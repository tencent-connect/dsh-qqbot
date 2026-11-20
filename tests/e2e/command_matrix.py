"""QQ commands, native selection, and cold replay against a runner-owned Host."""
import argparse
import json
import sys
import time
from pathlib import Path

from command_api import CommandAPI, load_config, private_json, route_id


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def headers(events):
    return [{key: event.get('data', {}).get('header', {}).get('config', {}).get(key)
             for key in ('provider', 'model', 'reasoningEffort')}
        for event in events if event['type'] == 'request/header']


class Matrix:
    def __init__(self, settings):
        self.settings = settings
        self.path = Path(settings['runDir']) / 'command-report.json'
        self.report = {'version': 1, 'startedAt': time.time(),
            'mode': 'model-enabled' if settings['allowModelRequests'] else 'commands-only',
            'passed': False, 'cases': [], 'skipped': [], 'requests': [],
            'coverage': {'transport': 'local QQ HTTP/WS', 'realQQAccount': False}}
        self.save()
        self.api = None
        self.key = CommandAPI.peer_key()
        self.group_key = CommandAPI.peer_key('group')
        self.primary = settings['primary']
        self.secondary = settings['secondary']
        self.preset_primary = settings['presets']['primary']
        self.preset_secondary = settings['presets']['secondary']

    def save(self):
        private_json(self.path, self.report)

    def check(self, name, action):
        row = {'case': name, 'startedAt': time.time()}
        self.report['cases'].append(row)
        self.save()
        try:
            row['result'] = action()
            row['status'] = 'passed'
        except Exception as error:
            row.update({'status': 'failed', 'errorType': type(error).__name__,
                'error': str(error)[:300]})
            self.report['failure'] = {'case': name, 'errorType': type(error).__name__,
                'message': str(error)[:300]}
            raise
        finally:
            row['finishedAt'] = time.time()
            self.save()
        print(json.dumps({'case': name, 'status': row['status']}), flush=True)
        return row.get('result')

    def send(self, command, contains=(), scope='c2c'):
        result = self.api.inject(command, scope=scope)
        text = '\n'.join(row['content'] for row in result['outbound'])
        require(bool(result['outbound']), f'{command}: expected a synthetic response')
        require(all(part in text for part in contains), f'{command}: response did not contain its expected command feedback')
        return text

    def session_id(self):
        return self.api.prefs()['sessionIds'][self.key]

    def projection(self):
        value = self.api.projection(self.session_id())
        require(value is not None, 'Expected a persisted Session projection')
        return value

    def assert_route(self, actual, expected):
        require(all(actual.get(key) == value for key, value in expected.items()), 'Model selection does not match the expected route/effort')

    def new_alias(self, command, scope='c2c'):
        key = self.api.peer_key(scope)
        settings = self.api.peer_settings()
        before = self.api.prefs()
        self.send(command, ['已开启新会话'], scope=scope)
        after = self.api.prefs()
        require(self.api.peer_settings() == settings, 'New Session changed configured peer options')
        require(before['overrides'] == after['overrides'] and before['presets'] == after['presets'], 'New Session discarded chat overrides')
        require(after['sessionIds'][key] != before['sessionIds'].get(key), 'New Session did not change its identity')
        require(all(after['sessionIds'].get(peer) == sid for peer, sid in before['sessionIds'].items()
            if peer != key), 'New Session changed another peer binding')
        return {'alias': command, 'overridesPreserved': True}

    def smoke(self, preset):
        result = self.api.inject('smoke')
        sid = self.session_id()
        self.api.wait_idle(sid)
        # Host idle does not wait for the QQ delivery callback.
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            outbound = self.api.fixture('observations')['outbound']
            if any('QQ_CMD_OK' in row['content'].replace('\\_', '_')
                   and row['path'] == '/v2/users/local-fixture-allowed-user/messages'
                   for row in outbound if row['sequence'] > result['baseline']):
                break
            time.sleep(.05)
        else:
            raise AssertionError('The completed smoke reply is missing its fixed marker')
        values = self.projection()
        require(values['agentPreset'] == preset, 'The generated Session used another preset')
        self.assert_route(values['modelSelection']['lastUsed'], self.primary)
        items = self.api.rpc('session/list', {'_request': {}})['items']
        item = next((item for item in items if item['sessionId'] == sid), None)
        require(item is not None and Path(item['cwd']).resolve() == Path(self.settings['workspace']).resolve(), 'Session working directory is outside the test workspace')
        events = self.api.events(sid)
        request_headers = headers(events)
        require(bool(request_headers), 'The Session has no actual model request header')
        for route in request_headers:
            self.assert_route(route, self.primary)
        self.report['requests'].append({'sessionId': sid, 'preset': preset,
            'route': self.primary, 'requestHeaderCount': len(request_headers), 'cwdVerified': True})
        return {'sessionId': sid, 'preset': preset, 'route': self.primary,
            'historyEvents': len(events), 'cwdVerified': True}

    def basics(self):
        def listing():
            self.api.fixture('outbound', {'mode': 'success'})
            self.api.set_defaults('inherited')
            for command, expected in [
                    ('help', ['/model', '/preset', '/bot-me']),
                    ('model', [self.primary['model'], self.secondary['model']]),
                    ('preset', [self.preset_primary, self.preset_secondary]),
                    ('version', ['dsh-qqbot v']), ('stop', ['当前没有进行中的生成'])]:
                self.send(command, expected)
            self.send('ping', ['pong'], scope='group')
            return {'privateAndGroupRoundTrip': True}
        self.check('command-menus-and-idle-stop', listing)

        def isolation():
            self.send('model-primary', ['模型已切换', self.primary['model']])
            self.send('model-secondary', ['模型已切换', self.secondary['model']], scope='group')
            settings = self.api.peer_settings()
            self.assert_route(settings[self.key]['agent']['model'], {k: self.primary[k] for k in ('provider', 'model')})
            self.assert_route(settings[self.group_key]['agent']['model'], {k: self.secondary[k] for k in ('provider', 'model')})
            return {'privateGroupIsolated': True}
        self.check('model-overrides-are-peer-scoped', isolation)

        def presets():
            self.send('preset-minimal', [self.preset_secondary])
            before = self.api.peer_settings()
            require(before[self.key]['agent']['preset'] == self.preset_secondary, 'Preset override not saved')
            require(before[self.group_key]['agent']['preset'] != self.preset_secondary, 'Private preset leaked into the group')
            self.send('preset-invalid', ['未知 preset'])
            require(self.api.peer_settings() == before, 'Invalid preset changed preferences')
            self.send('preset-reset', ['已重置'])
            require(self.api.peer_settings()[self.key]['agent']['preset'] == '', 'Preset reset retained an override')
            self.send('preset-standard', [self.preset_primary])
            return {'invalidChoiceUnchanged': True, 'resetClearsOverride': True}
        self.check('preset-select-and-reset', presets)

        def aliases():
            return {'aliases': [self.new_alias('new', scope='group'),
                *(self.new_alias(command) for command in ('new', 'reset', 'clear'))]}
        self.check('new-reset-clear-keep-other-peer-and-overrides', aliases)

        def reload():
            before = self.api.prefs()
            settings = self.api.peer_settings()
            reconnect = self.api.set_defaults('web-primary')
            require(reconnect['hmr'], 'Configuration reload did not cause a new SDK READY')
            require(self.api.prefs() == before, 'Reload changed saved chat overrides or Session bindings')
            require(self.api.peer_settings() == settings, 'Reload changed conversation settings')
            self.send('ping', ['pong'], scope='group')
            self.send('ping', ['pong'])
            return {'samePreferences': True, 'readyBefore': reconnect['readyBefore'],
                'readyAfter': reconnect['readyAfter']}
        self.check('config-reload-keeps-peer-bindings', reload)

    def model_roundtrip(self):
        self.send('model-primary', ['模型已切换', self.primary['model']])
        self.send('preset-standard', [self.preset_primary])
        self.new_alias('new')
        return self.smoke(self.preset_primary)

    def run(self):
        try:
            def authenticate():
                self.api = CommandAPI(self.settings)
                return {'dummyBinding': True, 'ownedWorkspace': True}
            self.check('authenticate-owned-dummy-host', authenticate)
            self.basics()
            if self.settings['allowModelRequests']:
                self.check('primary-model-roundtrip', self.model_roundtrip)
            else:
                self.report['skipped'].append({'case': 'primary-model-roundtrip',
                    'reason': 'Model requests were not enabled'})
            self.report['passed'] = True
        finally:
            self.report['finishedAt'] = time.time()
            self.report['caseCount'] = len(self.report['cases'])
            self.save()
        return self.report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    args = parser.parse_args()
    matrix = None
    try:
        matrix = Matrix(load_config(args.config))
        report = matrix.run()
        print(json.dumps({'passed': report['passed'], 'cases': report['caseCount'],
            'skipped': len(report['skipped']), 'report': str(matrix.path)}))
        return 0
    except Exception as error:
        # Neither raw HTTP responses nor authentication URLs belong on stdout.
        print(json.dumps({'passed': False, 'errorType': type(error).__name__,
            'report': str(matrix.path) if matrix else None}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

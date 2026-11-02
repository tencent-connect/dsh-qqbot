"""QQ commands, native selection, and cold replay against a runner-owned Host."""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

from command_api import CommandAPI, load_config, private_json, route_id


class Skipped(Exception):
    pass


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def headers(events):
    return [{key: event.get('data', {}).get('header', {}).get('config', {}).get(key)
             for key in ('provider', 'model', 'reasoningEffort')}
        for event in events if event['type'] == 'request/header']


def human_history(events):
    result = []
    for event in events:
        data = event.get('data', {})
        if event['type'] == 'user/message' and data.get('source', {}).get('kind') == 'user':
            result.append({'role': 'user', 'content': data.get('content', [])})
        elif event['type'] == 'assistant/message':
            result.append({'role': 'assistant', 'content': data.get('message', {}).get('content', [])})
    return result


class Matrix:
    def __init__(self, settings):
        self.settings = settings
        self.path = Path(settings['runDir']) / 'command-report.json'
        self.report = {'version': 1, 'startedAt': time.time(),
            'mode': 'model-enabled' if settings['allowModelRequests'] else 'commands-only',
            'passed': False, 'cases': [], 'skipped': [], 'requests': [],
            'coverage': {'transport': 'local QQ HTTP/WS', 'realQQAccount': False,
                'history': False, 'coldReplay': False, 'runningCancellation': False,
                'compaction': 'untested', 'disconnectFaultInjection': False}}
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
        except Skipped as error:
            row.update({'status': 'skipped', 'reason': str(error)})
            self.report['skipped'].append({'case': name, 'reason': str(error)})
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

    def unchanged(self, command, contains):
        before = self.api.prefs()
        self.send(command, contains)
        require(self.api.prefs() == before, f'{command}: invalid choice changed preferences')
        return {'preferencesUnchanged': True}

    def session_id(self):
        return self.api.prefs()['sessionIds'][self.key]

    def projection(self):
        value = self.api.projection(self.session_id())
        require(value is not None, 'Expected a persisted Session projection')
        return value

    def assert_route(self, actual, expected):
        require(all(actual.get(key) == value for key, value in expected.items()), 'Model selection does not match the expected route/effort')

    def primary_defaults(self):
        self.api.set_defaults('model-inherited-preset-primary')
        self.send('model-reset')
        self.send('preset-reset')

    def new_alias(self, command):
        before = self.api.prefs()
        self.send(command, ['已开启新会话'])
        after = self.api.prefs()
        require(before['overrides'] == after['overrides'] and before['presets'] == after['presets'], 'New Session discarded chat overrides')
        require(after['sessionIds'][self.key] != before.get('sessionIds', {}).get(self.key), 'New Session did not change its identity')
        return {'alias': command, 'overridesPreserved': True}

    def smoke(self, preset):
        result = self.api.inject('smoke')
        sid = self.session_id()
        self.api.wait_idle(sid)
        outbound = self.api.fixture('observations')['outbound']
        require(any('QQ_CMD_OK' in row['content'].replace('\\_', '_')
            for row in outbound if row['sequence'] > result['baseline']), 'The completed smoke reply is missing its fixed marker')
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
            'historyItems': len(human_history(events)), 'cwdVerified': True}

    def select_model(self, command, expected, preset, pending):
        sid = self.session_id()
        before = self.api.events(sid)
        history = human_history(before)
        self.send(command)
        require(self.session_id() == sid, 'Model selection replaced the Session')
        after = self.api.events(sid)
        require(after[:len(before)] == before, 'Model selection changed existing events')
        require(human_history(after)[:len(history)] == history, 'Model selection changed human/assistant history')
        selections = [event['data'] for event in after[len(before):] if event['type'] == 'model/selection']
        require(bool(selections), 'Model selection was not durably recorded')
        value = self.projection()
        self.assert_route(value['modelSelection']['next'], expected)
        require(value['agentPreset'] == preset, 'Model selection remounted the current preset')
        require(self.api.prefs()['presets'].get(self.key) == pending, 'Model selection changed the pending preset')
        self.send('status', [f"{expected['provider']}/{expected['model']}", f'Preset: {preset}'])
        self.report['coverage']['history'] = True
        return {'sessionId': sid, 'sameSessionId': True, 'eventPrefixEqual': True,
            'historyItems': len(history), 'historyHash': digest(history), 'selectionEvents': len(selections),
            'next': value['modelSelection']['next'], 'actualPreset': preset, 'pendingPreset': pending}

    def basics(self):
        def neutral():
            self.api.fixture('outbound', {'mode': 'success'})
            self.api.set_defaults('inherited')
            self.send('new')
            self.send('model-reset')
            self.send('preset-reset')
            return {'freshSessionPointer': True}
        self.check('neutral-inherited-defaults', neutral)

        def listing():
            for command, expected in [('help', ['/model', '/preset', '/stop']),
                    ('model', [self.primary['model'], self.secondary['model']]),
                    ('preset', [self.preset_primary, self.preset_secondary]),
                    ('ping', ['pong']), ('version', [self.primary['model']]),
                    ('stop', ['当前没有进行中的生成'])]:
                self.send(command, expected)
            return {'commands': ['help', 'model', 'preset', 'ping', 'version', 'stop']}
        self.check('command-menus-and-idle-stop', listing)

        def short_and_invalid():
            command = 'model-primary' if '/' in self.primary['model'] else 'model-short'
            self.send(command, ['当前会话模型已切换'])
            self.assert_route(self.api.prefs()['overrides'][self.key], self.primary)
            self.unchanged('model-invalid', ['模型切换失败'])
            self.unchanged('preset-invalid', ['未知 preset'])
            return {'shortSyntax': 'not applicable: model ID contains slash' if command == 'model-primary' else 'passed', 'invalidChoicesUnchanged': True}
        self.check('model-syntax-and-invalid-choices', short_and_invalid)

        def priority():
            self.api.set_defaults('web-primary')
            self.send('model-primary')
            self.api.set_defaults('web-secondary')
            self.assert_route(self.api.prefs()['overrides'][self.key], self.primary)
            self.send('model', [self.primary['model'], self.secondary['model']])
            self.send('model', [self.secondary['model']], scope='group')
            require(self.group_key not in self.api.prefs()['overrides'], 'Private override leaked into the group')
            self.send('model-reset', [self.secondary['model']])
            self.send('model-default', [self.secondary['model']])
            require(self.key not in self.api.prefs()['overrides'], 'Model reset retained a chat override')
            return {'privateGroupIsolated': True, 'resetFollowsLatestWebDefault': True}
        self.check('peer-web-host-priority-and-group-isolation', priority)

        def preset_defaults():
            self.send('preset-standard')
            require(self.api.prefs()['presets'][self.key] == self.preset_primary, 'Preset command did not persist its override')
            self.send('preset-reset')
            self.send('preset', [self.preset_secondary])
            self.send('preset-standard')
            self.send('preset-default')
            require(self.key not in self.api.prefs()['presets'], 'Preset reset retained a chat override')
            return {'resetFollowsWebPreset': True}
        self.check('preset-reset-and-default-alias', preset_defaults)

        self.check('new-reset-clear-keep-chat-overrides', self.aliases_and_hmr)

    def aliases_and_hmr(self):
        self.send('model-primary')
        self.send('preset-standard')
        aliases = [self.new_alias(command) for command in ('reset', 'clear')]
        before = self.api.prefs()
        hmr = self.api.set_defaults('web-primary')
        require(self.api.prefs() == before, 'Web reload changed saved chat overrides')
        self.api.set_defaults('inherited')
        self.send('model-reset')
        self.send('preset-reset')
        return {'aliases': aliases, 'preferencesSurviveHmr': True, 'hmrObserved': hmr['hmr']}

    def full(self):
        self.check('complete-primary-model-turn', lambda: (self.primary_defaults(), self.smoke(self.preset_primary))[1])

        def pending():
            self.send('preset-minimal')
            require(self.projection()['agentPreset'] == self.preset_primary, 'Pending preset changed the active Session')
            require(self.api.prefs()['presets'][self.key] == self.preset_secondary, 'Pending preset was not saved')
            return {'currentPreset': self.preset_primary, 'nextPreset': self.preset_secondary}
        self.check('preset-only-affects-next-session', pending)
        self.check('native-model-select-retains-history-and-current-preset',
            lambda: self.select_model('model-secondary', self.secondary, self.preset_primary, self.preset_secondary))
        self.check('status-and-version-current-route', lambda: self.current_feedback(self.secondary, self.preset_primary, self.preset_secondary))
        self.check('model-reset-keeps-current-and-pending-presets',
            lambda: self.select_model('model-reset', self.primary, self.preset_primary, self.preset_secondary))
        self.check('new-keeps-override-and-applies-pending-preset',
            lambda: (self.new_alias('new'), self.smoke(self.preset_secondary))[1])

        def clear_pending():
            self.send('preset-reset')
            require(self.key not in self.api.prefs()['presets'], 'Preset reset retained an override')
            require(self.projection()['agentPreset'] == self.preset_secondary, 'Preset reset remounted the active Session')
            return {'activePresetUnchanged': True}
        self.check('preset-reset-keeps-started-session', clear_pending)
        self.check('model-select-keeps-secondary-active-preset',
            lambda: self.select_model('model-secondary', self.secondary, self.preset_secondary, None))
        self.check('model-reset-keeps-secondary-active-preset',
            lambda: self.select_model('model-reset', self.primary, self.preset_secondary, None))
        self.check('new-applies-web-primary-preset', lambda: (self.new_alias('new'), self.smoke(self.preset_primary))[1])
        self.check('web-reload-retains-overrides', self.aliases_and_hmr)
        self.check('primary-turn-after-web-reload', lambda: (self.primary_defaults(), self.smoke(self.preset_primary))[1])

        def compact():
            self.send('compact')
            self.api.wait_idle(self.session_id())
            self.send('stop', ['当前没有进行中的生成'])
            self.report['coverage']['compaction'] = 'short-history command path; long-context summary untested'
            return {'shortHistoryPath': True}
        self.check('short-history-compact-and-idle-stop', compact)
        self.check('cancel-a-running-generation', self.running_stop)
        self.check('cold-model-selection-after-web-reload',
            lambda: self.cold_select('web-primary', 'model-secondary', self.secondary))
        self.check('cold-model-reset-after-web-reload',
            lambda: self.cold_select('model-inherited-preset-primary', 'model-reset', self.primary))
        self.check('cold-selection-survives-another-reload', self.cold_replay)

    def current_feedback(self, route, preset, pending):
        self.send('status', [f"{route['provider']}/{route['model']}", f'Preset: {preset}', pending])
        self.send('preset', [preset, pending])
        self.send('version', [f"{route['provider']}/{route['model']}"])
        return {'currentAndPendingFeedback': True}

    def running_stop(self):
        sid = self.session_id()
        before = self.api.events(sid)
        result = self.api.inject('smoke', wait=False)
        for _ in range(80):
            if self.api.state(sid)['running']:
                break
            time.sleep(.025)
        else:
            self.api.wait_idle(sid)
            for route in headers(self.api.events(sid)):
                self.assert_route(route, self.primary)
            raise Skipped('Generation completed before a running state could be observed; not retried')
        self.send('stop')
        self.api.wait_idle(sid)
        events = self.api.events(sid)
        for route in headers(events):
            self.assert_route(route, self.primary)
        endings = [event['data'] for event in events[len(before):] if event['type'] == 'turn/end']
        require(bool(endings), 'Cancellation did not produce a durable turn end')
        reason = endings[-1].get('reason', {})
        require(reason.get('kind') == 'aborted' and reason.get('reason', {}).get('kind') == 'user', 'The observed turn was not cancelled by the user stop command')
        self.report['coverage']['runningCancellation'] = True
        return {'observedRunning': True, 'durableUserAbort': True}

    def cold_select(self, scenario, command, expected):
        sid = self.session_id()
        before = self.api.events(sid)
        preset = self.projection()['agentPreset']
        reconnect = self.api.set_defaults(scenario)
        require(reconnect['hmr'], 'Cold case did not observe an actual SDK reconnect')
        self.send(command)
        require(self.session_id() == sid, 'Cold selection replaced the persisted Session')
        after = self.api.events(sid)
        require(after[:len(before)] == before, 'Cold selection changed existing history')
        require(any(event['type'] == 'model/selection' for event in after[len(before):]), 'Cold selection did not append its durable choice')
        require(headers(after) == headers(before), 'Selection-only cold command generated a model request')
        values = self.projection()
        self.assert_route(values['modelSelection']['next'], expected)
        require(values['agentPreset'] == preset, 'Cold selection changed the locked preset')
        self.send('status', [f"{expected['provider']}/{expected['model']}", f'Preset: {preset}'])
        self.send('version', [f"{expected['provider']}/{expected['model']}"])
        return {'sameSessionId': True, 'eventPrefixEqual': True, 'historyHash': digest(human_history(before)),
            'noNewModelRequests': True, 'selection': values['modelSelection']['next'], 'actualPreset': preset,
            'hmrReadyBefore': reconnect['readyBefore'], 'hmrReadyAfter': reconnect['readyAfter']}

    def cold_replay(self):
        results = []
        for scenario in ('web-primary', 'model-inherited-preset-primary'):
            sid = self.session_id()
            before = self.api.events(sid)
            reconnect = self.api.set_defaults(scenario)
            require(reconnect['hmr'], 'Replay case did not observe a reload')
            self.send('model', [self.primary['model']])
            after = self.api.events(sid)
            require(self.session_id() == sid and after[:len(before)] == before, 'Reload changed the saved Session or existing events')
            require(headers(before) == headers(after), 'Read-only model listing generated a request')
            values = self.projection()
            self.assert_route(values['modelSelection']['next'], self.primary)
            require(values['agentPreset'] == self.preset_primary, 'Replay changed the actual preset')
            results.append({'sameSessionId': True, 'eventPrefixEqual': True, 'noNewModelRequests': True})
        self.report['coverage']['coldReplay'] = True
        return {'replays': results}

    def run(self):
        try:
            def authenticate():
                self.api = CommandAPI(self.settings)
                return {'dummyBinding': True, 'ownedWorkspace': True}
            self.check('authenticate-owned-dummy-host', authenticate)
            self.basics()
            if self.settings['allowModelRequests']:
                self.full()
            else:
                for case in ('real-model-roundtrip', 'history-preserving-selection', 'cold-replay', 'running-cancellation', 'compaction'):
                    self.report['skipped'].append({'case': case, 'reason': 'Model requests were not enabled; no persisted model turn was created'})
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

"""Rerunnable stock-Host QQ acceptance, with explicit timing and restart gates."""
import argparse
import copy
import hashlib
import json
import time
import uuid
from pathlib import Path

from upstream_api import RpcError, UpstreamAPI, load_config, private_json


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Inconclusive(RuntimeError):
    pass


def event_text(events, kind='user/message'):
    result = []
    for event in events:
        if event['type'] != kind:
            continue
        data = event['data'].get('message', {}) if kind == 'assistant/message' else event['data']
        result.extend(part['text'] for part in data.get('content', []) if part.get('type') == 'text')
    return '\n'.join(result)


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class Acceptance:
    def __init__(self, args):
        self.args = args
        self.api = UpstreamAPI(load_config(args.config))
        self.root = self.api.run_dir
        self.tag = uuid.uuid4().hex[:12]
        self.report = {'version': 1, 'deployment': 'stock-qqbot-commands', 'startedAt': time.time(),
            'passed': False, 'modelRequestsEnabled': args.allow_model_requests, 'cases': [],
            'evidenceBoundary': 'Synthetic QQ gateway with real unmodified stock Host; no real QQ account or handset validation'}
        self.report_path = self.root / f'acceptance-{self.tag}.json'

    def save(self):
        private_json(self.report_path, self.report)

    def wait(self, predicate, message, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(.03)
        raise Inconclusive(message)

    def ensure_entry(self, scope='c2c'):
        if not self.api.entry(scope):
            self.api.command('status', scope=scope)
        return self.wait(lambda: self.api.entry(scope), 'Synthetic peer discovery did not appear')

    def configure(self, scope='c2c', archive=False):
        entry = self.ensure_entry(scope)
        if entry['currentSessionId']:
            self.api.wait_idle(entry['currentSessionId'])
        policy = copy.deepcopy(entry['policy'])
        policy.update({'allowedModels': sorted({f'{route["provider"]}/{route["model"]}'
            for route in [self.api.settings['primary'], self.api.settings['secondary']]}),
            'allowedPresets': sorted(set(self.api.settings['presets'].values())),
            'allowedPermissions': ['read-only'], 'permission': 'read-only',
            'requireMention': True, 'receiveEnabled': True, 'replyEnabled': True,
            'toolMode': 'restricted', 'cwd': self.api.settings['workspace'],
            'controllers': ['local-fixture-allowed-user'], 'approvers': [],
            'tools': {key: 'deny' for key in policy['tools']}})
        policy['resources'].update({'executionEnabled': False, 'sandbox': 'read-only',
            'readRoots': [], 'writeRoots': [], 'sendRoots': [], 'networkDomains': []})
        if archive:
            policy['context']['mode'] = 'archive'
        self.api.action('policy', scope=scope, expectedVersion=entry['policy']['version'], policy=policy, alias=entry['alias'])
        current = self.api.entry(scope)
        if current['currentSessionId']:
            self.api.action('permission', scope=scope, value='read-only')
        self.api.action('model', scope=scope,
            value=f'{self.api.settings["primary"]["provider"]}/{self.api.settings["primary"]["model"]}',
            **({'reasoningEffort': self.api.settings['primary']['reasoningEffort']}
               if self.api.settings['primary'].get('reasoningEffort') else {}))
        self.api.action('preset', scope=scope, value=self.api.settings['presets']['primary'])
        return self.api.entry(scope)

    def requests(self, events):
        headers = [row for row in events if row['type'] == 'request/header']
        require(headers, 'No actual native model request was recorded')
        expected = self.api.settings['primary']
        require(all(all(row['data'].get('header', {}).get('config', {}).get(key) == value
            for key, value in expected.items()) for row in headers), 'Actual request route or reasoning effort changed')
        return len(headers)

    def settle(self, session_id, previous_cursor=-1):
        self.wait(lambda: self.api.state(session_id)['cursor'] > previous_cursor,
            'Session did not admit the submitted input', timeout=30)
        self.api.wait_idle(session_id)
        time.sleep(.25)
        events = self.api.events(session_id)
        return [row for row in events if row['seq'] > previous_cursor]

    def preflight(self):
        config = self.api.assert_dummy()
        fixture = self.api.fixture('status')
        require(fixture['activeConnections'] == 1 and fixture['readyCount'] >= 1, 'One ready synthetic QQ connection is required')
        require(self.api._request('/qqbot/im-qqbot/runtime')['phase'] == 'ready', 'QQ runtime is not ready')
        catalog = self.api.rpc('session/modelCatalog')
        require(not catalog.get('failures'), 'Live model catalog reports a provider failure')
        expected = self.api.settings['primary']
        require(all(catalog['default'].get(key) == value for key, value in expected.items()), 'Host default differs from the explicit primary route')
        self.api.fixture('outbound', {'mode': 'success'})
        return {'dummyAppId': config['appId'], 'actualHostDefault': catalog['default'],
            'sdkConnections': fixture['activeConnections'], 'modelRequestsAdded': 0}

    def commands(self):
        entry = self.configure()
        sid = entry['currentSessionId']
        before = self.api.events(sid) if sid else []
        primary = f'{self.api.settings["primary"]["provider"]}/{self.api.settings["primary"]["model"]}'
        for command, value in [('model-primary', primary), ('model-secondary', None), ('model-primary', primary)]:
            self.api.command(command)
            expected = value or f'{self.api.settings["secondary"]["provider"]}/{self.api.settings["secondary"]["model"]}'
            require(self.api.entry()['currentModel'] == expected, 'QQ model command did not reach native effective selection')
        for command, expected in [('preset-minimal', self.api.settings['presets']['secondary']),
                ('preset-standard', self.api.settings['presets']['primary'])]:
            self.api.command(command)
            current = self.api.entry()
            require(expected in {current['currentPreset'], current['nextPreset']}, 'QQ preset command did not reach native preset selection')
        self.api.command('new')
        next_sid = self.api.entry()['currentSessionId']
        require(next_sid is None or next_sid != sid, 'QQ /new retained the prior Session binding')
        if next_sid:
            require(not any(row['type'] in {'request/header', 'turn/start'} for row in self.api.events(next_sid)),
                'QQ /new started generation in the replacement Session')
        require([row for row in self.api.events(sid) if row['type'] in {'request/header', 'turn/start'}]
            == [row for row in before if row['type'] in {'request/header', 'turn/start'}] if sid else True,
            'Selection-only commands started a model turn')
        return {'modelSelectionReadback': True, 'presetSelectionReadback': True,
            'previousSessionId': sid, 'replacementSessionId': next_sid, 'priorBindingReleased': True,
            'secondaryDiffers': any(self.api.settings['primary'][key] != self.api.settings['secondary'][key]
                for key in ('provider', 'model')), 'modelRequestsAdded': 0}

    def workspace(self):
        entry = self.configure()
        previous = entry['currentSessionId']
        directory = Path(self.api.settings['workspace']) / ('upstream-' + self.tag)
        directory.mkdir(mode=0o700)
        try:
            listed = self.api.rpc('directoryPicker/list', {'path': str(directory)})
            listing = {'available': isinstance(listed, dict), 'status': 'passed'}
        except RpcError as error:
            if str(error) != 'directoryPicker/list: directory-picker/unavailable':
                raise
            listing = {'available': False, 'status': 'not-applicable',
                'reason': 'Stock deployment selects a native chooser instead of the browse directory-picker capability'}
        adopted = self.api.adopt_workspace(str(directory))['workspace']
        value = self.api.action('workspace', workspaceId=adopted['workspaceId'])
        current = self.api.entry()
        require(current['currentSessionId'] == value['sessionId'] and current['currentSessionId'] != previous,
            'Workspace change did not create and bind a new native Session')
        require(current['currentWorkspace']['path'] == str(directory), 'Workspace selection did not round trip through the native registry')
        events = self.api.events(current['currentSessionId'])
        require(not [row for row in events if row['type'] in {'turn/start', 'request/header'}], 'Workspace selection started generation')
        return {'sessionId': current['currentSessionId'], 'workspaceId': adopted['workspaceId'],
            'directoryListing': listing, 'modelRequestsAdded': 0}

    def passive(self):
        entry = self.configure('group', archive=True)
        sid = entry['currentSessionId']
        before = self.api.events(sid) if sid else []
        cursor = self.api.outbound_cursor()
        marker = 'UPSTREAM_PASSIVE_' + self.tag
        message_id = self.api.inject(marker, scope='group', mention=False, full=True)
        messages = self.wait(lambda: next((row for row in self.api.action('messages', scope='group')['messages'] if row['id'] == message_id), None),
            'Passive group message did not reach its archive')
        time.sleep(.4)
        current = self.api.entry('group')
        require(current['currentSessionId'] == sid, 'Passive group traffic created or rotated an Agent Session')
        after = self.api.events(sid) if sid else []
        require(after == before, 'Passive group traffic mutated the native Session log')
        outbound = self.api.outbound_evidence(cursor)
        require(not outbound['contentMessages'], 'Passive group traffic sent a QQ response')
        require(messages['text'] == marker, 'Passive archive content changed')
        return {'messageId': message_id, 'sessionId': sid, 'archived': True,
            'nativeLogChanged': False, 'qqResponses': 0, 'modelRequestsAdded': 0, 'outbound': outbound}

    def final_once(self):
        entry = self.configure()
        self.api.command('new')
        previous = entry['currentSessionId']
        cursor = self.api.outbound_cursor()
        marker = 'UPSTREAM_QQ_FINAL_' + self.tag
        message_id = self.api.inject('只回复 ' + marker + '。不要调用工具。')
        current = self.wait(lambda: (self.api.entry() or {}).get('currentSessionId'), 'QQ trigger did not bind a native Session', timeout=30)
        require(current != previous, 'QQ /new reused the prior Session')
        events = self.settle(current)
        self.api.wait_outbound(cursor, timeout=30, contents_only=True)
        time.sleep(.3)
        outbound = self.api.outbound_evidence(cursor)
        rows = outbound['contentMessages']
        require(len(rows) == 1 and rows[0]['path'] == '/v2/users/local-fixture-allowed-user/messages'
            and marker in rows[0]['content'], 'A private QQ turn did not send exactly one final response')
        require(any(row['type'] == 'user/message' and row['data'].get('source', {}).get('qq', {}).get('messageId') == message_id
            for row in events), 'QQ input is absent from its real native Session')
        require(any(row['type'] == 'turn/end' and row['data']['reason']['kind'] == 'completed' for row in events), 'QQ turn did not complete natively')
        require(marker in event_text(events, 'assistant/message'), 'Native assistant final did not carry the QQ result')
        private_json(self.root / ('final-once-events-' + self.tag + '.json'), events)
        return {'sessionId': current, 'messageId': message_id, 'qqResponses': len(rows),
            'actualRequests': self.requests(events), 'outbound': outbound}

    def native(self, separate=False):
        self.configure()
        sid = self.api.create_native(preset=self.api.settings['presets']['primary']) if separate else self.api.entry()['currentSessionId']
        if not sid:
            raise Inconclusive('Shared native prompt needs a QQ Session; run final-once or workspace first')
        cursor = self.api.outbound_cursor()
        before = self.api.events(sid)
        mark = ('UPSTREAM_NATIVE_NEW_' if separate else 'UPSTREAM_NATIVE_SHARED_') + self.tag
        request = self.api.prompt(sid, '只回复 ' + mark + '。不要调用工具。')
        events = self.settle(sid, before[-1]['seq'] if before else -1)
        require(mark in event_text(events, 'assistant/message'), 'Native browser prompt did not finish in its Session')
        outbound = self.api.outbound_evidence(cursor)
        require(not outbound['contentMessages'], 'A native browser prompt sent an automatic QQ response')
        require(any(row['type'] == 'user/message' and row['data'].get('source', {}).get('rpcId') == request for row in events),
            'Native prompt request identity is missing from Session history')
        return {'sessionId': sid, 'requestId': request, 'qqResponses': 0, 'actualRequests': self.requests(events),
            'sharesQQSession': not separate, 'outbound': outbound}

    def timing(self, mode):
        self.configure()
        sid = self.api.entry()['currentSessionId']
        if not sid:
            raise Inconclusive('Timing verification needs an existing QQ Session')
        cursor = self.api.outbound_cursor()
        before = self.api.events(sid)
        floor = before[-1]['seq'] if before else -1
        long_prompt = '这是原生网页与QQ队列的真实时序验证。请写出从1到160的每个整数，每个整数后附五个汉字。不要调用工具。'
        self.api.prompt(sid, long_prompt)
        self.wait(lambda: self.api.state(sid)['running'], 'Native model did not enter an observable running window')
        marker = 'UPSTREAM_TIMING_' + mode.upper() + '_' + self.tag
        message = self.api.inject('只回复 ' + marker + '。不要调用工具。')
        try:
            item = self.wait(lambda: next((row for row in self.api.state(sid).get('queue') or []
                if row['placement'] == 'queued' and marker in json.dumps(row['content'], ensure_ascii=False)), None),
                'No editable QQ queue item was observed before model completion', timeout=12)
            if mode == 'edit':
                self.api.update_queue(sid, item['id'], 'edit', '只回复 UPSTREAM_EDITED_' + self.tag + '。不要调用工具。')
            else:
                self.api.update_queue(sid, item['id'], 'steer')
        except Inconclusive:
            self.api.wait_idle(sid)
            raise
        events = self.settle(sid, floor)
        outbound = self.api.outbound_evidence(cursor)
        require(not outbound['contentMessages'], 'Edited or steered QQ input retained automatic QQ egress')
        mutations = [row for row in events if row['type'] == 'agent/inbox/spliced'
            and item['id'] in json.dumps(row['data'])]
        require(mutations, 'Queue mutation is missing from durable native evidence')
        return {'sessionId': sid, 'messageId': message, 'itemId': item['id'], 'mutation': mode,
            'queueObservedBeforeMutation': True, 'qqResponses': 0, 'actualRequests': self.requests(events), 'outbound': outbound}

    def mixed(self):
        self.configure()
        sid = self.api.entry()['currentSessionId']
        if not sid:
            raise Inconclusive('Mixed-turn verification needs an existing QQ Session')
        cursor = self.api.outbound_cursor()
        before = self.api.events(sid)
        floor = before[-1]['seq'] if before else -1
        message = self.api.inject('这是混合输入抑制验证。请写出从1到160的每个整数，每个整数后附五个汉字。不要调用工具。')
        self.wait(lambda: self.api.state(sid)['running'], 'QQ model did not enter an observable running window')
        request = self.api.prompt(sid, '网页接管本轮。只回复 UPSTREAM_MIXED_' + self.tag + '。不要调用工具。', mode='steer')
        events = self.settle(sid, floor)
        turn = None
        sources = {}
        for event in events:
            if event['type'] == 'turn/start':
                turn = event['data']['turn']
            elif event['type'] == 'user/message':
                source = event['data'].get('source', {})
                if source.get('qq', {}).get('messageId') == message:
                    sources['qq'] = turn
                if source.get('rpcId') == request:
                    sources['web'] = turn
        if sources.get('qq') is None or sources.get('qq') != sources.get('web'):
            raise Inconclusive('Actual Session history did not place QQ and browser input in the same native turn')
        outbound = self.api.outbound_evidence(cursor)
        require(not outbound['contentMessages'], 'A mixed QQ and browser turn sent automatic QQ output')
        return {'sessionId': sid, 'messageId': message, 'requestId': request, 'sameTurn': sources['qq'],
            'qqResponses': 0, 'actualRequests': self.requests(events), 'outbound': outbound}

    def restart_prepare(self):
        snapshot = self.api.snapshot()
        sessions = {}
        for entry in snapshot['conversations']:
            for item in entry['sessions']:
                sid = item['sessionId']
                self.api.wait_idle(sid)
                events = self.api.events(sid)
                sessions[sid] = {'events': events, 'sha256': digest(events)}
        value = {'outboundCursor': self.api.outbound_cursor(), 'bindings': {row['key']: row['currentSessionId']
            for row in snapshot['conversations']}, 'sessions': sessions, 'createdAt': time.time()}
        private_json(self.root / 'restart-baseline.json', value)
        return {'sessions': len(sessions), 'outboundCursor': value['outboundCursor'], 'nextAction': 'Send restart to runner stdin, then run --case restart-after'}

    def restart_after(self):
        baseline = json.loads((self.root / 'restart-baseline.json').read_text())
        time.sleep(.5)
        snapshot = self.api.snapshot()
        require({row['key']: row['currentSessionId'] for row in snapshot['conversations']} == baseline['bindings'],
            'Restart changed QQ conversation Session bindings')
        outbound = self.api.outbound_evidence(baseline['outboundCursor'])
        require(not outbound['contentMessages'], 'Restart resent QQ output')
        for sid, prior in baseline['sessions'].items():
            events = self.api.events(sid)
            require(events[:len(prior['events'])] == prior['events'], 'Restart changed or lost a durable Session history prefix')
            require(not any(row['type'] in {'turn/start', 'request/header'} for row in events[len(prior['events']):]),
                'Restart replayed a model turn')
        return {'durableSessionPrefixes': len(baseline['sessions']), 'qqResponses': 0, 'modelRequestsAdded': 0,
            'outbound': outbound}

    def run(self):
        cases = {'preflight': self.preflight, 'commands': self.commands, 'workspace': self.workspace,
            'passive': self.passive, 'final-once': self.final_once, 'native-shared': lambda: self.native(False),
            'native-new': lambda: self.native(True), 'timing-edit': lambda: self.timing('edit'),
            'timing-steer': lambda: self.timing('steer'), 'timing-mixed': self.mixed, 'restart-prepare': self.restart_prepare,
            'restart-after': self.restart_after}
        selected = self.args.case or ['preflight', 'commands', 'workspace', 'passive', 'final-once', 'native-shared', 'native-new']
        if self.args.timing_cases:
            selected += ['timing-edit', 'timing-steer', 'timing-mixed']
        model_cases = {'passive', 'final-once', 'native-shared', 'native-new', 'timing-edit', 'timing-steer', 'timing-mixed'}
        try:
            for name in selected:
                if name in model_cases and not self.args.allow_model_requests:
                    self.report['cases'].append({'name': name, 'status': 'skipped', 'reason': '--allow-model-requests is required'})
                    continue
                started = time.monotonic()
                outbound_cursor = None
                try:
                    outbound_cursor = self.api.outbound_cursor()
                    result = cases[name]()
                    self.report['cases'].append({'name': name, 'status': 'passed', 'evidence': result,
                        'durationSeconds': round(time.monotonic() - started, 3)})
                except Inconclusive as error:
                    self.report['cases'].append({'name': name, 'status': 'inconclusive', 'reason': str(error)})
                    break
                except Exception as error:
                    self.report['cases'].append({'name': name, 'status': 'failed', 'errorType': type(error).__name__,
                        'reason': str(error) if isinstance(error, (AssertionError, RuntimeError)) else 'Inspect private runtime evidence'})
                    break
                finally:
                    row = self.report['cases'][-1]
                    if row['status'] in {'failed', 'inconclusive'} and outbound_cursor is not None:
                        try:
                            raw = self.api.outbound_since(outbound_cursor)
                            row['rawOutboundRequests'] = raw
                            row['outbound'] = self.api.classify_outbound(raw)
                        except RuntimeError as error:
                            row['outboundEvidenceError'] = str(error)
                    self.save()
            self.report['passed'] = all(row['status'] == 'passed' for row in self.report['cases'])
            self.report['remainingPrimitives'] = {'mixed-turn': 'UpstreamAPI.prompt(session_id, text, mode="steer") during an observed QQ turn',
                'queue-edit': 'UpstreamAPI.state -> update_queue(session_id, item_id, "edit", text)',
                'queue-steer': 'UpstreamAPI.state -> update_queue(session_id, item_id, "steer")',
                'restart': '--case restart-prepare, runner stdin restart, --case restart-after'}
        finally:
            self.report['finishedAt'] = time.time()
            self.save()
        print(json.dumps({'passed': self.report['passed'], 'cases': [{key: row[key] for key in ('name', 'status')}
            for row in self.report['cases']], 'report': str(self.report_path)}))
        return 0 if self.report['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--allow-model-requests', action='store_true')
    parser.add_argument('--timing-cases', action='store_true')
    parser.add_argument('--case', action='append', choices=['preflight', 'commands', 'workspace', 'passive', 'final-once',
        'native-shared', 'native-new', 'timing-edit', 'timing-steer', 'timing-mixed', 'restart-prepare', 'restart-after'])
    return Acceptance(parser.parse_args()).run()


if __name__ == '__main__':
    raise SystemExit(main())

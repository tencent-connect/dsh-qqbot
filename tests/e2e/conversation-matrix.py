"""Conversation/policy matrix against an explicitly owned, dummy-only local QQ Host.

Requires the local QQ fixture's --allowModelRequests configuration. It never
addresses the daily Host, the retained real-QQ review Host, or a remote target.
"""
import argparse
import copy
import json
import time
import urllib.error
import urllib.parse
import uuid
from pathlib import Path

from command_api import CommandAPI, json_request, origin, private_json

PATH = '/qqbot/im-qqbot/conversations'
FLASH = {'provider': 'deepseek-codebuddy', 'model': 'deepseek-v4.1-flash', 'reasoningEffort': 'high'}
OWNER = 'local-fixture-allowed-user'
CONTROLLER = 'local-fixture-denied-user'


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def text_of(events, event_type='user/message'):
    result = []
    for event in events:
        if event['type'] != event_type:
            continue
        data = event.get('data', {})
        if event_type == 'assistant/message':
            data = data.get('message', {})
        result.extend(part['text'] for part in data.get('content', []) if part.get('type') == 'text')
    return '\n'.join(result)


def result_call_id(event):
    data = event.get('data', {})
    message = data.get('message', {})
    return data.get('callId') or message.get('toolCallId') or message.get('source', {}).get('callId')


def result_is_error(event):
    data = event.get('data', {})
    return bool(data.get('error') or data.get('message', {}).get('isError'))


class ConversationMatrix:
    def __init__(self, args):
        self.args = args
        self.home = Path(args.test_home).resolve()
        require(self.home not in {Path.home(), Path.home() / '.dsh', Path('/')}, 'A dedicated isolated test home is required')
        self.host, self.qq = origin(args.host_origin), origin(args.fixture_origin)
        for value in [self.host, self.qq]:
            require(urllib.parse.urlsplit(value).port not in {3080, 3192}, 'Daily and real-QQ review ports are forbidden')
        require(self.host != self.qq, 'Host and fixture ports must differ')
        case = self.home / 'fixture' / 'command-case'
        metadata = json.loads((case / 'metadata.json').read_text())
        self.workspace = Path(args.workspace or metadata['workspace']).resolve()
        self.data_dir = Path(args.data_dir or metadata['dataDir']).resolve()
        self.log = Path(args.host_log or case / 'host-3194.log').resolve()
        require(self.data_dir.is_relative_to(self.home) and self.log.is_relative_to(self.home), 'Log and plugin data must belong to the isolated home')
        self.report_path = self.home / 'evidence' / 'conversation-matrix.json'
        self.report = {'version': 1, 'startedAt': time.time(), 'passed': False, 'cases': [], 'requests': [],
            'coverage': {'realQQ': False, 'host': self.host, 'fixture': self.qq, 'workspace': str(self.workspace),
                'actualFileTool': 'pending', 'actorOverrides': args.actor_overrides}, 'skipped': []}
        if args.resume or args.file_only or args.finish_file_evidence:
            previous = json.loads(self.report_path.read_text())
            expected_tasks = {8} if args.finish_file_evidence else {7} if args.file_only else {2, 5}
            require(previous.get('modelTasks') in expected_tasks and len(previous.get('requests', [])) == previous['modelTasks'],
                'Resume requires completed request evidence at the expected task boundary')
            require(previous.get('coverage', {}).get('host') == self.host and previous.get('coverage', {}).get('fixture') == self.qq,
                'Cannot resume another deployment')
            self.report = previous
            self.report['passed'] = False
            self.report.setdefault('priorAttemptFailures', []).append(self.report.pop('failure', {}))
            for case_row in self.report['cases']:
                if case_row.get('status') == 'failed':
                    if 'model marker missing' in case_row.get('error', ''):
                        case_row['status'] = 'limited'
                        case_row['limitation'] = 'Tool invocation markup appeared as assistant text; actual tool execution and tool declaration wiring remain unverified'
                    else:
                        case_row['status'] = 'superseded'
                        case_row['retest'] = 'This case is rerun after the Host fix without repeating model tasks'
        self.api = CommandAPI({'hostOrigin': self.host, 'fixtureOrigin': self.qq,
            'hostLog': str(self.log), 'workspace': str(self.workspace), 'dataDir': str(self.data_dir),
            'primary': FLASH, 'allowModelRequests': args.allow_model_requests})
        # Even evidence writes follow the first authenticated dummy-binding check.
        self.report_path.parent.mkdir(parents=True, exist_ok=True)
        self.save()
        self.sequence = 3000 if args.finish_file_evidence else 2000 if args.file_only else 1000 if args.resume else 0
        self.tag = uuid.uuid4().hex[:12]
        self.tasks = self.report.get('modelTasks', 0) if args.resume or args.file_only or args.finish_file_evidence else 0
        self.before_config = self.api.config()
        self.session_ids = {}
        self.entry_keys = {(scope, identity): CommandAPI.peer_key(scope, identity)
            for scope in ['group', 'c2c'] for identity in ['allowed', 'denied']}

    def save(self):
        private_json(self.report_path, self.report)

    def check(self, name, action):
        row = {'case': name, 'startedAt': time.time()}
        self.report['cases'].append(row)
        self.save()
        try:
            row['result'] = action()
            row['status'] = 'passed'
        except Exception as error:
            row.update({'status': 'failed', 'errorType': type(error).__name__, 'error': str(error)[:500]})
            self.report['failure'] = {'case': name, 'errorType': type(error).__name__, 'message': str(error)[:500]}
            raise
        finally:
            row['finishedAt'] = time.time()
            self.save()
        print(json.dumps({'case': name, 'status': row['status']}), flush=True)
        return row.get('result')

    def assert_dummy(self):
        current = self.api.assert_dummy()
        require(current['appId'] == '0000000000', 'Refusing non-dummy QQ credentials')
        return current

    def fixture(self, path, body=None):
        require(path in {'status', 'observations', 'conversation', 'outbound'}, 'Unsupported fixture route')
        if body is not None:
            self.assert_dummy()
        return json_request(self.qq + '/__fixture/' + path, body)

    def snapshot(self):
        return self.api.get(PATH)

    def entry(self, scope='group', identity='allowed'):
        key = self.entry_keys[(scope, identity)]
        return next(row for row in self.snapshot()['conversations'] if row['key'] == key)

    def action(self, action, scope='group', identity='allowed', expected_status=200, **fields):
        self.assert_dummy()
        data = {'action': action, **fields}
        if action != 'owners':
            data['key'] = self.entry_keys[(scope, identity)]
        try:
            value = json_request(self.host + PATH, data, self.api.opener)
        except urllib.error.HTTPError as error:
            value = json.loads(error.read())
            require(error.code == expected_status, f'{action}: expected HTTP {expected_status}, got {error.code}: {value.get("error", "unknown")}')
            return value
        require(expected_status == 200, f'{action}: unexpectedly accepted a rejected operation')
        return value

    def observations(self):
        return self.fixture('observations')['outbound']

    def inject(self, content, scope='group', identity='allowed', mention=True, full=True, sender_identity=None, message_id=None):
        require(scope in {'group', 'c2c'} and identity in {'allowed', 'denied'}, 'Only fixed synthetic peers are supported')
        require(sender_identity is None or sender_identity in {'allowed', 'denied'}, 'Invalid synthetic sender')
        if not content.strip().startswith('/'):
            require(self.args.allow_model_requests or (scope == 'group' and not mention), 'Model requests were not explicitly enabled')
        require(self.fixture('status')['activeConnections'] == 1, 'Exactly one SDK connection is required')
        self.sequence += 1
        message_id = message_id or f'local-fixture-matrix-{self.tag}-{self.sequence}'
        require(message_id.startswith('local-fixture-'), 'Synthetic message prefix required')
        body = {'scope': scope, 'identity': identity, 'mention': mention, 'full': full,
            'content': content, 'messageId': message_id}
        if sender_identity is not None:
            body['senderIdentity'] = sender_identity
        before = max((row['sequence'] for row in self.observations()), default=0)
        self.fixture('conversation', body)
        return {'messageId': message_id, 'baseline': before}

    def command(self, content, scope='group', identity='allowed', contains=(), sender_identity=None):
        sent = self.inject(content, scope, identity, sender_identity=sender_identity)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            rows = [row for row in self.observations() if row['sequence'] > sent['baseline']]
            if rows:
                time.sleep(.12)
                rows = [row for row in self.observations() if row['sequence'] > sent['baseline']]
                text = '\n'.join(row['content'] for row in rows).replace('\\_', '_')
                require(all(fragment in text for fragment in contains), f'{content}: expected feedback {contains}, got {text[:400]}')
                return text
            time.sleep(.05)
        raise AssertionError(f'{content}: no synthetic command response')

    def policy(self, scope, identity, edit):
        entry = self.entry(scope, identity)
        policy = copy.deepcopy(entry['policy'])
        edit(policy)
        self.action('policy', scope, identity, expectedVersion=entry['policy']['version'], policy=policy, alias=entry['alias'])
        return self.entry(scope, identity)

    def model_task(self, content, scope='group', identity='allowed', marker=None):
        require(self.args.allow_model_requests, 'Real model verification requires --allow-model-requests')
        require(self.tasks < 8, 'The matrix real-model task budget is exhausted')
        self.api.ensure_primary_route(scope, identity)
        self.tasks += 1
        sent = self.inject(content, scope, identity)
        deadline = time.monotonic() + 15
        sid = None
        while time.monotonic() < deadline:
            sid = self.entry(scope, identity)['currentSessionId']
            if sid and any(event['type'] == 'user/message' and event.get('data', {}).get('source', {}).get('qq', {}).get('messageId') == sent['messageId'] for event in self.api.events(sid)):
                break
            time.sleep(.1)
        require(sid is not None, 'QQ task did not create a Session')
        self.api.wait_idle(sid)
        events = self.api.events(sid)
        admitted = [event for event in events if event['type'] == 'user/message' and event.get('data', {}).get('source', {}).get('qq', {}).get('messageId') == sent['messageId']]
        require(len(admitted) == 1, 'QQ message was missing or admitted more than once')
        source = admitted[0]['data']['source']
        require(source['kind'] == 'user' and source['qq']['senderId'] == f'local-fixture-{identity}-user', 'QQ speaker source identity mismatch')
        projection = self.api.projection(sid)
        require(all(projection['modelSelection']['lastUsed'].get(key) == value for key, value in FLASH.items()), 'Actual QQ request used a different route or reasoning effort')
        row = {'sessionId': sid, 'route': FLASH, 'kind': 'qq', 'messageId': sent['messageId']}
        self.report['requests'].append(row)
        if marker:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                out = '\n'.join(item['content'] for item in self.observations() if item['sequence'] > sent['baseline']).replace('\\_', '_')
                if marker in out:
                    break
                time.sleep(.05)
            else:
                raise AssertionError(f'QQ model marker missing for {marker}')
        self.save()
        return {'sessionId': sid, 'events': events, 'admitted': admitted[0], 'sent': sent}

    def native_task(self, sid, content):
        require(self.tasks < 8 and self.args.allow_model_requests, 'Native task budget is exhausted')
        self.assert_dummy()
        projection = self.api.projection(sid)
        route = projection['modelSelection']['next']
        require(all(route.get(key) == value for key, value in FLASH.items()), 'Native task must use Flash/high')
        self.tasks += 1
        baseline = max((row['sequence'] for row in self.observations()), default=0)
        payload = {'request': {'requestId': str(uuid.uuid4()), 'sessionId': sid, 'mode': 'queue',
            'content': [{'type': 'text', 'text': content}], 'clientTimeZone': 'Asia/Shanghai'}}
        result = json_request(self.host + '/api/session/prompt', {'type': 'client-request', 'rpcId': str(uuid.uuid4()),
            'method': 'session/prompt', 'payload': {'args': payload}}, self.api.opener)['result']
        require(result.get('ok') is True, 'Native local prompt admission failed')
        self.api.wait_idle(sid)
        time.sleep(.2)
        require(not [row for row in self.observations() if row['sequence'] > baseline], 'Local Web/native prompt was sent to QQ')
        actual = self.api.projection(sid)['modelSelection']['lastUsed']
        require(all(actual.get(key) == value for key, value in FLASH.items()), 'Actual native request used a different route or effort')
        self.report['requests'].append({'sessionId': sid, 'route': FLASH, 'kind': 'local-native', 'noQQDelivery': True})
        return self.api.events(sid)

    def preflight(self):
        current = self.assert_dummy()
        catalog = self.api.rpc('session/modelCatalog')
        provider = next(group for group in catalog['groups'] if group['id'] == FLASH['provider'])
        require(provider['models'][0]['id'] == FLASH['model'], 'Flash must be the provider first model')
        require(all(catalog['default'].get(key) == value for key, value in FLASH.items()), 'Host default must be Flash/high')
        require(self.fixture('status')['activeConnections'] == 1, 'Exactly one fixture connection required')
        self.fixture('outbound', {'mode': 'success'})
        patch = {'access': {**current['access'], 'c2cMode': 'open', 'groupMode': 'open'},
            'provider': '', 'model': '', 'preset': 'standard', 'streaming': False}
        json_request(self.host + '/qqbot/im-qqbot/config', patch, self.api.opener)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                config = self.assert_dummy()
                if self.api.get('/qqbot/im-qqbot/runtime')['phase'] == 'ready' and self.fixture('status')['activeConnections'] == 1 and config['access']['groupMode'] == 'open' and config['preset'] == 'standard':
                    break
            except (urllib.error.HTTPError, urllib.error.URLError):
                pass
            time.sleep(.1)
        else:
            raise AssertionError('Isolated config/fixture did not converge after HMR')
        for scope in ['group', 'c2c']:
            for identity in ['allowed', 'denied']:
                self.command('/bot-ping', scope, identity, contains=['pong'])
        self.action('owners', ownerIds=[OWNER])
        for scope in ['group', 'c2c']:
            for identity in ['allowed', 'denied']:
                def edit(policy):
                    policy['allowedModels'] = [f"{FLASH['provider']}/{FLASH['model']}"]
                    policy['allowedPresets'] = ['standard', 'minimal']
                    policy['controllers'] = []
                    policy['approvers'] = [OWNER]
                    policy['tools'] = {}
                    policy['role'] = {'description': '', 'tone': '', 'world': '', 'prompt': ''}
                    policy['context']['mode'] = 'recent'
                    policy['requireMention'] = True
                self.policy(scope, identity, edit)
                self.action('reset', scope, identity)
                self.action('model', scope, identity, value=f"{FLASH['provider']}/{FLASH['model']}")
        return {'dummyAppId': current['appId'], 'fourSyntheticPeers': True, 'firstModel': FLASH, 'noRealQQ': True}

    def commands(self):
        before = copy.deepcopy(self.api.prefs())
        for command in ['/model reset', '/model default', '/preset minimal', '/preset default', '/permission read-only', '/new', '/reset', '/clear']:
            self.command(command, identity='denied', contains=['无权限'])
        require(self.api.prefs() == before, 'Ordinary member command changed saved preferences')
        self.command('/model', identity='denied', contains=['模型'])
        self.command('/preset', identity='denied', contains=['preset'])
        self.policy('group', 'denied', lambda p: p.update({'controllers': [CONTROLLER]}))
        self.command(f"/model {FLASH['provider']}/{FLASH['model']}", identity='denied', contains=['已切换'])
        self.command('/model reset', identity='denied', contains=['恢复'])
        self.command('/preset minimal', identity='denied', contains=['minimal'])
        self.command('/preset default', identity='denied', contains=['已清除'])
        self.command('/permission read-only', identity='denied', contains=['已切换'])
        self.command('/new', identity='denied', contains=['已开启新会话'])
        self.command('/model fixture-unavailable/model', contains=['失败'])
        if self.args.actor_overrides:
            self.command('/new', identity='allowed', sender_identity='denied', contains=['无权限'])
            self.command('/model reset', identity='denied', sender_identity='allowed', contains=['恢复'])
        else:
            self.report['skipped'].append({'case': 'cross-group-actor-override', 'reason': 'Fixture actor override was not enabled'})
        require(all(self.api.rpc('session/modelCatalog')['default'].get(key) == value for key, value in FLASH.items()), 'QQ command changed Host model defaults')
        return {'ordinaryDenied': True, 'controllerAllowed': True, 'ownerAllowed': True, 'hostDefaultsUnchanged': True}

    def conflict(self):
        entry = self.entry()
        self.action('policy', expectedVersion=entry['policy']['version'], policy=entry['policy'], alias='矩阵群 A')
        self.action('policy', expected_status=409, expectedVersion=entry['policy']['version'], policy=entry['policy'], alias='陈旧草稿')
        require(self.entry()['alias'] == '矩阵群 A', 'Stale policy update overwrote the committed alias')
        return {'http409': True}

    def background_and_models(self):
        self.policy('group', 'allowed', lambda p: p['role'].update({'description': 'MATRIX_ROLE_OLD'}))
        self.action('reset')
        before_id = self.entry()['currentSessionId']
        self.inject('MATRIX_A_RECENT_ONLY', mention=False)
        result_a = self.model_task('只回复 QQ_MATRIX_A_OK，不调用工具。', marker='QQ_MATRIX_A_OK')
        require('MATRIX_A_RECENT_ONLY' in text_of([result_a['admitted']]), 'Recent background did not enter the request')
        require('MATRIX_ROLE_OLD' == next(row for row in self.entry()['sessions'] if row['sessionId'] == before_id)['role']['description'], 'Current Session did not pin its role')
        before_events = len(self.api.events(result_a['sessionId']))
        before_outbound = max((row['sequence'] for row in self.observations()), default=0)
        self.inject('只回复 QQ_MATRIX_A_OK，不调用工具。', message_id=result_a['sent']['messageId'])
        time.sleep(.5)
        require(len(self.api.events(result_a['sessionId'])) == before_events, 'Duplicate message appended another Session event')
        require(not [row for row in self.observations() if row['sequence'] > before_outbound], 'Duplicate QQ input produced another reply')
        self.policy('group', 'denied', lambda p: p['context'].update({'mode': 'archive'}))
        for index in range(55):
            self.inject(f'MATRIX_B_ARCHIVE_{index:02}', identity='denied', mention=False)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            first = self.action('messages', identity='denied')['messages']
            if len(first) == 50:
                break
            time.sleep(.1)
        require(len(first) == 50, 'Archive first page did not reach its bounded size')
        second = self.action('messages', identity='denied', before=first[-1]['cursor'])['messages']
        require(second and not {row['id'] for row in first} & {row['id'] for row in second}, 'Archive pages overlap or lose old rows')
        tools = self.snapshot()['tools']
        read = next((tool for tool in tools if tool['name'] == 'read' and tool['available']), None)
        prompt_b = '只回复 QQ_MATRIX_B_OK，不调用工具。'
        if read:
            fixture_root = self.workspace / 'conversation-matrix'
            allowed = fixture_root / 'allowed'
            allowed.mkdir(parents=True, exist_ok=True)
            self.allowed_file = allowed / 'permitted.txt'
            self.denied_file = fixture_root / 'outside.txt'
            self.allowed_file.write_text('MATRIX_ALLOWED_FILE_OK\n')
            self.denied_file.write_text('MATRIX_OUTSIDE_FILE_MUST_NOT_BE_READ\n')
            def readonly(policy):
                policy['template'] = 'readonly'; policy['name'] = '矩阵资料只读'
                policy['resources']['readRoots'] = [str(allowed)]
                policy['tools'] = {read['id']: 'allow'}
            self.policy('group', 'denied', readonly)
            prompt_b = f'这是隔离权限测试。请分别调用 read 工具读取这两个绝对路径：{self.allowed_file} 和 {self.denied_file}。第二个路径应由权限系统拒绝，不要换工具或尝试绕过。最后只回复 QQ_MATRIX_B_OK。'
        result_b = self.model_task(prompt_b, identity='denied', marker=None if read else 'QQ_MATRIX_B_OK')
        require('MATRIX_B_ARCHIVE_' in text_of([result_b['admitted']]), 'Archive background was not injected')
        require('MATRIX_A_RECENT_ONLY' not in text_of(result_b['events']), 'Group A context leaked to group B')
        if read:
            tool_calls = [row for row in result_b['events'] if row['type'] == 'tool/call' and row['data']['name'] == 'read']
            results = [row for row in result_b['events'] if row['type'] == 'tool/result']
            serialized = json.dumps(results, ensure_ascii=False)
            require('MATRIX_OUTSIDE_FILE_MUST_NOT_BE_READ' not in serialized, 'Outside file content leaked through the read tool')
            allowed_attempt = any(str(self.allowed_file) in row['data'].get('arguments', '') for row in tool_calls)
            denied_attempt = any(str(self.denied_file) in row['data'].get('arguments', '') for row in tool_calls)
            if allowed_attempt and denied_attempt:
                require('MATRIX_ALLOWED_FILE_OK' in serialized, 'Permitted file read did not return the fixture content')
                require(any(result_is_error(row) for row in results), 'Out-of-scope tool attempt did not produce an error')
                self.report['coverage']['actualFileTool'] = 'allowed read succeeded; out-of-root attempt denied before content exposure'
            else:
                self.report['coverage']['actualFileTool'] = 'model did not attempt both requested paths; no outside content exposed'
                self.report['skipped'].append({'case': 'both-model-file-attempts', 'reason': 'Model did not call read for both paths'})
        else:
            self.report['coverage']['actualFileTool'] = 'no read tool in the active catalog'
            self.report['skipped'].append({'case': 'actual-file-tool', 'reason': 'No read tool in active catalog'})
        for identity, marker in [('allowed', 'QQ_MATRIX_DM_A_OK'), ('denied', 'QQ_MATRIX_DM_B_OK')]:
            result = self.model_task(f'只回复 {marker}，不调用工具。', scope='c2c', identity=identity, marker=marker)
            require('MATRIX_A_RECENT_ONLY' not in text_of(result['events']) and 'MATRIX_B_ARCHIVE_' not in text_of(result['events']), 'Group context leaked into a DM')
            self.session_ids[('c2c', identity)] = result['sessionId']
        self.session_ids[('group', 'allowed')] = result_a['sessionId']
        self.session_ids[('group', 'denied')] = result_b['sessionId']
        require(len(set(self.session_ids.values())) == 4, 'Two groups and two DMs reused a Session identity')
        return {'fourDistinctSessions': True, 'recentBackground': True, 'archivePagination': True, 'persistentMessageDedup': True, 'sourceQQ': True}

    def resume_background_and_models(self):
        """Reuse completed group turns; never spend more model tasks to fix the harness."""
        group_requests = self.report['requests'][:2]
        group_a, group_b = [self.api.events(row['sessionId']) for row in group_requests]
        require('MATRIX_A_RECENT_ONLY' in text_of(group_a), 'Original recent background evidence missing')
        require('MATRIX_B_ARCHIVE_' in text_of(group_b), 'Original archive background evidence missing')
        require('MATRIX_A_RECENT_ONLY' not in text_of(group_b), 'Group A context leaked into B')
        calls = [row for row in group_b if row['type'] == 'tool/call']
        require(not calls and 'DSML' in text_of(group_b, 'assistant/message'), 'Resume requires the observed non-executed tool invocation')
        for identity, record in zip(['allowed', 'denied'], group_requests):
            events = self.api.events(record['sessionId'])
            message = next(row for row in events if row['type'] == 'user/message' and row.get('data', {}).get('source', {}).get('qq', {}).get('messageId') == record['messageId'])
            require(message['data']['source']['qq']['senderId'] == f'local-fixture-{identity}-user', 'Persisted QQ source identity mismatch')
            actual = self.api.projection(record['sessionId'])['modelSelection']['lastUsed']
            require(all(actual.get(key) == value for key, value in FLASH.items()), 'Persisted actual route differs from Flash/high')
            self.session_ids[('group', identity)] = record['sessionId']
        self.report['coverage']['actualFileTool'] = 'unverified: no native tool/call or tool/result events; tool declaration wiring must be checked before attributing cause'
        self.report['skipped'].append({'case': 'actual-file-tool', 'reason': 'Tool invocation markup appeared as assistant text; actual execution was not observed'})
        page = self.action('messages', identity='denied')['messages']
        require(len(page) == 50, 'Archive first page is missing')
        older = self.action('messages', identity='denied', before=page[-1]['cursor'])['messages']
        require(older and not {row['id'] for row in page} & {row['id'] for row in older}, 'Archive pagination is not disjoint')
        for identity, marker in [('allowed', 'QQ_MATRIX_DM_A_OK'), ('denied', 'QQ_MATRIX_DM_B_OK')]:
            result = self.model_task(f'只回复 {marker}，不调用工具。', scope='c2c', identity=identity, marker=marker)
            require('MATRIX_A_RECENT_ONLY' not in text_of(result['events']) and 'MATRIX_B_ARCHIVE_' not in text_of(result['events']), 'Group context leaked into a DM')
            self.session_ids[('c2c', identity)] = result['sessionId']
        require(len(set(self.session_ids.values())) == 4, 'Four peer Sessions are not distinct')
        return {'fourDistinctSessions': True, 'recentBackground': True, 'archivePagination': True, 'sourceQQ': True,
            'groupTurnsReused': True, 'actualFileTool': self.report['coverage']['actualFileTool']}

    def reset_role_interaction(self):
        old = self.entry()
        def interaction(policy):
            policy['role']['description'] = 'MATRIX_ROLE_NEW'
            policy['context']['mode'] = 'interaction'
        self.policy('group', 'allowed', interaction)
        current = self.entry()
        require(next(row for row in current['sessions'] if row['sessionId'] == old['currentSessionId'])['role']['description'] == 'MATRIX_ROLE_OLD', 'Pending role changed the active Session snapshot')
        self.command('/new', contains=['已开启新会话'])
        fresh = self.entry()
        require(fresh['currentSessionId'] and fresh['currentSessionId'] != old['currentSessionId'], 'New command did not immediately update the directory pointer')
        require(next(row for row in fresh['sessions'] if row['sessionId'] == fresh['currentSessionId'])['role']['description'] == 'MATRIX_ROLE_NEW', 'New Session missed the pending role')
        self.inject('MATRIX_INTERACTION_DO_NOT_INJECT', mention=False)
        result = self.model_task('只回复 QQ_MATRIX_NEW_OK，不调用工具。', marker='QQ_MATRIX_NEW_OK')
        text = text_of(result['events'])
        require('MATRIX_INTERACTION_DO_NOT_INJECT' not in text and 'MATRIX_A_RECENT_ONLY' not in text, 'Reset/interaction mode reintroduced ordinary or prior background')
        archived = len(self.action('messages', identity='denied')['messages'])
        self.command('/new', identity='denied', contains=['已开启新会话'])
        require(len(self.action('messages', identity='denied')['messages']) == archived, 'New command removed archived group records')
        self.session_ids[('group', 'allowed')] = result['sessionId']
        return {'newPointerImmediate': True, 'oldRolePinned': True, 'newRoleApplied': True, 'interactionIgnoresOrdinary': True, 'archiveRetained': True}

    def explicit_sends(self):
        operation = f'matrix-{self.tag}-manual'
        baseline = max((row['sequence'] for row in self.observations()), default=0)
        first = self.action('send', operationId=operation, text='QQ_MATRIX_EXPLICIT_SEND')['delivery']
        require(first['state'] == 'accepted', 'Explicit send was not accepted')
        second = self.action('send', operationId=operation, text='QQ_MATRIX_EXPLICIT_SEND')['delivery']
        require(second['id'] == first['id'], 'Repeated explicit operation created a different delivery')
        attempts = [row for row in self.observations() if row['sequence'] > baseline]
        require(len(attempts) == 1, 'Explicit double submission caused multiple fixture requests')
        self.action('send', expected_status=409, operationId=operation, text='QQ_MATRIX_DIFFERENT_CONTENT')
        self.fixture('outbound', {'mode': 'failure'})
        bad_id = f'matrix-{self.tag}-unknown'
        failed = self.action('send', operationId=bad_id, text='QQ_MATRIX_UNKNOWN_SEND')['delivery']
        require(failed['state'] == 'unknown', 'Uncertain send was incorrectly reported accepted')
        count = max((row['sequence'] for row in self.observations()), default=0)
        self.action('send', operationId=bad_id, text='QQ_MATRIX_UNKNOWN_SEND')
        require(max((row['sequence'] for row in self.observations()), default=0) == count, 'Unknown send was blindly replayed')
        self.fixture('outbound', {'mode': 'success'})
        return {'accepted': True, 'idempotent': True, 'contentConflict': True, 'unknownNotReplayed': True}

    def local_analysis(self):
        sid = self.session_ids[('group', 'allowed')]
        child = self.action('analyze', sessionId=sid)['sessionId']
        require(child != sid and all(child not in [row['sessionId'] for row in entry['sessions']] for entry in self.snapshot()['conversations']), 'Local analysis gained a QQ peer mapping')
        child_events = self.native_task(child, '只回复 QQ_MATRIX_LOCAL_ANALYSIS_ONLY，不调用工具。')
        require('QQ_MATRIX_LOCAL_ANALYSIS_ONLY' in text_of(child_events), 'Analysis local input missing')
        require('QQ_MATRIX_LOCAL_ANALYSIS_ONLY' not in text_of(self.api.events(sid)), 'Analysis input contaminated original QQ history')
        original_events = self.native_task(sid, '只回复 QQ_MATRIX_NATIVE_WEB_ONLY，不调用工具。')
        require('QQ_MATRIX_NATIVE_WEB_ONLY' in text_of(original_events), 'Native Web control did not execute')
        return {'childSession': child, 'noPeerMapping': True, 'analysisIsolated': True, 'nativeWebNotForwarded': True}

    def restore_session_evidence(self):
        inverse = {value: key for key, value in self.entry_keys.items()}
        for request in self.report['requests']:
            if request['kind'] != 'qq':
                continue
            message = next(event for event in self.api.events(request['sessionId']) if event['type'] == 'user/message'
                and event.get('data', {}).get('source', {}).get('qq', {}).get('messageId') == request['messageId'])
            key = message['data']['source']['qq']['conversationKey']
            require(key in inverse, 'Persisted model evidence belongs to another peer')
            self.session_ids[inverse[key]] = request['sessionId']
        require(len(self.session_ids) == 4, 'Resume could not restore four peer Session identities')

    def verify_file_tool(self):
        self.assert_dummy()
        self.command('/model', identity='denied', contains=['模型'])
        entry = self.entry('group', 'denied')
        read = next((row for row in self.snapshot()['tools'] if row['name'] == 'read' and row['available']), None)
        require(read is not None and entry['policy']['tools'].get(read['id']) == 'allow', 'Read is not both registered and authorized for group B')
        allowed_file = self.workspace / 'conversation-matrix' / 'allowed' / 'permitted.txt'
        outside_file = self.workspace / 'conversation-matrix' / 'outside.txt'
        require(allowed_file.read_text().strip() == 'MATRIX_ALLOWED_FILE_OK', 'Owned allowed fixture content changed')
        require(outside_file.read_text().strip() == 'MATRIX_OUTSIDE_FILE_MUST_NOT_BE_READ', 'Owned outside fixture content changed')
        prompt = f'这是隔离权限验证，请实际调用 read 工具两次：先读取 {allowed_file}，再尝试读取 {outside_file}。第二个文件在授权范围外，应由工具返回拒绝，不要换工具或绕过。两次工具返回后回复 QQ_MATRIX_FILE_GUARD_OK。'
        if self.args.finish_file_evidence:
            prior = self.report['requests'][-1]
            require(prior['kind'] == 'qq' and prior['sessionId'] == entry['currentSessionId'], 'File result evidence no longer matches current group B')
            result = {'sessionId': prior['sessionId'], 'events': self.api.events(prior['sessionId'])}
        else:
            result = self.model_task(prompt, identity='denied')
        calls = [row for row in result['events'] if row['type'] == 'tool/call' and row['data'].get('name') == 'read']
        results = [row for row in result['events'] if row['type'] == 'tool/result']
        allowed_calls = [row for row in calls if str(allowed_file) in row['data'].get('arguments', '')]
        outside_calls = [row for row in calls if str(outside_file) in row['data'].get('arguments', '')]
        require(allowed_calls and outside_calls, 'The real model did not produce both required native read calls')
        by_id = {result_call_id(row): row for row in results}
        successful = [by_id[row['data']['callId']] for row in allowed_calls if row['data']['callId'] in by_id]
        rejected = [by_id[row['data']['callId']] for row in outside_calls if row['data']['callId'] in by_id]
        require(any('MATRIX_ALLOWED_FILE_OK' in json.dumps(row, ensure_ascii=False) and not result_is_error(row) for row in successful), 'Allowed native read did not return its fixture data')
        require(any(result_is_error(row) for row in rejected), 'Outside native read was not rejected')
        require('MATRIX_OUTSIDE_FILE_MUST_NOT_BE_READ' not in json.dumps(results, ensure_ascii=False), 'Outside file bytes leaked into a tool result')
        require('MATRIX_OUTSIDE_FILE_MUST_NOT_BE_READ' not in text_of(result['events'], 'assistant/message'), 'Outside file bytes leaked in assistant content')
        assistant_sources = [row['data'].get('message', {}).get('source', {}).get('replayState', {}).get('response', {})
            for row in result['events'] if row['type'] == 'assistant/message']
        request_routes = [{field: row['data'].get('header', {}).get('config', {}).get(field) for field in FLASH}
            for row in result['events'] if row['type'] == 'request/header']
        require(request_routes and all(all(route.get(field) == value for field, value in FLASH.items()) for route in request_routes),
            'A native file tool step used a different actual model route or effort')
        observation = {'sessionId': result['sessionId'], 'registeredToolNames': [read['name']],
            'requestHeaderStoresToolSchemas': False, 'nativeToolCalls': [row['data']['name'] for row in calls],
            'toolDeclarationEvidence': 'Native assistant tool-call blocks and executed tool/call events, rather than plain text',
            'stopReasons': [row.get('stopReason') for row in assistant_sources], 'allowedReadSucceeded': True,
            'outsideReadRejected': True, 'outsideContentExposed': False, 'actualModelRoute': FLASH, 'requestRoutes': request_routes}
        self.report['coverage']['actualFileTool'] = observation
        self.report['skipped'] = [row for row in self.report['skipped'] if row['case'] not in {'actual-file-tool', 'both-model-file-attempts'}]
        return observation

    def receiving_toggle(self):
        self.assert_dummy()
        entry = self.entry()
        sid = entry['currentSessionId']
        baseline_events = self.api.events(sid)
        other = self.entry('group', 'denied')['admitted']
        self.action('admit', enabled=False)
        require(self.entry()['admitted'] is False and self.entry()['policy']['receiveEnabled'] is False, 'Single-group admission switch did not save')
        baseline = max((row['sequence'] for row in self.observations()), default=0)
        self.inject('/bot-ping')
        time.sleep(.4)
        require(not [row for row in self.observations() if row['sequence'] > baseline], 'Disabled group still answered an incoming command')
        require(self.api.events(sid) == baseline_events, 'Disabled incoming command changed the QQ Session')
        denied = self.action('send', expected_status=400, operationId=f'matrix-{self.tag}-disabled', text='QQ_MATRIX_DISABLED_MUST_NOT_SEND')
        require('尚未允许' in denied.get('error', ''), 'Explicit send did not honor disabled group admission')
        require(self.entry('group', 'denied')['admitted'] == other, 'Single-group admission switch changed another group')
        self.action('admit', enabled=True)
        require(self.entry()['admitted'] is True, 'Reenabled group did not become admitted')
        self.command('/bot-ping', contains=['pong'])
        return {'disabledInboundRejected': True, 'disabledExplicitSendRejected': True, 'reenableRestored': True, 'otherGroupUnchanged': True, 'modelRequestsAdded': 0}

    def run(self):
        try:
            if self.args.file_only or self.args.finish_file_evidence:
                self.check('real-file-tool-after-scope-wiring-fix', self.verify_file_tool)
                self.check('single-group-admission-toggle', self.receiving_toggle)
                self.report['passed'] = True
                return
            if self.args.resume and self.tasks == 2:
                self.check('four-session-matrix-continued-with-model-protocol-limitation', self.resume_background_and_models)
                self.check('new-role-and-context-reset', self.reset_role_interaction)
            elif self.args.resume:
                self.restore_session_evidence()
            else:
                self.check('dummy-host-route-and-four-peer-preflight', self.preflight)
                self.check('ordinary-controller-owner-command-policy', self.commands)
                self.check('policy-version-conflict', self.conflict)
            if self.args.allow_model_requests and not self.args.resume:
                self.check('four-session-context-source-model-and-file-matrix', self.background_and_models)
                self.check('new-role-and-context-reset', self.reset_role_interaction)
            elif not self.args.allow_model_requests:
                self.report['skipped'].append({'case': 'real-model-context-analysis', 'reason': '--allow-model-requests was not provided'})
            self.check('explicit-send-idempotency-and-unknown', self.explicit_sends)
            if self.args.allow_model_requests:
                self.check('local-analysis-and-native-web-egress-negative-control', self.local_analysis)
            self.report['passed'] = True
        finally:
            self.report['modelTasks'] = self.tasks
            self.report['finishedAt'] = time.time()
            self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test-home', required=True)
    parser.add_argument('--host-origin', default='http://127.0.0.1:3194')
    parser.add_argument('--fixture-origin', default='http://127.0.0.1:3193')
    parser.add_argument('--workspace')
    parser.add_argument('--data-dir')
    parser.add_argument('--host-log')
    parser.add_argument('--allow-model-requests', action='store_true')
    parser.add_argument('--actor-overrides', action='store_true')
    parser.add_argument('--resume', action='store_true', help='Resume after two group turns or five QQ turns without spending duplicate model tasks')
    parser.add_argument('--file-only', action='store_true', help='Use the eighth and final task for native file enforcement, then test admission without a model')
    parser.add_argument('--finish-file-evidence', action='store_true', help='Read the completed eighth task and finish admission checks without another model request')
    args = parser.parse_args()
    ConversationMatrix(args).run()


if __name__ == '__main__':
    main()

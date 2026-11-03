"""Bounded stock Host access; set QQBOT_TEST_HOME in runner and helper environments to override the isolated Home."""
import argparse
import http.cookiejar
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from command_api import CommandAPI, LocalRedirect, RpcError, SafetyError, private_json


DEFAULT_HOME = Path.home() / '.local' / 'share' / 'dsh-qqbot-command-test'
HOST = 'http://127.0.0.1:3194'
FIXTURE = 'http://127.0.0.1:3195'
CONVERSATIONS = '/qqbot/im-qqbot/conversations'
PEERS = re.compile(r'^qqbot:0000000000:(c2c:local-fixture-(?:allowed|denied)-user|group:local-fixture-(?:allowed|denied)-group)$')
READ_RPCS = frozenset({'session/modelCatalog', 'agentPresets/list', 'session/projections',
    'session/state', 'session/events', 'session/list', 'session/wait', 'directoryPicker/list'})
WRITE_RPCS = frozenset({'session/create', 'session/prompt', 'session/updateQueue',
    'session/cancel', 'workspace/create'})
COMMANDS = frozenset({'help', 'status', 'me', 'model', 'model-primary', 'model-short', 'model-secondary',
    'model-reset', 'model-default', 'model-invalid', 'preset', 'preset-standard', 'preset-minimal',
    'preset-reset', 'preset-default', 'preset-invalid', 'new', 'reset', 'clear', 'stop',
    'ping', 'version', 'smoke', 'compact'})


def test_home(env=None):
    env = os.environ if env is None else env
    home = Path(env.get('QQBOT_TEST_HOME', DEFAULT_HOME))
    if not home.is_absolute() or home.resolve() != home:
        raise SafetyError('QQBOT_TEST_HOME must name an absolute canonical isolated Home')
    if home in (Path(home.anchor), Path.home().resolve()):
        raise SafetyError('An isolated test Home is required')
    daily_homes = [Path.home() / '.dsh']
    if env.get('DSH_HOME'):
        daily_homes.append(Path(env['DSH_HOME']))
    if any(home.is_relative_to(daily.resolve()) or daily.resolve().is_relative_to(home) for daily in daily_homes):
        raise SafetyError('Daily DSH Home cannot be used for tests')
    return home


def load_config(path, env=None):
    home = test_home(env)
    if not home.is_dir():
        raise SafetyError('An existing isolated test Home is required')
    evidence = home / 'evidence'
    if not evidence.is_dir() or evidence.resolve(strict=True) != evidence:
        raise SafetyError('Evidence must remain in the isolated Home')
    path = Path(path).resolve(strict=True)
    if not path.is_relative_to(evidence):
        raise SafetyError('Runner config must remain inside registered test evidence')
    config = json.loads(path.read_text())
    if (config.get('version') != 2 or config.get('kind') != 'stock-qqbot-commands'
            or config.get('home') != str(home) or config.get('profile') != 'qqbot-commands'
            or config.get('hostOrigin') != HOST or config.get('fixtureOrigin') != FIXTURE
            or not isinstance(config.get('allowModelRequests'), bool)):
        raise SafetyError('Only the registered stock test deployment is allowed')
    profile = home / 'profiles' / config['profile']
    if not profile.is_dir() or profile.resolve(strict=True) != profile:
        raise SafetyError('The test profile must remain in the isolated Home')
    root = Path(config['runDir']).resolve(strict=True)
    if not root.is_relative_to(evidence) or root == evidence or path.parent != root:
        raise SafetyError('A runner-owned evidence subdirectory is required')
    if Path(config['hostLog']).resolve() != root / 'host.log':
        raise SafetyError('Authentication must use this runner log')
    for key in ('workspace', 'dataDir', 'dshSource', 'pluginRoot'):
        candidate = Path(config[key])
        if not candidate.is_absolute() or candidate.resolve(strict=True) != candidate or not candidate.is_dir():
            raise SafetyError('Explicit canonical existing directories are required')
    if not Path(config['dataDir']).is_relative_to(home) or Path(config['dataDir']) == home:
        raise SafetyError('Plugin data must remain in the registered Home')
    for name in ('primary', 'secondary'):
        route = config.get(name)
        if not isinstance(route, dict) or any(not isinstance(route.get(key), str) or not route[key]
                or re.search(r'[\s"\'<>]', route[key]) for key in ('provider', 'model')):
            raise SafetyError('Explicit model routes are required')
    if not isinstance(config.get('presets'), dict) or any(not isinstance(config['presets'].get(key), str)
            or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', config['presets'][key]) for key in ('primary', 'secondary')):
        raise SafetyError('Explicit preset IDs are required')
    return config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SafetyError('API requests may not redirect')


def text(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 16000:
        raise SafetyError('A bounded nonempty text value is required')
    return value


class UpstreamAPI:
    events = CommandAPI.events
    peer_key = staticmethod(CommandAPI.peer_key)

    def __init__(self, config):
        self.settings = config
        self.host, self.qq = HOST, FIXTURE
        self.run_dir = Path(config['runDir'])
        self.owned_path = self.run_dir / 'owned-native-sessions.json'
        self.owned = set(json.loads(self.owned_path.read_text())) if self.owned_path.exists() else set()
        jar = http.cookiejar.CookieJar()
        auth = urllib.request.build_opener(LocalRedirect(HOST), urllib.request.HTTPCookieProcessor(jar))
        urls = re.findall(re.escape(HOST) + r'/\?token=[A-Za-z0-9._~%+-]+', Path(config['hostLog']).read_text())
        if not urls:
            raise RuntimeError('Host authentication is unavailable in the private runner log')
        try:
            with auth.open(urls[-1], timeout=10):
                pass
        except (urllib.error.URLError, urllib.error.HTTPError):
            raise RuntimeError('Private Host authentication failed') from None
        self.opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(jar))
        self.fixture_opener = urllib.request.build_opener(NoRedirect())
        self.assert_dummy()

    def _request(self, path, data=None, fixture=False):
        authority = FIXTURE if fixture else HOST
        if not isinstance(path, str) or not path.startswith('/') or path.startswith('//'):
            raise SafetyError('Only relative API paths are allowed')
        request = urllib.request.Request(authority + path, headers={'content-type': 'application/json'},
            data=None if data is None else json.dumps(data).encode(), method='GET' if data is None else 'POST')
        try:
            with (self.fixture_opener if fixture else self.opener).open(request, timeout=40) as response:
                payload = response.read(8 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            raise RpcError(f'{path.split("?")[0]}: HTTP {error.code}') from None
        except urllib.error.URLError:
            raise RpcError(f'{path.split("?")[0]}: transport failure') from None
        if len(payload) > 8 * 1024 * 1024:
            raise RuntimeError('Response exceeded the verification read limit')
        return json.loads(payload)

    def assert_dummy(self):
        config = self._request('/qqbot/im-qqbot/config')['config']
        if config.get('appId') != '0000000000' or Path(config.get('cwd', '')).resolve() != Path(self.settings['workspace']):
            raise SafetyError('Refusing a changed QQ identity or workspace')
        return config

    def snapshot(self):
        result = self._request(CONVERSATIONS)
        if any(not PEERS.fullmatch(row.get('key', '')) or row.get('appId') != '0000000000'
                for row in result['conversations']):
            raise SafetyError('Conversation directory contains a non-synthetic identity')
        return result

    def entry(self, scope='c2c', identity='allowed'):
        key = self.peer_key(scope, identity)
        return next((row for row in self.snapshot()['conversations'] if row['key'] == key), None)

    def _session(self, session_id):
        known = self.owned | {item['sessionId'] for row in self.snapshot()['conversations'] for item in row['sessions']}
        if not isinstance(session_id, str) or session_id not in known:
            raise SafetyError('Session is not owned by this synthetic deployment')
        return session_id

    def _path(self, path):
        candidate = Path(path)
        root = Path(self.settings['workspace'])
        if not candidate.is_absolute() or not candidate.resolve(strict=True).is_relative_to(root):
            raise SafetyError('Directory operations must remain in the configured workspace')
        return str(candidate.resolve(strict=True))

    def rpc(self, method, args=None):
        if method not in READ_RPCS | WRITE_RPCS:
            raise SafetyError('Unsupported stock RPC')
        args = args or {}
        request = args.get('request', {})
        if method.startswith('session/') and method not in {'session/create', 'session/list', 'session/modelCatalog'}:
            session_id = request.get('address', {}).get('sessionId') if method == 'session/events' else request.get('sessionId')
            self._session(session_id)
        if method == 'directoryPicker/list':
            if set(args) != {'path'}:
                raise SafetyError('Directory listing requires an explicit workspace path')
            self._path(args['path'])
        if method in WRITE_RPCS:
            self.assert_dummy()
            if method == 'session/create':
                if set(request) - {'cwd', 'agentPreset'} or request.get('cwd') != self._path(request.get('cwd', '')):
                    raise SafetyError('Native creation requires an explicit workspace directory')
                if request.get('agentPreset') not in (None, *self.settings['presets'].values()):
                    raise SafetyError('Native creation requires a configured preset')
            elif method == 'workspace/create':
                if set(request) != {'path'}:
                    raise SafetyError('Workspace adoption requires one explicit path')
                self._path(request['path'])
            elif method == 'session/prompt':
                self.require_model(request['sessionId'])
                if request.get('mode') not in {'queue', 'steer'} or not re.fullmatch(r'upstream-[A-Za-z0-9-]{1,100}', request.get('requestId', '')):
                    raise SafetyError('Native prompts require a runner request identity and queue/steer mode')
                self._content(request.get('content'))
            elif method == 'session/updateQueue':
                action = request.get('action', {})
                if action.get('kind') not in {'edit', 'remove', 'steer'} or not isinstance(request.get('itemId'), str):
                    raise SafetyError('Unsupported queue mutation')
                if action['kind'] != 'remove':
                    self.require_model(request['sessionId'])
                if action['kind'] == 'edit':
                    self._content(action.get('content'))
        response = self._request('/api/' + method, {'type': 'client-request', 'rpcId': str(uuid.uuid4()),
            'method': method, 'payload': {'args': args}})
        result = response['result']
        if not result['ok']:
            raise RpcError(f'{method}: {result.get("error", {}).get("code", "unknown")}')
        value = result['value']
        if method == 'session/create':
            self.owned.add(value['sessionId'])
            private_json(self.owned_path, sorted(self.owned))
        return value

    @staticmethod
    def _content(content):
        if (not isinstance(content, list) or len(content) != 1 or not isinstance(content[0], dict)
                or set(content[0]) != {'type', 'text'} or content[0]['type'] != 'text'):
            raise SafetyError('Verification prompts permit one text part')
        text(content[0]['text'])

    def state(self, session_id):
        return self.rpc('session/state', {'request': {'sessionId': session_id}})

    def projection(self, session_id):
        result = self.rpc('session/projections', {'request': {'sessionId': session_id}})
        return None if result is None else result['values']

    def require_model(self, session_id=None):
        if not self.settings['allowModelRequests']:
            raise SafetyError('Model requests require --allow-model-requests at runner startup')
        self.assert_dummy()
        catalog = self.rpc('session/modelCatalog')
        expected = self.settings['primary']
        group = next((row for row in catalog['groups'] if row['id'] == expected['provider']), None)
        if not group or not any(row['id'] == expected['model'] for row in group['models']):
            raise SafetyError('Permitted primary model is absent from the live Host catalog')
        route = catalog['default']
        if session_id:
            projection = self.projection(session_id)
            route = (projection or {}).get('modelSelection', {}).get('next') or route
        if any(route.get(key) != value for key, value in expected.items()):
            raise SafetyError('Live model selection differs from the permitted primary route')

    def fixture(self, operation, data=None):
        allowed = {'status', 'observations', 'message', 'conversation', 'outbound', 'disconnect', 'resume'}
        if operation not in allowed:
            raise SafetyError('Unsupported fixture operation')
        if data is not None:
            self.assert_dummy()
            if operation in {'message', 'conversation'}:
                self.peer_key(data.get('scope', 'group'), data.get('identity', 'denied'))
                if self._request('/__fixture/status', fixture=True)['activeConnections'] != 1:
                    raise SafetyError('Exactly one synthetic SDK connection is required')
                if operation == 'conversation' or 'text' in data or data.get('command') in {'smoke', 'compact'}:
                    entry = self.entry(data.get('scope', 'group'), data.get('identity', 'denied'))
                    self.require_model(entry['currentSessionId'] if entry else None)
                    text(data.get('content', data.get('text', 'fixed fixture command')))
                elif data.get('command') not in COMMANDS:
                    raise SafetyError('Only fixed fixture commands are supported')
        return self._request('/__fixture/' + operation, data, fixture=True)

    def inject(self, content, scope='c2c', identity='allowed', mention=True, full=False, message_id=None):
        message_id = message_id or 'local-fixture-upstream-' + uuid.uuid4().hex
        self.fixture('conversation', {'scope': scope, 'identity': identity, 'mention': mention,
            'full': full, 'content': text(content), 'messageId': message_id})
        return message_id

    def command(self, command, scope='c2c', identity='allowed'):
        if command not in COMMANDS:
            raise SafetyError('Unsupported fixture command')
        baseline = self.outbound_cursor()
        self.fixture('message', {'command': command, 'scope': scope, 'identity': identity})
        return self.wait_outbound(baseline, contents_only=True)

    def outbound_cursor(self):
        return max((row['sequence'] for row in self.fixture('observations')['outbound']), default=0)

    def outbound_since(self, cursor, contents_only=False):
        status = self.fixture('status')
        cut = status['observedOutboundRequests']
        rows = [row for row in self.fixture('observations')['outbound'] if cursor < row['sequence'] <= cut]
        if status['observedOutboundRequests'] - cursor != len(rows):
            raise RuntimeError('Fixture outbound evidence overflowed its bounded observation window')
        return self.classify_outbound(rows)['contentMessages'] if contents_only else rows

    @staticmethod
    def classify_outbound(rows):
        contents, notifications = [], []
        for row in rows:
            if row['messageType'] in {0, 2}:
                contents.append(row)
            elif row['messageType'] == 6 and row['content'] == '':
                notifications.append({'kind': 'typing', **row})
            else:
                raise RuntimeError(f'Unclassified QQ outbound message type {row["messageType"]}; inspect raw fixture evidence')
        return {'totalRequests': len(rows), 'contentMessages': contents, 'protocolNotifications': notifications}

    def outbound_evidence(self, cursor):
        return self.classify_outbound(self.outbound_since(cursor))

    def wait_outbound(self, cursor, timeout=30, contents_only=False):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            rows = self.outbound_since(cursor, contents_only=contents_only)
            if rows:
                return rows
            time.sleep(.05)
        raise RuntimeError('No synthetic QQ response before timeout')

    def action(self, action, scope='c2c', identity='allowed', **fields):
        if set(fields) & {'action', 'key', 'sessionId'}:
            raise SafetyError('Conversation identity and current Session are selected by the helper')
        entry = self.entry(scope, identity)
        if not entry:
            raise SafetyError('Synthetic conversation has not been observed')
        self.assert_dummy()
        if action not in {'messages', 'deliveries', 'policy', 'lifecycle', 'model', 'preset', 'workspace', 'permission', 'reset', 'stop', 'send'}:
            raise SafetyError('Unsupported conversation action')
        if action == 'model' and fields.get('value') not in {'reset', 'default', *(f'{r["provider"]}/{r["model"]}' for r in [self.settings['primary'], self.settings['secondary']])}:
            raise SafetyError('Only configured model selections are allowed')
        if action == 'preset' and fields.get('value') not in {'reset', 'default', *self.settings['presets'].values()}:
            raise SafetyError('Only configured preset selections are allowed')
        if action == 'permission' and fields.get('value') != 'read-only':
            raise SafetyError('Acceptance permits only read-only permission')
        if action == 'workspace':
            workspace_id = fields.get('workspaceId')
            if not isinstance(workspace_id, str) or workspace_id not in self._workspaces():
                raise SafetyError('Workspace must first be adopted through this helper')
        if action == 'policy':
            self._policy(fields.get('policy', {}))
        if action == 'send':
            text(fields.get('text'))
            if not re.fullmatch(r'upstream-[A-Za-z0-9-]{1,100}', fields.get('operationId', '')):
                raise SafetyError('Explicit sends require a runner operation identity')
        request = {'action': action, 'key': entry['key'], 'sessionId': entry['currentSessionId'], **fields}
        return self._request(CONVERSATIONS + '/action', request)

    def _policy(self, policy):
        routes = {f'{route["provider"]}/{route["model"]}' for route in [self.settings['primary'], self.settings['secondary']]}
        resources = policy.get('resources', {})
        if (set(policy.get('allowedModels', [])) - routes
                or set(policy.get('allowedPresets', [])) - set(self.settings['presets'].values())
                or set(policy.get('allowedPermissions', [])) - {'read-only'}
                or policy.get('permission') != 'read-only' or resources.get('executionEnabled') is not False
                or resources.get('sandbox') != 'read-only' or resources.get('networkDomains')):
            raise SafetyError('Acceptance policy must retain bounded models and read-only execution')
        for key in ('readRoots', 'writeRoots', 'sendRoots'):
            for root in resources.get(key, []):
                self._path(root)
        if policy.get('cwd'):
            self._path(policy['cwd'])
        if any(actor not in {'local-fixture-allowed-user', 'local-fixture-denied-user'}
                for key in ('controllers', 'approvers') for actor in policy.get(key, [])):
            raise SafetyError('Policy actors must be synthetic')

    def _workspaces(self):
        path = self.run_dir / 'owned-workspaces.json'
        return json.loads(path.read_text()) if path.exists() else []

    def adopt_workspace(self, path):
        value = self.rpc('workspace/create', {'request': {'path': self._path(path)}})
        private_json(self.run_dir / 'owned-workspaces.json', sorted(set(self._workspaces()) | {value['workspace']['workspaceId']}))
        return value

    def create_native(self, cwd=None, preset=None):
        request = {'cwd': self._path(cwd or self.settings['workspace'])}
        if preset:
            request['agentPreset'] = preset
        return self.rpc('session/create', {'request': request})['sessionId']

    def prompt(self, session_id, content, mode='queue', request_id=None):
        request_id = request_id or 'upstream-' + uuid.uuid4().hex
        self.rpc('session/prompt', {'request': {'sessionId': session_id, 'requestId': request_id,
            'mode': mode, 'content': [{'type': 'text', 'text': text(content)}]}})
        return request_id

    def update_queue(self, session_id, item_id, kind, content=None):
        action = {'kind': kind}
        if kind == 'edit':
            action['content'] = [{'type': 'text', 'text': text(content)}]
        return self.rpc('session/updateQueue', {'request': {'sessionId': session_id, 'itemId': item_id, 'action': action}})

    def wait_idle(self, session_id, timeout=120):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = self.rpc('session/wait', {'request': {'sessionId': session_id, 'timeoutMs': 5000, 'maxMessages': 4}})
            if result['reason'] == 'idle':
                return result
            if result['reason'] == 'input-required':
                raise RuntimeError('Model task is awaiting human input')
        raise RuntimeError('Model task did not settle before timeout')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--operation', required=True, choices=['preflight', 'conversations', 'catalog', 'session-events',
        'session-state', 'fixture-status', 'fixture-observations', 'outbound-evidence', 'fixture-message', 'native-create', 'native-prompt',
        'queue-edit', 'queue-steer', 'queue-remove', 'directory-list', 'workspace-create', 'action'])
    parser.add_argument('--params-file')
    parser.add_argument('--output')
    args = parser.parse_args()
    api = UpstreamAPI(load_config(args.config))
    params = json.loads(Path(args.params_file).read_text()) if args.params_file else {}
    operation = args.operation
    if operation == 'preflight':
        value = {'dummyBinding': bool(api.assert_dummy()), 'runtime': api._request('/qqbot/im-qqbot/runtime'),
            'fixture': api.fixture('status'), 'modelRequestsEnabled': api.settings['allowModelRequests']}
    elif operation == 'conversations': value = api.snapshot()
    elif operation == 'catalog': value = api.rpc('session/modelCatalog')
    elif operation == 'session-events': value = api.events(params['sessionId'])
    elif operation == 'session-state': value = api.state(params['sessionId'])
    elif operation == 'fixture-status': value = api.fixture('status')
    elif operation == 'fixture-observations': value = api.fixture('observations')
    elif operation == 'outbound-evidence': value = api.outbound_evidence(params.get('cursor', 0))
    elif operation == 'fixture-message': value = {'messageId': api.inject(**params)}
    elif operation == 'native-create': value = {'sessionId': api.create_native(**params)}
    elif operation == 'native-prompt': value = {'requestId': api.prompt(**params)}
    elif operation.startswith('queue-'): value = api.update_queue(params['session_id'], params['item_id'], operation[6:], params.get('content'))
    elif operation == 'directory-list': value = api.rpc('directoryPicker/list', {'path': api._path(params['path'])})
    elif operation == 'workspace-create': value = api.adopt_workspace(params['path'])
    else: value = api.action(**params)
    output = Path(args.output or api.run_dir / ('primitive-' + uuid.uuid4().hex + '.json')).resolve()
    if not output.is_relative_to(api.run_dir) or output == api.run_dir:
        raise SafetyError('Primitive output must remain in this run evidence directory')
    private_json(output, value)
    print(json.dumps({'operation': operation, 'evidence': str(output)}))


if __name__ == '__main__':
    try:
        main()
    except (SafetyError, RpcError, RuntimeError, ValueError, KeyError) as error:
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'error': str(error)}))
        raise SystemExit(1)

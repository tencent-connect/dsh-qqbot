"""Private, loopback-only access to one runner-owned QQ test deployment."""
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


COMMANDS = frozenset({
    'help', 'status', 'model', 'model-primary', 'model-short', 'model-secondary',
    'model-reset', 'model-default', 'model-invalid', 'preset', 'preset-standard',
    'preset-minimal', 'preset-reset', 'preset-default', 'preset-invalid', 'new',
    'reset', 'clear', 'stop', 'compact', 'ping', 'version', 'smoke',
})
GENERATING_COMMANDS = frozenset({'smoke', 'compact'})
READ_RPCS = frozenset({'session/modelCatalog', 'agentPresets/list', 'session/projections',
    'session/state', 'session/events', 'session/list', 'session/wait'})


class SafetyError(RuntimeError):
    pass


class RpcError(RuntimeError):
    pass


def origin(value):
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or parsed.username or parsed.password or parsed.path or parsed.query
            or parsed.fragment or parsed.port is None or not 0 < parsed.port < 65536):
        raise SafetyError('Test origins must be explicit http://127.0.0.1:PORT authorities')
    return value


def load_config(path):
    value = json.loads(Path(path).read_text())
    if value.get('version') != 1 or not isinstance(value.get('allowModelRequests'), bool):
        raise SafetyError('Unsupported runner configuration')
    requested_root = Path(value['runDir'])
    root = requested_root.resolve()
    if not requested_root.is_absolute() or root == Path.home() or root == Path(root.anchor):
        raise SafetyError('A dedicated run directory is required')
    for key in ('home', 'workspace', 'dataDir', 'hostLog', 'fixtureLog', 'fixtureStatus'):
        candidate = Path(value[key])
        if not candidate.is_absolute() or not candidate.resolve().is_relative_to(root) or candidate.resolve() == root:
            raise SafetyError(f'{key} must remain inside the run directory')
    if origin(value['hostOrigin']) == origin(value['fixtureOrigin']):
        raise SafetyError('Host and QQ fixture must use separate ports')
    for key in ('primary', 'secondary'):
        route = value[key]
        if not isinstance(route, dict) or not all(isinstance(route.get(k), str) and route[k] for k in ('provider', 'model')):
            raise SafetyError('Explicit primary and secondary routes are required')
    if route_id(value['primary']) == route_id(value['secondary']):
        raise SafetyError('Primary and secondary routes must differ')
    if not all(isinstance(value['presets'].get(k), str) and value['presets'][k] for k in ('primary', 'secondary')):
        raise SafetyError('Both preset IDs are required')
    if value['presets']['primary'] == value['presets']['secondary']:
        raise SafetyError('Primary and secondary presets must differ')
    return value


def route_id(route):
    return route.get('provider'), route.get('model')


def private_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write('\n')
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def json_request(url, data=None, opener=None):
    request = urllib.request.Request(url, headers={'content-type': 'application/json'},
        data=None if data is None else json.dumps(data).encode(), method='GET' if data is None else 'POST')
    with (opener.open(request, timeout=40) if opener else urllib.request.urlopen(request, timeout=40)) as response:
        payload = response.read(8 * 1024 * 1024 + 1)
    if len(payload) > 8 * 1024 * 1024:
        raise RuntimeError('Test response exceeded the bounded read limit')
    return json.loads(payload)


class LocalRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed_origin):
        self.allowed_origin = allowed_origin

    def redirect_request(self, request, fp, code, message, headers, new_url):
        parsed = urllib.parse.urlsplit(new_url)
        if f'{parsed.scheme}://{parsed.netloc}' != self.allowed_origin:
            raise SafetyError('Test authentication cannot redirect outside its Host')
        return super().redirect_request(request, fp, code, message, headers, new_url)


class CommandAPI:
    def __init__(self, config):
        self.settings = config
        self.host = config['hostOrigin']
        self.qq = config['fixtureOrigin']
        self.opener = urllib.request.build_opener(LocalRedirect(self.host),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        pattern = re.escape(self.host) + r'/\?token=[A-Za-z0-9._~%+-]+'
        urls = re.findall(pattern, Path(config['hostLog']).read_text())
        if not urls:
            raise RuntimeError('Host startup authentication URL is unavailable; inspect the private run log')
        with self.opener.open(urls[-1], timeout=10):
            pass
        self.assert_dummy()

    def get(self, path):
        if not path.startswith('/') or path.startswith('//'):
            raise SafetyError('Host paths must be relative to its configured authority')
        return json_request(self.host + path, opener=self.opener)

    def config(self):
        return self.get('/qqbot/im-qqbot/config')['config']

    def assert_dummy(self):
        current = self.config()
        if current.get('appId') != '0000000000':
            raise SafetyError('Refusing a non-dummy QQ binding')
        if Path(current.get('cwd', '')).resolve() != Path(self.settings['workspace']).resolve():
            raise SafetyError('The QQ workspace is not owned by this test run')
        return current

    def rpc(self, endpoint, args=None):
        if endpoint not in READ_RPCS:
            raise SafetyError('Only the test matrix read-only RPC endpoints are supported')
        response = json_request(self.host + '/api/' + endpoint, {
            'type': 'client-request', 'rpcId': str(uuid.uuid4()), 'method': endpoint,
            'payload': {'args': args or {}},
        }, self.opener)
        result = response['result']
        if not result['ok']:
            # Error details can contain configuration or credentials. Preserve only the code.
            raise RpcError(f'{endpoint}: {result.get("error", {}).get("code", "unknown")}')
        return result['value']

    def fixture(self, path, data=None):
        if path not in {'status', 'observations', 'message', 'outbound'}:
            raise SafetyError('Unsupported fixture operation')
        if data is not None:
            self.assert_dummy()
            if path == 'message':
                if data.get('command') not in COMMANDS:
                    raise SafetyError('Only fixed fixture commands are supported')
                if data['command'] in GENERATING_COMMANDS:
                    self.ensure_primary_route(data.get('scope', 'c2c'), data.get('identity', 'allowed'))
        return json_request(self.qq + '/__fixture/' + path, data)

    def prefs(self):
        path = Path(self.settings['dataDir']) / 'model-prefs.json'
        value = json.loads(path.read_text()) if path.exists() else {}
        return {key: value.get(key, {}) for key in ('overrides', 'presets', 'sessionIds')}

    @staticmethod
    def peer_key(scope='c2c', identity='allowed'):
        if scope not in {'c2c', 'group'} or identity not in {'allowed', 'denied'}:
            raise SafetyError('Only fixed synthetic peers are supported')
        return f'qqbot:0000000000:{scope}:local-fixture-{identity}-' + ('user' if scope == 'c2c' else 'group')

    def projection(self, session_id):
        value = self.rpc('session/projections', {'request': {'sessionId': session_id}})
        return None if value is None else value['values']

    def state(self, session_id):
        return self.rpc('session/state', {'request': {'sessionId': session_id}})

    def events(self, session_id, max_pages=50, max_events=20000):
        """Read complete durable history at one cut; never accept a truncated prefix."""
        all_events = {}
        before = None
        cut = None
        for _ in range(max_pages):
            request = {'address': {'kind': 'session', 'sessionId': session_id}, 'maxMessages': 200}
            if before is not None:
                request['beforeSeq'] = before
            if cut is not None:
                request['throughSeq'] = cut
            page = self.rpc('session/events', {'request': request})
            if cut is None:
                cut = page['cursor']
            elif page['cursor'] != cut:
                raise RuntimeError('Session history pagination changed its read cut')
            events = [row['event'] for row in page['records'] if row.get('type') == 'event']
            for event in events:
                if event['seq'] in all_events and all_events[event['seq']] != event:
                    raise RuntimeError('Inconsistent event across history pages')
                all_events[event['seq']] = event
            if len(all_events) > max_events:
                raise RuntimeError('Session history exceeds the bounded verification size')
            if not page['hasMore']:
                ordered = [all_events[key] for key in sorted(all_events)]
                if [event['seq'] for event in ordered] != list(range(cut + 1)):
                    raise RuntimeError('Session history is not a complete contiguous log')
                return ordered
            if not events:
                raise RuntimeError('History reports more pages without a usable cursor')
            next_before = min(event['seq'] for event in events)
            if before is not None and next_before >= before:
                raise RuntimeError('Session history pagination did not advance')
            before = next_before
        raise RuntimeError('Session history exceeds the bounded page limit')

    def ensure_primary_route(self, scope, identity):
        if not self.settings['allowModelRequests']:
            raise SafetyError('Model requests require --allow-model-requests')
        config = self.assert_dummy()
        expected = self.settings['primary']
        catalog = self.rpc('session/modelCatalog')
        group = next((row for row in catalog['groups'] if row['id'] == expected['provider']), None)
        if not group or not group['models'] or group['models'][0]['id'] != expected['model']:
            raise SafetyError('Generation is permitted only on the configured provider first model')
        preferences = self.prefs()
        key = self.peer_key(scope, identity)
        route = preferences['overrides'].get(key)
        if route is None:
            route = dict(catalog['default'])
            if config.get('provider') or config.get('model'):
                route = {'provider': config.get('provider') or route.get('provider'),
                    'model': config.get('model') or route.get('model')}
        session_id = preferences['sessionIds'].get(key)
        if session_id:
            projected = self.projection(session_id)
            if projected is not None:
                route = projected.get('modelSelection', {}).get('next') or route
        if route_id(route) != route_id(expected):
            raise SafetyError('The current chat is not routed to the permitted primary model')
        if expected.get('reasoningEffort') and route.get('reasoningEffort') != expected['reasoningEffort']:
            raise SafetyError('The primary reasoning effort does not match the run configuration')

    def inject(self, command, scope='c2c', identity='allowed', mention=True, wait=True):
        if command not in COMMANDS or not isinstance(mention, bool):
            raise SafetyError('Only fixed fixture command keys are supported')
        self.peer_key(scope, identity)
        self.assert_dummy()
        if command in GENERATING_COMMANDS:
            self.ensure_primary_route(scope, identity)
        if self.fixture('status')['activeConnections'] != 1:
            raise SafetyError('Exactly one SDK connection is required')
        before = self.fixture('observations')
        baseline = max((row['sequence'] for row in before['outbound']), default=0)
        self.fixture('message', {'command': command, 'scope': scope, 'identity': identity, 'mention': mention})
        deadline = time.monotonic() + (60 if command in GENERATING_COMMANDS else 20)
        latest = before
        if wait:
            while time.monotonic() < deadline:
                latest = self.fixture('observations')
                if any(row['sequence'] > baseline for row in latest['outbound']):
                    break
                time.sleep(.05)
            else:
                raise RuntimeError(f'{command}: no synthetic QQ response before timeout')
        return {'outbound': [row for row in latest['outbound'] if row['sequence'] > baseline], 'baseline': baseline}

    def scenarios(self):
        p, s, presets = self.settings['primary'], self.settings['secondary'], self.settings['presets']
        return {
            'inherited': {'provider': '', 'model': '', 'preset': ''},
            'model-inherited-preset-primary': {'provider': '', 'model': '', 'preset': presets['primary']},
            'web-primary': {'provider': p['provider'], 'model': p['model'], 'preset': presets['primary']},
            'web-secondary': {'provider': s['provider'], 'model': s['model'], 'preset': presets['secondary']},
        }

    def set_defaults(self, scenario):
        expected = self.scenarios()[scenario]
        current = self.assert_dummy()
        changed = any(current.get(key) != value for key, value in expected.items())
        ready_before = self.fixture('status')['readyCount']
        response = json_request(self.host + '/qqbot/im-qqbot/config', expected, self.opener)
        if not response.get('ok'):
            raise RuntimeError('Web config did not acknowledge its write')
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            try:
                actual = self.assert_dummy()
                status = self.fixture('status')
                if (all(actual.get(key) == value for key, value in expected.items())
                        and status['activeConnections'] == 1
                        and (not changed or status['readyCount'] > ready_before)
                        and self.get('/qqbot/im-qqbot/runtime')['phase'] == 'ready'):
                    return {'readback': True, 'hmr': changed,
                        'readyBefore': ready_before, 'readyAfter': status['readyCount']}
            except (urllib.error.HTTPError, urllib.error.URLError):
                pass
            time.sleep(.05)
        raise RuntimeError('Web config readback or observed QQ reconnect did not converge')

    def wait_idle(self, session_id):
        for _ in range(6):
            result = self.rpc('session/wait', {'request': {
                'sessionId': session_id, 'timeoutMs': 10000, 'maxMessages': 4}})
            if result['reason'] != 'timeout':
                if result['reason'] != 'idle':
                    raise RuntimeError('Model task stopped for pending input rather than idle')
                return
        raise RuntimeError('Model task did not settle within the bounded wait')

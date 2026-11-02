import copy
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

from command_api import SafetyError


SPEC = importlib.util.spec_from_file_location('qq_sidebar_fixtures', Path(__file__).with_name('qq-sidebar-fixtures.py'))
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FixtureAPI:
    def __init__(self, root):
        self.run_dir = root
        self.settings = {'workspace': str(root)}
        self.ready = True
        self.busy = False
        self.actions = []
        self.workspaces = {}
        self.rows = {}
        self.entries = []
        for scope, count in [('group', 5), ('c2c', 26)]:
            sessions = []
            for index in range(count):
                sid = f'{scope}-{index}'
                sessions.append({'sessionId': sid})
                self.rows[sid] = {'sessionId': sid, 'cwd': str(root), 'projections': {'values': {'title': None}}}
            self.entries.append({'key': f'qqbot:0000000000:{scope}:local-fixture-allowed-peer',
                'scope': scope, 'admitted': True, 'alias': '', 'sessions': sessions,
                'currentSessionId': sessions[-1]['sessionId'], 'workspaceId': None, 'policy': {'version': 1}})
        self.entries.append({'key': 'qqbot:0000000000:c2c:local-fixture-denied-user',
            'scope': 'c2c', 'admitted': False, 'alias': '', 'sessions': [], 'currentSessionId': None})

    def assert_dummy(self):
        return {'appId': '0000000000'}

    def fixture(self, operation):
        assert operation == 'status'
        return {'activeConnections': 1, 'readyCount': 1, 'outboundMode': 'blocked',
            'observedOutboundRequests': 0, 'successfulOutboundRequests': 0, 'mediaUploadRequests': 0, 'receivedMessages': 0}

    def _request(self, path):
        assert path == '/qqbot/im-qqbot/runtime'
        return {'phase': 'ready' if self.ready else 'connecting'}

    def snapshot(self):
        return {'conversations': copy.deepcopy(self.entries)}

    def entry(self, scope, identity):
        assert identity == 'allowed'
        return copy.deepcopy(next(row for row in self.entries if row['scope'] == scope and row['admitted']))

    def state(self, session_id):
        return {'running': self.busy, 'pendingInput': [], 'queue': None}

    def events(self, session_id):
        return []

    def rpc(self, method, args=None):
        if method == 'session/list':
            assert args == {'_request': {}}
            return {'items': copy.deepcopy(list(self.rows.values()))}
        assert method == 'session/modelCatalog'
        return {'default': {'provider': 'fixture', 'model': 'never-called'}}

    def adopt_workspace(self, path):
        self.workspaces[path] = path
        return {'workspace': {'workspaceId': path, 'path': path}}

    def action(self, action, scope, identity, **fields):
        assert action in {'workspace', 'reset', 'policy'} and identity == 'allowed'
        row = next(row for row in self.entries if row['scope'] == scope and row['admitted'])
        self.actions.append((action, scope))
        if action == 'policy':
            assert fields['expectedVersion'] == row['policy']['version']
            row['alias'] = fields['alias']
            row['policy']['version'] += 1
            return {}
        if action == 'workspace' and fields['workspaceId'] == row['workspaceId']:
            return {}
        if action == 'workspace':
            row['workspaceId'] = fields['workspaceId']
        sid = f'{scope}-{len(row["sessions"])}'
        row['sessions'].append({'sessionId': sid})
        row['currentSessionId'] = sid
        self.rows[sid] = {'sessionId': sid, 'cwd': row['workspaceId'], 'projections': {'values': {'title': None}}}
        return {'sessionId': sid}


class SidebarFixturesTest(unittest.TestCase):
    def test_two_runs_add_only_two_group_sessions_and_preserve_c2c_and_denied(self):
        with tempfile.TemporaryDirectory() as directory:
            api = FixtureAPI(Path(directory).resolve())
            first = MODULE.SidebarFixtures(api).run()
            after_first = api.snapshot()
            calls = list(api.actions)
            second = MODULE.SidebarFixtures(api).run()
            self.assertEqual(first['createdSessions'], 2)
            self.assertEqual(second['createdSessions'], 0)
            self.assertEqual(after_first, api.snapshot())
            self.assertEqual(calls, api.actions)
            self.assertEqual(len(api.entry('group', 'allowed')['sessions']), 7)
            self.assertEqual(len(api.entry('c2c', 'allowed')['sessions']), 26)
            self.assertEqual(api.entries[-1]['sessions'], [])

    def test_partial_history_workspace_run_converges_with_one_new_session(self):
        with tempfile.TemporaryDirectory() as directory:
            api = FixtureAPI(Path(directory).resolve())
            fixture = MODULE.SidebarFixtures(api)
            history = str(fixture.paths['history'])
            api.adopt_workspace(history)
            api.action('workspace', 'group', 'allowed', workspaceId=history)
            result = fixture.run()
            self.assertEqual(result['createdSessions'], 1)
            self.assertEqual(len(api.entry('group', 'allowed')['sessions']), 7)

    def test_unready_or_busy_deployment_stops_before_mutation(self):
        for condition in ('ready', 'busy'):
            with self.subTest(condition=condition), tempfile.TemporaryDirectory() as directory:
                api = FixtureAPI(Path(directory).resolve())
                setattr(api, condition, condition == 'busy')
                fixture = MODULE.SidebarFixtures(api)
                with self.assertRaises(SafetyError):
                    fixture.run()
                self.assertEqual(api.actions, [])
                self.assertEqual(api.workspaces, {})
                self.assertFalse(fixture.paths['history'].exists())


if __name__ == '__main__':
    unittest.main()

"""Offline safety and complete-history contracts for the portable command harness."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from command_api import CommandAPI, RpcError, SafetyError, load_config, private_json


class CommandAPITests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='qqbot-api-test-')
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.settings = {'version': 1, 'runDir': str(root), 'home': str(root / 'home'),
            'workspace': str(root / 'workspace'), 'dataDir': str(root / 'data'),
            'hostLog': str(root / 'host.log'), 'fixtureLog': str(root / 'fixture.log'),
            'fixtureStatus': str(root / 'fixture-status.json'),
            'hostOrigin': 'http://127.0.0.1:31001', 'fixtureOrigin': 'http://127.0.0.1:31002',
            'allowModelRequests': False,
            'primary': {'provider': 'provider', 'model': 'first', 'reasoningEffort': 'high'},
            'secondary': {'provider': 'provider', 'model': 'second'},
            'presets': {'primary': 'preset-one', 'secondary': 'preset-two'}}
        self.config_path = root / 'run.json'

    def load(self, **changes):
        value = {**self.settings, **changes}
        self.config_path.write_text(json.dumps(value))
        return load_config(self.config_path)

    def api(self, enabled=False):
        api = CommandAPI.__new__(CommandAPI)
        api.settings = {**self.settings, 'allowModelRequests': enabled}
        api.host = self.settings['hostOrigin']
        api.qq = self.settings['fixtureOrigin']
        api.opener = object()
        api.config = Mock(return_value={'appId': '0000000000', 'cwd': self.settings['workspace'],
            'provider': '', 'model': '', 'preset': ''})
        return api

    def routed_api(self):
        api = self.api(enabled=True)
        api.rpc = Mock(return_value={'default': self.settings['primary'],
            'groups': [{'id': 'provider', 'models': [{'id': 'first'}, {'id': 'second'}]}]})
        api.prefs = Mock(return_value={'overrides': {}, 'presets': {}, 'sessionIds': {}})
        return api

    def test_config_accepts_separate_loopback_ports_and_owned_paths(self):
        self.assertEqual(self.load()['dataDir'], self.settings['dataDir'])

    def test_config_rejects_remote_origins_credentials_paths_and_shared_port(self):
        invalid = ['https://127.0.0.1:31001', 'http://example.test:31001',
            'http://user:secret@127.0.0.1:31001', 'http://127.0.0.1:31001/path',
            'http://127.0.0.1:31001?token=secret', 'http://127.0.0.1']
        for value in invalid:
            with self.subTest(origin=value), self.assertRaises((SafetyError, ValueError)):
                self.load(hostOrigin=value)
        with self.assertRaises(SafetyError):
            self.load(fixtureOrigin=self.settings['hostOrigin'])

    def test_config_rejects_escaped_data_directory_and_symlink(self):
        with self.assertRaises(SafetyError):
            self.load(dataDir=str(Path(self.settings['runDir']).parent / 'outside'))
        link = Path(self.settings['runDir']) / 'linked-data'
        link.symlink_to(Path(self.settings['runDir']).parent, target_is_directory=True)
        with self.assertRaises(SafetyError):
            self.load(dataDir=str(link))

    def test_config_requires_explicit_boolean_generation_permission(self):
        for value in [None, 'true', 1]:
            with self.subTest(permission=value), self.assertRaises(SafetyError):
                self.load(allowModelRequests=value)

    def test_config_rejects_indistinguishable_routes_and_presets(self):
        with self.assertRaises(SafetyError):
            self.load(secondary=self.settings['primary'])
        with self.assertRaises(SafetyError):
            self.load(presets={'primary': 'one', 'secondary': 'one'})

    def test_private_report_is_not_world_readable(self):
        private_json(self.config_path, {'passed': True})
        self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads(self.config_path.read_text()), {'passed': True})

    def test_dummy_guard_refuses_live_binding_before_mutating_fixture(self):
        api = self.api()
        api.config.return_value['appId'] = 'real-account'
        with patch('command_api.json_request') as request:
            with self.assertRaises(SafetyError):
                api.inject('help')
            with self.assertRaises(SafetyError):
                api.fixture('outbound', {'mode': 'success'})
            with self.assertRaises(SafetyError):
                api.set_defaults('web-primary')
            request.assert_not_called()

    def test_dummy_guard_requires_the_run_workspace(self):
        api = self.api()
        api.config.return_value['cwd'] = str(Path(self.settings['runDir']).parent)
        with self.assertRaises(SafetyError):
            api.assert_dummy()

    def test_no_permission_blocks_both_generation_paths_before_send(self):
        api = self.api()
        for command in ['smoke', 'compact']:
            with self.subTest(command=command), patch('command_api.json_request') as request:
                with self.assertRaises(SafetyError):
                    api.inject(command)
                with self.assertRaises(SafetyError):
                    api.fixture('message', {'command': command})
                request.assert_not_called()

    def test_free_form_commands_and_real_peer_identifiers_are_rejected(self):
        api = self.api()
        with self.assertRaises(SafetyError):
            api.inject('send arbitrary text')
        with self.assertRaises(SafetyError):
            api.inject('help', identity='real-peer')
        with self.assertRaises(SafetyError):
            api.inject('help', scope='channel')

    def test_primary_guard_accepts_inherited_route_and_new_session_null_projection(self):
        api = self.routed_api()
        api.prefs.return_value['sessionIds'][api.peer_key()] = 'new-not-created'
        api.projection = Mock(return_value=None)
        api.ensure_primary_route('c2c', 'allowed')
        api.projection.assert_called_once_with('new-not-created')

    def test_primary_guard_refuses_secondary_or_wrong_effort(self):
        for route in [self.settings['secondary'], {'provider': 'provider', 'model': 'first', 'reasoningEffort': 'low'}]:
            api = self.routed_api()
            api.prefs.return_value['overrides'][api.peer_key()] = route
            with self.subTest(route=route), self.assertRaises(SafetyError):
                api.ensure_primary_route('c2c', 'allowed')

    def test_primary_guard_cannot_ignore_projection_errors(self):
        api = self.routed_api()
        api.prefs.return_value['sessionIds'][api.peer_key()] = 'existing'
        api.projection = Mock(side_effect=RpcError('session/projections: unavailable'))
        with self.assertRaises(RpcError):
            api.ensure_primary_route('c2c', 'allowed')

    def test_primary_guard_requires_provider_first_model(self):
        api = self.routed_api()
        api.rpc.return_value['groups'][0]['models'].reverse()
        with self.assertRaises(SafetyError):
            api.ensure_primary_route('c2c', 'allowed')

    def test_rpc_errors_do_not_leak_remote_error_payload(self):
        api = self.api()
        with patch('command_api.json_request', return_value={'result': {
                'ok': False, 'error': {'code': 'fixture/error', 'message': 'secret credential text'}}}):
            with self.assertRaises(RpcError) as caught:
                api.rpc('session/modelCatalog')
        self.assertEqual(str(caught.exception), 'session/modelCatalog: fixture/error')

    def test_rpc_surface_cannot_create_or_prompt_sessions(self):
        api = self.api()
        with patch('command_api.json_request') as request:
            for method in ['session/create', 'session/prompt', 'other/mutate']:
                with self.subTest(method=method), self.assertRaises(SafetyError):
                    api.rpc(method, {})
            request.assert_not_called()

    def test_history_paginates_at_one_cut_and_preserves_complete_prefix(self):
        api = self.api()
        entries = [{'type': 'event', 'event': {'seq': i, 'type': 'fixture/event'}} for i in range(3)]
        api.rpc = Mock(side_effect=[{'cursor': 2, 'records': entries[1:], 'hasMore': True},
            {'cursor': 2, 'records': entries[:1], 'hasMore': False}])
        self.assertEqual([row['seq'] for row in api.events('session')], [0, 1, 2])
        second = api.rpc.call_args_list[1].args[1]['request']
        self.assertEqual(second['beforeSeq'], 1)
        self.assertEqual(second['throughSeq'], 2)

    def test_history_rejects_unread_pages_empty_cursor_and_event_gaps(self):
        api = self.api()
        page = {'cursor': 2, 'records': [{'type': 'event', 'event': {'seq': 2}}], 'hasMore': True}
        api.rpc = Mock(return_value=page)
        with self.assertRaises(RuntimeError):
            api.events('session', max_pages=1)
        api.rpc.return_value = {'cursor': 2, 'records': [], 'hasMore': True}
        with self.assertRaises(RuntimeError):
            api.events('session')
        api.rpc.return_value = {**page, 'hasMore': False}
        with self.assertRaises(RuntimeError):
            api.events('session')

    def test_web_readback_alone_does_not_prove_hmr(self):
        api = self.api()
        before = api.config.return_value
        after = {**before, 'provider': 'provider', 'model': 'first', 'preset': 'preset-one'}
        api.config.side_effect = [before, after]
        api.fixture = Mock(return_value={'readyCount': 1, 'activeConnections': 1})
        api.get = Mock(return_value={'phase': 'ready'})
        with patch('command_api.json_request', return_value={'ok': True}), \
                patch('command_api.time.monotonic', side_effect=[0, 0, 21]), \
                patch('command_api.time.sleep'):
            with self.assertRaises(RuntimeError):
                api.set_defaults('web-primary')


if __name__ == '__main__':
    unittest.main()

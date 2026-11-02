"""Safety boundaries without accessing a DSH Home, gateway, or model."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import upstream_api
from upstream_api import SafetyError, UpstreamAPI, load_config, test_home


class SafeAPITest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.api = object.__new__(UpstreamAPI)
        self.api.settings = {'workspace': str(self.workspace), 'allowModelRequests': False,
            'primary': {'provider': 'test', 'model': 'primary'}, 'secondary': {'provider': 'test', 'model': 'secondary'},
            'presets': {'primary': 'standard', 'secondary': 'minimal'}}
        self.api._request = Mock(side_effect=AssertionError('No network request should be made'))

    def deployment_config(self):
        home = self.root / 'test-home'
        evidence = home / 'evidence' / 'run'
        evidence.mkdir(parents=True)
        value = {'version': 2, 'kind': 'stock-qqbot-commands', 'home': str(home), 'profile': 'qqbot-commands',
            'hostOrigin': upstream_api.HOST, 'fixtureOrigin': upstream_api.FIXTURE, 'allowModelRequests': False,
            'runDir': str(evidence), 'hostLog': str(evidence / 'host.log'), 'workspace': str(self.workspace),
            'dataDir': str(home / 'data'), 'dshSource': str(self.root / 'stock'), 'pluginRoot': str(self.root / 'plugin'),
            'primary': {'provider': 'test', 'model': 'primary'}, 'secondary': {'provider': 'test', 'model': 'secondary'},
            'presets': {'primary': 'standard', 'secondary': 'minimal'}}
        for key in ('dataDir', 'dshSource', 'pluginRoot'):
            Path(value[key]).mkdir()
        (home / 'profiles' / 'qqbot-commands').mkdir(parents=True)
        path = evidence / 'run.json'
        path.write_text(json.dumps(value))
        return path, value, {'QQBOT_TEST_HOME': str(home)}

    def test_portable_default_and_environment_home_registration(self):
        self.assertEqual(test_home({}), Path.home() / '.local' / 'share' / 'dsh-qqbot-command-test')
        self.assertEqual(test_home({'QQBOT_TEST_HOME': str(self.root)}), self.root)

    def test_daily_home_profile_and_unbounded_environment_roots_are_rejected(self):
        daily = self.root / 'daily'
        for home in ('', '.', str(Path.home()), str(Path(self.root.anchor)), str(Path.home() / '.dsh'),
                str(Path.home() / '.dsh' / 'profiles' / 'web'), str(daily), str(daily / 'profiles' / 'web'), str(self.root)):
            with self.subTest(home=home), self.assertRaises(SafetyError):
                test_home({'QQBOT_TEST_HOME': home, 'DSH_HOME': str(daily)})

    def test_registered_temporary_home_loads_without_network(self):
        path, value, env = self.deployment_config()
        self.assertEqual(load_config(path, env), value)
        self.api._request.assert_not_called()

    def test_config_cannot_register_its_own_home_or_change_the_profile(self):
        path, value, env = self.deployment_config()
        with self.assertRaises(SafetyError):
            load_config(path, {'QQBOT_TEST_HOME': str(self.workspace)})
        for key, candidate in [('home', str(self.workspace)), ('profile', 'web')]:
            with self.subTest(key=key):
                changed = {**value, key: candidate}
                path.write_text(json.dumps(changed))
                with self.assertRaises(SafetyError):
                    load_config(path, env)

    def test_data_must_be_a_canonical_descendant_of_the_registered_home(self):
        path, value, env = self.deployment_config()
        alias = Path(value['home']) / 'data-link'
        alias.symlink_to(self.workspace, target_is_directory=True)
        for candidate in (self.workspace, Path(value['home']), alias):
            with self.subTest(path=candidate):
                path.write_text(json.dumps({**value, 'dataDir': str(candidate)}))
                with self.assertRaises(SafetyError):
                    load_config(path, env)

    def test_home_and_evidence_symlinks_cannot_escape_isolation(self):
        path, value, env = self.deployment_config()
        alias = self.root / 'home-link'
        alias.symlink_to(Path(value['home']), target_is_directory=True)
        with self.assertRaises(SafetyError):
            load_config(path, {'QQBOT_TEST_HOME': str(alias)})
        run = path.parent
        outside = self.root / 'outside'
        run.rename(outside)
        evidence = Path(value['home']) / 'evidence'
        evidence.rmdir()
        evidence.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(SafetyError):
            load_config(outside / 'run.json', env)

    def test_profile_cannot_link_outside_the_isolated_home(self):
        path, value, env = self.deployment_config()
        profile = Path(value['home']) / 'profiles' / 'qqbot-commands'
        profile.rmdir()
        profile.symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaises(SafetyError):
            load_config(path, env)

    def test_unlisted_rpc_is_rejected_before_network(self):
        with self.assertRaises(SafetyError):
            self.api.rpc('session/delete', {'request': {'sessionId': 'unowned'}})
        self.api._request.assert_not_called()

    def test_generation_without_runner_opt_in_is_rejected_before_network(self):
        with self.assertRaises(SafetyError):
            self.api.require_model()
        self.api._request.assert_not_called()

    def test_directory_boundary_rejects_outside_and_symlink_escape(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (self.workspace / 'escape').symlink_to(outside, target_is_directory=True)
        for path in (outside, self.workspace / 'escape'):
            with self.assertRaises(SafetyError):
                self.api.rpc('directoryPicker/list', {'path': str(path)})
        self.api._request.assert_not_called()

    def test_directory_listing_cannot_default_to_personal_home(self):
        with self.assertRaises(SafetyError):
            self.api.rpc('directoryPicker/list')
        self.api._request.assert_not_called()

    def test_native_session_is_scoped_before_any_rpc(self):
        self.api.owned = set()
        self.api.snapshot = Mock(return_value={'conversations': []})
        with self.assertRaises(SafetyError):
            self.api.state('daily-session')
        self.api._request.assert_not_called()

    def test_conversation_identity_cannot_be_overridden(self):
        with self.assertRaises(SafetyError):
            self.api.action('send', key='qqbot:real-app:c2c:real-peer', text='test', operationId='upstream-test')
        self.api._request.assert_not_called()

    def test_prompt_content_rejects_attachments_and_malformed_blocks(self):
        for content in ([], [None], [{'type': 'image', 'data': 'test'}], [{'type': 'text', 'text': ''}]):
            with self.assertRaises(SafetyError):
                self.api._content(content)

    def test_non_dummy_binding_is_rejected(self):
        self.api._request = Mock(return_value={'config': {'appId': 'real-app', 'cwd': str(self.workspace)}})
        with self.assertRaises(SafetyError):
            self.api.assert_dummy()

    def test_daily_or_real_review_ports_are_rejected_from_config(self):
        path, value, env = self.deployment_config()
        for key, origin in [('hostOrigin', 'http://127.0.0.1:3080'), ('hostOrigin', 'http://127.0.0.1:3192'),
                ('hostOrigin', 'https://example.com'), ('fixtureOrigin', 'http://127.0.0.1:3194'),
                ('fixtureOrigin', 'https://example.com')]:
            with self.subTest(key=key, origin=origin):
                path.write_text(json.dumps({**value, key: origin}))
                with self.assertRaises(SafetyError):
                    load_config(path, env)

    def test_typing_notification_is_recorded_separately_from_final_text(self):
        rows = [{'sequence': 1, 'messageType': 6, 'content': ''},
            {'sequence': 2, 'messageType': 2, 'content': 'final'}]
        value = self.api.classify_outbound(rows)
        self.assertEqual(value['totalRequests'], 2)
        self.assertEqual(value['contentMessages'], [rows[1]])
        self.assertEqual(value['protocolNotifications'], [{'kind': 'typing', **rows[0]}])

    def test_unknown_types_or_nonempty_typing_are_not_silently_filtered(self):
        for message_type, content in [(99, ''), (99, 'unexpected'), (6, 'unexpected')]:
            with self.assertRaises(RuntimeError):
                self.api.classify_outbound([{'sequence': 1, 'messageType': message_type, 'content': content}])

    def test_contents_only_keeps_raw_request_overflow_gate(self):
        self.api.fixture = Mock(side_effect=[{'observedOutboundRequests': 3},
            {'outbound': [{'sequence': 3, 'messageType': 6, 'content': ''}]}])
        with self.assertRaisesRegex(RuntimeError, 'overflowed'):
            self.api.outbound_since(0, contents_only=True)

    def test_outbound_read_cut_does_not_mistake_concurrent_send_for_overflow(self):
        rows = [{'sequence': 1, 'messageType': 6, 'content': ''},
            {'sequence': 2, 'messageType': 2, 'content': 'arrived after cut'}]
        self.api.fixture = Mock(side_effect=[{'observedOutboundRequests': 1}, {'outbound': rows}])
        self.assertEqual(self.api.outbound_since(0), [rows[0]])

    def test_final_wait_does_not_return_when_only_typing_has_arrived(self):
        typing = {'sequence': 1, 'messageType': 6, 'content': ''}
        final = {'sequence': 2, 'messageType': 0, 'content': 'final'}
        self.api.fixture = Mock(side_effect=[{'observedOutboundRequests': 1}, {'outbound': [typing]},
            {'observedOutboundRequests': 2}, {'outbound': [typing, final]}])
        with patch.object(upstream_api.time, 'sleep'):
            self.assertEqual(self.api.wait_outbound(0, contents_only=True), [final])


if __name__ == '__main__':
    unittest.main()

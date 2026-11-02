"""Prepare bounded metadata-only fixtures for the stock QQ sidebar acceptance."""
import argparse
import copy
import json
import time
from dataclasses import dataclass
from pathlib import Path

from upstream_api import RpcError, SafetyError, UpstreamAPI, load_config, private_json


@dataclass(frozen=True)
class Peer:
    scope: str
    alias: str


PEERS = (
    Peer('group', 'QQ 左栏验收群 · 这是一个用于验证侧栏省略截断及完整名称提示的长备注'),
    Peer('c2c', 'QQ 左栏验收联系人'),
)
MIN_GROUP_SESSIONS = 7


def require(condition, message):
    if not condition:
        raise SafetyError(message)


def model_counts(events):
    counts = {'request/header': 0, 'turn/start': 0}
    for event in events:
        kind = event['type']
        if kind.startswith('request/') or kind == 'turn/start':
            counts[kind] = counts.get(kind, 0) + 1
    return counts


class SidebarFixtures:
    def __init__(self, api):
        self.api = api
        self.output = api.run_dir / 'sidebar-fixtures.json'
        root = Path(api.settings['workspace'])
        self.paths = {name: root / ('qq-sidebar-' + name) for name in ('history', 'current')}
        self.report = {'version': 1, 'passed': False, 'startedAt': time.time(),
            'boundary': 'Real stock Host with synthetic QQ peers; metadata only, no model or QQ send',
            'createdSessionIds': [], 'actions': [], 'limitations': []}

    def save(self):
        private_json(self.output, self.report)

    def native_rows(self):
        return {row['sessionId']: row for row in self.api.rpc('session/list', {'_request': {}})['items']}

    def entry(self, scope):
        entry = self.api.entry(scope, 'allowed')
        require(entry is not None and entry['admitted'], 'Both allowed synthetic peers must already be discovered and admitted')
        return entry

    def capture(self, snapshot):
        sessions = {item['sessionId'] for row in snapshot['conversations'] for item in row['sessions']}
        evidence = {}
        for session_id in sorted(sessions):
            state = self.api.state(session_id)
            require(not state.get('running') and not state.get('pendingInput') and not state.get('queue'),
                'All mapped synthetic Sessions must be idle with no queued or pending input')
            evidence[session_id] = {'counts': model_counts(self.api.events(session_id)), 'state': state}
        return evidence

    def action(self, action, scope='group', **fields):
        result = self.api.action(action, scope=scope, identity='allowed', **fields)
        self.report['actions'].append({'action': action, 'scope': scope})
        current = self.entry(scope)['currentSessionId']
        if current and current not in self.report['beforeSessions'] and current not in self.report['createdSessionIds']:
            self.report['createdSessionIds'].append(current)
        self.save()
        return result

    def prepare_group(self, workspaces):
        entry = self.entry('group')
        rows = self.native_rows()
        history = str(self.paths['history'])
        historical = any(rows.get(item['sessionId'], {}).get('cwd') == history
            for item in entry['sessions'] if item['sessionId'] != entry['currentSessionId'])
        current = rows.get(entry['currentSessionId'], {})
        complete = historical and current.get('cwd') == str(self.paths['current'])
        if not complete:
            if not historical:
                self.action('workspace', workspaceId=workspaces['history']['workspaceId'])
            while len(self.entry('group')['sessions']) < MIN_GROUP_SESSIONS - 1:
                self.action('reset')
            self.action('workspace', workspaceId=workspaces['current']['workspaceId'])
        while len(self.entry('group')['sessions']) < MIN_GROUP_SESSIONS:
            self.action('reset')

    def run(self):
        self.api.assert_dummy()
        fixture = self.api.fixture('status')
        runtime = self.api._request('/qqbot/im-qqbot/runtime')
        require(runtime.get('phase') == 'ready' and fixture.get('activeConnections') == 1
            and fixture.get('readyCount', 0) >= 1 and fixture.get('outboundMode') == 'blocked',
            'The existing stock runtime must be ready with one blocked-outbound dummy QQ connection')
        before = self.api.snapshot()
        for peer in PEERS:
            self.entry(peer.scope)
        self.report.update({'beforeDirectory': before, 'beforeSessions': self.capture(before),
            'beforeFixture': fixture, 'beforeHostDefault': self.api.rpc('session/modelCatalog')['default']})
        self.save()
        for peer in PEERS:
            entry = self.entry(peer.scope)
            if entry['alias'] != peer.alias:
                self.action('policy', scope=peer.scope, expectedVersion=entry['policy']['version'],
                    policy=copy.deepcopy(entry['policy']), alias=peer.alias)
        workspaces = {}
        for name, path in self.paths.items():
            path.mkdir(mode=0o700, exist_ok=True)
            require(path.resolve(strict=True) == path and path.is_dir(), 'Fixture workspaces must be real canonical directories')
            workspaces[name] = self.api.adopt_workspace(str(path))['workspace']
        self.report['workspaces'] = workspaces
        self.prepare_group(workspaces)
        after = self.api.snapshot()
        evidence = self.capture(after)
        for session_id, prior in self.report['beforeSessions'].items():
            require(session_id in evidence and evidence[session_id]['counts'] == prior['counts'],
                'Existing Session model-request or turn-start evidence changed')
        for session_id in evidence.keys() - self.report['beforeSessions'].keys():
            require(not any(evidence[session_id]['counts'].values()), 'New metadata Session started generation')
        denied = lambda snapshot: [row for row in snapshot['conversations']
            if ':local-fixture-denied-' in row['key']]
        require(denied(before) == denied(after), 'The existing denied-peer directory must remain unchanged')
        rows = self.native_rows()
        group = self.entry('group')
        require(len(group['sessions']) >= MIN_GROUP_SESSIONS, 'The group needs at least seven mapped Sessions')
        require(rows[group['currentSessionId']]['cwd'] == str(self.paths['current']), 'The current Session has the wrong native cwd')
        require(any(item['sessionId'] != group['currentSessionId']
            and rows.get(item['sessionId'], {}).get('cwd') == str(self.paths['history']) for item in group['sessions']),
            'A historical Session must retain the history workspace cwd')
        after_fixture = self.api.fixture('status')
        for counter in ('observedOutboundRequests', 'successfulOutboundRequests', 'mediaUploadRequests', 'receivedMessages'):
            require(after_fixture.get(counter) == fixture.get(counter), 'Metadata preparation caused QQ traffic')
        host_default = self.api.rpc('session/modelCatalog')['default']
        require(host_default == self.report['beforeHostDefault'], 'Host default model changed')
        if not any(not row['admitted'] and not row['sessions'] for row in after['conversations']):
            self.report['limitations'].append('No existing unadmitted peer without Sessions. Use nonmatching UI search for the empty-data view; client behavior tests cover browse without creation.')
        expected = []
        for peer in PEERS:
            entry = self.entry(peer.scope)
            expected.append({'key': entry['key'], 'scope': peer.scope, 'alias': entry['alias'],
                'currentSessionId': entry['currentSessionId'], 'workspaceId': entry['workspaceId'],
                'sessions': [{**item, 'cwd': rows.get(item['sessionId'], {}).get('cwd'),
                    'title': rows.get(item['sessionId'], {}).get('projections', {}).get('values', {}).get('title')}
                    for item in entry['sessions']]})
        self.report.update({'afterDirectory': after, 'afterSessions': evidence, 'afterFixture': after_fixture,
            'afterHostDefault': host_default, 'expectedDirectory': expected, 'modelRequestsAdded': 0,
            'turnStartsAdded': 0, 'passed': True, 'finishedAt': time.time()})
        self.save()
        return {'passed': True, 'createdSessions': len(self.report['createdSessionIds']),
            'mappedSessions': sum(len(row['sessions']) for row in expected), 'modelRequestsAdded': 0,
            'turnStartsAdded': 0, 'evidence': str(self.output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    fixture = SidebarFixtures(UpstreamAPI(load_config(args.config)))
    try:
        result = fixture.run()
    except (SafetyError, RpcError, RuntimeError, ValueError, KeyError) as error:
        fixture.report.update({'failure': {'type': type(error).__name__, 'message': str(error)},
            'finishedAt': time.time()})
        fixture.save()
        print(json.dumps({'failed': True, 'errorType': type(error).__name__, 'evidence': str(fixture.output)}))
        raise SystemExit(1) from None
    print(json.dumps(result))


if __name__ == '__main__':
    main()

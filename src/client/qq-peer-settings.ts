import { createElement as h, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import type { QQAgentSettings } from '../shared/agent-settings.ts';
import type { ConversationAction, ConversationView, ToolCatalogEntry } from '../shared/conversation-protocol.ts';
import { permissionSandbox } from '../shared/policy-settings.ts';
import type { SelectorSource } from './host-selectors.ts';
import { QQAgentSettingsForm } from './qq-agent-settings-form.ts';
import { useQQAgentCatalog } from './qq-agent-catalog.ts';
import type { QQTranslate } from './qq-locale.ts';
import type { QQSessionStore } from './qq-session-store.ts';

interface PeerDraft { version: number; settings: QQAgentSettings; alias: string; receiveEnabled: boolean; nativePermission: string | null }
interface RetainedDraft { draft: PeerDraft; base: PeerDraft }
type PeerPatch = Extract<ConversationAction, { action: 'peer-settings' }>['patch'];
const drafts = new Map<string, RetainedDraft>();
function current(entry: ConversationView, settings: QQAgentSettings): PeerDraft {
  const permission = permissionSandbox(entry.currentPermission ?? '') ?? settings.execution.permission;
  const snapshot = structuredClone(settings);
  snapshot.execution.permission = permission;
  return { version: entry.policy.version, settings: snapshot, alias: entry.alias, receiveEnabled: entry.policy.receiveEnabled !== false, nativePermission: entry.currentPermission ?? null };
}
function settingsPatch(base: PeerDraft, draft: PeerDraft): PeerPatch {
  const patch: PeerPatch = {};
  if (base.alias !== draft.alias) patch.alias = draft.alias;
  if (base.receiveEnabled !== draft.receiveEnabled) patch.receiveEnabled = draft.receiveEnabled;
  for (const key of ['promptGroup', 'promptDirect'] as const) {
    if (base.settings[key] !== draft.settings[key]) Object.assign(patch, { [key]: draft.settings[key] });
  }
  const previous = base.settings.execution;
  const next = draft.settings.execution;
  if (previous.kind !== next.kind || (previous.kind === 'custom' && next.kind === 'custom' && JSON.stringify([...previous.tools].sort()) !== JSON.stringify([...next.tools].sort()))) {
    patch.toolScope = next.kind === 'native' ? { kind: 'native' } : { kind: 'custom', tools: next.tools };
  }
  if (previous.permission !== next.permission) {
    patch.permission = next.permission;
    patch.expectedPermission = base.nativePermission;
  }
  return patch;
}

export function QQPeerSettings({ entry, store, tools, t }: {
  entry: ConversationView; store: QQSessionStore; tools: readonly ToolCatalogEntry[]; selectorSource: SelectorSource; t: QQTranslate; workspaces?: ReadonlyArray<{ workspaceId: string; title: string; path: string }>; defaultWorkspaceName?: string; defaultCwd?: string;
}): ReactNode {
  if (!entry.settings) return h('p', { role: 'status', className: 'imqc-hint' }, '会话设置暂不可用，请刷新 QQ 目录。');
  return h(PeerSettingsDraft, { key: entry.key, entry, settings: entry.settings, store, tools, t });
}

function PeerSettingsDraft({ entry, settings, store, tools, t }: {
  entry: ConversationView; settings: QQAgentSettings; store: QQSessionStore; tools: readonly ToolCatalogEntry[]; t: QQTranslate;
}): ReactNode {
  const [retained, setRetained] = useState<RetainedDraft>(() => drafts.get(entry.key) ?? (() => { const draft = current(entry, settings); return { draft, base: draft }; })());
  const { draft, base } = retained;
  const catalog = useQQAgentCatalog(undefined, false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const changes = settingsPatch(base, draft);
  const dirty = Object.keys(changes).length > 0;
  const settingsConflict = base.version !== entry.policy.version;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (dirty) drafts.set(entry.key, retained); else drafts.delete(entry.key); }, [entry.key, retained, dirty]);
  useEffect(() => {
    if (!dirty && settingsConflict) { const value = current(entry, settings); setRetained({ draft: value, base: value }); }
  }, [dirty, settingsConflict, entry, settings]);
  useEffect(() => {
    const nativePermission = entry.currentPermission ?? null;
    setRetained(value => {
      if (value.base.nativePermission === nativePermission || value.draft.settings.execution.permission !== value.base.settings.execution.permission) return value;
      const permission = permissionSandbox(nativePermission ?? '') ?? settings.execution.permission;
      const follow = (previous: PeerDraft): PeerDraft => ({ ...previous, nativePermission, settings: { ...previous.settings, execution: { ...previous.settings.execution, permission } } });
      return { base: follow(value.base), draft: follow(value.draft) };
    });
  }, [entry.currentPermission, settings.execution.permission, draft.settings.execution.permission, base.settings.execution.permission]);
  const patch = (next: Partial<PeerDraft>): void => { setRetained(value => ({ ...value, draft: { ...value.draft, ...next } })); setError(''); setNotice(''); };
  const discard = (): void => { const value = current(entry, settings); setRetained({ draft: value, base: value }); drafts.delete(entry.key); setError(''); setNotice(''); };
  const clearRecords = (): void => {
    if (pending.current) return;
    if (typeof window !== 'undefined' && !window.confirm('确定清空此对话的全部消息记录？此操作不可撤销（不影响 QQ 会话与去重）。')) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    void store.perform({ action: 'clear-records', key: entry.key, expectedRecordingVersion: entry.recording?.version ?? 0 }).then(() => { if (mounted.current) setNotice('消息记录已清空。'); })
      .catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '清空失败'); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  };
  const admit = (): void => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    void store.perform({ action: 'admit', key: entry.key, enabled: true }).then(result => {
      if (mounted.current) setNotice(result.notice ?? '接入规则已保存，请等待目录确认接收状态。');
    }).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '接入规则保存失败'); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  };
  const save = (): void => {
    if (pending.current || !dirty || (entry.running || settingsConflict)) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    void store.perform({ action: 'peer-settings', key: entry.key, expectedVersion: base.version, patch: changes }).then(result => {
      const saved = result.snapshot?.conversations.find(value => value.key === entry.key);
      if (!saved?.settings) throw new Error('保存结果未确认，草稿已保留。请刷新目录核对。');
      const value = current(saved, saved.settings);
      drafts.delete(entry.key);
      if (mounted.current) { setRetained({ draft: value, base: value }); setNotice(result.notice ?? ''); }
    }).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '保存失败，草稿已保留。'); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  };
  const saveRecording = (enabled: boolean): void => {
    if (pending.current || !entry.recording) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    void store.perform({ action: 'recording', key: entry.key, expectedRecordingVersion: entry.recording.version, enabled, retentionDays: entry.recording.retentionDays })
      .then(() => { if (mounted.current) setNotice(enabled ? '已开启 QQ 消息保存，从现在起保存收到和发出的正文。' : '已停止保存新的 QQ 正文，已有记录和 DSH 会话历史保留。'); })
      .catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '消息保存设置失败'); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  };
  return h('section', { className: 'imqc-peerSettings', 'aria-label': t('peer.settings.aria'), 'aria-busy': busy },
    entry.legacySessionAssociation ? h('p', { role: 'status', className: 'imqc-hint' }, '旧版会话关联待核验。恢复原会话后继续；若原会话不存在，可明确新建，旧关联仍保留。') : null,
    h('div', { className: 'imqc-inline' }, h('span', null, '接收此 QQ 对话'), h(Switch, { label: '接收此 QQ 对话', checked: draft.receiveEnabled, disabled: busy, onChange: receiveEnabled => patch({ receiveEnabled }) })),
    !entry.admitted && entry.policy.receiveEnabled !== false ? h('div', { className: 'imqc-banner' }, h('p', { className: 'imqc-hint' }, '此对话当前未获接收许可。接收开关仍受账号访问范围约束；加入访问名单后才能接收。'),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: admit }, '启用此对话并加入访问名单')) : null,
    h('label', { className: 'imqc-field' }, h('span', null, 'QQ 备注'), h(Input, { value: draft.alias, maxLength: 100, disabled: busy, 'aria-label': 'QQ 备注', onChange: (event: ChangeEvent<HTMLInputElement>) => patch({ alias: event.target.value }) })),
    h(QQAgentSettingsForm, { settings: draft.settings, tools, catalog, scope: 'conversation', chatScope: entry.scope, disabled: busy, onChange: value => patch({ settings: value }), onRefreshCatalog: catalog.refresh,
      askTools: Object.entries(entry.policy.tools).filter(([, decision]) => decision === 'ask').map(([id]) => id) }),
    h('div', { className: 'imqc-inline' }, h('span', null, '保存 QQ 消息'), h(Switch, { label: '保存 QQ 消息', checked: entry.recording?.enabled === true, disabled: busy || !entry.recording, onChange: saveRecording })),
    h('div', { className: 'imqc-inline' },
      h('span', { className: 'imqc-hint' }, entry.recording?.enabled ? entry.recording.retentionDays > 0 ? `QQ 收发记录按已有配置保留 ${entry.recording.retentionDays} 天，可手动清空；DSH 会话历史独立保留` : 'QQ 收发记录默认不自动清理，可手动清空；DSH 会话历史独立保留' : '未新增 QQ 收发记录，可在上方开启；已有记录按原保留设置处理，DSH 会话历史独立保留。'),
      h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: clearRecords }, '清空消息记录')),
    entry.running ? h('p', { role: 'status', className: 'imqc-hint' }, '任务运行中，可继续编辑草稿；任务结束后再保存会话设置。') : null,
    settingsConflict && dirty ? h('p', { role: 'alert', className: 'imqc-error' }, '设置已在其他位置更新。草稿保留，请放弃修改以载入最新设置。') : null,
    error ? h('p', { role: 'alert', className: 'imqc-error' }, error) : null,
    notice ? h('p', { role: 'status', className: 'imqc-hint' }, notice) : null,
    dirty ? h('div', { className: 'imqc-actions imqc-saveBar' },
      h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: discard }, '放弃修改'),
      h(Button, { variant: 'primary', size: 'sm', disabled: busy || entry.running || settingsConflict, onClick: () => save() }, busy ? '保存中…' : '保存会话设置')) : null);
}

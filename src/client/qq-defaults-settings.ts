import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import type { QQDefaults } from '../shared/agent-settings.ts';
import type { SelectorSource } from './host-selectors.ts';
import { QQAgentSettingsForm } from './qq-agent-settings-form.ts';
import { useQQAgentCatalog } from './qq-agent-catalog.ts';
import { QQSessionStore, useQQSessionStore } from './qq-session-store.ts';

interface DefaultsDraft { draft: QQDefaults; base: QQDefaults }
const drafts = new WeakMap<QQSessionStore, DefaultsDraft>();

export function QQDefaultsSettings({ store, selectorSource, t, workspaces = [], defaultWorkspaceName }: { store: QQSessionStore; selectorSource: SelectorSource; t?: import('./qq-locale.ts').QQTranslate; workspaces?: ReadonlyArray<{ workspaceId: string; title: string; path: string }>; defaultWorkspaceName?: string }): ReactNode {
  const state = useQQSessionStore(store);
  const defaults = state.directory?.defaults;
  if (!defaults) return h('section', { className: 'imqc', 'aria-label': '新对话默认设置' }, h('h3', null, '新对话默认设置'),
    h('p', { role: state.error ? 'alert' : 'status', className: state.error ? 'imqc-error' : 'imqc-hint' }, state.error ?? '正在读取新对话默认设置…'),
    h(Button, { variant: 'ghost', size: 'sm', disabled: state.loading, onClick: store.refresh }, '刷新默认设置'));
  return h(DefaultsSettingsDraft, { store, selectorSource, defaults, t, workspaces, defaultWorkspaceName, tools: state.directory?.tools ?? [] });
}

function DefaultsSettingsDraft({ store, selectorSource, defaults, t, tools, workspaces = [], defaultWorkspaceName }: {
  store: QQSessionStore; selectorSource: SelectorSource; defaults: QQDefaults; t?: import('./qq-locale.ts').QQTranslate; tools: Parameters<typeof QQAgentSettingsForm>[0]['tools']; workspaces?: ReadonlyArray<{ workspaceId: string; title: string; path: string }>; defaultWorkspaceName?: string;
}): ReactNode {
  const [retained, setRetained] = useState<DefaultsDraft>(() => drafts.get(store) ?? { draft: structuredClone(defaults), base: structuredClone(defaults) });
  const { draft, base } = retained;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);
  const catalog = useQQAgentCatalog(selectorSource);
  const dirty = JSON.stringify(draft.settings) !== JSON.stringify(base.settings);
  const conflict = base.version !== defaults.version;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (dirty) drafts.set(store, retained); else drafts.delete(store); }, [store, retained, dirty]);
  useEffect(() => { if (!dirty && conflict) setRetained({ draft: structuredClone(defaults), base: structuredClone(defaults) }); }, [dirty, conflict, defaults]);
  const discard = (): void => { setRetained({ draft: structuredClone(defaults), base: structuredClone(defaults) }); drafts.delete(store); setError(''); setNotice(''); };
  const save = (): void => {
    if (pending.current || !dirty || conflict) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    void store.perform({ action: 'defaults', expectedVersion: base.version, settings: draft.settings }).then(result => {
      const saved = result.snapshot?.defaults;
      if (!saved) throw new Error('保存结果未确认，草稿已保留。请刷新默认设置核对。');
      drafts.delete(store);
      if (mounted.current) { setRetained({ draft: structuredClone(saved), base: structuredClone(saved) }); setNotice('新对话默认设置已保存，已接入的对话保持各自设置。'); }
    }).catch((cause: unknown) => { if (mounted.current) setError(cause instanceof Error ? cause.message : '默认设置保存失败，草稿已保留。'); })
      .finally(() => { pending.current = false; if (mounted.current) setBusy(false); });
  };
  const ttl = t ? t('defaults.title') : '新对话默认值';
  return h('section', { className: 'imqc imqc-defaultsSettings', 'aria-label': ttl, 'aria-busy': busy },
    h('h3', { className: 'imqb-cardTitle' }, ttl),
    h('p', { className: 'imqb-cardHint' }, t ? t('defaults.hint') : '之后首次接入的群聊和私聊复制这些设置。保存立即生效，不改动已接入的对话，也不会重载插件。'),
    h(QQAgentSettingsForm, { settings: draft.settings, tools, catalog, scope: 'defaults', onPickDirectory: selectorSource.pickDirectory, onCreateWorkspace: selectorSource.createWorkspace, workspaces, defaultWorkspaceName, defaultCwd: store.getSnapshot().directory?.defaultCwd, disabled: busy, onRefreshCatalog: catalog.refresh, onChange: settings => { setRetained(value => ({ ...value, draft: { ...value.draft, settings } })); setError(''); setNotice(''); } }),
    conflict && dirty ? h('p', { role: 'alert', className: 'imqc-error' }, '默认设置已在其他位置更新。草稿保留，请放弃修改以载入最新设置。') : null,
    error ? h('p', { role: 'alert', className: 'imqc-error' }, error) : null,
    notice ? h('p', { role: 'status', className: 'imqc-hint' }, notice) : null,
    h('div', { className: 'imqc-actions' }, h(Button, { variant: 'ghost', size: 'sm', disabled: busy || !dirty, onClick: discard }, '放弃默认设置修改'),
      h(Button, { variant: 'primary', size: 'sm', disabled: busy || !dirty || conflict, onClick: save }, busy ? '保存中…' : (t ? t('defaults.save') : '保存默认设置（即时生效）'))));
}

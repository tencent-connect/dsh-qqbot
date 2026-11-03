import { createElement as h, Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { SlotComponent, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots';
import type { PermissionCatalog } from '@deepseek-ai/dsh-permission-presets/client';
import type { PermissionSelectInjected, PermissionSelectProps } from '@deepseek-ai/dsh-client-ui-permission-presets/client';
import { QQSessionStore, useQQSessionStore } from './qq-session-store.ts';
import { QQPermissionMenu } from './qq-permission-menu.ts';

const SLOT = 'conversation.input.permission';
const PRIORITY = -30;
export const QQ_CUSTOM_TOOLS_PERMISSION = 'qqbot-custom-tools';

type NativeEntry = StoredEntry & {
  locale: 'permission.access';
  component: SlotComponent<PermissionSelectProps>;
  inject: (sessionId: PermissionSelectProps['sessionId']) => PermissionSelectInjected;
};

/** The captured entry must match the public permission UI's component/inject protocol. */
function isNativeEntry(entry: StoredEntry): entry is NativeEntry {
  return entry.locale === 'permission.access' && entry.store === undefined && entry.children === undefined
    && typeof entry.component === 'function' && typeof entry.inject === 'function';
}

function isCatalog(value: unknown): value is PermissionCatalog {
  if (!value || typeof value !== 'object' || !('options' in value) || !Array.isArray(value.options)
    || !('defaultOptions' in value) || !Array.isArray(value.defaultOptions) || !('defaultPreset' in value) || typeof value.defaultPreset !== 'string') return false;
  const option = (item: unknown): boolean => !!item && typeof item === 'object'
    && 'value' in item && typeof item.value === 'string' && 'name' in item && typeof item.name === 'string';
  return value.options.every(option) && value.defaultOptions.every(option)
    && !value.options.some(item => item.value === QQ_CUSTOM_TOOLS_PERMISSION);
}

export function createQQPermissionControl(store: QQSessionStore, Native: SlotComponent<PermissionSelectProps>): SlotComponent<PermissionSelectProps> {
  function QQPermissionControl(props: PermissionSelectProps): ReactNode {
    if (typeof props.usePermissionCatalog !== 'function' || typeof props.useProjection !== 'function' || typeof props.select !== 'function') return h(Native, props);
    return h(QQPermissionAdapter, props);
  }

  function QQPermissionAdapter(props: PermissionSelectProps): ReactNode {
    useQQSessionStore(store);
    const selection = props.useProjection('permissions');
    const catalog = props.usePermissionCatalog(state => state);
    const entry = store.entry(props.sessionId);
    const current = !!entry?.settings && entry.currentSessionId === props.sessionId;
    const compatible = !!catalog?.value && isCatalog(catalog.value);
    const custom = current && compatible && entry.settings?.execution.kind === 'custom';
    const previous = useRef({ sessionId: props.sessionId, permission: selection?.currentValue });
    const activeSession = useRef<PermissionSelectProps['sessionId'] | null>(props.sessionId);
    const [error, setError] = useState('');
    useEffect(() => {
      activeSession.current = props.sessionId;
      setError('');
      return () => { activeSession.current = null; };
    }, [props.sessionId]);
    useEffect(() => {
      const changed = previous.current.sessionId === props.sessionId && previous.current.permission !== selection?.currentValue;
      previous.current = { sessionId: props.sessionId, permission: selection?.currentValue };
      if (current && changed && selection !== undefined) store.refresh();
    }, [props.sessionId, current, selection?.currentValue]);
    const select = useCallback(async (id: string): Promise<boolean> => {
      setError('');
      const sessionId = props.sessionId;
      try {
        const latest = store.entry(sessionId);
        if (!latest?.settings || latest.currentSessionId !== sessionId || selection === undefined) throw new Error('当前 QQ 会话已变化，请重新选择。');
        if (id !== QQ_CUSTOM_TOOLS_PERMISSION && !catalog?.value?.options.some(option => option.value === id)) throw new Error('权限目录已变化，请重新选择。');
        const patch = id === QQ_CUSTOM_TOOLS_PERMISSION
          ? { toolScope: { kind: 'custom' as const, tools: [] } }
          : { nativePermission: id, expectedPermission: selection.currentValue, toolScope: { kind: 'native' as const } };
        const result = await store.perform({ action: 'peer-settings', key: latest.key, expectedVersion: latest.policy.version, patch });
        const saved = result.snapshot?.conversations.find(value => value.key === latest.key);
        if (!saved?.settings || saved.currentSessionId !== sessionId) throw new Error('保存结果未确认，请刷新 QQ 设置后核对。');
        if (id === QQ_CUSTOM_TOOLS_PERMISSION && activeSession.current === sessionId) store.openDrawer(saved, 'settings', sessionId);
        return true;
      } catch (cause) {
        if (activeSession.current === sessionId) setError(cause instanceof Error ? cause.message : 'QQ 权限设置失败，请重试。');
        throw cause;
      }
    }, [props.sessionId, selection?.currentValue, catalog]);
    if (!current || !compatible || !catalog.value || selection === undefined) return h(Native, props);
    return h(Fragment, null, h(QQPermissionMenu, { key: props.sessionId, catalog: catalog.value, currentValue: custom ? QQ_CUSTOM_TOOLS_PERMISSION : selection.currentValue, customValue: QQ_CUSTOM_TOOLS_PERMISSION, locked: props.locked, select, t: props.t }),
      error ? h('span', { role: 'alert', className: 'imqc-error' }, error) : null);
  }
  return QQPermissionControl;
}

/** Own only a wrapper around the live native entry; competing slot occupants keep their rank. */
export function installQQToolScopeControl({ slots, store }: { slots: Pick<Context['slots'], 'entries' | 'subscribe' | 'register'>; store: QQSessionStore }): () => void {
  let source: NativeEntry | undefined;
  let wrapper: SlotComponent<PermissionSelectProps> | undefined;
  let release: (() => void) | undefined;
  let stopped = false;
  let reconciling = false;
  let pending = false;
  const clear = (): void => {
    const dispose = release;
    release = undefined;
    source = undefined;
    dispose?.();
    wrapper = undefined;
  };
  const sync = (): void => {
    if (stopped) return;
    if (reconciling) { pending = true; return; }
    reconciling = true;
    try {
      do {
        pending = false;
        const entries = slots.entries(SLOT).filter(entry => entry.component !== wrapper);
        const candidates = entries.filter(isNativeEntry);
        const candidate = candidates.length === 1 && entries[0] === candidates[0] && (candidates[0].options.priority ?? 0) > PRIORITY ? candidates[0] : undefined;
        if (candidate === source) continue;
        clear();
        if (!candidate) continue;
        source = candidate;
        wrapper = createQQPermissionControl(store, candidate.component);
        const inject: (sessionId: PermissionSelectProps['sessionId']) => PermissionSelectInjected = candidate.inject;
        release = slots.register({ name: SLOT, priority: PRIORITY, locale: candidate.locale, inject }, wrapper);
      } while (pending && !stopped);
    } finally { reconciling = false; }
  };
  const unsubscribe = slots.subscribe(SLOT, sync);
  sync();
  return () => { stopped = true; unsubscribe(); clear(); };
}

/**
 * QQ 机器人配置面板 — 必要配置的 UI 编辑
 *
 * 使用宿主公共 Switch、SegmentedControl、Button 与目录菜单；多行草稿保留普通 textarea。
 *
 * 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
 * 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
 * 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
 *
 * 这里只维护账号访问范围；Agent 默认设置通过独立的版本化接口保存。
 */
import { createElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { BIND_CONFIG_PATH } from '../shared/bind-protocol.ts';

import { fetchJson } from './http.ts';
import { configDraft, configPatch, DEFAULT_ACCESS, isConfigDirty, normalizeConfig, parseConfigDraft, rebaseConfig, type AccessControlWire, type ConfigDraft, type ConfigWire } from './config-form-state.ts';
import type { SelectorSource } from './host-selectors.ts';
import { SlashCommandList } from './slash-command-list.ts';
import { CONVERSATIONS_PATH, type SlashCommandDescriptor } from '../shared/conversation-protocol.ts';
import { PairClaimPanel } from './qq-pairing.ts';
import type { QQBotKey } from './qq-locale.ts';
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots';

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-qqbot-config-panel-styles';

/** QQ settings layout; control appearance belongs to the public host primitives. */
function useConfigPanelStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(STYLE_ID);
    const retain = (element: HTMLElement): (() => void) => {
      element.dataset.users = String(Number(element.dataset.users ?? 0) + 1);
      return () => {
        const users = Number(element.dataset.users ?? 1) - 1;
        if (users === 0) element.remove();
        else element.dataset.users = String(users);
      };
    };
    if (existing !== null) return retain(existing);
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); }
.imqb2-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-textarea { box-sizing: border-box; width: 100%; min-height: 68px; padding: 8px 12px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.imqb2-textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
/* Preserve the QQ settings draft and readback feedback in the sticky footer. */
.imqb2-footer {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center;
  flex-wrap: wrap; gap: 8px; margin-top: 16px; padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.imqb2-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.imqb2-feedback { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb2-feedback p { flex: 1; min-width: 0; }
.imqb2-form .imqc-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.imqb2-form .imqc-pair { margin: 4px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.imqb2-form .imqc-pairMembers { list-style: none; padding: 0; margin: 8px 0 0; }
.imqb2-form .imqc-pairMember { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb2-form .imqc-pairMemberMain { flex: 1 1 180px; min-width: 0; }
.imqb2-form .imqc-pairMemberName { display: block; font-weight: 500; }
.imqb2-form .imqc-pairMemberMeta, .imqb2-form .imqc-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb2-form .imqc-pairMemberOpenId { color: var(--dsw-alias-label-secondary); }
.imqb2-form .imqc-error { color: var(--dsw-alias-state-error-primary); }
.imqb2-form .imqc-cmdList { margin: 12px 0; }
.imqb2-form .imqc-cmdRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.imqb2-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb2-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb2-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.imqb2-directory-feedback { display: flex; align-items: flex-start; gap: 8px; }
.imqb2-directory-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .imqb2-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb2-selector-head { align-items: stretch; flex-direction: column; }
  .imqb2-note { flex-basis: 100%; }
}
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
    document.head.appendChild(style);
    return retain(style);
  }, []);
}

/** 访问模式分段选择行 */
function SegmentedRow({ label, help, value, options, onChange, disabled = false }: {
  label: string; help?: string; value: AccessMode;
  options: ReadonlyArray<{ value: AccessMode; label: string }>; onChange: (next: AccessMode) => void; disabled?: boolean;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(SegmentedControl<AccessMode>, { id: `imqq-access-${label}`, value, options, onChange, label, disabled }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

type AccessMode = AccessControlWire['c2cMode'];

const MODE_OPTIONS: ReadonlyArray<{ value: AccessMode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'disabled', label: '关闭' },
];

const DRAFT_STORAGE_KEY = 'im-qqbot/config-draft/v1';

function storedDraft(): ConfigDraft | undefined {
  try {
    const text = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    return text === null ? undefined : parseConfigDraft(JSON.parse(text));
  } catch (_error) {
    // Storage may be unavailable or contain an interrupted older draft.
    return undefined;
  }
}

/** Keep an edited form through a client reload without storing credential fields. */
function storeDraft(draft: ConfigDraft): void {
  try {
    if (isConfigDirty(draft.baseline, draft.form)) {
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(configDraft(draft.baseline, draft.form)));
    } else {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    }
  } catch (_error) {
    // In-memory draft protection still works when tab storage is disabled.
  }
}

interface PendingConfirmation {
  appId: ConfigWire['appId'];
  changed: Partial<ConfigWire>;
}

type SaveResult = { kind: 'confirmed' | 'unconfirmed' | 'failed'; message: string };

function matchesSavedConfig(config: ConfigWire, expected: PendingConfirmation): boolean {
  return config.appId === expected.appId && !isConfigDirty(config, { ...config, ...expected.changed });
}

function waitForReadback(signal: AbortSignal, delay: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delay);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** HMR can briefly serve the old plugin fiber after its profile patch was written. */
async function confirmSavedConfig(expected: PendingConfirmation, signal: AbortSignal): Promise<ConfigWire | undefined> {
  const deadline = Date.now() + 5000;
  for (let attempt = 0; attempt < 6 && !signal.aborted; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const { config } = await fetchJson<{ config: ConfigWire }>(BIND_CONFIG_PATH,
        { cache: 'no-store', signal }, Math.min(1000, remaining));
      if (matchesSavedConfig(config, expected)) return config;
    } catch (_error) {
      // The route may disappear while the saved plugin is reloading.
    }
    if (!signal.aborted) await waitForReadback(signal, Math.min(400, Math.max(0, deadline - Date.now())));
  }
  return undefined;
}

export interface ConfigPanelProps { bindPhase?: string; selectorSource?: SelectorSource; t?: Translate<QQBotKey> }

/** Settings editor with recoverable requests and a draft protected from binding refreshes. */
export function ConfigPanel({ bindPhase }: ConfigPanelProps): ReactNode {
  useConfigPanelStyles();
  const [commands, setCommands] = useState<SlashCommandDescriptor[]>([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (bindPhase !== 'bound') return;
    void fetchJson<{ commands: SlashCommandDescriptor[] }>(CONVERSATIONS_PATH, { signal: controller.signal })
      .then(result => { setCommands(result.commands); setCommandsError(null); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setCommandsError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [bindPhase]);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const draftRef = useRef<ConfigDraft | null>(null);
  const mounted = useRef(true);
  const saveController = useRef<AbortController | null>(null);
  const pendingConfirmation = useRef<PendingConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  const replaceDraft = useCallback((next: ConfigDraft): void => {
    draftRef.current = next;
    storeDraft(next);
    setDraft(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; saveController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    setLoading(true);
    setLoadError(null);
    void fetchJson<{ config: ConfigWire }>(BIND_CONFIG_PATH, { cache: 'no-store', signal: controller.signal })
      .then(({ config }) => {
        if (stopped || saveController.current !== null) return;
        const expected = pendingConfirmation.current;
        if (expected !== null && config.appId === expected.appId && !matchesSavedConfig(config, expected)) {
          setResult({ kind: 'unconfirmed', message: '配置已保存，刷新配置核对生效结果。' });
          return;
        }
        pendingConfirmation.current = null;
        const current = draftRef.current ?? storedDraft();
        const sameAccount = current?.baseline.appId === config.appId;
        const hadDraft = current !== undefined && current !== null && sameAccount && isConfigDirty(current.baseline, current.form);
        const form = hadDraft ? rebaseConfig(current.baseline, current.form, config) : config;
        replaceDraft({ baseline: config, form });
        setDraftNotice(hadDraft && isConfigDirty(config, form) ? '已保留未保存的修改，其余配置已更新。' : null);
        setLoadError(null);
        if (expected !== null) setResult(matchesSavedConfig(config, expected) && !isConfigDirty(config, form)
          ? { kind: 'confirmed', message: '配置已保存并生效。' } : null);
      })
      .catch((error: unknown) => {
        if (!stopped) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; controller.abort(); };
  }, [bindPhase, reload, replaceDraft]);

  const patch = useCallback(<K extends keyof ConfigWire>(key: K, value: ConfigWire[K]): void => {
    const current = draftRef.current;
    if (current === null) return;
    replaceDraft({ ...current, form: { ...current.form, [key]: value } });
    setResult(null);
  }, [replaceDraft]);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    const current = draftRef.current;
    if (busy || current === null) return;
    const submitted = normalizeConfig(current.form);
    const changed = configPatch(current.baseline, submitted);
    if (Object.keys(changed).length === 0) {
      replaceDraft({ baseline: current.baseline, form: submitted });
      return;
    }
    replaceDraft({ baseline: current.baseline, form: submitted });
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setResult(null);
    void fetchJson<{ ok: boolean; message?: string; error?: string }>(BIND_CONFIG_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changed), signal: controller.signal,
    })
      .then(async (body) => {
        if (!body.ok) throw new Error(body.error ?? '保存失败，请重试。');
        // The write is confirmed. A read from the old fiber during HMR must not undo it.
        if (!mounted.current || controller.signal.aborted) return;
        const expected = { appId: submitted.appId, changed };
        pendingConfirmation.current = expected;
        replaceDraft({ baseline: submitted, form: submitted });
        setDraftNotice(null);
        const config = await confirmSavedConfig(expected, controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        if (config !== undefined) {
          pendingConfirmation.current = null;
          replaceDraft({ baseline: config, form: config });
          setResult({ kind: 'confirmed', message: '配置已保存并生效。' });
        } else {
          setResult({ kind: 'unconfirmed', message: '配置已保存，刷新配置核对生效结果。' });
        }
      })
      .catch((error: unknown) => {
        if (mounted.current && !controller.signal.aborted) setResult({ kind: 'failed', message: `保存结果未确认：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或刷新配置核对。` });
      })
      .finally(() => {
        if (saveController.current === controller) {
          saveController.current = null;
          if (mounted.current) setBusy(false);
        }
      });
  }, [busy, replaceDraft]);

  const retry = (): void => { setReload((value) => value + 1); };
  const loadFeedback = loadError === null ? null : createElement('div', { className: 'imqb2-feedback', role: 'alert' },
    createElement('p', { className: 'imqb2-note imqb2-note--error' }, `配置加载失败：${loadError}`),
    createElement(Button, { variant: 'ghost', size: 'sm', onClick: retry, disabled: loading || busy }, loading ? '重试中…' : '重试'),
  );
  if (draft === null) {
    return createElement('div', { 'aria-busy': loading }, loadFeedback,
      loading ? createElement('p', { className: 'imqb2-hint', role: 'status', style: { padding: '12px 0' } }, '正在加载配置…') : null,
    );
  }

  const { baseline, form } = draft;
  const dirty = isConfigDirty(baseline, form);
  const access = form.access ?? DEFAULT_ACCESS;
  const message = busy ? '正在保存配置…' : result?.message ?? (dirty
    ? draftNotice ?? '有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。'
    : '没有未保存的修改。');

  return createElement('form', { className: 'imqb2-form', onSubmit: submit, 'aria-busy': busy },
    loadFeedback,
    createElement('fieldset', { className: 'imqb2-fields', disabled: busy },
      createElement('div', { className: 'imqb2-group-title' }, '服务范围'),
      createElement(SegmentedRow, { disabled: busy,
        label: '私聊', value: access.c2cMode, options: MODE_OPTIONS,
        onChange: (value) => { patch('access', { ...access, c2cMode: value }); },
      }),
      access.c2cMode === 'allowlist' ? createElement(PairClaimPanel, { purpose: 'allow-c2c', title: '私聊白名单', enabled: bindPhase === 'bound', onChange: retry, hint: '生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。' }) : null,
      createElement(SegmentedRow, { disabled: busy,
        label: '群聊', value: access.groupMode, options: MODE_OPTIONS,
        onChange: (value) => { patch('access', { ...access, groupMode: value }); },
      }),
      access.groupMode === 'allowlist' ? createElement(PairClaimPanel, { purpose: 'allow-group', title: '群白名单', enabled: bindPhase === 'bound', onChange: retry, hint: '生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。' }) : null,
      createElement(SegmentedRow, { disabled: busy,
        label: '斜杠命令', value: access.commandMode ?? 'allowlist', options: MODE_OPTIONS,
        help: '仅在获准接入的对话中生效。所有人模式允许成员切换模型、开始新会话等，影响该群的共享会话。审批和提问按钮按各自权限处理。',
        onChange: value => { patch('access', { ...access, commandMode: value }); },
      }),
      (access.commandMode ?? 'allowlist') === 'allowlist' ? createElement(PairClaimPanel, {
        purpose: 'owner', title: '命令白名单', enabled: bindPhase === 'bound', onChange: retry,
        hint: '名单按发送者 OpenID 校验，适用于获准接入的群聊和私聊。保存模式与管理名单分别生效。',
      }) : null,
      commandsError ? createElement('p', { className: 'imqc-error', role: 'alert' }, `命令清单加载失败：${commandsError}`) : null,
      createElement(SlashCommandList, { commands }),



    ),
    createElement('div', { className: 'imqb2-footer' },
      createElement('p', { className: `imqb2-note${result === null ? '' : result.kind === 'failed' ? ' imqb2-note--error' : ' imqb2-note--ok'}`, role: result?.kind === 'failed' ? 'alert' : 'status', 'aria-live': 'polite' }, message),
      createElement('div', { className: 'imqb2-footer-actions' },
        pendingConfirmation.current !== null || result?.kind === 'failed' ? createElement(Button, {
          variant: 'ghost', size: 'sm', disabled: busy || loading, onClick: retry,
        }, loading ? '刷新中…' : '刷新配置') : null,
        createElement(Button, { variant: 'ghost', size: 'sm', disabled: busy || !dirty, onClick: () => { replaceDraft({ baseline, form: baseline }); setResult(null); setDraftNotice(null); } }, '撤销修改'),
        createElement(Button, { variant: 'primary', size: 'sm', type: 'submit', disabled: busy || !dirty }, busy ? '保存中…' : '保存'),
      ),
    ),
  );
}

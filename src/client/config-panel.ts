import { t } from './qq-locale.ts';
import { createElement, Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, Switch, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT, BIND_METHODS, BIND_RPC_ENDPOINT, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import { RpcError, rpcCall } from './rpc.ts';
import { WORKBENCH_ROBOTS_PATH, type WorkbenchRobot, type WorkbenchRobotsResponse } from '../shared/workbench-protocol.ts';

import { fetchJson, HttpError } from './http.ts';
import { configDraft, configPatch, DEFAULT_ACCESS, isConfigDirty, normalizeConfig, parseConfigDraft, rebaseConfig, type AccessControlWire, type ConfigDraft, type ConfigWire } from './config-form-state.ts';
import { SlashCommandList } from './slash-command-list.ts';
import type { SlashCommandDescriptor } from '../shared/command-protocol.ts';
import { PairClaimPanel } from './qq-pairing.ts';

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
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
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
.imqb2-form .imqc-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb2-form .imqc-error { color: var(--dsw-alias-state-error-primary); }
.imqb2-form .imqc-cmdList { margin: 12px 0; }
.imqb2-form .imqc-cmdContent { padding: 4px 0 4px 22px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-form .imqc-cmdGroup + .imqc-cmdGroup { margin-top: 16px; }
.imqb2-form .imqc-cmdGroup > strong { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.imqb2-form .imqc-cmdRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; overflow-wrap: anywhere; }
.imqb2-form .imqc-cmdRow code { padding: 1px 6px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; }
.imqb2-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb2-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb2-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
@media (max-width: 480px) {
  .imqb2-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb2-note { flex-basis: 100%; }
}
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
    `;
    document.head.appendChild(style);
    return retain(style);
  }, []);
}

/** 访问模式分段选择行 */
function SegmentedRow<T extends string>({ label, help, value, options, onChange, disabled = false }: {
  label: string; help?: string; value: T;
  options: ReadonlyArray<{ value: T; label: string }>; onChange: (next: T) => void; disabled?: boolean;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(SegmentedControl<T>, { id: `imqq-access-${label}`, value, options, onChange, label, disabled }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

type AccessMode = AccessControlWire['c2cMode'];

const modeOptions = (): ReadonlyArray<{ value: AccessMode; label: string }> => [
  { value: 'open', label: t("所有人") },
  { value: 'allowlist', label: t("白名单") },
  { value: 'disabled', label: t("关闭") },
];

type AccessModeKey = 'c2cMode' | 'groupMode' | 'commandMode';

export function AccessSettings({
  access, busy, bound = true, enabled = true, appId, onMode, onMembershipChange,
}: {
  access: Pick<AccessControlWire, AccessModeKey>; busy: boolean; bound?: boolean; enabled?: boolean; appId?: string;
  onMode: (key: AccessModeKey, value: AccessMode) => void; onMembershipChange: () => void;
}): ReactNode {
  useConfigPanelStyles();
  const [commands, setCommands] = useState<SlashCommandDescriptor[]>([]);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    if (!bound || !enabled) return;
    void rpcCall<{ commands: SlashCommandDescriptor[] }>(
      ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.commands, { appId }, undefined, controller.signal,
    )
      .then(result => { if (!controller.signal.aborted) { setCommands(result.commands); setCommandsError(null); } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setCommandsError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [appId, bound, enabled, access.commandMode]);
  return createElement('div', { className: 'imqb2-form' },
    createElement('div', { className: 'imqb2-group-title' }, t("服务范围")),
    createElement(SegmentedRow<AccessMode>, {
      disabled: busy, label: t("私聊"), value: access.c2cMode, options: modeOptions(),
      onChange: value => onMode('c2cMode', value),
    }),
    access.c2cMode === 'allowlist' ? createElement(PairClaimPanel, {
      purpose: 'allow-c2c', title: t("私聊白名单"), enabled: bound, canPair: enabled, appId, onChange: onMembershipChange,
      hint: t("生成配对码，让对方在私聊里直接给机器人发送这个码，即加入私聊白名单。"),
    }) : null,
    createElement(SegmentedRow<AccessMode>, {
      disabled: busy, label: t("群聊"), value: access.groupMode, options: modeOptions(),
      onChange: value => onMode('groupMode', value),
    }),
    access.groupMode === 'allowlist' ? createElement(PairClaimPanel, {
      purpose: 'allow-group', title: t("群白名单"), enabled: bound, canPair: enabled, appId, onChange: onMembershipChange,
      hint: t("生成配对码，让群成员在群里 @ 机器人后直接发送这个码，即把该群加入白名单。"),
    }) : null,
    createElement(SegmentedRow<AccessMode>, {
      disabled: busy, label: t("斜杠命令"), value: access.commandMode ?? 'open', options: modeOptions(),
      help: t("仅在获准接入的对话中生效。所有人模式允许成员切换模型、开始新会话等，影响该群的共享会话。审批和提问按钮按各自权限处理。"),
      onChange: value => onMode('commandMode', value),
    }),
    access.commandMode === 'allowlist' ? createElement(PairClaimPanel, {
      purpose: 'owner', title: t("命令白名单"), enabled: bound, canPair: enabled, appId, onChange: onMembershipChange,
      hint: t("名单按发送者 OpenID 校验，适用于获准接入的群聊和私聊。保存模式与管理名单分别生效。"),
    }) : null,
    commandsError && bound && enabled ? createElement('p', { className: 'imqc-error', role: 'alert' }, t("命令清单加载失败：{0}", commandsError)) : null,
    commands.length ? createElement(SlashCommandList, { commands }) : null,
  );
}

const DRAFT_STORAGE_KEY = 'im-qqbot/config-draft/v1';

function storedDraft(key: string): ConfigDraft | undefined {
  try {
    const text = sessionStorage.getItem(key);
    return text === null ? undefined : parseConfigDraft(JSON.parse(text));
  } catch (_error) {
    // Storage may be unavailable or contain an interrupted older draft.
    return undefined;
  }
}

/** Keep an edited form through a client reload without storing credential fields. */
function storeDraft(key: string, draft: ConfigDraft): void {
  try {
    if (isConfigDirty(draft.baseline, draft.form)) {
      sessionStorage.setItem(key, JSON.stringify(configDraft(draft.baseline, draft.form)));
    } else {
      sessionStorage.removeItem(key);
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
      const { config } = await rpcCall<{ config: ConfigWire }>(
        BIND_RPC_ENDPOINT, BIND_METHODS.configGet, {}, Math.min(1000, remaining), signal,
      );
      if (matchesSavedConfig(config, expected)) return config;
    } catch (_error) {
      // The route may disappear while the saved plugin is reloading.
    }
    if (!signal.aborted) await waitForReadback(signal, Math.min(400, Math.max(0, deadline - Date.now())));
  }
  return undefined;
}

interface PrimaryAccountSettingsProps {
  appId: string;
  revision: number;
  enabled: boolean;
  formId: string;
  defaultName: string;
  controls: ReactNode;
  credentials: ReactNode;
  onAliasSaved(robot: WorkbenchRobot): void;
}

export function PrimaryAccountSettings({
  appId, revision, enabled, formId, defaultName, controls, credentials, onAliasSaved,
}: PrimaryAccountSettingsProps): ReactNode {
  useConfigPanelStyles();
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
  const storageKey = `${DRAFT_STORAGE_KEY}:${appId}`;

  const replaceDraft = useCallback((next: ConfigDraft): void => {
    draftRef.current = next;
    storeDraft(storageKey, next);
    setDraft(next);
  }, [storageKey]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; saveController.current?.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    setLoading(true);
    setLoadError(null);
    void rpcCall<{ config: ConfigWire }>(BIND_RPC_ENDPOINT, BIND_METHODS.configGet, {}, undefined, controller.signal)
      .then(async ({ config }) => {
        const { robots } = await fetchJson<WorkbenchRobotsResponse>(WORKBENCH_ROBOTS_PATH, { cache: 'no-store', signal: controller.signal });
        const robot = robots.find(robot => robot.appId === appId && robot.primary);
        if (!robot || config.appId !== appId) throw new Error(t("主机器人绑定已更新，请重新打开设置。"));
        config = { ...config, alias: robot.alias, robotRevision: robot.revision };
        if (stopped || saveController.current !== null) return;
        const expected = pendingConfirmation.current;
        const confirmed = expected !== null && matchesSavedConfig(config, expected);
        if (confirmed || expected?.appId !== config.appId) pendingConfirmation.current = null;
        const current = draftRef.current ?? storedDraft(storageKey);
        const sameAccount = current?.baseline.appId === config.appId;
        const hadDraft = current !== undefined && current !== null && sameAccount && isConfigDirty(current.baseline, current.form);
        const form = hadDraft ? rebaseConfig(current.baseline, current.form, config) : config;
        const dirty = isConfigDirty(config, form);
        replaceDraft({ baseline: config, form });
        setDraftNotice(hadDraft && dirty ? t("已保留未保存的修改，其余配置已更新。") : null);
        setLoadError(null);
        if (dirty) setResult(null);
        else if (confirmed) setResult({ kind: 'confirmed', message: t("配置已保存，插件重载完成后生效。") });
        else if (pendingConfirmation.current !== null) {
          setResult({ kind: 'unconfirmed', message: t("已读取当前配置，内容与上次保存的值不同。") });
        } else setResult(null);
      })
      .catch((error: unknown) => {
        if (!stopped) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; controller.abort(); };
  }, [appId, reload, replaceDraft, revision]);

  const patch = useCallback(<K extends keyof ConfigWire>(key: K, value: ConfigWire[K]): void => {
    const current = draftRef.current;
    if (current === null) return;
    replaceDraft({ ...current, form: { ...current.form, [key]: value } });
    setResult(null);
  }, [replaceDraft]);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    const current = draftRef.current;
    if (saveController.current !== null || busy || current === null) return;
    let submitted = normalizeConfig(current.form);
    const { alias, ...changed } = configPatch(current.baseline, submitted);
    const configChanged = Object.keys(changed).length > 0;
    if (alias === undefined && !configChanged) {
      replaceDraft({ baseline: current.baseline, form: submitted });
      return;
    }
    replaceDraft({ baseline: current.baseline, form: submitted });
    const controller = new AbortController();
    saveController.current = controller;
    setBusy(true);
    setResult(null);
    let aliasSaved = false;
    void (async () => {
      if (alias !== undefined) {
        const { robot } = await fetchJson<{ robot: WorkbenchRobot }>(WORKBENCH_ROBOTS_PATH, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ appId, revision: current.baseline.robotRevision, alias }),
        });
        if (!mounted.current || controller.signal.aborted) return;
        aliasSaved = true;
        const identity = { alias: robot.alias, robotRevision: robot.revision };
        submitted = { ...submitted, ...identity };
        replaceDraft({ baseline: { ...current.baseline, ...identity }, form: submitted });
        onAliasSaved(robot);
      }
      if (!configChanged) {
        setResult({ kind: 'confirmed', message: t("配置已保存。") });
        return;
      }
      const body = await rpcCall<{ ok: boolean; error?: string }>(BIND_RPC_ENDPOINT, BIND_METHODS.configSet, {
        ...changed,
        expectedAppId: appId,
        ...(changed.access === undefined ? {} : { accessRevision: current.baseline.accessRevision }),
      }, undefined, controller.signal);
      if (!body.ok) throw new Error(body.error ?? t("保存失败，请重试。"));
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
        const baseline = { ...config, alias: submitted.alias, robotRevision: submitted.robotRevision };
        replaceDraft({ baseline, form: baseline });
        setResult({ kind: 'confirmed', message: t("配置已保存，插件重载完成后生效。") });
      } else {
        setResult({ kind: 'unconfirmed', message: t("配置已保存，刷新配置核对生效结果。") });
      }
    })()
      .catch((error: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        const conflict = (error instanceof HttpError && error.status === 409)
          || (error instanceof RpcError && (error.code === RPC_ERROR_CODES.configConflict || error.code === RPC_ERROR_CODES.accountChanged));
        const detail = conflict
          ? t("{0}草稿已保留，请先刷新配置。", error.message)
          : t("保存结果未确认：{0}。草稿已保留，可重试或刷新配置核对。", error instanceof Error ? error.message : String(error));
        setResult({ kind: 'failed', message: aliasSaved ? t("机器人名称已保存。{0}", detail) : detail });
      })
      .finally(() => {
        if (saveController.current === controller) {
          saveController.current = null;
          if (mounted.current) setBusy(false);
        }
      });
  }, [onAliasSaved, appId, busy, replaceDraft]);

  const retry = (): void => { setReload((value) => value + 1); };
  const loadFeedback = loadError === null ? null : createElement('div', { className: 'imqb2-feedback', role: 'alert' },
    createElement('p', { className: 'imqb2-note imqb2-note--error' }, t("配置加载失败：{0}", loadError)),
    createElement(Button, { variant: 'ghost', size: 'sm', onClick: retry, disabled: loading || busy }, loading ? t("重试中…") : t("重试")),
  );
  const accountFields = createElement(Fragment, null,
    credentials,
    createElement('div', { className: 'imqr-account-controls', role: 'group', 'aria-label': t("账号信息") },
      draft && createElement('label', { className: 'imqr-account-name' }, t("机器人名称"), createElement(Input, {
        form: formId, value: draft.form.alias ?? '', disabled: busy || loading,
        placeholder: defaultName, autoComplete: 'off', maxLength: 120,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch('alias', event.target.value),
      })),
      controls),
  );
  if (draft === null) {
    return createElement('div', { 'aria-busy': loading }, accountFields, loadFeedback,
      loading ? createElement('p', { className: 'imqb2-hint', role: 'status', style: { padding: '12px 0' } }, t("正在加载配置…")) : null,
    );
  }

  const { baseline, form } = draft;
  const dirty = isConfigDirty(baseline, form);
  const access = form.access ?? DEFAULT_ACCESS;
  const message = busy ? t("正在保存配置…") : result?.message ?? (dirty
    ? draftNotice ?? t("有未保存修改。保存会重载插件，并中断正在运行的 QQ 任务。")
    : t("没有未保存的修改。"));

  const settingsForm = createElement('form', { id: formId, className: 'imqb2-form', onSubmit: submit, 'aria-busy': busy },
    loadFeedback,
    createElement('fieldset', { className: 'imqb2-fields', disabled: busy },
      createElement(AccessSettings, { access, busy, appId, enabled, onMembershipChange: retry,
        onMode: (key, value) => patch('access', { ...access, [key]: value }),
      }),
      createElement('div', { className: 'imqb2-group-title' }, t("基础设置")),
      createElement('div', { className: 'imqb2-field' },
        createElement('div', { className: 'imqb2-head' },
          createElement('span', { className: 'imqb2-label' }, t("群聊仅回复 @机器人的消息")),
          createElement(Switch, { label: t("群聊仅回复 @机器人的消息"), checked: form.requireMention ?? true,
            onChange: value => patch('requireMention', value) }))),
    ),
    createElement('div', { className: 'imqb2-footer' },
      createElement('p', { className: `imqb2-note${result === null ? '' : result.kind === 'failed' ? ' imqb2-note--error' : ' imqb2-note--ok'}`, role: result?.kind === 'failed' ? 'alert' : 'status', 'aria-live': 'polite' }, message),
      createElement('div', { className: 'imqb2-footer-actions' },
        pendingConfirmation.current !== null || result?.kind === 'failed' ? createElement(Button, {
          variant: 'ghost', size: 'sm', disabled: busy || loading, onClick: retry,
        }, loading ? t("刷新中…") : t("刷新配置")) : null,
        createElement(Button, { variant: 'ghost', size: 'sm', disabled: busy || !dirty, onClick: () => { replaceDraft({ baseline, form: baseline }); setResult(null); setDraftNotice(null); } }, t("撤销修改")),
        createElement(Button, { variant: 'primary', size: 'sm', type: 'submit', disabled: busy || !dirty }, busy ? t("保存中…") : t("保存")),
      ),
    ),
  );
  return createElement(Fragment, null, accountFields, settingsForm);
}

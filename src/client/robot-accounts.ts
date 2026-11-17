import { t } from './qq-locale.ts';
import { createElement as h, Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, IconPlusOutlineRegular, IconSettingsOutlineRegular, IconTrashOutlineRegular, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WORKBENCH_ROBOT_BIND_PATH,
  WORKBENCH_ROBOT_REMOVE_PATH,
  WORKBENCH_ROBOTS_PATH,
  type WorkbenchRobot,
  type WorkbenchRobotBinding,
  type WorkbenchRobotPatch,
  type WorkbenchRobotRemoval,
  type WorkbenchRobotsResponse,
} from '../shared/workbench-protocol.ts';
import { BindPanelBody, QQ_BOT_LOGO_PATH } from './bind-page.ts';
import { AccessSettings, PrimaryAccountSettings } from './config-panel.ts';
import { fetchJson, HttpError } from './http.ts';

export function robotStateLabel(state: WorkbenchRobot['state']): string {
  return {
  connecting: t("连接中"), connected: t("已连接"), reconnecting: t("重连中"), failed: t("连接失败"), disabled: t("已停用"),
  }[state];
}

type Access = WorkbenchRobot['access'];
type Mode = Access['groupMode'];
type ModeKey = 'c2cMode' | 'groupMode' | 'commandMode';
const MODE_KEYS = ['c2cMode', 'groupMode', 'commandMode'] as const satisfies readonly ModeKey[];
type Draft = { alias: string; c2cMode: Mode; groupMode: Mode; commandMode?: Mode };
type EditRobot = { kind: 'edit'; baseline: WorkbenchRobot; draft: Draft };
type Editor = { kind: 'add'; id: string } | EditRobot;
export type RobotAccountDrafts = Map<string, EditRobot>;

export function robotBindingKey(robot: WorkbenchRobot): string {
  return JSON.stringify([robot.appId, robot.bindingRevision]);
}

export function accountName(robot: WorkbenchRobot): string {
  return robot.alias || defaultAccountName(robot);
}

function defaultAccountName(robot: WorkbenchRobot): string {
  return robot.primary ? t("主机器人") : t("机器人 {0}", robot.appId);
}

function editRobot(robot: WorkbenchRobot): EditRobot {
  return {
    kind: 'edit', baseline: robot, draft: {
      alias: robot.alias, c2cMode: robot.access.c2cMode, groupMode: robot.access.groupMode,
      commandMode: robot.access.commandMode,
    },
  };
}

function makePatch({ draft, baseline }: EditRobot): WorkbenchRobotPatch {
  const patch: WorkbenchRobotPatch = { appId: baseline.appId, revision: baseline.revision };
  const alias = draft.alias.trim();
  if (alias !== baseline.alias) patch.alias = alias;
  if (!baseline.primary) {
    const access: Partial<Access> = {};
    for (const key of MODE_KEYS) {
      if (draft[key] !== undefined && draft[key] !== baseline.access[key]) access[key] = draft[key];
    }
    if (Object.keys(access).length > 0) patch.access = access;
  }
  return patch;
}

function rememberEdit(accountDrafts: RobotAccountDrafts, editor: EditRobot): void {
  const key = robotBindingKey(editor.baseline);
  if (Object.keys(makePatch(editor)).length > 2) accountDrafts.set(key, editor);
  else accountDrafts.delete(key);
}

function rebase(editor: EditRobot, latest: WorkbenchRobot): EditRobot {
  const next = editRobot(latest);
  const patch = makePatch(editor);
  if (patch.alias !== undefined) next.draft.alias = patch.alias;
  for (const key of MODE_KEYS) {
    const mode = patch.access?.[key];
    if (mode !== undefined) next.draft[key] = mode;
  }
  return next;
}

function replaceRobot(robots: readonly WorkbenchRobot[] | null, robot: WorkbenchRobot): readonly WorkbenchRobot[] {
  const list = robots ?? [];
  return list.some(item => item.appId === robot.appId)
    ? list.map(item => item.appId === robot.appId ? robot : item)
    : [...list, robot];
}

export interface RobotAccountsProps {
  selectedAppId?: string;
  draftStore: RobotAccountDrafts;
  onSelect: (appId: string) => void;
  workbench: {
    collapsed: boolean;
    compact: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: (appId: string) => void;
    onBindPrimary?: () => void;
    primaryBinding?: boolean;
    settingsRequest?: () => void;
    onAdd: () => void;
    onCancelAdd: () => void;
    render: (view: {
      robots: readonly WorkbenchRobot[] | null;
      unavailable: boolean;
      error?: string;
      rail: ReactNode;
      accountSettings: ReactNode;
      cancelAdd: () => void;
      busy: boolean;
    }) => ReactNode;
  };
}

export function RobotAccounts({ selectedAppId, draftStore: accountDrafts, onSelect, workbench }: RobotAccountsProps): ReactNode {
  const [robots, setRobots] = useState<readonly WorkbenchRobot[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [removing, setRemoving] = useState<WorkbenchRobot>();
  const [removeMode, setRemoveMode] = useState<WorkbenchRobotRemoval>();
  const [removeError, setRemoveError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editError, setEditError] = useState('');
  const [rebased, setRebased] = useState(false);
  const [busy, setBusy] = useState(false);
  const [binding, setBinding] = useState<{ id: string; state: WorkbenchRobotBinding }>();
  const [reload, setReload] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const sawUnboundPrimary = useRef(false);
  const formId = useId();
  const bindId = editor?.kind === 'add' ? editor.id : undefined;
  const bindState = binding?.id === bindId ? binding?.state : undefined;
  const bindingBusy = busy || bindState?.phase === 'saving' || bindState?.phase === 'bound';
  const activeRobot = robots?.find(robot => robot.appId === selectedAppId)
    ?? robots?.find(robot => robot.primary) ?? robots?.[0];

  const setEdit = (next: EditRobot): void => {
    rememberEdit(accountDrafts, next);
    setEditor(next);
  };

  useEffect(() => () => { mutation.current?.abort(); mutation.current = null; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async (): Promise<void> => {
      const current = generation.current;
      try {
        const response = await fetchJson<WorkbenchRobotsResponse>(WORKBENCH_ROBOTS_PATH, { cache: 'no-store', signal: controller.signal });
        if (controller.signal.aborted || generation.current !== current || mutation.current) return;
        setRobots(response.robots);
        setLoadError('');
        setUnavailable(false);
      } catch (error) {
        if (controller.signal.aborted || generation.current !== current || mutation.current) return;
        if (error instanceof HttpError && error.status === 404) {
          setUnavailable(true);
          setLoadError('');
        } else {
          setLoadError(error instanceof Error ? error.message : t("无法读取机器人列表"));
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh(); }, 4000);
      }
    };
    void refresh();
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [reload]);

  useEffect(() => {
    if (!removing || !removeError || busy || !robots) return;
    const latest = robots.find(robot => robot.appId === removing.appId);
    if (!latest) {
      if (removeMode === 'clear') return;
      accountDrafts.delete(robotBindingKey(removing));
      setRemoving(undefined);
      setEditor(current => current?.kind === 'edit' && current.baseline.appId === removing.appId ? null : current);
      if (selectedAppId === removing.appId && robots[0]) onSelect(robots[0].appId);
    } else if (latest.revision !== removing.revision) {
      setRemoving(latest);
      setRemoveError(t("机器人配置已更新，请确认当前机器人后再解绑。"));
    }
  }, [busy, removing, removeError, removeMode, robots, selectedAppId, onSelect]);

  useEffect(() => {
    if (!bindId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (state: WorkbenchRobotBinding) => {
      if (controller.signal.aborted) return;
      setBinding(current => current?.id === bindId && current.state.phase === 'bound' ? current : { id: bindId, state });
    };
    const poll = async (): Promise<void> => {
      try {
        const state = await fetchJson<WorkbenchRobotBinding>(`${WORKBENCH_ROBOT_BIND_PATH}?id=${bindId}`, { signal: controller.signal });
        if (!mutation.current) update(state);
        if (state.phase === 'bound' && !mutation.current) return;
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          update({ phase: 'failed', reason: error.message });
          return;
        }
        update({ phase: 'failed', reason: t("无法读取绑定状态，请刷新二维码。") });
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 1500);
    };
    const start = fetchJson<WorkbenchRobotBinding>(WORKBENCH_ROBOT_BIND_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', id: bindId }),
    }).then(state => {
      update(state);
      if (!controller.signal.aborted) void poll();
    }, (error: unknown) => {
      update({ phase: 'failed', reason: error instanceof Error ? error.message : t("无法开始绑定，请重试。") });
    });
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      void start.then(() => fetchJson(WORKBENCH_ROBOT_BIND_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id: bindId }),
      })).catch(() => {});
    };
  }, [bindId]);

  useEffect(() => {
    if (bindState?.phase === 'bound') {
      generation.current++;
      setRobots(current => replaceRobot(current, bindState.robot));
      setEditor(editRobot(bindState.robot));
      workbench.onOpenSettings(bindState.robot.appId);
      return;
    }
    const primary = robots?.find(robot => robot.primary);
    if (!primary) sawUnboundPrimary.current = robots?.length === 0 || !!workbench.primaryBinding;
    if (sawUnboundPrimary.current && primary) {
      sawUnboundPrimary.current = false;
      setEditor(editRobot(primary));
      workbench.onOpenSettings(primary.appId);
    }
  }, [bindState, robots, workbench]);

  const submitBinding = async (appId: string, appSecret: string) => {
    if (!bindId || mutation.current) return { ok: false, error: t("请等待当前绑定完成。") };
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    try {
      const state = await fetchJson<WorkbenchRobotBinding>(WORKBENCH_ROBOT_BIND_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action: 'manual', id: bindId, appId, appSecret }),
      });
      if (controller.signal.aborted) return { ok: false, error: t("绑定已取消。") };
      if (state.phase === 'bound') {
        setBinding({ id: bindId, state });
        return { ok: true };
      }
      return { ok: false, error: state.phase === 'failed' ? state.reason : t("绑定未完成，请重试。") };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : t("绑定失败，请重试。") };
    } finally {
      if (mutation.current === controller) {
        generation.current++;
        mutation.current = null;
        setBusy(false);
      }
    }
  };

  const save = async (patch: WorkbenchRobotPatch, editing: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (mutation.current) return { ok: false, error: t("请等待当前操作完成。") };
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    setActionError('');
    setEditError('');
    setRebased(false);
    try {
      const { robot } = await fetchJson<{ robot: WorkbenchRobot }>(WORKBENCH_ROBOTS_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch), signal: controller.signal,
      });
      if (controller.signal.aborted) return { ok: false, error: t("操作已取消。") };
      setRobots(current => replaceRobot(current, robot));
      if (editing) {
        setEdit(editRobot(robot));
      } else if (editor?.kind === 'edit' && editor.baseline.appId === robot.appId
        && editor.baseline.revision === patch.revision) {
        setEdit(rebase(editor, robot));
      }
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, error: t("操作已取消。") };
      const conflict = error instanceof HttpError && error.status === 409;
      const message = conflict && patch.revision !== null
        ? t("机器人配置已更新，请读取最新配置后再保存。")
        : error instanceof Error ? error.message : t("无法保存机器人配置");
      if (editing) setEditError(message);
      else setActionError(message);
      if (conflict) setReload(value => value + 1);
      return { ok: false, error: message };
    } finally {
      if (mutation.current === controller) {
        generation.current++;
        mutation.current = null;
        setBusy(false);
      }
    }
  };

  const openRemove = (robot: WorkbenchRobot): void => {
    setRemoveError('');
    setRemoveMode(undefined);
    setRemoving(robot);
  };
  const remove = async (robot: WorkbenchRobot, mode: WorkbenchRobotRemoval): Promise<void> => {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    setRemoveError('');
    setRemoveMode(mode);
    try {
      await fetchJson(WORKBENCH_ROBOT_REMOVE_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: robot.appId, revision: robot.revision, bindingRevision: robot.bindingRevision, mode }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRobots(current => current?.filter(item => item.appId !== robot.appId) ?? null);
      accountDrafts.delete(robotBindingKey(robot));
      setEditor(current => current?.kind === 'edit' && current.baseline.appId === robot.appId ? null : current);
      setRemoving(undefined);
      if (activeRobot?.appId === robot.appId) {
        const next = robots?.find(item => item.appId !== robot.appId);
        if (next) onSelect(next.appId);
      }
    } catch (error) {
      if (!controller.signal.aborted) setRemoveError(error instanceof HttpError && (error.status === 409 || error.status === 503)
        ? error.message : t("暂未确认解绑结果。若刷新后仍显示此机器人，可以重试。"));
    } finally {
      if (mutation.current === controller) {
        generation.current++;
        mutation.current = null;
        setBusy(false);
        setReload(value => value + 1);
      }
    }
  };

  const startEdit = (next: Editor): void => {
    setEditor(next);
    setEditError('');
    setRebased(false);
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    if (editor?.kind !== 'edit') return;
    const latest = accountDrafts.get(robotBindingKey(editor.baseline)) ?? editor;
    setEdit({ ...latest, draft: { ...latest.draft, [key]: value } });
  };
  const current = editor?.kind === 'edit' ? robots?.find(robot => robot.appId === editor.baseline.appId) : undefined;
  const stale = editor?.kind === 'edit' && current !== undefined && current.revision !== editor.baseline.revision;
  useEffect(() => {
    if (!stale || !current || editor?.kind !== 'edit' || busy) return;
    const baseline = editor.baseline;
    if (robotBindingKey(baseline) !== robotBindingKey(current)) {
      accountDrafts.delete(robotBindingKey(baseline));
      setEditor(editRobot(current));
      return;
    }
    const modesUnchanged = MODE_KEYS.every(key => current.access[key] === baseline.access[key]);
    if (Object.keys(makePatch(editor)).length === 2 || (
      current.alias === baseline.alias && current.enabled === baseline.enabled && modesUnchanged
    )) {
      setEdit(rebase(editor, current));
    }
  }, [busy, current, editor, stale]);
  const patch = editor?.kind === 'edit' ? makePatch(editor) : undefined;
  const adding = editor?.kind === 'add';
  const canSave = !busy && !stale && patch !== undefined && Object.keys(patch).length > 2;
  const cancelAdd = (): void => {
    if (bindingBusy) return;
    setEditor(null);
    workbench.onCancelAdd();
  };
  const openSettings = (robot: WorkbenchRobot): void => {
    const key = robotBindingKey(robot);
    if (editor?.kind !== 'edit' || robotBindingKey(editor.baseline) !== key) {
      startEdit(accountDrafts.get(key) ?? editRobot(robot));
    }
    workbench.onOpenSettings(robot.appId);
  };
  const bindPrimary = (): void => {
    setEditor(null);
    setEditError('');
    setRebased(false);
    sawUnboundPrimary.current = true;
    workbench.onBindPrimary?.();
  };
  useEffect(() => {
    if (!workbench.settingsRequest || !robots || unavailable || bindingBusy) return;
    if (activeRobot) openSettings(activeRobot);
    else bindPrimary();
    workbench.settingsRequest();
  }, [workbench, robots, unavailable, bindingBusy, activeRobot]);
  const footer = h('div', { className: 'imqw-actions imqw-savebar imqr-footer' },
    h(Button, { size: 'sm', variant: 'ghost', type: 'button',
      disabled: busy || (!stale && !canSave),
      onClick: () => {
        if (editor?.kind === 'edit') {
          accountDrafts.delete(robotBindingKey(editor.baseline));
          startEdit(editRobot(current ?? editor.baseline));
        }
      },
    }, t("撤销修改")),
    h(Button, { size: 'sm', variant: 'primary', type: 'submit', form: formId, disabled: !canSave },
      busy ? t("保存中…") : t("保存")));
  const enabled = current?.enabled ?? (editor?.kind === 'edit' && editor.baseline.enabled);
  const enableControl = editor?.kind === 'edit' ? h('div', { className: 'imqr-inline-state' },
    h('span', null, t("启用机器人")),
    h(Switch, {
      checked: enabled,
      label: t("启用机器人"), disabled: busy,
      onChange: enabled => {
        const robot = current ?? editor.baseline;
        void save({ appId: robot.appId, revision: robot.revision, enabled }, false);
      },
    }),
  ) : null;
  const form = editor?.kind !== 'edit' ? null : h('form', {
      id: formId, className: 'imqr-form', onSubmit: (event: FormEvent) => {
        event.preventDefault();
        if (canSave) void save(patch, true);
      },
    },
      h('div', { className: 'imqr-account-controls', role: 'group', 'aria-label': t("账号信息") },
        h('label', { className: 'imqr-account-name' }, t("机器人名称"), h(Input, {
          value: editor.draft.alias, disabled: busy, placeholder: defaultAccountName(editor.baseline),
          autoComplete: 'off', maxLength: 120, onChange: event => setField('alias', event.currentTarget.value),
        })),
        enableControl),
      stale ? h('div', { className: 'imqr-header' },
        h('p', { className: 'imqb-error', role: 'alert' }, t("配置已变化，草稿仍保留。")),
        h(Button, { size: 'sm', variant: 'outline', type: 'button', disabled: busy, onClick: () => {
          if (editor.kind !== 'edit' || !current) return;
          setEdit(rebase(editor, current));
          setEditError('');
          setRebased(true);
        } }, t("合并到最新配置"))) : null,
      editError && !stale ? h('p', { className: 'imqb-error', role: 'alert' }, editError) : null,
      rebased && !stale ? h('p', { className: 'imqb-status-sub', role: 'status' }, t("草稿已合并，请核对后保存。")) : null,
  );
  const startBinding = (): void => startEdit({ kind: 'add', id: crypto.randomUUID() });
  const credentials = editor?.kind === 'edit' ? h('section', { 'aria-label': t("凭据与访问") },
    h('h3', null, t("凭据与访问")),
    h<NonNullable<Parameters<typeof BindPanelBody>[0]>>(BindPanelBody, {
      key: editor.baseline.appId, state: { phase: 'bound', appId: editor.baseline.appId },
      recheck: () => setReload(value => value + 1),
      boundActions: {
        disabled: busy || stale,
        ...(editor.baseline.primary ? {} : {
          replace: (appId: string, appSecret: string) => save({ appId, appSecret, revision: editor.baseline.revision }, false),
        }),
        unbind: () => openRemove(current ?? editor.baseline),
      },
    }),
  ) : null;
  const accountSettings = editor?.kind === 'add'
    ? h<NonNullable<Parameters<typeof BindPanelBody>[0]>>(BindPanelBody, {
        key: bindId, state: bindState?.phase === 'bound' ? { phase: 'saving' } : bindState ?? null,
        actions: { refresh: startBinding, submit: submitBinding } })
    : editor && h('section', { className: 'imqr-inline' },
      editor.baseline.primary
        ? h(PrimaryAccountSettings, {
            key: robotBindingKey(editor.baseline),
            appId: editor.baseline.appId, revision: current?.revision ?? editor.baseline.revision,
            enabled, formId, defaultName: defaultAccountName(editor.baseline), controls: enableControl, credentials,
            onAliasSaved: robot => setRobots(current => replaceRobot(current, robot)),
          })
        : h(Fragment, null, credentials, form,
            h(AccessSettings, {
              key: `access-${editor.baseline.appId}`, appId: editor.baseline.appId, access: editor.draft, busy,
              enabled, onMode: setField, onMembershipChange: () => setReload(value => value + 1),
            }), footer),
    );
  if (unavailable || (robots === null && !loadError)) {
    return workbench.render({ robots, unavailable, rail: null, accountSettings: null, cancelAdd, busy: bindingBusy });
  }

  const retryClear = removing !== undefined && removeMode === 'clear' && removeError !== ''
    && robots?.some(robot => robot.appId === removing.appId) === false;
  const rail = h('section', { className: 'imqr-rail', 'aria-label': t("机器人账号") },
    h('style', null, STYLES),
    h('div', { className: 'imqr-header' },
      workbench.collapsed ? null : h('h2', { className: 'imqb-status-title' }, t("机器人")),
      h('div', { className: 'imqr-actions' },
        robots?.length === 0 ? null : h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: t("添加机器人"), 'aria-label': t("添加机器人"),
          disabled: busy || adding || robots === null,
          onClick: () => {
            startBinding();
            workbench.onAdd();
          },
        }, h(IconPlusOutlineRegular, { size: 16 })),
        !workbench.compact ? h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: workbench.collapsed ? t("展开机器人栏") : t("收起机器人栏"),
          'aria-label': workbench.collapsed ? t("展开机器人栏") : t("收起机器人栏"),
          onClick: workbench.onToggleCollapse,
        }, workbench.collapsed ? '›' : '‹') : null)),
    loadError ? h('p', { className: 'imqb-error', role: 'alert' }, loadError) : null,
    actionError ? h('p', { className: 'imqb-error', role: 'alert' }, actionError) : null,
    robots?.length && !robots.some(robot => robot.primary)
      ? h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: bindingBusy,
        'aria-label': t("绑定主机器人"), title: t("绑定主机器人"), onClick: bindPrimary,
      }, workbench.collapsed ? h(IconPlusOutlineRegular, { size: 16 }) : t("绑定主机器人")) : null,
    robots?.length === 0 ? h('p', { className: 'imqb-status-sub' }, t("还没有机器人")) : null,
    robots?.map(robot => {
      const name = accountName(robot);
      const selected = activeRobot?.appId === robot.appId;
      const avatar = h('span', { className: 'imqr-avatar', 'data-state': robot.state, 'aria-hidden': true },
        robot.alias ? [...robot.alias][0] : h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'currentColor' },
          h('path', { d: QQ_BOT_LOGO_PATH })));
      const label = workbench.collapsed ? null : h('span', { className: 'imqb-status-meta' },
        h('span', { className: 'imqb-status-title imqr-name' }, name),
        h('span', { className: 'imqb-status-sub' }, robotStateLabel(robot.state)),
        h('span', { className: 'imqb-status-sub' }, 'AppID ', robot.appId));
      return h('div', { className: 'imqr-row', key: robot.appId, 'data-selected': selected || undefined },
        h('button', {
          className: 'imqr-select', type: 'button', disabled: adding && bindingBusy, 'aria-pressed': selected,
          onClick: () => {
            if (adding) cancelAdd();
            onSelect(robot.appId);
          },
          'aria-label': name, title: `${name} · ${robotStateLabel(robot.state)}`,
        }, avatar, label),
        workbench.collapsed ? null : h('div', { className: 'imqr-row-actions' },
          h('div', { className: 'imqr-row-buttons' },
            h(Button, { size: 'sm', variant: 'ghost', type: 'button', disabled: bindingBusy, onClick: () => openSettings(robot), 'aria-label': t("设置{0}", name), title: t("设置{0}", name) }, h(IconSettingsOutlineRegular, { size: 16 })),
            h(Button, {
              size: 'sm', variant: 'ghost', type: 'button', className: 'imqr-remove', disabled: bindingBusy,
              onClick: () => openRemove(robot),
              'aria-label': t("解绑{0}", name), title: t("解绑{0}", name),
            }, h(IconTrashOutlineRegular, { size: 16 }))),
          h(Switch, { checked: robot.enabled, label: t("启用{0}", name), disabled: bindingBusy, onChange: enabled => {
            void save({ appId: robot.appId, revision: robot.revision, enabled }, false);
          } })),
      );
    }),
    workbench.collapsed && activeRobot
      ? h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: t("当前机器人设置"), 'aria-label': t("当前机器人设置"), disabled: bindingBusy,
          onClick: () => openSettings(activeRobot),
        }, h(IconSettingsOutlineRegular, { size: 16 })) : null,
    removing ? h(Modal, {
      open: true, title: t("解绑「{0}」？", accountName(removing)), closeLabel: t("关闭"),
      description: retryClear ? t("这台机器人已解绑。重试将继续清除本机 QQ 消息记录和 Session 关联。")
        : t("「仅解绑」会保留本机 QQ 消息记录和 Session 关联。「解绑并清除记录」还会删除这台机器人在本机的 QQ 消息记录，并解除它的 QQ 会话与 DSH Session 的关联。清除无法撤销，原 Session 可在 DSH 工作区打开。"),
      onClose: () => { if (!mutation.current) setRemoving(undefined); },
      footer: h(Fragment, null,
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setRemoving(undefined) }, t("取消")),
        h(Button, {
          type: 'button', variant: 'outline', size: 'sm', disabled: busy || retryClear,
          onClick: () => { void remove(removing, 'retain'); },
        }, busy && removeMode === 'retain' ? t("正在解绑…") : t("仅解绑")),
        h(Button, {
          type: 'button', variant: 'outline', size: 'sm', className: 'imqb-danger imqr-clear', disabled: busy,
          onClick: () => { void remove(removing, 'clear'); },
        }, busy && removeMode === 'clear' ? t("正在清除…") : retryClear ? t("重试清除记录") : t("解绑并清除记录"))),
    }, h('p', { className: 'imqb-status-sub' }, 'AppID ', removing.appId),
      removeError ? h('p', { className: 'imqb-error', role: 'alert' }, removeError) : null) : null,
  );
  return workbench.render({ robots, unavailable, error: loadError, rail, accountSettings, cancelAdd, busy: bindingBusy });
}

const STYLES = `
.imqr-header { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
.imqr-name { overflow-wrap: anywhere; }
.imqr-select { font: inherit; color: inherit; background: none; border: 0; padding: 4px; text-align: left; cursor: pointer; display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; border-radius: 8px; }
.imqr-avatar { display: grid; place-items: center; position: relative; flex: 0 0 28px; width: 28px; height: 28px; border-radius: 8px; background: var(--dsw-alias-bg-layer-3); }
.imqr-avatar::after { content: ''; position: absolute; inset: auto 0 0 auto; width: 7px; height: 7px; background: var(--dsw-alias-label-tertiary); border-radius: 100%; }
.imqr-avatar[data-state='connected']::after { background: var(--dsw-alias-text-green, #29966e); }
.imqr-avatar[data-state='failed']::after { background: var(--dsw-alias-text-red, #ce5260); }
.imqr-inline { display: flex; flex-direction: column; gap: 14px; }
.imqr-account-controls {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; font-size: 13px;
}
.imqr-account-name { display: flex; flex: 0 1 280px; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
.imqr-account-name > :last-child { box-sizing: border-box; flex: 1 1 160px; min-width: 0; }
.imqr-account-name input::placeholder { color: var(--dsw-alias-label-secondary); opacity: 1; }
.imqr-inline-state { display: flex; align-items: center; gap: 8px; }
.imqr-rail { display: grid; align-content: start; gap: 8px; min-width: 0; }
.imqr-row {
  display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.imqr-row[data-selected] {
  background: var(--dsw-alias-bg-module-platform);
  border-color: var(--dsw-alias-border-l4);
}
.imqr-row-actions, .imqr-row-buttons { display: flex; align-items: center; gap: 2px; }
.imqr-row-actions { justify-content: space-between; }
.imqr-row-buttons > button { padding-inline: 4px; }
.imqr-remove:hover, .imqr-remove:focus-visible { color: var(--dsw-alias-state-error-primary); }
.imqr-clear:not(:disabled) { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }
.imqr-actions, .imqr-footer { display: flex; align-items: center; gap: 8px; }
.imqr-footer { justify-content: flex-end; }
.imqr-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.imqr-select:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; }
`;

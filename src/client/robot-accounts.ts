import { createElement as h, Fragment, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, IconPlusOutlineRegular, IconSettingsOutlineRegular, IconTrashOutlineRegular, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WORKBENCH_ROBOT_BIND_PATH,
  WORKBENCH_ROBOT_REMOVE_PATH,
  WORKBENCH_ROBOTS_PATH,
  type WorkbenchRobot,
  type WorkbenchRobotBinding,
  type WorkbenchRobotPatch,
  type WorkbenchRobotsResponse,
} from '../shared/workbench-protocol.ts';
import { BindPanelBody, QQ_BOT_LOGO_PATH } from './bind-page.ts';
import { AccessSettings } from './config-panel.ts';
import { fetchJson, HttpError } from './http.ts';

export const ROBOT_STATE_LABELS: Record<WorkbenchRobot['state'], string> = {
  connecting: '连接中', connected: '已连接', reconnecting: '重连中', failed: '连接失败', disabled: '已停用',
};

type Access = WorkbenchRobot['access'];
type Mode = Access['groupMode'];
type ModeKey = 'c2cMode' | 'groupMode' | 'commandMode';
const MODE_KEYS = ['c2cMode', 'groupMode', 'commandMode'] as const satisfies readonly ModeKey[];
type Draft = { alias: string; c2cMode: Mode; groupMode: Mode; commandMode: Mode };
type EditRobot = { kind: 'edit'; baseline: WorkbenchRobot; draft: Draft };
type Editor = { kind: 'add'; id: string } | EditRobot;

export function accountName(robot: WorkbenchRobot): string {
  return robot.alias || (robot.primary ? '主机器人' : `机器人 ${robot.appId}`);
}

function editRobot(robot: WorkbenchRobot): EditRobot {
  return {
    kind: 'edit', baseline: robot, draft: {
      alias: robot.alias, c2cMode: robot.access.c2cMode, groupMode: robot.access.groupMode,
      commandMode: robot.access.commandMode ?? 'open',
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
      if (draft[key] !== (baseline.access[key] ?? 'open')) access[key] = draft[key];
    }
    if (Object.keys(access).length > 0) patch.access = access;
  }
  return patch;
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
  onSelect: (appId: string) => void;
  workbench: {
    collapsed: boolean;
    compact: boolean;
    onToggleCollapse: () => void;
    onOpenSettings: (appId: string) => void;
    onAdd: () => void;
    onCancelAdd: () => void;
    render: (view: {
      robots: readonly WorkbenchRobot[] | null;
      unavailable: boolean;
      rail: ReactNode;
      accountSettings: ReactNode;
      cancelAdd: () => void;
      busy: boolean;
    }) => ReactNode;
  };
}

export function RobotAccounts({ selectedAppId, onSelect, workbench }: RobotAccountsProps): ReactNode {
  const [robots, setRobots] = useState<readonly WorkbenchRobot[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [removing, setRemoving] = useState<WorkbenchRobot>();
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
          setLoadError(error instanceof Error ? error.message : '无法读取机器人列表');
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
      setRemoving(undefined);
      setEditor(current => current?.kind === 'edit' && current.baseline.appId === removing.appId ? null : current);
      if (selectedAppId === removing.appId && robots[0]) onSelect(robots[0].appId);
    } else if (latest.revision !== removing.revision) {
      setRemoving(latest);
      setRemoveError('机器人配置已更新，请确认当前机器人后再解绑。');
    }
  }, [busy, removing, removeError, robots, selectedAppId, onSelect]);

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
        update({ phase: 'failed', reason: '无法读取绑定状态，请刷新二维码。' });
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 1500);
    };
    const start = fetchJson<WorkbenchRobotBinding>(WORKBENCH_ROBOT_BIND_PATH, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', id: bindId }),
    }).then(state => {
      update(state);
      if (!controller.signal.aborted) void poll();
    }, (error: unknown) => {
      update({ phase: 'failed', reason: error instanceof Error ? error.message : '无法开始绑定，请重试。' });
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
    if (robots?.length === 0) sawUnboundPrimary.current = true;
    const primary = robots?.find(robot => robot.primary);
    if (sawUnboundPrimary.current && primary) {
      sawUnboundPrimary.current = false;
      setEditor(editRobot(primary));
      workbench.onOpenSettings(primary.appId);
    }
  }, [bindState, robots, workbench]);

  const submitBinding = async (appId: string, appSecret: string) => {
    if (!bindId || mutation.current) return { ok: false, error: '请等待当前绑定完成。' };
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    try {
      const state = await fetchJson<WorkbenchRobotBinding>(WORKBENCH_ROBOT_BIND_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ action: 'manual', id: bindId, appId, appSecret }),
      });
      if (controller.signal.aborted) return { ok: false, error: '绑定已取消。' };
      if (state.phase === 'bound') {
        setBinding({ id: bindId, state });
        return { ok: true };
      }
      return { ok: false, error: state.phase === 'failed' ? state.reason : '绑定未完成，请重试。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : '绑定失败，请重试。' };
    } finally {
      if (mutation.current === controller) {
        generation.current++;
        mutation.current = null;
        setBusy(false);
      }
    }
  };

  const save = async (patch: WorkbenchRobotPatch, editing: boolean): Promise<{ ok: boolean; error?: string }> => {
    if (mutation.current) return { ok: false, error: '请等待当前操作完成。' };
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
      if (controller.signal.aborted) return { ok: false, error: '操作已取消。' };
      setRobots(current => replaceRobot(current, robot));
      if (editing) {
        setEditor(editRobot(robot));
      } else if (editor?.kind === 'edit' && editor.baseline.appId === robot.appId
        && editor.baseline.revision === patch.revision) {
        setEditor(rebase(editor, robot));
      }
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, error: '操作已取消。' };
      const conflict = error instanceof HttpError && error.status === 409;
      const message = conflict && patch.revision !== null
        ? '机器人配置已更新，请读取最新配置后再保存。'
        : error instanceof Error ? error.message : '无法保存机器人配置';
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

  const remove = async (robot: WorkbenchRobot): Promise<void> => {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    generation.current++;
    setBusy(true);
    setRemoveError('');
    try {
      await fetchJson(WORKBENCH_ROBOT_REMOVE_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId: robot.appId, revision: robot.revision }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRobots(current => current?.filter(item => item.appId !== robot.appId) ?? null);
      setEditor(current => current?.kind === 'edit' && current.baseline.appId === robot.appId ? null : current);
      setRemoving(undefined);
      if (activeRobot?.appId === robot.appId) {
        const next = robots?.find(item => item.appId !== robot.appId);
        if (next) onSelect(next.appId);
      }
    } catch (error) {
      if (!controller.signal.aborted) setRemoveError(error instanceof HttpError && error.status === 409
        ? error.message : '暂未确认解绑结果。若刷新后仍显示此机器人，可以重试。');
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
    setEditor(current => current?.kind === 'edit' ? { ...current, draft: { ...current.draft, [key]: value } } : current);
  };
  const current = editor?.kind === 'edit' ? robots?.find(robot => robot.appId === editor.baseline.appId) : undefined;
  const stale = editor?.kind === 'edit' && current !== undefined && current.revision !== editor.baseline.revision;
  useEffect(() => {
    if (!stale || !current || editor?.kind !== 'edit' || busy) return;
    const baseline = editor.baseline;
    const modesUnchanged = MODE_KEYS.every(key => current.access[key] === baseline.access[key]);
    if (Object.keys(makePatch(editor)).length === 2 || (
      current.alias === baseline.alias && current.enabled === baseline.enabled && modesUnchanged
    )) {
      setEditor(rebase(editor, current));
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
    if (editor?.kind !== 'edit' || editor.baseline.appId !== robot.appId) startEdit(editRobot(robot));
    workbench.onOpenSettings(robot.appId);
  };
  const footer = h('div', { className: 'imqr-footer' },
    h(Button, { size: 'sm', variant: 'ghost', type: 'button',
      disabled: busy || (!stale && !canSave),
      onClick: () => {
        if (editor?.kind === 'edit') startEdit(editRobot(current ?? editor.baseline));
      },
    }, '撤销修改'),
    h(Button, { size: 'sm', variant: 'primary', type: 'submit', form: formId, disabled: !canSave },
      busy ? '保存中…' : '保存'));
  const form = editor?.kind !== 'edit' ? null : h('form', {
      id: formId, className: 'imqr-form', onSubmit: (event: FormEvent) => {
        event.preventDefault();
        if (canSave) void save(patch, true);
      },
    },
      h('label', { className: 'imqb-field imqr-field' }, '机器人名称', h(Input, {
        value: editor.draft.alias, disabled: busy, placeholder: '可选，便于区分机器人', autoComplete: 'off', maxLength: 120,
        onChange: event => setField('alias', event.currentTarget.value),
      })),
      stale ? h('div', { className: 'imqr-header' },
        h('p', { className: 'imqb-error', role: 'alert' }, '配置已变化，草稿仍保留。'),
        h(Button, { size: 'sm', variant: 'outline', type: 'button', disabled: busy, onClick: () => {
          if (editor.kind !== 'edit' || !current) return;
          setEditor(rebase(editor, current));
          setEditError('');
          setRebased(true);
        } }, '合并到最新配置')) : null,
      editError && !stale ? h('p', { className: 'imqb-error', role: 'alert' }, editError) : null,
      rebased && !stale ? h('p', { className: 'imqb-status-sub', role: 'status' }, '草稿已合并，请核对后保存。') : null,
  );
  const startBinding = (): void => startEdit({ kind: 'add', id: crypto.randomUUID() });
  const accountSettings = editor?.kind === 'add'
    ? h<NonNullable<Parameters<typeof BindPanelBody>[0]>>(BindPanelBody, {
        key: bindId, state: bindState?.phase === 'bound' ? { phase: 'saving' } : bindState ?? null,
        actions: { refresh: startBinding, submit: submitBinding } })
    : editor ? h('section', { className: 'imqr-inline' },
    h('h3', null, '账号信息'),
    h('div', { className: 'imqr-inline-state' },
      h('span', null, '启用机器人'),
      h(Switch, {
        checked: current?.enabled ?? editor.baseline.enabled,
        label: '启用机器人', disabled: busy,
        onChange: enabled => {
          const robot = current ?? editor.baseline;
          void save({ appId: robot.appId, revision: robot.revision, enabled }, false);
        },
      }),
    ),
    form,
    editor.baseline.primary ? null : h(Fragment, null,
      h<NonNullable<Parameters<typeof BindPanelBody>[0]>>(BindPanelBody, {
        key: editor.baseline.appId, state: { phase: 'bound', appId: editor.baseline.appId },
        recheck: () => setReload(value => value + 1),
        boundActions: {
          disabled: busy || stale,
          replace: (appId, appSecret) => save({ appId, appSecret, revision: editor.baseline.revision }, false),
          unbind: () => { setRemoveError(''); setRemoving(current ?? editor.baseline); },
        },
      }),
      h(AccessSettings, {
        key: `access-${editor.baseline.appId}`, appId: editor.baseline.appId, access: editor.draft, busy,
        enabled: current?.enabled ?? editor.baseline.enabled, onMode: setField,
        onMembershipChange: () => setReload(value => value + 1),
      }),
    ),
    footer,
  ) : null;
  if (unavailable || (robots === null && !loadError)) {
    return workbench.render({ robots, unavailable, rail: null, accountSettings: null, cancelAdd, busy: bindingBusy });
  }

  const activeRobot = robots?.find(robot => robot.appId === selectedAppId) ?? robots?.[0];
  const rail = h('section', { className: 'imqr-rail', 'aria-label': '机器人账号' },
    h('style', null, STYLES),
    h('div', { className: 'imqr-header' },
      workbench.collapsed ? null : h('h2', { className: 'imqb-status-title' }, '机器人'),
      h('div', { className: 'imqr-actions' },
        robots?.length === 0 ? null : h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: '添加机器人', 'aria-label': '添加机器人',
          disabled: busy || adding || robots === null,
          onClick: () => {
            startBinding();
            workbench.onAdd();
          },
        }, h(IconPlusOutlineRegular, { size: 16 })),
        !workbench.compact ? h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: workbench.collapsed ? '展开机器人栏' : '收起机器人栏',
          'aria-label': workbench.collapsed ? '展开机器人栏' : '收起机器人栏',
          onClick: workbench.onToggleCollapse,
        }, workbench.collapsed ? '›' : '‹') : null)),
    loadError ? h('p', { className: 'imqb-error', role: 'alert' }, loadError) : null,
    actionError ? h('p', { className: 'imqb-error', role: 'alert' }, actionError) : null,
    robots?.length === 0 ? h('p', { className: 'imqb-status-sub' }, '还没有机器人') : null,
    robots?.map(robot => {
      const name = accountName(robot);
      const selected = activeRobot?.appId === robot.appId;
      const avatar = h('span', { className: 'imqr-avatar', 'data-state': robot.state, 'aria-hidden': true },
        robot.alias ? [...robot.alias][0] : h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'currentColor' },
          h('path', { d: QQ_BOT_LOGO_PATH })));
      const label = workbench.collapsed ? null : h('span', { className: 'imqb-status-meta' },
        h('span', { className: 'imqb-status-title imqr-name' }, name),
        h('span', { className: 'imqb-status-sub' }, ROBOT_STATE_LABELS[robot.state]));
      return h('div', { className: 'imqr-row', key: robot.appId, 'data-selected': selected || undefined },
        h('button', {
          className: 'imqr-select', type: 'button', disabled: adding && bindingBusy, 'aria-pressed': selected,
          onClick: () => {
            if (adding) cancelAdd();
            onSelect(robot.appId);
          },
          'aria-label': name, title: `${name} · ${ROBOT_STATE_LABELS[robot.state]}`,
        }, avatar, label),
        workbench.collapsed ? null : h('div', { className: 'imqr-row-actions' },
          h('div', { className: 'imqr-row-buttons' },
            h(Button, { size: 'sm', variant: 'ghost', type: 'button', disabled: bindingBusy, onClick: () => openSettings(robot), 'aria-label': `设置${name}`, title: `设置${name}` }, h(IconSettingsOutlineRegular, { size: 16 })),
            h(Button, {
              size: 'sm', variant: 'ghost', type: 'button', className: 'imqr-remove', disabled: bindingBusy,
              onClick: () => { setRemoveError(''); setRemoving(robot); },
              'aria-label': `解绑${name}`, title: `解绑${name}`,
            }, h(IconTrashOutlineRegular, { size: 16 }))),
          h(Switch, { checked: robot.enabled, label: `启用${name}`, disabled: bindingBusy, onChange: enabled => {
            void save({ appId: robot.appId, revision: robot.revision, enabled }, false);
          } })),
      );
    }),
    workbench.collapsed && activeRobot
      ? h(Button, {
          size: 'sm', variant: 'ghost', type: 'button', title: '当前机器人设置', 'aria-label': '当前机器人设置', disabled: bindingBusy,
          onClick: () => openSettings(activeRobot),
        }, h(IconSettingsOutlineRegular, { size: 16 })) : null,
    removing ? h(Modal, {
      open: true, title: `解绑「${accountName(removing)}」？`, closeLabel: '关闭',
      description: '将断开这台机器人并移除本机绑定。QQ 消息记录和 DSH 会话历史会保留。',
      onClose: () => { if (!mutation.current) setRemoving(undefined); },
      footer: h(Fragment, null,
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setRemoving(undefined) }, '取消'),
        h(Button, {
          type: 'button', variant: 'outline', size: 'sm', className: 'imqr-remove', disabled: busy,
          onClick: () => { void remove(removing); },
        }, busy ? '正在解绑…' : '确认解绑')),
    }, removeError ? h('p', { className: 'imqb-error', role: 'alert' }, removeError) : null) : null,
  );
  return workbench.render({ robots, unavailable, rail, accountSettings, cancelAdd, busy: bindingBusy });
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
.imqr-inline-state { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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
.imqr-actions, .imqr-footer { display: flex; align-items: center; gap: 8px; }
.imqr-footer { justify-content: flex-end; }
.imqr-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.imqr-select:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; }
`;

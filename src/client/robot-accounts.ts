import { createElement as h, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, IconPlusOutlineRegular, Input, Modal, SegmentedControl, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import {
  WORKBENCH_ROBOTS_PATH,
  type WorkbenchRobot,
  type WorkbenchRobotPatch,
  type WorkbenchRobotsResponse,
} from '../shared/workbench-protocol.ts';
import { QQ_BOT_LOGO_PATH } from './bind-page.ts';
import { fetchJson, HttpError } from './http.ts';

const STATE_LABELS: Record<WorkbenchRobot['state'], string> = {
  connecting: '连接中', connected: '已连接', reconnecting: '重连中', failed: '连接失败', disabled: '已停用',
};

type Access = WorkbenchRobot['access'];
type Mode = Access['groupMode'];
type Draft = {
  appId: string;
  alias: string;
  appSecret: string;
  groupMode: Mode;
  c2cMode: Mode;
  groupAllow: string;
  c2cAllow: string;
};
type Editor = { kind: 'add'; draft: Draft } | { kind: 'edit'; baseline: WorkbenchRobot; draft: Draft };

const MODE_OPTIONS: ReadonlyArray<{ value: Mode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'disabled', label: '关闭' },
];

const EMPTY_DRAFT: Draft = {
  appId: '', alias: '', appSecret: '', groupMode: 'allowlist', c2cMode: 'allowlist', groupAllow: '', c2cAllow: '',
};

function accountName(robot: WorkbenchRobot): string {
  return robot.alias || (robot.primary ? '主机器人' : `机器人 ${robot.appId}`);
}

function editRobot(robot: WorkbenchRobot): Editor {
  return {
    kind: 'edit', baseline: robot, draft: {
      appId: robot.appId, alias: robot.alias, appSecret: '',
      c2cMode: robot.access.c2cMode, groupMode: robot.access.groupMode,
      c2cAllow: robot.access.c2cAllow.join('\n'), groupAllow: robot.access.groupAllow.join('\n'),
    },
  };
}

function openIds(value: string): string[] {
  return [...new Set(value.split(/[\n,，]/).map(id => id.trim()).filter(Boolean))];
}

function accessPatch(draft: Draft, baseline?: Access): Partial<Access> {
  const patch: Partial<Access> = {};
  for (const key of ['groupMode', 'c2cMode'] as const) {
    if (draft[key] !== baseline?.[key]) patch[key] = draft[key];
  }
  for (const key of ['groupAllow', 'c2cAllow'] as const) {
    const ids = openIds(draft[key]);
    if (ids.length !== baseline?.[key].length || ids.some(id => !baseline[key].includes(id))) patch[key] = ids;
  }
  return patch;
}

function makePatch(editor: Editor): WorkbenchRobotPatch {
  const { draft } = editor;
  const baseline = editor.kind === 'edit' ? editor.baseline : undefined;
  const patch: WorkbenchRobotPatch = { appId: draft.appId.trim(), revision: baseline?.revision ?? null };
  const alias = draft.alias.trim();
  if (alias !== baseline?.alias) patch.alias = alias;
  if (!baseline?.primary) {
    const access = accessPatch(draft, baseline?.access);
    if (Object.keys(access).length > 0) patch.access = access;
    if (draft.appSecret.trim()) patch.appSecret = draft.appSecret.trim();
  }
  if (!baseline) patch.enabled = true;
  return patch;
}

function rebase(editor: Extract<Editor, { kind: 'edit' }>, latest: WorkbenchRobot): Editor {
  const next = editRobot(latest);
  const { draft } = next;
  const patch = makePatch(editor);
  if (patch.alias !== undefined) draft.alias = patch.alias;
  if (patch.appSecret !== undefined) draft.appSecret = patch.appSecret;
  for (const key of ['groupMode', 'c2cMode'] as const) {
    const mode = patch.access?.[key];
    if (mode !== undefined) draft[key] = mode;
  }
  for (const key of ['groupAllow', 'c2cAllow'] as const) {
    const edited = patch.access?.[key];
    if (edited === undefined) continue;
    const before = new Set(editor.baseline.access[key]);
    const removed = new Set([...before].filter(id => !edited.includes(id)));
    const added = edited.filter(id => !before.has(id));
    draft[key] = [...new Set([...latest.access[key].filter(id => !removed.has(id)), ...added])].join('\n');
  }
  return next;
}

function AccessField({ scope, mode, allow, disabled, onMode, onAllow }: {
  scope: 'c2c' | 'group'; mode: Mode; allow: string; disabled: boolean;
  onMode: (mode: Mode) => void; onAllow: (allow: string) => void;
}): ReactNode {
  const id = useId();
  const label = scope === 'group' ? '群聊接入' : '私聊接入';
  const listLabel = scope === 'group' ? '群 OpenID 白名单' : '用户 OpenID 白名单';
  return h('div', { className: 'imqr-access' },
    h('div', { className: 'imqr-header' },
      h('span', null, label),
      h(SegmentedControl<Mode>, { id, value: mode, options: MODE_OPTIONS, onChange: onMode, label, disabled })),
    mode === 'allowlist' ? h('label', { className: 'imqb-field imqr-field' },
      h('span', null, listLabel),
      h('textarea', {
        value: allow, disabled, spellCheck: false, rows: 3,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onAllow(event.currentTarget.value),
      }),
      h('span', { className: 'imqb-status-sub' }, '每行一个 OpenID，也可用逗号分隔。QQ 号和群号不能用于添加，空白名单拒绝所有消息。')) : null,
  );
}

export interface RobotAccountsProps {
  selectedAppId?: string;
  onSelect?: (appId: string) => void;
  onRobotsChange?: (robots: readonly WorkbenchRobot[]) => void;
}

export function RobotAccounts({ selectedAppId, onSelect, onRobotsChange }: RobotAccountsProps = {}): ReactNode {
  const [robots, setRobots] = useState<readonly WorkbenchRobot[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editError, setEditError] = useState('');
  const [rebased, setRebased] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const formId = useId();

  useEffect(() => () => { mutation.current?.abort(); mutation.current = null; }, []);
  useEffect(() => {
    if (robots !== null) onRobotsChange?.(robots);
  }, [robots, onRobotsChange]);

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

  const save = async (patch: WorkbenchRobotPatch, editing: boolean): Promise<void> => {
    if (mutation.current) return;
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
      if (controller.signal.aborted) return;
      setRobots(current => {
        const list = current ?? [];
        return list.some(item => item.appId === robot.appId)
          ? list.map(item => item.appId === robot.appId ? robot : item)
          : [...list, robot];
      });
      if (editing) setEditor(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      const conflict = error instanceof HttpError && error.status === 409;
      const message = conflict && patch.revision !== null
        ? '机器人配置已更新，请读取最新配置后再保存。'
        : error instanceof Error ? error.message : '无法保存机器人配置';
      if (editing) setEditError(message);
      else setActionError(message);
      if (conflict) setReload(value => value + 1);
    } finally {
      if (mutation.current === controller) {
        mutation.current = null;
        setBusy(false);
      }
    }
  };

  if (unavailable || (robots === null && !loadError)) return null;

  const startEdit = (next: Editor): void => {
    setEditor(next);
    setEditError('');
    setRebased(false);
  };
  const setField = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setEditor(current => current === null ? null : { ...current, draft: { ...current.draft, [key]: value } });
  };
  const current = editor?.kind === 'edit' ? robots?.find(robot => robot.appId === editor.baseline.appId) : undefined;
  const stale = editor?.kind === 'edit' && current !== undefined && current.revision !== editor.baseline.revision;
  const patch = editor === null ? undefined : makePatch(editor);
  const canSave = !busy && !stale && patch !== undefined && Object.keys(patch).length > 2;
  const input = (label: string, key: 'appId' | 'alias' | 'appSecret', props: Partial<React.ComponentProps<typeof Input>> = {}): ReactNode => (
    h('label', { className: 'imqb-field imqr-field' }, h('span', null, label), h(Input, {
      value: editor?.draft[key] ?? '', disabled: busy, onChange: event => setField(key, event.currentTarget.value), ...props,
    }))
  );

  return h('section', { className: 'imqb-card imqr-card', 'aria-label': '机器人账号' },
    h('style', null, STYLES),
    h('div', { className: 'imqr-header' },
      h('h2', { className: 'imqb-status-title' }, '机器人账号'),
      h(Button, {
        size: 'sm', variant: 'outline', type: 'button', icon: h(IconPlusOutlineRegular, { size: 16 }),
        disabled: busy || robots === null,
        onClick: () => startEdit({ kind: 'add', draft: { ...EMPTY_DRAFT } }),
      }, '添加机器人')),
    loadError ? h('p', { className: 'imqb-error', role: 'alert' }, loadError) : null,
    actionError ? h('p', { className: 'imqb-error', role: 'alert' }, actionError) : null,
    robots?.length === 0 ? h('p', { className: 'imqb-status-sub' }, '还没有机器人。可在下方扫码绑定主机器人，也可以手动添加账号。') : null,
    robots?.map(robot => {
      const name = accountName(robot);
      const label = h('span', { className: 'imqb-status-title imqr-name' }, name);
      return h('div', { className: 'imqr-row', key: robot.appId, 'data-selected': selectedAppId === robot.appId || undefined },
        h('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true },
          h('path', { d: QQ_BOT_LOGO_PATH })),
        h('div', { className: 'imqb-status-meta' },
          onSelect ? h('button', { className: 'imqr-select', type: 'button', onClick: () => onSelect(robot.appId), 'aria-pressed': selectedAppId === robot.appId }, label) : label,
          h('span', { className: 'imqb-status-sub' }, `AppID ${robot.appId} · ${STATE_LABELS[robot.state]}`)),
        h('div', { className: 'imqr-actions' },
          h(Button, { size: 'sm', variant: 'ghost', type: 'button', disabled: busy, onClick: () => startEdit(editRobot(robot)), 'aria-label': `设置${name}` }, '设置'),
          h(Switch, { checked: robot.enabled, label: `启用${name}`, disabled: busy, onChange: enabled => {
            void save({ appId: robot.appId, revision: robot.revision, enabled }, false);
          } })),
      );
    }),
    editor === null ? null : h(Modal, {
      open: true, closeLabel: '关闭', onClose: () => { if (!busy) setEditor(null); },
      title: editor.kind === 'add' ? '添加 QQ 机器人' : `设置${accountName(editor.baseline)}`,
      description: editor.kind === 'add'
        ? '保存后连接此机器人。私聊和群聊默认使用空白名单。'
        : editor.baseline.primary ? '主机器人的凭据和访问权限在原绑定设置中管理。' : '访问规则仅适用于此机器人。填写新的 AppSecret 后会重新连接。',
      className: 'imqr-modal',
      footer: h('div', { className: 'imqr-footer' },
        h(Button, { size: 'sm', variant: 'ghost', type: 'button', disabled: busy, onClick: () => setEditor(null) }, '取消'),
        h(Button, { size: 'sm', variant: 'primary', type: 'submit', form: formId, disabled: !canSave }, busy ? '保存中…' : '保存')),
    }, h('form', {
      id: formId, className: 'imqr-form', onSubmit: (event: FormEvent) => {
        event.preventDefault();
        if (canSave) void save(patch, true);
      },
    },
      editor.kind === 'add' ? input('AppID', 'appId', { required: true, autoComplete: 'off', spellCheck: false, maxLength: 128, pattern: '[A-Za-z0-9_\\-]+' }) : null,
      input('机器人名称', 'alias', { placeholder: '可选，便于区分机器人', autoComplete: 'off', maxLength: 120 }),
      editor.kind === 'edit' && editor.baseline.primary ? null : [
        h('div', { key: 'credential' }, input('AppSecret', 'appSecret', {
          type: 'password', autoComplete: 'new-password', required: editor.kind === 'add', maxLength: 512,
          placeholder: editor.kind === 'edit' ? '留空则继续使用已保存的凭据' : undefined,
        })),
        h(AccessField, { key: 'c2c', scope: 'c2c', mode: editor.draft.c2cMode, allow: editor.draft.c2cAllow, disabled: busy,
          onMode: value => setField('c2cMode', value), onAllow: value => setField('c2cAllow', value) }),
        h(AccessField, { key: 'group', scope: 'group', mode: editor.draft.groupMode, allow: editor.draft.groupAllow, disabled: busy,
          onMode: value => setField('groupMode', value), onAllow: value => setField('groupAllow', value) }),
      ],
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
    )),
  );
}

const STYLES = `
.imqr-card { padding: 12px 16px; margin-bottom: 20px; }
.imqr-header, .imqr-row { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; min-width: 0; }
.imqr-row { padding: 10px 0; border-top: 1px solid var(--dsw-alias-border-l2); margin-top: 8px; }
.imqr-row[data-selected] { background: var(--dsw-alias-bg-layer-2); }
.imqr-name { overflow-wrap: anywhere; }
.imqr-select { font: inherit; color: inherit; background: none; border: 0; padding: 2px 0; text-align: left; cursor: pointer; }
.imqr-actions, .imqr-footer { display: flex; align-items: center; gap: 8px; }
.imqr-footer { justify-content: flex-end; }
.imqr-modal { width: min(540px, 100%); max-height: 100%; overflow-y: auto; }
.imqr-form { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.imqr-access { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; font-size: 13px; }
.imqr-access .imqr-field { margin-top: 8px; }
.imqr-field textarea { box-sizing: border-box; width: 100%; resize: vertical; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); }
.imqr-field textarea:focus-visible, .imqr-select:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; }
`;

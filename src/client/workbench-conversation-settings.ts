import styles from './workbench.module.css';
import { t } from './qq-locale.ts';
import { createElement as h, Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { Button, IconEllipsisOutlineRegular, Menu, Modal, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { retentionDays, shortensRetention, type MessageRetention, type WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import type { WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import { WORKBENCH_GROUP_GUIDE_IMAGES, type WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { changes, mergeDraft, selectDraft, type Draft } from './workbench-state.ts';
import { accessLabel, peerName, workspaceName } from './workbench-labels.ts';
import { WorkbenchAgentFields, WorkbenchReplyFields, type AgentFormSource } from './workbench-agent-form.ts';
import { readDefaults } from './workbench-defaults.ts';
import { SettingsGroup } from './workbench-settings-group.ts';
import { QQSelect } from './qq-select.ts';

function GroupPermissionGuide(): ReactNode {
  const groupPermissionGuide = [
    {
      title: t("获取群内全部消息"),
      description: t("在「机器人可获取的群聊消息范围」中选择此项，工作台才能接收普通群消息。是否记录消息和是否仅在 @ 时回复由 DSH 设置决定。"),
      image: WORKBENCH_GROUP_GUIDE_IMAGES['message-scope.png'],
    },
    {
      title: t("机器人主动在群聊内发言"),
      description: t("开启后，工作台可在没有可用回复凭据时主动发言。网页回答的自动推送仍由机器人的主动推送配置决定。"),
      image: WORKBENCH_GROUP_GUIDE_IMAGES['proactive.png'],
    },
  ] as const;
  const [preview, setPreview] = useState<typeof groupPermissionGuide[number]>();
  return h(SettingsGroup, { title: t("QQ 群权限"), hint: t("在手机 QQ 设置"), children: h(Fragment, null,
    h('p', { className: 'imqw-muted' }, t("请群主在手机 QQ 的群聊中打开机器人的设置。")),
    groupPermissionGuide.map(item => h('div', { key: item.image },
      h('div', { className: 'imqw-group-guide-heading' },
        h('strong', null, item.title),
        h(Button, { type: 'button', size: 'sm', variant: 'ghost', 'aria-haspopup': 'dialog',
          'aria-label': t("看图：{0}", item.title), onClick: () => setPreview(item) }, t("看图"))),
      h('p', { className: 'imqw-muted' }, item.description))),
    preview ? h(Modal, {
      open: true, title: preview.title, closeLabel: t("关闭"), onClose: () => setPreview(undefined),
      className: styles.dialog + ' imqw-group-guide-dialog', contentClassName: 'imqw-group-guide-scroll',
    }, h('img', { className: 'imqw-group-guide-image', src: preview.image, alt: t("手机 QQ 设置截图：{0}", preview.title) })) : null,
  ) });
}

interface ConversationSettingsProps {
  robot: WorkbenchRobot;
  peer: WorkbenchConversation;
  agentSource?: AgentFormSource;
  closeButton: ReactNode;
  archived: boolean;
  workspace?: string;
  openCurrent?: () => void;
  draft: Draft;
  busy: boolean;
  feedback?: { message: string };
  onEdit: (draft: Draft) => void;
  onSave: (draft: Draft, confirmRetention?: true) => void;
  onClearRecords: () => void;
}

export function ConversationSettings({ robot, peer, agentSource, closeButton, archived, workspace, openCurrent, draft, busy, feedback, onEdit, onSave, onClearRecords }: ConversationSettingsProps): ReactNode {
  const retentionOptions = [
    { value: '7d', label: t("保留最近 7 天") }, { value: '30d', label: t("保留最近 30 天") },
    { value: 'forever', label: t("长期保留") }, { value: 'paused', label: t("暂停记录") },
  ] as const satisfies ReadonlyArray<{ value: MessageRetention; label: string }>;
  const [adoptError, setAdoptError] = useState('');
  const [reading, setReading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<'shorten' | 'clear'>();
  const edited = changes(draft);
  const dirty = Object.keys(edited).length > 0;
  const stale = dirty && (draft.baseline.revision !== peer.revision || draft.baseline.defaultsRevision !== peer.defaultsRevision);
  const current = peer.sessions.find(session => session.id === peer.currentSessionId);
  const agent = draft.agent;
  const disabled = busy || reading;
  const fields = agent ? {
    settings: agent, disabled,
    onChange: (patch: Partial<WorkbenchAgentSettings>) => onEdit({ ...draft, agent: { ...agent, ...patch } }),
  } : undefined;
  const adopt = async (): Promise<void> => {
    setReading(true);
    setAdoptError('');
    try {
      const { settings } = await readDefaults(robot.appId);
      if (!agent) return;
      onEdit({ ...draft, agent: {
        ...settings,
        ...(peer.scope === 'group' ? { directPrompt: agent.directPrompt, streaming: agent.streaming } : { groupPrompt: agent.groupPrompt }),
      } });
    } catch (error) {
      setAdoptError(error instanceof Error ? error.message : t("无法读取机器人默认设置。"));
    } finally {
      setReading(false);
    }
  };

  return h('form', { className: 'imqw-form', onSubmit: (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || stale || disabled || confirm) return;
    if (shortensRetention(draft.baseline.retention, draft.retention)) setConfirm('shorten');
    else onSave(draft);
  } },
    h('header', { className: 'imqw-column-head' },
      h('div', null, h('h2', null, t("会话设置")), h('p', { className: 'imqw-muted', title: peerName(peer) }, peerName(peer))),
      h('div', { className: 'imqw-actions' },
        agent ? h(Menu, {
          open: menuOpen, onClose: () => setMenuOpen(false), portal: true, autoFocus: true,
          items: [{ id: 'adopt-defaults', label: t("采用机器人当前默认值"), disabled }],
          onSelect: () => { setMenuOpen(false); if (!disabled) void adopt(); },
          anchor: h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled,
            'aria-label': t("更多会话设置"), 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
            onClick: () => setMenuOpen(open => !open),
          }, h(IconEllipsisOutlineRegular, { size: 16 })),
        }) : null,
        closeButton)),
    h(SettingsGroup, { title: t("概览与接收"), defaultOpen: true, children: h(Fragment, null,
      h('label', { className: 'imqw-field' },
        h('span', null, t("会话备注")),
        h(Input, {
          value: draft.alias, maxLength: 120, placeholder: peer.name || t("未设置备注"), disabled,
          onChange: event => onEdit({ ...draft, alias: event.currentTarget.value }),
        })),
      h('div', { className: 'imqw-receiving' },
        h('span', null, t("暂停此 QQ 会话")),
        h(Switch, {
          checked: !draft.receiving, label: t("暂停此 QQ 会话"), disabled,
          onChange: paused => onEdit({ ...draft, receiving: !paused }),
        })),
      h('p', { className: 'imqw-muted' }, t("暂停会话会停止收发和新建 Session。消息保留期可在消息记录里调整。")),
      peer.executionBlocked ? h('p', { className: 'imqb-error', role: 'alert' }, peer.executionBlocked) : null,
      !peer.admitted ? h('p', { className: 'imqw-muted' }, t("此对话未获机器人接入许可。")) : null,
      h('details', { className: 'imqw-settings-meta' },
        h('summary', null, t("对话详情")),
        h('dl', { className: 'imqw-details' },
          h('dt', null, t("接入规则")), h('dd', null, accessLabel(robot, peer)),
          h('dt', null, 'OpenID'), h('dd', null, h('code', null, peer.openId)),
        )),
    ) }),
    peer.scope === 'group' ? h(GroupPermissionGuide) : null,
    fields ? h(Fragment, null,
      h(SettingsGroup, { title: t("Agent 设置"), hint: t("当前与新建"), children:
        h(WorkbenchAgentFields, {
          ...fields, source: agentSource, conversationDefaults: true,
          currentSession: current ? {
            id: current.id, archived, open: openCurrent,
            placement: [workspace || workspaceName(current.cwd), current.preset].filter(Boolean).join(' · '),
          } : undefined,
        }),
      }),
      h(SettingsGroup, { title: t("QQ 回复"), hint: t("当前 Session 也适用"), children: h(WorkbenchReplyFields, { ...fields, source: agentSource, scope: peer.scope }) }),
    ) : null,
    h(SettingsGroup, { title: t("消息记录"), children: h('div', { className: 'imqw-agent-fields' },
      h('div', { className: 'imqw-field' },
        h('span', null, t("本机消息记录")),
        h(QQSelect, {
          label: t("本机消息记录"), value: draft.retention, options: retentionOptions, disabled,
          onChange: value => {
            const option = retentionOptions.find(item => item.value === value);
            if (option) onEdit({ ...draft, retention: option.value });
          },
        }),
        h('p', { className: 'imqw-muted' }, draft.retention === 'paused'
          ? t("保存后暂停记录新消息，保留已有记录。")
          : t("保留期限适用于此 QQ 对话的本机收发记录。"))),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled, className: 'imqb-danger',
        onClick: () => setConfirm('clear'),
      }, t("清空本会话记录")),
    ) }),
    confirm ? h(Modal, {
      open: true, title: confirm === 'clear' ? t("清空本会话记录？") : t("缩短消息保留期？"), closeLabel: t("关闭"),
      description: confirm === 'clear'
        ? t("将删除「{0}」的全部本机 QQ 消息记录。DSH Session 历史单独保留。", peerName(peer))
        : t("保存后将删除「{0}」超过 {1} 天的本机 QQ 消息记录。", peerName(peer), retentionDays(draft.retention)),
      onClose: () => setConfirm(undefined),
      footer: h(Fragment, null,
        h(Button, { type: 'button', variant: 'ghost', onClick: () => setConfirm(undefined) }, t("取消")),
        h(Button, { type: 'button', variant: 'outline', className: 'imqb-danger',
          disabled: disabled || (confirm === 'shorten' && stale),
          onClick: () => {
            setConfirm(undefined);
            if (confirm === 'clear') onClearRecords();
            else onSave(draft, true);
          },
        }, confirm === 'clear' ? t("确认清空") : t("确认缩短并保存"))),
    }) : null,
    reading ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取默认值…")) : null,
    adoptError ? h('p', { className: 'imqb-error', role: 'alert' }, adoptError) : null,
    stale ? h('div', { className: 'imqw-conflict' },
      h('p', { className: 'imqb-error', role: 'alert' }, t("会话设置已更新。请确认是否将草稿中的改动合并到最新设置。")),
      h(Button, {
        type: 'button', size: 'sm', variant: 'outline', disabled,
        onClick: () => onEdit(mergeDraft(peer, draft, edited)),
      }, t("合并草稿"))) : null,
    feedback ? h('p', { className: 'imqb-error', role: 'alert' }, feedback.message) : null,
    h('footer', { className: 'imqw-actions imqw-savebar' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: disabled || !dirty, onClick: () => onEdit(selectDraft(peer)) }, t("撤销修改")),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: disabled || !dirty || stale }, busy ? t("保存中…") : t("保存")),
    ),
  );
}

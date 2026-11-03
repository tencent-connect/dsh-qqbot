import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { ConversationView, DeliveryRecord } from '../shared/conversation-protocol.ts';
import type { RuntimeStateWire } from '../shared/runtime-protocol.ts';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { BindPanelBody, QQ_BOT_LOGO_PATH, useBindState } from './bind-page.ts';
import { type SelectorSource } from './host-selectors.ts';
import { QQConversationView } from './qq-conversation-view.ts';
export { QQConversationView } from './qq-conversation-view.ts';
import { QQOperationDialog } from './qq-operation-dialog.ts';
import { deliveryExplanation, deliverySummary, passiveReplyFeedback } from './delivery-feedback.ts';
import { QQSessionStore, useQQSessionStore, type QQAnswerPreview } from './qq-session-store.ts';
import { PairClaimPanel } from './qq-pairing.ts';
import { SlashCommandList } from './slash-command-list.ts';

const PHASE_LABELS: Record<RuntimeStateWire['phase'], string> = { unbound: '等待绑定', connecting: '正在连接', ready: '已连接', reconnecting: '正在重连', failed: '连接失败', stopped: '已停止' };
export function activityLabel(timestamp: number | null, now = Date.now()): string {
  if (timestamp === null || timestamp === 0) return '暂无活动';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
export interface ConversationPanelProps { onOpenSettings: () => void; store: QQSessionStore }

export function ConversationPanel({ onOpenSettings, store }: ConversationPanelProps): ReactNode {
  const bind = useBindState();
  const directory = useQQSessionStore(store);
  const entries = directory.directory?.conversations ?? [];
  const resumable = store.resumeTarget();
  return h('section', { className: 'imqc imqq-welcome', 'aria-label': 'QQ 会话' },
    h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: QQ_BOT_LOGO_PATH, fill: 'currentColor' })),
    h('div', { className: 'imqq-welcomeTitle' },
      h('h3', null, 'QQ 会话'),
      h('span', { className: 'imqc-state imqq-welcomeState', role: 'status' }, directory.runtime ? PHASE_LABELS[directory.runtime.phase] : '读取连接状态…')),
    h('p', { className: 'imqc-hint' }, entries.length ? '在左侧选择群聊或联系人，继续当前会话或查看历史。' : '收到 QQ 消息后，群聊和联系人会出现在左侧。可先管理账号和授权范围。'),
    h('p', { className: 'imqc-hint' }, '会话使用原生聊天页的输入框、模型和权限控件。选择目录中的对话不会自动创建任务。'),
    bind.state?.phase !== 'bound' ? h(BindPanelBody, bind) : null,
    directory.error ? h('p', { className: 'imqc-error', role: 'alert' }, directory.error) : null,
    h('div', { className: 'imqq-welcomeActions' },
      resumable ? h(Button, { variant: 'outline', size: 'sm', onClick: () => store.openSession(resumable.sessionId) }, `继续与「${resumable.name}」的会话`) : null,
      h(Button, { variant: 'outline', size: 'sm', onClick: onOpenSettings }, '账号设置')),
    resumable ? h('p', { className: 'imqc-hint' }, `「继续」会打开最近活跃对话「${resumable.name}」的当前会话；要开新会话，请在左侧该对话的「＋」或菜单里新建。`) : null);
}

export function QQAccountOwners({ store, t, bound = true }: { store: QQSessionStore; t?: import('./qq-locale.ts').QQTranslate; bound?: boolean }): ReactNode {
  const title = t ? t('owners.title') : '斜杠命令超管';
  const commands = useQQSessionStore(store).directory?.commands ?? [];
  return h('section', { className: 'imqc', 'aria-label': title },
    h(PairClaimPanel, { purpose: 'owner', title, enabled: bound,
      description: t ? t('owners.hint') : '所有 QQ 斜杠命令仅限此名单中的全局超管使用，名单对所有已启用且获准接入的 QQ 对话生效。不开放额外工具，不绕过执行权限。审批和提问按钮仍按原权限处理；DSH 网页斜杠命令不受此名单限制。',
      hint: '点「添加…」生成一次性配对码，然后在 QQ 里直接给机器人发送这个码；对方点「确认」后即可加入。' }),
    commands.length > 0 ? h(SlashCommandList, { commands }) : null);
}

function errorMessage(cause: unknown): string { return cause instanceof Error ? cause.message : '操作失败'; }
function usePassiveReplyFeedback(passiveReply: ConversationView['passiveReply']): ReturnType<typeof passiveReplyFeedback> {
  const [now, setNow] = useState(Date.now);
  const expiresAt = passiveReply?.expiresAt;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (): void => {
      const current = Date.now();
      setNow(current);
      if (expiresAt !== undefined && expiresAt !== null && expiresAt > current) timer = setTimeout(update, Math.min(1000, expiresAt - current));
    };
    update();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [expiresAt]);
  return passiveReplyFeedback(passiveReply, now);
}
export function QQConversationOverlay({ store, selectorSource, t, useWorkspaces, useSessions, defaultWorkspaceName }: { store: QQSessionStore; selectorSource: SelectorSource; t: import('./qq-locale.ts').QQTranslate; defaultWorkspaceName: string; useWorkspaces: PropsRuntime<'shell.overlay'>['useWorkspaces']; useSessions?: PropsRuntime<'shell.overlay'>['useSessions'] }): ReactNode {
  const state = useQQSessionStore(store);
  const workspaces = useWorkspaces((snapshot) => snapshot.items);
  const overlay = state.overlay;
  if (overlay?.kind === 'drawer') {
    const target = overlay.target;
    const entry = store.conversation(target.key);
    return h(Modal, { key: `${target.key}/${target.sessionId}`, title: `${target.name} · QQ 设置`, open: true, closeLabel: '关闭', className: 'imqq-settingsModal', contentClassName: 'imqq-settingsContent', onClose: store.closeDrawer,
      children: entry ? h(QQConversationView, { sessionId: target.sessionId, conversationKey: target.key, initialTab: target.tab, store, selectorSource, t, useSessions, useWorkspaces, defaultWorkspaceName }) : h('p', { role: 'alert' }, '此 QQ 对话已不可用，请刷新目录。') });
  }
  if (overlay?.kind === 'operation') return h(QQOperationDialog, { key: `${overlay.target.kind}/${overlay.target.key}`, target: overlay.target, store, selectorSource, workspaces, defaultWorkspaceName });
  if (overlay?.kind === 'answer') return h(Modal, { key: overlay.preview.operationId, title: `发送到 ${overlay.preview.name}`, open: true, closeLabel: '关闭', className: 'imqq-answerPreview', onClose: store.closePreview, children: h(AnswerPreview, { preview: overlay.preview, store }) });
  return null;
}

function AnswerPreview({ preview, store }: { preview: QQAnswerPreview; store: QQSessionStore }): ReactNode {
  useQQSessionStore(store);
  const replyFeedback = usePassiveReplyFeedback(store.conversation(preview.key)?.passiveReply);
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
  const [attempted, setAttempted] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const valid = store.canSend(preview);
  return h('div', null, h('p', { className: 'imqc-hint' }, `目标 ${preview.name} · 会话 ${preview.sessionId.slice(-8)}`), h('p', { className: 'imqc-hint' }, replyFeedback.summary), h('p', { className: 'imqc-hint' }, '仅发送以下最终回答。'), h('pre', { className: 'imqc-messageText' }, preview.text),
    !valid ? h('p', { role: 'alert', className: 'imqc-error' }, '此对话的授权或当前会话已变化，请关闭预览并重新选择回答。') : null,
    error ? h('p', { role: 'alert', className: 'imqc-error' }, error) : null,
    delivery ? h('div', { role: 'status' }, h('p', null, deliverySummary(delivery)), h('p', { className: 'imqc-hint' }, deliveryExplanation(delivery)), delivery.error ? h('p', { className: 'imqc-error' }, delivery.error) : null) : null,
    h(Button, { variant: 'primary', size: 'sm', disabled: busy || !valid || attempted, onClick: () => {
      if (!store.canSend(preview) || pending.current || attempted) return;
      pending.current = true; setAttempted(true); setBusy(true); setError(null);
      void store.sendAnswer(preview).then((result) => { if (result.delivery) setDelivery(result.delivery); else setError('未确认发送结果，请查看发送记录。'); }).catch((cause: unknown) => setError(`发送结果未确认：${errorMessage(cause)}。请查看发送记录并核对 QQ，本次操作不会重发。`)).finally(() => { pending.current = false; setBusy(false); });
    } }, busy ? '提交中…' : attempted ? '本次发送已提交' : replyFeedback.sendLabel));
}

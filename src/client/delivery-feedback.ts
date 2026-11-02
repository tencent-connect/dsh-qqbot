import type { ConversationView, DeliveryRecord } from '../shared/conversation-protocol.ts';

const DELIVERY_LABELS: Record<DeliveryRecord['state'], string> = { pending: '待发送', sending: '发送中', accepted: 'QQ 接口已接受', failed: '本次发送已结束：失败', unknown: '本次发送已结束：结果未知' };

export function passiveReplyFeedback(passiveReply: ConversationView['passiveReply'], now: number): { summary: string; sendLabel: string } {
  if (passiveReply === undefined) return { summary: '被动回复窗口状态未知，当前目录未提供时限；发送时由 QQ 平台判定。', sendLabel: '确认发送到 QQ' };
  const sendLabel = '尝试主动发送到 QQ';
  if (passiveReply.expiresAt === null) return { sendLabel, summary: '暂无可用的被动回复来源，本次将尝试主动发送，是否允许取决于机器人权限。' };
  const deadline = new Date(passiveReply.expiresAt).toLocaleString();
  if (passiveReply.expiresAt <= now) return { sendLabel, summary: `被动回复窗口已过期（截止 ${deadline}）；本次将尝试主动发送，是否允许取决于机器人权限。` };
  const seconds = Math.ceil((passiveReply.expiresAt - now) / 1000);
  return { summary: `被动回复窗口剩余 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒（截止 ${deadline}）。发送仍以 QQ 平台返回结果为准。`, sendLabel: '确认发送到 QQ' };
}

export function deliverySummary(delivery: DeliveryRecord): string {
  const accepted = delivery.parts.filter((part) => part.state === 'accepted').length;
  return `${DELIVERY_LABELS[delivery.state]} · QQ 接口接受 ${accepted}/${delivery.parts.length || '未知'} 段`;
}

export function deliveryExplanation(delivery: DeliveryRecord): string {
  if (delivery.state === 'unknown') return '部分分段可能已经发送，请先核对 QQ。本次操作已结束，不会自动重发；关闭后可重新选择回答发起新的发送。';
  if (delivery.state === 'failed') {
    const accepted = delivery.parts.filter((part) => part.state === 'accepted').length;
    const failure = accepted > 0
      ? `已有 ${accepted} 段获 QQ 接口接受，后续分段发送失败。接口接受不代表消息已送达或已读，请先核对 QQ。`
      : '本次发送失败，没有分段获 QQ 接口接受。';
    return `${failure}本次操作已结束，不会自动重发；关闭后可重新选择回答发起新的发送。`;
  }
  return '接口接受不代表消息已送达或已读。';
}

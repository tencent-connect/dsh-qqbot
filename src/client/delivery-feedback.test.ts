import { describe, expect, it } from 'vitest';
import type { DeliveryRecord } from '../shared/conversation-protocol.ts';
import { deliveryExplanation, deliverySummary, passiveReplyFeedback } from './delivery-feedback.ts';

function record(state: DeliveryRecord['state'], parts: DeliveryRecord['parts']): DeliveryRecord {
  return { id: 'delivery', key: 'group', text: 'answer', at: 1, updatedAt: 2, state, parts };
}
describe('QQ delivery feedback', () => {
  it('shows the remaining passive reply time and deadline without promising delivery', () => {
    const expiresAt = 300_000;
    const feedback = passiveReplyFeedback({ expiresAt }, 1);
    expect(feedback.summary).toContain('剩余 5 分 0 秒');
    expect(feedback.summary).toContain(new Date(expiresAt).toLocaleString());
    expect(feedback.summary).toContain('以 QQ 平台返回结果为准');
    expect(feedback.sendLabel).toBe('确认发送到 QQ');
  });
  it('switches to an explicit active-send attempt at the passive reply deadline', () => {
    const feedback = passiveReplyFeedback({ expiresAt: 1000 }, 1000);
    expect(feedback.summary).toContain('被动回复窗口已过期');
    expect(feedback.summary).toContain('是否允许取决于机器人权限');
    expect(feedback.sendLabel).toBe('尝试主动发送到 QQ');
  });
  it('distinguishes a missing source from a legacy snapshot without window information', () => {
    const missing = passiveReplyFeedback({ expiresAt: null }, 1000);
    expect(missing.summary).toContain('暂无可用的被动回复来源');
    expect(missing.summary).toContain('是否允许取决于机器人权限');
    expect(missing.sendLabel).toBe('尝试主动发送到 QQ');
    const legacy = passiveReplyFeedback(undefined, 1000);
    expect(legacy.summary).toContain('窗口状态未知');
    expect(legacy.summary).not.toContain('已过期');
    expect(legacy.sendLabel).toBe('确认发送到 QQ');
  });
  it('counts accepted segments explicitly when a later segment fails', () => {
    const delivery = record('failed', [{ index: 0, state: 'accepted' }, { index: 1, state: 'failed' }, { index: 2, state: 'pending' }]);
    expect(deliverySummary(delivery)).toContain('QQ 接口接受 1/3 段');
    expect(deliveryExplanation(delivery)).toContain('已有 1 段获 QQ 接口接受，后续分段发送失败');
    expect(deliveryExplanation(delivery)).toContain('接口接受不代表消息已送达或已读');
    expect(deliveryExplanation(delivery)).toContain('不会自动重发');
    expect(deliveryExplanation(delivery)).not.toContain('部分分段可能已经发送');
  });
  it('reports a definitive rejection with no accepted segments without an unknown-result warning', () => {
    const delivery = record('failed', [{ index: 0, state: 'failed' }]);
    expect(deliveryExplanation(delivery)).toContain('本次发送失败，没有分段获 QQ 接口接受');
    expect(deliveryExplanation(delivery)).toContain('不会自动重发');
    expect(deliveryExplanation(delivery)).not.toContain('可能已经发送');
  });
  it('keeps an unknown-result warning with or without confirmed accepted segments', () => {
    for (const parts of [[], [{ index: 0, state: 'accepted' }, { index: 1, state: 'unknown' }]] satisfies DeliveryRecord['parts'][]) {
      const explanation = deliveryExplanation(record('unknown', parts));
      expect(explanation).toContain('部分分段可能已经发送，请先核对 QQ');
      expect(explanation).toContain('不会自动重发');
      expect(explanation).not.toContain('没有分段获 QQ 接口接受');
    }
  });
  it('does not describe acceptance as delivery or reading', () => {
    const delivery = record('accepted', [{ index: 0, state: 'accepted' }]);
    expect(deliverySummary(delivery)).toContain('QQ 接口接受 1/1 段');
    expect(deliveryExplanation(delivery)).toBe('接口接受不代表消息已送达或已读。');
  });
  it('does not turn a missing segment count into a known total of zero', () => {
    expect(deliverySummary(record('unknown', []))).toContain('0/未知 段');
  });
});

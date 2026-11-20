import { describe, it, expect } from 'vitest';
import { SessionArchivedError, classifySessionError } from './errors.ts';

describe('classifySessionError', () => {
  it('类型实例 → session-archived', () => {
    expect(classifySessionError(new SessionArchivedError('session-1'))).toBe('session-archived');
  });

  it('duck-typing 兜底：挂 code 的普通 Error 也认（热重载后跨模块实例）', () => {
    // 插件热重载时旧实例抛出的错误对新实例 instanceof 不成立，
    // 分类必须还能按 code 字段认出来，否则恢复路径会静默失配。
    const legacy = Object.assign(new Error('archived'), { code: 'session-archived' });
    expect(classifySessionError(legacy)).toBe('session-archived');
  });

  it('其余一律 other，不做猜测', () => {
    expect(classifySessionError(new Error('EIO'))).toBe('other');
    expect(classifySessionError(Object.assign(new Error('x'), { code: 'other-code' }))).toBe('other');
    expect(classifySessionError(undefined)).toBe('other');
    expect(classifySessionError('string error')).toBe('other');
  });

  it('错误实例自带 code 属性，旧式比对仍可工作（过渡期兼容）', () => {
    expect(new SessionArchivedError('session-1').code).toBe('session-archived');
    expect(new SessionArchivedError('session-1').sessionId).toBe('session-1');
  });
});

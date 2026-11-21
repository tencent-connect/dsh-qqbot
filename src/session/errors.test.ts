import { describe, it, expect } from 'vitest';
import { SessionArchivedError, SessionBusyError, classifySessionError, isSessionOwnedError } from './errors.ts';

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

  it('写句柄占用 → session-busy', () => {
    expect(classifySessionError(new SessionBusyError('session-1'))).toBe('session-busy');
    expect(classifySessionError(Object.assign(new Error('busy'), { code: 'session-busy' }))).toBe('session-busy');
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

describe('isSessionOwnedError', () => {
  it('按 name 识别宿主 SessionAlreadyOwnedError', () => {
    const err = Object.assign(new Error('opaque'), { name: 'SessionAlreadyOwnedError' });
    expect(isSessionOwnedError(err)).toBe(true);
  });

  it('按 message 识别（name 被中间层包装/丢失时）', () => {
    expect(isSessionOwnedError(new Error('session "s1" is already owned by an active write handle'))).toBe(true);
  });

  it('其他错误一律 false', () => {
    expect(isSessionOwnedError(new Error('session "s1" not found'))).toBe(false);
    expect(isSessionOwnedError(new Error('EIO'))).toBe(false);
    expect(isSessionOwnedError(undefined)).toBe(false);
  });
});

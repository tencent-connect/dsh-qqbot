import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './config.ts';

describe('ConfigSchema 默认值（内层外层默认必须对齐：#94-1 不变量）', () => {
  it('完全省略 access → c2cMode open（子 schema 默认生效）', () => {
    const cfg = ConfigSchema({});
    expect(cfg.access.c2cMode).toBe('open');
    expect(cfg.access.groupMode).toBe('open');
  });

  it('access: {} → 子字段默认填充 open', () => {
    const cfg = ConfigSchema({ access: {} });
    expect(cfg.access.c2cMode).toBe('open');
  });

  it('access 空值（YAML access: 后无内容）→ open', () => {
    const cfg = ConfigSchema({ access: null });
    expect(cfg.access.c2cMode).toBe('open');
  });

  it('显式配置不受默认影响', () => {
    const cfg = ConfigSchema({ access: { c2cMode: 'allowlist' } });
    expect(cfg.access.c2cMode).toBe('allowlist');
  });

  it('闲置会话默认 30 分钟回收', () => {
    const cfg = ConfigSchema({});
    expect(cfg.sessionIdleTimeout).toBe(30 * 60 * 1000);
  });

  it.each([
    [{}, 'c2c'],
    [{ proactiveDelivery: {} }, 'c2c'],
    [{ proactiveDelivery: null }, 'c2c'],
    [{ proactiveDelivery: { externalTurns: 'off' } }, 'off'],
    [{ proactiveDelivery: { externalTurns: 'all' } }, 'all'],
  ])('proactiveDelivery.externalTurns：%j → %s', (input, expected) => {
    expect(ConfigSchema(input).proactiveDelivery.externalTurns).toBe(expected);
  });
});

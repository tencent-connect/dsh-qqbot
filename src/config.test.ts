import { describe, it, expect } from 'vitest';
import { ConfigSchema } from './config.ts';

describe('ConfigSchema 默认值（#94-1：省略 access 不得回落 open）', () => {
  it('完全省略 access → c2cMode allowlist（子 schema 默认生效）', () => {
    const cfg = ConfigSchema({});
    expect(cfg.access.c2cMode).toBe('allowlist');
    expect(cfg.access.groupMode).toBe('open');
  });

  it('access: {} → 子字段默认填充 allowlist', () => {
    const cfg = ConfigSchema({ access: {} });
    expect(cfg.access.c2cMode).toBe('allowlist');
  });

  it('access 空值（YAML access: 后无内容）→ allowlist', () => {
    const cfg = ConfigSchema({ access: null });
    expect(cfg.access.c2cMode).toBe('allowlist');
  });

  it('显式配置不受默认影响', () => {
    const cfg = ConfigSchema({ access: { c2cMode: 'open' } });
    expect(cfg.access.c2cMode).toBe('open');
  });
});

describe('ConfigSchema: segmentedReply（分条发送）', () => {
  it('省略 → 默认关闭，参数取 AstrBot 线上口径', () => {
    const cfg = ConfigSchema({});
    expect(cfg.segmentedReply.enable).toBe(false);
    expect(cfg.segmentedReply.onlyLlmResult).toBe(true);
    expect(cfg.segmentedReply.splitMode).toBe('regex');
    expect(cfg.segmentedReply.intervalMin).toBe(2.5);
    expect(cfg.segmentedReply.intervalMax).toBe(5);
    expect(cfg.segmentedReply.wordsCountThreshold).toBe(150);
    expect(cfg.segmentedReply.forwardThreshold).toBe(1500);
    expect(cfg.segmentedReply.maxBubbles).toBe(3);
  });

  it('默认正则同时含标点与换行分支（删掉换行分支「一句一行」即失效）', () => {
    const { regex } = ConfigSchema({}).segmentedReply;
    expect(regex).toContain('\\n+');
    expect(regex).toContain('。');
  });

  it('部分配置：缺省字段补默认，显式值不被覆盖', () => {
    const cfg = ConfigSchema({ segmentedReply: { enable: true, intervalMin: 3.5 } });
    expect(cfg.segmentedReply.enable).toBe(true);
    expect(cfg.segmentedReply.intervalMin).toBe(3.5);
    expect(cfg.segmentedReply.intervalMax).toBe(5);
    expect(cfg.segmentedReply.splitMode).toBe('regex');
  });

  it('非法枚举值被拒绝（设置面板与配置路由的校验依赖）', () => {
    expect(() => ConfigSchema({ segmentedReply: { splitMode: 'bogus' } as never })).toThrow();
  });
});


import { describe, it, expect } from 'vitest';
import { ConfigSchema, resolveBotIdentities, type ImQQBotConfig } from './config.ts';

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

const cfg = (input: Record<string, unknown>): ImQQBotConfig => ConfigSchema(input) as ImQQBotConfig;

describe('ConfigSchema bots[]（多 bot 列表）', () => {
  it('缺省 → 空数组（未配置 bots[] 时不进入多 bot 路径）', () => {
    expect(cfg({}).bots).toEqual([]);
  });

  it('合法条目原样保留（含 appId/appSecret 与顶层字段并存）', () => {
    const c = cfg({
      appId: '1001',
      appSecret: 's1',
      bots: [{ appId: '1002', appSecret: 's2' }, { appId: '1003', appSecret: 's3' }],
    });
    expect(c.bots).toEqual([
      { appId: '1002', appSecret: 's2' },
      { appId: '1003', appSecret: 's3' },
    ]);
  });

  it('缺 appSecret 的条目 → 校验失败（不会产出半凭据 bot）', () => {
    expect(() => ConfigSchema({ bots: [{ appId: '1002' }] })).toThrow();
  });

  it('缺 appId 的条目 → 校验失败', () => {
    expect(() => ConfigSchema({ bots: [{ appSecret: 's2' }] })).toThrow();
  });

  it('appId 类型不符 → 校验失败', () => {
    expect(() => ConfigSchema({ bots: [{ appId: 1002, appSecret: 's2' }] })).toThrow();
  });

  it('条目不是对象 → 校验失败', () => {
    expect(() => ConfigSchema({ bots: ['not-a-bot'] })).toThrow();
  });
});

describe('resolveBotIdentities（配置面 → 生效 bot 列表）', () => {
  it('都没配 → 空数组（入口据此报错并退出）', () => {
    expect(resolveBotIdentities(cfg({}))).toEqual([]);
  });

  it('仅 legacy 单字段 → 单条目（历史路径）', () => {
    expect(resolveBotIdentities(cfg({ appId: '1001', appSecret: 's1' })))
      .toEqual([{ appId: '1001', appSecret: 's1' }]);
  });

  it('仅 bots[] → 全部条目', () => {
    const c = cfg({ bots: [{ appId: '1002', appSecret: 's2' }, { appId: '1003', appSecret: 's3' }] });
    expect(resolveBotIdentities(c).map((b) => b.appId)).toEqual(['1002', '1003']);
  });

  it('legacy + bots[] 并存 → legacy 在前，按 appId 去重（同 appId 以 legacy 凭据为准）', () => {
    const c = cfg({
      appId: '1001',
      appSecret: 'legacy-secret',
      bots: [
        { appId: '1001', appSecret: 'dup-secret' },
        { appId: '1002', appSecret: 's2' },
        { appId: '1002', appSecret: 's2-again' },
      ],
    });
    expect(resolveBotIdentities(c)).toEqual([
      { appId: '1001', appSecret: 'legacy-secret' },
      { appId: '1002', appSecret: 's2' },
    ]);
  });

  it('凭据不全的条目被丢弃（env 兜底也缺时不会启动半截实例）', () => {
    const c = { ...cfg({ appId: '1001', appSecret: 's1' }) };
    c.bots = [{ appId: '1002', appSecret: '' }, { appId: '', appSecret: 's3' }];
    expect(resolveBotIdentities(c)).toEqual([{ appId: '1001', appSecret: 's1' }]);
  });
});

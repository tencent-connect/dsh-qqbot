/**
 * /switch 支撑逻辑单测：
 * - SessionManager.switchSession / listSwitchTargets / currentBoundSessionId
 * - switchCommand 的参数解析（序号 / 前缀 / 歧义 / default）
 *
 * ModelResolver 被 mock 为内存 Map，测试不触碰真实 prefs 文件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { DshAgentRegistry, DshAgent, SessionRecord, SwitchTarget } from './types.ts';

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock('../model/model-resolver.ts', () => ({
  ModelResolver: class {
    getSessionId(key: string) {
      return prefs.get(key);
    }
    setSessionId(key: string, id: string) {
      prefs.set(key, id);
    }
    clearSessionId(key: string) {
      prefs.delete(key);
    }
  },
}));

import { SessionManager } from './session-manager.ts';

const APP_ID = '9000000001';
const SESSION_KEY = `qqbot:${APP_ID}:c2c:peer-a`;

/** 与 SessionManager.deriveSessionId 一致的确定性派生（测试期望值独立推导） */
function derived(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

interface PersistenceCalls {
  listCalls: number;
}

function makeManager(
  persistence:
    | {
        list: () => Promise<Array<{ id: string; cwd?: string; createdAt?: number; origin?: string }>>;
        load: (id: string) => Promise<{ meta?: { id?: string } }>;
      }
    | undefined,
): { manager: SessionManager; calls: PersistenceCalls } {
  const calls: PersistenceCalls = { listCalls: 0 };
  const services = new Map<string, unknown>();
  if (persistence) {
    services.set('sessionPersistence', {
      list: async () => {
        calls.listCalls += 1;
        return persistence.list();
      },
      load: (id: string) => persistence.load(id),
    });
  }
  const ctx = {
    get: (name: string) => {
      const svc = services.get(name);
      if (svc) return svc;
      throw new Error(`no service: ${name}`);
    },
    on: () => {},
  } as unknown as Context;
  const agents = { get: () => undefined } as unknown as DshAgentRegistry;
  const config = {
    appId: APP_ID,
    sessionIdleTimeout: 0,
    textChunkLimit: 4000,
  } as unknown as ImQQBotConfig;
  const logger = { info: () => {}, warn: () => {}, debug: () => {} };
  return { manager: new SessionManager(ctx, agents, config, logger as never), calls };
}

function idleRecord(): SessionRecord {
  return {
    sessionKey: SESSION_KEY,
    sessionId: 'session-old',
    agent: { status: 'idle', cancel: vi.fn() } as unknown as DshAgent,
    handle: { dispose: vi.fn(async () => {}) } as unknown as SessionRecord['handle'],
    lastActivity: Date.now(),
  } as SessionRecord;
}

function injectRecord(manager: SessionManager, record: SessionRecord): void {
  (manager as unknown as { sessions: Map<string, SessionRecord> }).sessions.set(record.sessionKey, record);
}

const KNOWN = [
  { id: 'session-bbbb', cwd: 'D:\\work\\beta', createdAt: 200 },
  { id: 'session-aaaa', cwd: 'D:\\work\\alpha', createdAt: 100 },
  { id: 'session-cccc', cwd: 'D:\\work\\gamma', createdAt: 300 },
  { id: 'session-dddd', cwd: 'D:\\sub\\x', createdAt: 400, origin: 'subagent' as const },
];

function makePersistence() {
  return {
    list: async () => KNOWN,
    load: async (id: string) => (KNOWN.some((h) => h.id === id) ? { meta: { id } } : Promise.reject(new Error('missing'))),
  };
}

beforeEach(() => {
  prefs.clear();
});

describe('currentBoundSessionId', () => {
  it('无覆盖时回落到确定性哈希派生', () => {
    const { manager } = makeManager(makePersistence());
    expect(manager.currentBoundSessionId('c2c', 'peer-a')).toBe(derived(SESSION_KEY));
  });

  it('有 per-peer 覆盖时优先返回覆盖值', () => {
    const { manager } = makeManager(makePersistence());
    prefs.set(SESSION_KEY, 'session-aaaa');
    expect(manager.currentBoundSessionId('c2c', 'peer-a')).toBe('session-aaaa');
  });
});

describe('listSwitchTargets', () => {
  it('过滤 subagent 并按 createdAt 倒序', async () => {
    const { manager } = makeManager(makePersistence());
    const targets = await manager.listSwitchTargets();
    expect(targets.map((t) => t.sessionId)).toEqual(['session-cccc', 'session-bbbb', 'session-aaaa']);
    expect(targets[0]!.cwd).toBe('D:\\work\\gamma');
  });

  it('服务不可用时优雅降级为空数组', async () => {
    const { manager, calls } = makeManager(undefined);
    await expect(manager.listSwitchTargets()).resolves.toEqual([]);
    expect(calls.listCalls).toBe(0);
  });
});

describe('switchSession', () => {
  it('切换到存在的持久化会话并写入覆盖绑定', async () => {
    const { manager } = makeManager(makePersistence());
    const before = derived(SESSION_KEY);
    const result = await manager.switchSession('c2c', 'peer-a', 'session-bbbb');
    expect(result).toEqual({ ok: true, previous: before, target: 'session-bbbb' });
    expect(prefs.get(SESSION_KEY)).toBe('session-bbbb');
    expect(manager.currentBoundSessionId('c2c', 'peer-a')).toBe('session-bbbb');
  });

  it('拒绝不存在的目标且不写绑定', async () => {
    const { manager } = makeManager(makePersistence());
    const result = await manager.switchSession('c2c', 'peer-a', 'session-nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-found');
    expect(prefs.has(SESSION_KEY)).toBe(false);
  });

  it('目标与当前一致时 unchanged 且不重复回收', async () => {
    const { manager } = makeManager(makePersistence());
    const result = await manager.switchSession('c2c', 'peer-a', derived(SESSION_KEY));
    expect(result.ok && result.unchanged).toBe(true);
  });

  it('回收旧的活跃记录（cancel + dispose）', async () => {
    const { manager } = makeManager(makePersistence());
    const record = idleRecord();
    injectRecord(manager, record);
    const result = await manager.switchSession('c2c', 'peer-a', 'session-bbbb');
    expect(result.ok).toBe(true);
    expect(record.agent.cancel).toHaveBeenCalledWith({ kind: 'user' });
    expect(record.handle.dispose).toHaveBeenCalled();
    expect(manager.getSessionRecord('c2c', 'peer-a')).toBeUndefined();
  });

  it('当前会话生成中时拒绝切换', async () => {
    const { manager } = makeManager(makePersistence());
    const record = idleRecord();
    (record.agent as unknown as { status: string }).status = 'running';
    injectRecord(manager, record);
    const result = await manager.switchSession('c2c', 'peer-a', 'session-bbbb');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('busy');
    expect(prefs.has(SESSION_KEY)).toBe(false);
  });

  it('无目标参数时清除覆盖回到派生路由', async () => {
    const { manager } = makeManager(makePersistence());
    prefs.set(SESSION_KEY, 'session-aaaa');
    const result = await manager.switchSession('c2c', 'peer-a');
    expect(result.ok && result.target).toBe(derived(SESSION_KEY));
    expect(prefs.has(SESSION_KEY)).toBe(false);
  });
});

// ── 命令层：参数解析与输出 ──

import { switchCommand } from '../commands/session.ts';
import type { CommandDeps } from '../commands/types.ts';

function makeCmdCtx(raw: string) {
  const sent: string[] = [];
  const cmdCtx = {
    message: { kind: 'c2c', senderId: 'peer-a' },
    command: { name: 'switch', args: raw ? raw.split(/\s+/) : [], raw },
    bot: { sendMarkdown: (_t: unknown, content: string) => sent.push(content) },
    replyTarget: {},
  } as unknown as SlashCommandHandlerContext;
  return { cmdCtx, sent };
}

function makeDeps(overrides: Partial<SessionManager> = {}): CommandDeps {
  const manager = {
    currentBoundSessionId: () => derived(SESSION_KEY),
    listSwitchTargets: async (): Promise<SwitchTarget[]> =>
      KNOWN.filter((h) => h.origin !== 'subagent')
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((h) => ({ sessionId: h.id, cwd: h.cwd, createdAt: h.createdAt })),
    switchSession: vi.fn(async (_scope: 'c2c' | 'group', _peer: string, target?: string) =>
      target === 'session-nope'
        ? ({ ok: false, reason: 'not-found', message: '目标不存在' } as const)
        : ({ ok: true, previous: 'prev-id', target: target ?? derived(SESSION_KEY) } as const),
    ),
    ...overrides,
  } as unknown as SessionManager;
  return { manager, config: { textChunkLimit: 4000 } as unknown as ImQQBotConfig };
}

describe('switchCommand', () => {
  it('无参数时发送可点击列表并包含当前桥接', async () => {
    const { cmdCtx, sent } = makeCmdCtx('');
    const cmd = switchCommand(makeDeps());
    const result = await cmd.handler(cmdCtx);
    expect(result).toEqual({ kind: 'noop' });
    const text = sent.join('\n');
    expect(text).toContain('会话桥接切换');
    expect(text).toContain('/switch session-cccc');
    expect(text).toContain('#1');
  });

  it('序号选择调用 switchSession 并报告成功', async () => {
    const { cmdCtx } = makeCmdCtx('2');
    const deps = makeDeps();
    const result = await switchCommand(deps).handler(cmdCtx);
    expect(deps.manager.switchSession).toHaveBeenCalledWith('c2c', 'peer-a', 'session-bbbb');
    expect(String(result)).toContain('已切换到 bbbb');
  });

  it('id 前缀唯一命中生效', async () => {
    const { cmdCtx } = makeCmdCtx('session-aaa');
    const deps = makeDeps();
    await switchCommand(deps).handler(cmdCtx);
    expect(deps.manager.switchSession).toHaveBeenCalledWith('c2c', 'peer-a', 'session-aaaa');
  });

  it('歧义前缀返回候选而不切换', async () => {
    const { cmdCtx } = makeCmdCtx('session-');
    const deps = makeDeps();
    const result = await switchCommand(deps).handler(cmdCtx);
    expect(String(result)).toContain('匹配到 3 个会话');
    expect(deps.manager.switchSession).not.toHaveBeenCalled();
  });

  it('列表外的完整 id 透传给 manager 校验并报告失败', async () => {
    const { cmdCtx } = makeCmdCtx('session-nope');
    const deps = makeDeps();
    const result = await switchCommand(deps).handler(cmdCtx);
    expect(deps.manager.switchSession).toHaveBeenCalledWith('c2c', 'peer-a', 'session-nope');
    expect(String(result)).toContain('目标不存在');
  });

  it('default 走清绑定分支', async () => {
    const { cmdCtx } = makeCmdCtx('default');
    const deps = makeDeps();
    await switchCommand(deps).handler(cmdCtx);
    expect(deps.manager.switchSession).toHaveBeenCalledWith('c2c', 'peer-a');
  });
});

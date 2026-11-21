/**
 * 绑定全链路集成测试 — 真实 persist 落盘
 *
 * 区别于 bind-routes.test.ts（方法处理器单元）：本文件把 RPC 处理器接到
 * 真实的 profile 写盘，验证「手动绑定 / 配置保存 / 解绑」等链路在多插件
 * 共享的 cordis.patch.yml 上不破坏其他插件配置（#53 回归）。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { QrConnectCallbacks, QrConnectOptions } from '@tencent-connect/qqbot-connector';
import { createBindRpcHandler } from './bind-routes.ts';
import { createConfigRpcHandler } from '../runtime/config-routes.ts';
import { BindingService } from './binding-service.ts';
import { persistCredentialsToProfile, accessRevision, readProfileAccess } from './persist.ts';
import { BIND_METHODS, CONFIG_METHODS } from '../shared/rpc-protocol.ts';
import type { RpcResult } from '../rpc-carrier.ts';

/** 默认 persist 依赖 getProfileDir：用可控 mock 替换（其余导出保留） */
const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

/** 多插件共享的 profile patch（其他插件条目 + insert 行 + 注释，必须跨全部链路保留） */
const SHARED_PATCH = [
  '# 宿主设置与其他插件条目，绑定链路不得破坏',
  '- insert:',
  '    - id: custom-plugin',
  '      name: custom-plugin',
  '- id: ui-settings',
  '  config:',
  '    enabled: false',
  '- id: im-qqbot',
  '  config:',
  '    requireMention: true',
  '- id: llm-deepseek',
  '  config:',
  '    baseURL: https://example.com/v1',
].join('\n');

/** 直接构造处理器（默认 persist 处理器生效，真实落盘）：bind 管凭证，config 管配置 */
function createRealHandler(boundAppId: () => string | null): (method: string, payload: Record<string, unknown>) => Promise<RpcResult> {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const service = { wireState: () => ({ phase: 'starting' }), refresh: vi.fn() };
  const bind = createBindRpcHandler(service as never, logger, { boundAppId });
  const config = createConfigRpcHandler(logger, { boundAppId, currentConfig: () => ({ appId: boundAppId() ?? undefined }) });
  const configMethods = new Set<string>(Object.values(CONFIG_METHODS));
  return (method, payload = {}) => {
    const body = method === CONFIG_METHODS.configSet ? { expectedAppId: boundAppId(), ...payload } : payload;
    return Promise.resolve((configMethods.has(method) ? config : bind)(method, body, new AbortController().signal));
  };
}

/** 共享断言：其他插件的内容完整保留（im-qqbot 自身字段会被各链路合法修改，不在此断言） */
function expectSharedPreserved(patchPath: string): void {
  const after = readFileSync(patchPath, 'utf8');
  expect(after).toContain('# 宿主设置与其他插件条目，绑定链路不得破坏');
  expect(after).toContain('- insert:');
  expect(after).toContain('custom-plugin');
  expect(after).toContain('ui-settings');
  expect(after).toContain('llm-deepseek');
}

let dir: string;
let patchPath: string;

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  profileDirState.dir = undefined;
});

describe('绑定链路 × 真实 persist 落盘（#53 回归）', () => {
  it('手动绑定 → 配置保存 → 解绑：三操作全链路保留其他插件配置', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-it-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const savedAppId = process.env.QQBOT_APPID;
    const savedSecret = process.env.QQBOT_SECRET;
    process.env.QQBOT_APPID = 'test-app';

    try {
      const call = createRealHandler(() => (readFileSync(patchPath, 'utf8').includes('appId:') ? 'test-app' : null));

      // 1. 手动绑定（默认处理器 → persistCredentialsToProfile 真写盘）
      const manual = await call(BIND_METHODS.manual, { appId: 'test-app', appSecret: 'test-secret' });
      expect(manual.ok).toBe(true);
      expect(readFileSync(patchPath, 'utf8')).toContain('appId: test-app');
      expectSharedPreserved(patchPath);

      // 2. 配置保存（默认处理器 → updateProfileConfig 真写盘）
      const config = await call(CONFIG_METHODS.configSet, { requireMention: false });
      expect(config.ok).toBe(true);
      expect(readFileSync(patchPath, 'utf8')).toContain('requireMention: false');
      expect(readFileSync(patchPath, 'utf8')).toContain('appId: test-app');
      expectSharedPreserved(patchPath);

      // 3. 解绑（默认处理器 → removeCredentialsFromProfile 真写盘 + 清 env）
      const unbind = await call(BIND_METHODS.unbind);
      expect(unbind.ok).toBe(true);
      expect(process.env.QQBOT_APPID).toBeUndefined();
      const after = readFileSync(patchPath, 'utf8');
      expect(after).not.toContain('appId: test-app');
      expect(after).not.toContain('test-secret');
      expectSharedPreserved(patchPath);
    } finally {
      if (savedAppId === undefined) delete process.env.QQBOT_APPID;
      else process.env.QQBOT_APPID = savedAppId;
      if (savedSecret === undefined) delete process.env.QQBOT_SECRET;
      else process.env.QQBOT_SECRET = savedSecret;
    }
  });

  it('状态查询不触碰文件（只读）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-it-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const call = createRealHandler(() => null);
    const result = await call(BIND_METHODS.state);
    expect(result.ok).toBe(true);
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('配置保存（多字段批量）：全白名单字段落盘，其他插件保留', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-cfg-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const call = createRealHandler(() => null);
    const result = await call(CONFIG_METHODS.configSet, {
      requireMention: false,
      streaming: false,
      showToolResults: true,
      debug: true,
      provider: 'pi-ai',
      model: 'deepseek-chat',
      groupPrompt: '群聊提示词',
      directPrompt: '私聊提示词',
      accessRevision: accessRevision(readProfileAccess(undefined, dir)),
      access: { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'open', groupAllow: [] },
    });

    expect(result.ok).toBe(true);
    const after = readFileSync(patchPath, 'utf8');
    for (const expected of [
      'requireMention: false', 'streaming: false', 'showToolResults: true', 'debug: true',
      'provider: pi-ai', 'groupPrompt: 群聊提示词', 'directPrompt: 私聊提示词',
      'c2cMode: allowlist', 'c2cAllow:', '- u1',
    ]) {
      expect(after).toContain(expected);
    }
    expectSharedPreserved(patchPath);
  });

  it.each([
    ['凭据字段', { appId: 'hack', requireMention: false }],
    ['只读 cwd 字段', { cwd: '/tmp' }],
    ['未知字段', { timeoutMs: 100 }],
    ['类型错误（requireMention 传字符串）', { requireMention: 'yes' }],
  ])('配置保存拒绝：%s → 错误结果且文件不变', async (_name, payload) => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-rej-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const call = createRealHandler(() => null);
    const result = await call(CONFIG_METHODS.configSet, payload as Record<string, unknown>);

    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('配置保存：无 profile 目录 → persist-failed', async () => {
    profileDirState.dir = undefined;
    const call = createRealHandler(() => null);
    const result = await call(CONFIG_METHODS.configSet, { requireMention: false });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/persist-failed' } });
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-nodir-')); // 供 afterEach 清理
  });

  it('配置保存（幂等重放）：同值二次提交不重写文件', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-idem-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const call = createRealHandler(() => null);
    expect((await call(CONFIG_METHODS.configSet, { requireMention: false })).ok).toBe(true);

    // 拉开 mtime 后重放同值提交
    const { statSync, utimesSync } = await import('node:fs');
    const past = new Date(Date.now() - 1000);
    utimesSync(patchPath, past, past);

    expect((await call(CONFIG_METHODS.configSet, { requireMention: false })).ok).toBe(true);
    expect(statSync(patchPath).mtimeMs).toBe(past.getTime()); // 无变化 → 无写 → mtime 不动
  });

  it('配置保存（长 prompt）：超长提示词正常保存（#69）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-large-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const call = createRealHandler(() => null);
    const longPrompt = '你是一个专业的 QQ 群助手。'.repeat(400); // ~8KB UTF-8
    const result = await call(CONFIG_METHODS.configSet, { groupPrompt: longPrompt });

    expect(result.ok).toBe(true);
    expect(readFileSync(patchPath, 'utf8')).toContain('你是一个专业的 QQ 群助手。');
    expectSharedPreserved(patchPath);
  });

  it('manual 凭据字段长度受校验约束', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-manual-cap-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const call = createRealHandler(() => null);
    const result = await call(BIND_METHODS.manual, { appId: 'a'.repeat(5000), appSecret: 's' });

    expect(result).toMatchObject({ ok: false, error: { code: 'bind/invalid-credentials' } });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('allowlist 大列表可保存', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-allow-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const call = createRealHandler(() => null);
    const result = await call(CONFIG_METHODS.configSet, {
      accessRevision: accessRevision(readProfileAccess(undefined, dir)),
      access: { c2cMode: 'allowlist', c2cAllow: Array.from({ length: 5000 }, (_v, i) => `openid-${i}`), groupMode: 'open', groupAllow: [] },
    });

    expect(result.ok).toBe(true);
    expect(readFileSync(patchPath, 'utf8')).toContain('openid-4999');
    expectSharedPreserved(patchPath);
  });

  it('扫码链路：二维码 → 扫码成功 → 凭据落盘，多插件配置保留', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-qr-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    // 扫码状态机 + 假 connector（同 binding-service.test.ts 的驱动方式）
    const sessions: Array<{ callbacks: QrConnectCallbacks; options: QrConnectOptions | undefined; abort: () => void }> = [];
    const connect = (callbacks: QrConnectCallbacks, options?: QrConnectOptions): (() => void) => {
      const controller = new AbortController();
      sessions.push({ callbacks, options, abort: () => controller.abort() });
      return () => controller.abort();
    };
    const service = new BindingService({
      source: 'test',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      connect: connect as unknown as typeof import('@tencent-connect/qqbot-connector').startQrConnect,
      renderQr: async () => 'data:image/svg+xml;base64,TEST',
    });

    const startPromise = service.start();
    await new Promise((r) => { setTimeout(r, 0); });

    // 二维码就绪 → 手机扫码 → 成功回调
    sessions.at(-1)?.callbacks.onQrDisplayed?.('https://q.qq.com/connect?task_id=t1');
    sessions.at(-1)?.callbacks.onSuccess?.([{ appId: 'qr-app', appSecret: 'qr-secret' }]);
    const credentials = await startPromise;
    expect(credentials).toEqual({ appId: 'qr-app', appSecret: 'qr-secret' });

    // 调用方 then 链：凭据落盘（真实 setup/index.ts 的装配语义）
    expect(persistCredentialsToProfile(credentials, dir, { info: vi.fn(), warn: vi.fn() })).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('appId: qr-app');
    expect(after).toContain('appSecret: qr-secret');
    expectSharedPreserved(patchPath);

    service.dispose();
  });
});

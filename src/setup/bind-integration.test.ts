/**
 * 绑定全链路集成测试 — 真实 persist 落盘
 *
 * 区别于 bind-routes.test.ts（mock 提交处理）与 persist.test.ts（直调
 * persist）：本文件把路由默认处理器与扫码状态机接到真实的 profile 写盘，
 * 验证「扫码绑定 / 手动绑定 / 配置保存 / 解绑」四条链路在多插件共享的
 * cordis.patch.yml 上不破坏其他插件配置（#53 回归）。
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QrConnectCallbacks, QrConnectOptions } from '@tencent-connect/qqbot-connector';
import { registerBindRoutes, type WebRoute } from './bind-routes.ts';
import { BindingService } from './binding-service.ts';
import { persistCredentialsToProfile } from './persist.ts';
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH } from '../shared/bind-protocol.ts';

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

function fakeReq(method: string, body?: string): IncomingMessage {
  const req = {
    method,
    headers: { host: '127.0.0.1:3080' },
    resume: vi.fn(),
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')];
      let index = 0;
      return {
        next: () => Promise.resolve(index < chunks.length
          ? { done: false, value: chunks[index++] as Buffer }
          : { done: true as const, value: undefined }),
      };
    },
  };
  return req as unknown as IncomingMessage;
}

function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status: number) { res.statusCode = status; },
    end(payload?: string) { if (payload !== undefined) res.body += payload; },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}

/** 直接注册路由（不走 createHarness 的 manual 包装，让默认 persist 处理器生效） */
function registerRealRoutes(boundAppId: () => string | null): Map<string, WebRoute> {
  const routes = new Map<string, WebRoute>();
  const service = { wireState: () => ({ phase: 'starting' }), refresh: vi.fn() };
  registerBindRoutes(
    {
      register(route: WebRoute): () => void {
        routes.set(route.path, route);
        return () => { routes.delete(route.path); };
      },
    },
    service as never,
    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    { boundAppId },
  );
  return routes;
}

async function invoke(route: WebRoute | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (route === undefined) throw new Error('route not registered');
  await route.handler(req, res);
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
      const routes = registerRealRoutes(() => (readFileSync(patchPath, 'utf8').includes('appId:') ? 'test-app' : null));

      // 1. 手动绑定（默认处理器 → persistCredentialsToProfile 真写盘）
      const manualRes = fakeRes();
      await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('POST', '{"appId":"test-app","appSecret":"test-secret"}'), manualRes);
      expect(manualRes.statusCode).toBe(200);
      expect(readFileSync(patchPath, 'utf8')).toContain('appId: test-app');
      expectSharedPreserved(patchPath);

      // 2. 配置保存（默认处理器 → updateProfileConfig 真写盘）
      const configRes = fakeRes();
      await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', '{"requireMention":false}'), configRes);
      expect(configRes.statusCode).toBe(200);
      expect(readFileSync(patchPath, 'utf8')).toContain('requireMention: false');
      expect(readFileSync(patchPath, 'utf8')).toContain('appId: test-app');
      expectSharedPreserved(patchPath);

      // 3. 解绑（默认处理器 → removeCredentialsFromProfile 真写盘 + 清 env）
      const unbindRes = fakeRes();
      await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST'), unbindRes);
      expect(unbindRes.statusCode).toBe(200);
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

  it('状态查询不触碰文件（GET 只读）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-it-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET'), res);
    expect(res.statusCode).toBe(200);
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('配置保存（多字段批量）：全白名单字段落盘，其他插件保留', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-cfg-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', JSON.stringify({
      requireMention: false,
      groupSmartReply: true,
      groupReplyPrompt: '只在值得接话时回复',
      streaming: false,
      showToolResults: true,
      debug: true,
      provider: 'pi-ai',
      model: 'deepseek-chat',
      groupPrompt: '群聊提示词',
      directPrompt: '私聊提示词',
      access: { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'open', groupAllow: [] },
    })), res);

    expect(res.statusCode).toBe(200);
    const after = readFileSync(patchPath, 'utf8');
    for (const expected of [
      'requireMention: false', 'streaming: false', 'showToolResults: true', 'debug: true',
      'groupSmartReply: true', 'groupReplyPrompt: 只在值得接话时回复',
      "provider: pi-ai", 'groupPrompt: 群聊提示词', 'directPrompt: 私聊提示词',
      'c2cMode: allowlist', 'c2cAllow:', '- u1',
    ]) {
      expect(after).toContain(expected);
    }
    expectSharedPreserved(patchPath);
  });

  it.each([
    ['非法 JSON body', 'not-json{'],
    ['非对象 body', '"string"'],
    ['凭据字段', '{"appId":"hack","requireMention":false}'],
    ['只读 cwd 字段', '{"cwd":"/tmp"}'],
    ['未知字段', '{"timeoutMs":100}'],
    ['类型错误（requireMention 传字符串）', '{"requireMention":"yes"}'],
  ])('配置保存拒绝：%s → 400 且文件不变', async (_name, body) => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-rej-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', body), res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('配置保存：无 profile 目录 → 500', async () => {
    profileDirState.dir = undefined;
    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', '{"requireMention":false}'), res);
    expect(res.statusCode).toBe(500);
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-nodir-')); // 供 afterEach 清理
  });

  it('配置保存（幂等重放）：同值二次提交不重写文件', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-idem-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const routes = registerRealRoutes(() => null);
    const first = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', '{"requireMention":false}'), first);
    expect(first.statusCode).toBe(200);

    // 拉开 mtime 后重放同值提交
    const { statSync, utimesSync } = await import('node:fs');
    const past = new Date(Date.now() - 1000);
    utimesSync(patchPath, past, past);

    const second = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', '{"requireMention":false}'), second);
    expect(second.statusCode).toBe(200);
    expect(statSync(patchPath).mtimeMs).toBe(past.getTime()); // 无变化 → 无写 → mtime 不动
  });

  it('配置保存（长 prompt）：超过 4KB 的请求体正常保存（#69）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-large-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const routes = registerRealRoutes(() => null);
    const longPrompt = '你是一个专业的 QQ 群助手。'.repeat(400); // ~8KB UTF-8
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', JSON.stringify({ groupPrompt: longPrompt })), res);

    expect(res.statusCode).toBe(200);
    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('你是一个专业的 QQ 群助手。');
    expectSharedPreserved(patchPath);
  });

  it('manual 请求体仍受 4KB 上限约束', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-manual-cap-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    const oversized = JSON.stringify({ appId: 'a'.repeat(5000), appSecret: 's' });
    await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('POST', oversized), res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ ok: false });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('allowlist 大列表可保存（仅受 512KB body 上限约束）', async () => {
    dir = mkdtempSync(join(tmpdir(), 'im-qqbot-bind-allow-'));
    patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    profileDirState.dir = dir;

    const routes = registerRealRoutes(() => null);
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('POST', JSON.stringify({
      access: { c2cMode: 'allowlist', c2cAllow: Array.from({ length: 5000 }, (_v, i) => `openid-${i}`), groupMode: 'open', groupAllow: [] },
    })), res);

    expect(res.statusCode).toBe(200);
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

    // 扫码成功后 env 兜底写入（setup 流程语义）：不影响已写盘内容
    expect(existsSync(patchPath)).toBe(true);
    service.dispose();
  });
});

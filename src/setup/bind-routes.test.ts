/**
 * 端内绑定路由测试
 *
 * 用假的 webServer 捕获注册的 handler，验证：
 * 状态查询协议（含 bound 相位）、refresh / manual 动作、
 * 方法守卫、Origin 信任校验与 manual 请求体校验。
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BIND_CONFIG_PATH,
  BIND_MANUAL_PATH,
  BIND_REFRESH_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  registerBindRoutes,
  type BindRoutesOptions,
  type WebRoute,
} from './bind-routes.ts';
import type { BindingService } from './binding-service.ts';

/** 默认 unbind/persist 实现依赖 getProfileDir：用可控 mock 替换（其余导出保留） */
const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

/** 假 req：EventEmitter + headers/method + 可读 body */
function fakeReq(method: string, headers: Record<string, string | undefined> = {}, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { method?: string }).method = method;
  (req as { headers: Record<string, string | undefined> }).headers = headers;
  Object.assign(req, {
    resume: vi.fn(),
    // 模拟异步可读流：POST body 异步推送
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')];
      let index = 0;
      return {
        next: () => Promise.resolve(index < chunks.length
          ? { done: false, value: chunks[index++] as Buffer }
          : { done: true as const, value: undefined }),
      };
    },
  });
  return req;
}

/** 假 res：捕获 writeHead/end */
function fakeRes(): ServerResponse & { statusCode: number; body: string; headers: Record<string, string> } {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(payload?: string) {
      if (payload !== undefined) res.body += payload;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}

function createHarness(options: BindRoutesOptions = {}): {
  routes: Map<string, WebRoute>;
  service: { wireState: () => unknown; refresh: () => void };
  manualSubmits: unknown[];
} {
  const routes = new Map<string, WebRoute>();
  const webServer = {
    register(route: WebRoute): () => void {
      routes.set(route.path, route);
      return () => { routes.delete(route.path); };
    },
  };
  const service = {
    wireState: vi.fn(() => ({ phase: 'starting' })),
    refresh: vi.fn(),
  } as unknown as BindingService;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manualSubmits: unknown[] = [];
  const wrappedOptions: BindRoutesOptions = {
    ...options,
    onManualCredentials: (credentials) => {
      manualSubmits.push(credentials);
      return options.onManualCredentials?.(credentials) ?? { persisted: true };
    },
  };
  registerBindRoutes(webServer, service, logger, wrappedOptions);
  return {
    routes,
    service: service as unknown as { wireState: () => unknown; refresh: () => void },
    manualSubmits,
  };
}

async function invoke(route: WebRoute | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (route === undefined) throw new Error('route not registered');
  await route.handler(req, res);
}

function json(res: { body: string }): unknown {
  return JSON.parse(res.body);
}

describe('bind-routes', () => {
  it('注册状态、刷新与手动提交三条精确路由', () => {
    const { routes } = createHarness();
    expect(routes.has(BIND_STATE_PATH)).toBe(true);
    expect(routes.has(BIND_REFRESH_PATH)).toBe(true);
    expect(routes.has(BIND_MANUAL_PATH)).toBe(true);
    expect(routes.get(BIND_STATE_PATH)?.kind).toBe('exact');
  });

  it('GET state：返回 200 + 序列化相位 + no-store', async () => {
    const { routes, service } = createHarness();
    service.wireState = () => ({ phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 });

    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(json(res)).toEqual({ phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 });
  });

  it('GET state（bound）：优先返回脱敏 appId，不触碰扫码状态机', async () => {
    const { routes, service } = createHarness({ boundAppId: () => '102120114' });

    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);

    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ phase: 'bound', appId: '102120114' });
    expect(service.wireState).not.toHaveBeenCalled();
  });

  it('HEAD state：允许', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('HEAD', { host: 'x' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('POST state：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('POST', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST refresh：调用 service.refresh 并返回 starting', async () => {
    const { routes, service } = createHarness();
    const req = fakeReq('POST', { host: '127.0.0.1:3080' });
    const res = fakeRes();
    await invoke(routes.get(BIND_REFRESH_PATH), req, res);

    expect(service.refresh).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ phase: 'starting' });
  });

  it('GET refresh：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_REFRESH_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST manual：合法凭据 → 提交处理并返回成功', async () => {
    const { routes, manualSubmits } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', 'content-type': 'application/json' }, '{"appId":"102120114","appSecret":"s3cr3t"}'),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
    expect(manualSubmits).toEqual([{ appId: '102120114', appSecret: 's3cr3t' }]);
  });

  it('POST manual：缺失字段 → 400', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appId":"102120114"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST manual：空 body → 400', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }, ''), res);
    expect(res.statusCode).toBe(400);
  });

  it('POST manual：persisted=false → 500 + 错误信息', async () => {
    const { routes } = createHarness({
      onManualCredentials: () => ({ persisted: false, error: '写入失败' }),
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appId":"a","appSecret":"b"}'),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(json(res)).toEqual({ ok: false, error: '写入失败' });
  });

  it('GET manual：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST unbind（bound 态）：调用解绑处理并返回成功', async () => {
    const { routes } = createHarness({
      boundAppId: () => '102120114',
      onUnbind: () => ({ persisted: true }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
  });

  it('POST unbind（未绑定）：409，不触达解绑处理', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toEqual({ ok: false, error: '当前未绑定' });
  });

  it('GET unbind：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST unbind（默认实现）：删除 patch 凭据并清除进程 env（否则 HMR 后仍读到旧凭据，状态停留 bound）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-qqbot-unbind-'));
    const patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    appId: "102120114"',
      '    appSecret: "s3cr3t"',
      '    requireMention: true',
      '',
    ].join('\n'), 'utf8');
    profileDirState.dir = dir;
    // 扫码绑定成功时会写入进程 env：模拟该残留
    const savedAppId = process.env.QQBOT_APPID;
    const savedSecret = process.env.QQBOT_SECRET;
    process.env.QQBOT_APPID = '102120114';
    process.env.QQBOT_SECRET = 's3cr3t';

    try {
      const { routes } = createHarness({ boundAppId: () => '102120114' });
      const res = fakeRes();
      await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);

      expect(res.statusCode).toBe(200);
      expect(json(res)).toMatchObject({ ok: true });
      // 进程 env 凭据被清除（HMR 重载后新 fiber 不再回退读到旧凭据）
      expect(process.env.QQBOT_APPID).toBeUndefined();
      expect(process.env.QQBOT_SECRET).toBeUndefined();
      // patch 中的凭据被删除、其余配置保留
      const content = readFileSync(patchPath, 'utf8');
      expect(content).not.toContain('appId');
      expect(content).not.toContain('appSecret');
      expect(content).toContain('requireMention: true');
    } finally {
      profileDirState.dir = undefined;
      if (savedAppId === undefined) delete process.env.QQBOT_APPID;
      else process.env.QQBOT_APPID = savedAppId;
      if (savedSecret === undefined) delete process.env.QQBOT_SECRET;
      else process.env.QQBOT_SECRET = savedSecret;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST unbind（幂等重入）：patch 已无凭据时仍写回文件（触发宿主 HMR，bound fiber 才会卸载）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-qqbot-unbind-idem-'));
    const patchPath = join(dir, 'cordis.patch.yml');
    // 凭据已被上一次解绑删除，但 fiber 未重载（无 HMR）的场景
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    requireMention: true',
      '',
    ].join('\n'), 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    try {
      const { routes } = createHarness({ boundAppId: () => '102120114' });
      const res = fakeRes();
      await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);

      expect(res.statusCode).toBe(200);
      // 文件被重写（mtime 更新触发宿主 HMR 重载），内容仍为合法 YAML
      expect(readFileSync(patchPath, 'utf8')).toEqual(before);
    } finally {
      profileDirState.dir = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (profileDirState.dir !== undefined) {
      rmSync(profileDirState.dir, { recursive: true, force: true });
      profileDirState.dir = undefined;
    }
  });

  it('GET config：回显生效配置且剔除 appSecret', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({ appId: '102120114', appSecret: 'SECRET', requireMention: true, cwd: '/tmp/w' }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ config: { appId: '102120114', requireMention: true, cwd: '/tmp/w' } });
  });

  it('POST config：白名单内合法值通过并触发合并写入', async () => {
    const { routes } = createHarness({ onUpdateConfig: () => true });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', 'content-type': 'application/json' },
        '{"requireMention":false,"access":{"c2cMode":"allowlist","c2cAllow":["u1"],"groupMode":"open","groupAllow":[]}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
  });

  it('POST config：凭据字段被拒绝并引导绑定功能', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appSecret":"xxx"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('凭据') });
  });

  it.each(['', '结合群聊上下文决定是否接话。\n只输出 JSON。'])('POST config：保存智能回复开关及可编辑判断提示词 %j', async (prompt) => {
    const update = vi.fn(() => true);
    const { routes } = createHarness({ onUpdateConfig: update });
    const res = fakeRes();
    const config = { groupSmartReply: true, groupReplyPrompt: prompt };
    await invoke(routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify(config)), res);
    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(config);
  });

  it.each([
    { groupSmartReply: 'true' },
    { groupReplyPrompt: false },
    { groupReplyPrompt: 'x'.repeat(20001) },
  ])('POST config：拒绝无效智能回复配置 %#', async (config) => {
    const update = vi.fn(() => true);
    const { routes } = createHarness({ onUpdateConfig: update });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify(config)), res);
    expect(res.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('POST config：cwd 只读字段被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"cwd":"/etc"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('只读') });
  });

  it('POST config：未知/超时类字段不在白名单被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"maxQueue":50}'),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST config：类型错误被 Schema 拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"requireMention":"yes"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('布尔') });
  });

  it('跨站 Origin：403（state 与 manual 均拦截）', async () => {
    const { routes } = createHarness();
    const res1 = fakeRes();
    await invoke(
      routes.get(BIND_STATE_PATH),
      fakeReq('GET', { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }),
      res1,
    );
    expect(res1.statusCode).toBe(403);

    const res2 = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }, '{"appId":"a","appSecret":"b"}'),
      res2,
    );
    expect(res2.statusCode).toBe(403);
  });

  it('同源 Origin / 无 Origin（Desktop IPC 桥）：放行', async () => {
    const { routes } = createHarness();
    const resSame = fakeRes();
    await invoke(
      routes.get(BIND_STATE_PATH),
      fakeReq('GET', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }),
      resSame,
    );
    expect(resSame.statusCode).toBe(200);

    const resNone = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), resNone);
    expect(resNone.statusCode).toBe(200);
  });
});

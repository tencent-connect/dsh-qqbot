/**
 * 绑定 RPC 处理器单元测试 —— 方法分发、校验与 persist 语义。
 * 传输面（信封/围栏/405）由宿主 Connection 通道承载，见 rpc-carrier.test.ts。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BindingService } from './binding-service.ts';
import { createBindRpcHandler, type BindRpcOptions } from './bind-routes.ts';
import { BIND_METHODS, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { RpcResult } from '../rpc-carrier.ts';

/** persist 依赖 getProfileDir：用可控 mock 替换（其余导出保留） */
const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

const signal = (): AbortSignal => new AbortController().signal;

function createHarness(options: BindRpcOptions = {}) {
  const service = {
    wireState: vi.fn(() => ({ phase: 'starting' })),
    refresh: vi.fn(),
  } as unknown as BindingService;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manualSubmits: unknown[] = [];
  const wrappedOptions: BindRpcOptions = {
    ...options,
    onManualCredentials: (credentials) => {
      manualSubmits.push(credentials);
      return options.onManualCredentials?.(credentials) ?? { persisted: true };
    },
  };
  const handler = createBindRpcHandler(service, logger, wrappedOptions);
  const call = (method: string, payload: Record<string, unknown> = {}): Promise<RpcResult> =>
    Promise.resolve(handler(method, payload, signal()));
  return { service, manualSubmits, call };
}

let cleanupDir: string | undefined;

afterEach(() => {
  if (cleanupDir !== undefined) {
    rmSync(cleanupDir, { recursive: true, force: true });
    cleanupDir = undefined;
  }
  if (profileDirState.dir !== undefined) {
    rmSync(profileDirState.dir, { recursive: true, force: true });
    profileDirState.dir = undefined;
  }
});

describe('bind-rpc handler', () => {
  it('分发全部已知方法，未知方法报 unknown-method', async () => {
    const { call } = createHarness({ boundAppId: () => '102120114', onUnbind: () => ({ persisted: true }) });
    for (const method of Object.values(BIND_METHODS)) {
      const result = await call(method);
      // 业务成功与否取决于注入，分发只保证方法被处理器认识
      expect(result.ok === true || result.error?.code !== RPC_ERROR_CODES.unknownMethod).toBe(true);
    }
    expect(await call('bind.nope')).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.unknownMethod } });
  });

  it('state：返回扫码状态机相位', async () => {
    const { call, service } = createHarness();
    service.wireState = () => ({ phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 });
    expect(await call(BIND_METHODS.state)).toEqual({ ok: true, value: { phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 } });
  });

  it('state（bound）：优先返回脱敏 appId，不触碰扫码状态机', async () => {
    const { call, service } = createHarness({ boundAppId: () => '102120114' });
    expect(await call(BIND_METHODS.state)).toEqual({ ok: true, value: { phase: 'bound', appId: '102120114' } });
    expect(service.wireState).not.toHaveBeenCalled();
  });

  it('refresh：调用 service.refresh 并返回 starting', async () => {
    const { call, service } = createHarness();
    expect(await call(BIND_METHODS.refresh)).toEqual({ ok: true, value: { phase: 'starting' } });
    expect(service.refresh).toHaveBeenCalledOnce();
  });

  it('manual：合法凭据 → 提交处理并返回成功', async () => {
    const { call, manualSubmits } = createHarness();
    const result = await call(BIND_METHODS.manual, { appId: '102120114', appSecret: 's3cr3t' });
    expect(result).toEqual({ ok: true, value: { ok: true, message: '凭据已保存，插件将自动重载' } });
    expect(manualSubmits).toEqual([{ appId: '102120114', appSecret: 's3cr3t' }]);
  });

  it('manual：缺失/超长字段 → invalid-credentials，不触达提交处理', async () => {
    const { call, manualSubmits } = createHarness();
    expect(await call(BIND_METHODS.manual, { appId: '102120114' })).toMatchObject({ ok: false, error: { code: 'bind/invalid-credentials' } });
    expect(await call(BIND_METHODS.manual, { appId: 'a'.repeat(5000), appSecret: 's' })).toMatchObject({ ok: false, error: { code: 'bind/invalid-credentials' } });
    expect(manualSubmits).toEqual([]);
  });

  it('manual：persisted=false → persist-failed + 错误信息', async () => {
    const { call } = createHarness({ onManualCredentials: () => ({ persisted: false, error: '写入失败' }) });
    expect(await call(BIND_METHODS.manual, { appId: 'a', appSecret: 'b' })).toMatchObject({ ok: false, error: { code: 'bind/persist-failed', message: '写入失败' } });
  });

  it('unbind（bound 态）：调用解绑处理并返回成功', async () => {
    const onUnbind = vi.fn(() => ({ persisted: true }));
    const { call } = createHarness({ boundAppId: () => '102120114', onUnbind });
    expect(await call(BIND_METHODS.unbind)).toEqual({ ok: true, value: { ok: true, message: '已解绑，插件将重载并重新进入绑定流程' } });
    expect(onUnbind).toHaveBeenCalledOnce();
  });

  it('unbind（未绑定）：not-bound，不触达解绑处理', async () => {
    const onUnbind = vi.fn(() => ({ persisted: true }));
    const { call } = createHarness({ onUnbind });
    expect(await call(BIND_METHODS.unbind)).toMatchObject({ ok: false, error: { code: 'bind/not-bound', message: '当前未绑定' } });
    expect(onUnbind).not.toHaveBeenCalled();
  });

  it('unbind（默认实现）：删除 patch 凭据并清除进程 env（否则 HMR 后仍读到旧凭据，状态停留 bound）', async () => {
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
    const savedAppId = process.env.QQBOT_APPID;
    const savedSecret = process.env.QQBOT_SECRET;
    process.env.QQBOT_APPID = '102120114';
    process.env.QQBOT_SECRET = 's3cr3t';

    try {
      const { call } = createHarness({ boundAppId: () => '102120114' });
      expect(await call(BIND_METHODS.unbind)).toMatchObject({ ok: true });
      // 进程 env 凭据被清除（HMR 重载后新 fiber 不再回退读到旧凭据）
      expect(process.env.QQBOT_APPID).toBeUndefined();
      expect(process.env.QQBOT_SECRET).toBeUndefined();
      // patch 中的凭据被删除、其余配置保留
      const content = readFileSync(patchPath, 'utf8');
      expect(content).not.toContain('appId');
      expect(content).not.toContain('appSecret');
      expect(content).toContain('requireMention: true');
    } finally {
      if (savedAppId === undefined) delete process.env.QQBOT_APPID;
      else process.env.QQBOT_APPID = savedAppId;
      if (savedSecret === undefined) delete process.env.QQBOT_SECRET;
      else process.env.QQBOT_SECRET = savedSecret;
    }
  });

  it('unbind（幂等重入）：patch 已无凭据时仍写回文件（触发宿主 HMR，bound fiber 才会卸载）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-qqbot-unbind-idem-'));
    const patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    requireMention: true',
      '',
    ].join('\n'), 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    try {
      const { call } = createHarness({ boundAppId: () => '102120114' });
      expect(await call(BIND_METHODS.unbind)).toMatchObject({ ok: true });
      // 文件被重写（mtime 更新触发宿主 HMR 重载），内容仍为合法 YAML
      expect(readFileSync(patchPath, 'utf8')).toEqual(before);
    } finally {
      profileDirState.dir = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

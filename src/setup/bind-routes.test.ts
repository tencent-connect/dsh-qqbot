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
import { readProfileAccess, persistCredentialsToProfile, updateProfileConfig, accessRevision } from './persist.ts';
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
    Promise.resolve(handler(method, method === BIND_METHODS.configSet
      ? { expectedAppId: options.boundAppId?.() ?? options.currentConfig?.().appId ?? null, ...payload }
      : payload, signal()));
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
    const { call } = createHarness({ boundAppId: () => '102120114', onUnbind: () => ({ persisted: true }), onUpdateConfig: () => true });
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

  it('config.get：回显生效配置且剔除 appSecret 与已退役配置', async () => {
    const { call } = createHarness({
      currentConfig: () => ({ appId: '102120114', appSecret: 'SECRET', requireMention: true, cwd: '/tmp/w', memory: { qdrantUrl: 'http://retired.example' } }),
    });
    const result = await call(BIND_METHODS.configGet);
    expect(result).toMatchObject({ ok: true, value: { config: { appId: '102120114', requireMention: true, cwd: '/tmp/w', accessRevision: expect.any(String) } } });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|retired\.example/);
  });

  it('rejects a previous account revision after credentials change even when the access settings match', async () => {
    profileDirState.dir = mkdtempSync(join(tmpdir(), 'qq-access-rebind-'));
    const initial = readProfileAccess(undefined);
    expect(updateProfileConfig({ access: initial }, profileDirState.dir)).toBe(true);
    const { call: oldCall } = createHarness({
      boundAppId: () => 'old-app',
      currentConfig: () => ({ appId: '__FROM_ENV__', appSecret: 'old-secret', access: initial }),
    });
    const read = async (callFn: typeof oldCall) => {
      const result = await callFn(BIND_METHODS.configGet);
      expect(result.ok).toBe(true);
      const config = (result as { value: { config: Record<string, unknown> } }).value.config;
      expect(JSON.stringify(config)).not.toMatch(/old-secret|new-secret/);
      return config;
    };
    const old = await read(oldCall);
    expect(old.appId).toBe('old-app');
    expect(persistCredentialsToProfile({ appId: 'new-app', appSecret: 'new-secret' }, profileDirState.dir)).toBe(true);
    const staleSave = await oldCall(BIND_METHODS.configSet, {
      access: { ...old.access, commandMode: 'disabled' }, accessRevision: old.accessRevision,
    });
    expect(staleSave).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    expect(readProfileAccess(initial, profileDirState.dir)).toEqual(initial);

    const { call } = createHarness({
      boundAppId: () => 'new-app',
      currentConfig: () => ({ appId: 'new-app', appSecret: 'new-secret', access: initial }),
    });
    const fresh = await read(call);
    expect(fresh.appId).toBe('new-app');
    expect(fresh.accessRevision).not.toBe(old.accessRevision);
    const staleNewRoute = await call(BIND_METHODS.configSet, {
      access: { ...old.access, commandMode: 'disabled' }, accessRevision: old.accessRevision,
    });
    expect(staleNewRoute).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    const freshSave = await call(BIND_METHODS.configSet, {
      access: { ...fresh.access, commandMode: 'disabled' }, accessRevision: fresh.accessRevision,
    });
    expect(freshSave.ok).toBe(true);
    expect((readProfileAccess(initial, profileDirState.dir) as { commandMode?: string }).commandMode).toBe('disabled');
  });

  it.each([undefined, '', 123, 'old-app', null])('rejects config writes with an invalid or stale expected account: %s', async expectedAppId => {
    const onUpdateConfig = vi.fn(() => true);
    const handler = createBindRpcHandler(null, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, {
      boundAppId: () => 'new-app', onUpdateConfig,
    });
    const result = await handler(BIND_METHODS.configSet, { expectedAppId, model: 'old-model' }, signal());
    expect(result).toMatchObject({ ok: false });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('checks account identity for non-access writes and excludes it from persisted settings', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ boundAppId: () => 'new-app', onUpdateConfig });
    expect(await call(BIND_METHODS.configSet, { expectedAppId: 'old-app', model: 'old-model' })).toMatchObject({
      ok: false, error: { code: 'config/account-changed' },
    });
    expect(onUpdateConfig).not.toHaveBeenCalled();
    expect(await call(BIND_METHODS.configSet, { expectedAppId: 'new-app', model: 'new-model' })).toMatchObject({ ok: true });
    expect(onUpdateConfig).toHaveBeenCalledExactlyOnceWith({ model: 'new-model' });
  });

  it('rejects non-access writes through an old fiber after the persisted account changes', async () => {
    profileDirState.dir = mkdtempSync(join(tmpdir(), 'qq-config-account-'));
    expect(persistCredentialsToProfile({ appId: 'old-app', appSecret: 'old-secret' }, profileDirState.dir)).toBe(true);
    const { call } = createHarness({ boundAppId: () => 'old-app' });
    expect(persistCredentialsToProfile({ appId: 'new-app', appSecret: 'new-secret' }, profileDirState.dir)).toBe(true);
    const patchPath = join(profileDirState.dir, 'cordis.patch.yml');
    const before = readFileSync(patchPath, 'utf8');
    expect(await call(BIND_METHODS.configSet, { expectedAppId: 'old-app', model: 'stale-model' })).toMatchObject({ ok: false });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('config.set：白名单内合法值通过并触发合并写入', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    const result = await call(BIND_METHODS.configSet, {
      requireMention: false, accessRevision: accessRevision(readProfileAccess(undefined)),
      access: { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'open', groupAllow: [] },
    });
    expect(result).toEqual({ ok: true, value: { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' } });
  });

  it.each(['open', 'allowlist', 'disabled'])('saves command mode %s through the existing config method', async commandMode => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    const result = await call(BIND_METHODS.configSet, {
      accessRevision: accessRevision(readProfileAccess(undefined)),
      access: { c2cMode: 'open', c2cAllow: [], groupMode: 'allowlist', groupAllow: ['group'], commandMode },
    });
    expect(result.ok).toBe(true);
    expect(onUpdateConfig).toHaveBeenCalledWith(expect.objectContaining({ access: expect.objectContaining({ commandMode, groupAllow: ['group'] }) }));
  });

  it.each(['c2cAllow', 'groupAllow'] as const)('rejects a stale %s snapshot after revocation and accepts a refreshed mode change', async list => {
    profileDirState.dir = mkdtempSync(join(tmpdir(), 'qq-access-revoke-'));
    const initial = readProfileAccess(undefined);
    initial[list] = ['revoked-peer'];
    updateProfileConfig({ access: initial }, profileDirState.dir);
    const { call } = createHarness({ currentConfig: () => ({ access: initial }) });
    const read = async () => {
      const result = await call(BIND_METHODS.configGet);
      return (result as { value: { config: Record<string, unknown> & { access: Record<string, unknown>; accessRevision: string } } }).value.config;
    };
    const old = await read();
    updateProfileConfig({ access: { ...initial, [list]: [] } }, profileDirState.dir);
    const fresh = await read();
    expect((fresh.access as Record<string, unknown>)[list]).toEqual([]);
    const staleSave = await call(BIND_METHODS.configSet, {
      access: { ...old.access, commandMode: 'disabled' }, accessRevision: old.accessRevision,
    });
    expect(staleSave).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    expect((readProfileAccess(initial, profileDirState.dir) as Record<string, unknown>)[list]).toEqual([]);
    const save = await call(BIND_METHODS.configSet, {
      access: { ...fresh.access, commandMode: 'disabled' }, accessRevision: fresh.accessRevision,
    });
    expect(save.ok).toBe(true);
    expect(readProfileAccess(initial, profileDirState.dir)).toMatchObject({ [list]: [], commandMode: 'disabled' });
  });

  it('rejects access writes without a revision instead of trusting an old browser', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    expect(await call(BIND_METHODS.configSet, { access: readProfileAccess(undefined) })).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('rejects unknown command modes before writing the profile', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    expect(await call(BIND_METHODS.configSet, {
      access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [], commandMode: 'unexpected' },
    })).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('config.set：凭据字段被拒绝并引导绑定功能', async () => {
    const { call } = createHarness();
    const result = await call(BIND_METHODS.configSet, { appSecret: 'xxx' });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('凭据') } });
  });

  it('config.set：cwd 只读字段被拒绝', async () => {
    const { call } = createHarness();
    const result = await call(BIND_METHODS.configSet, { cwd: '/etc' });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('只读') } });
  });

  it('config.set：未知/类型错误字段被 Schema 拒绝', async () => {
    const { call } = createHarness();
    expect(await call(BIND_METHODS.configSet, { maxQueue: 50 })).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
    expect(await call(BIND_METHODS.configSet, { requireMention: 'yes' })).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('布尔') } });
  });
});

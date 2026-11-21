/**
 * 配置端点单元测试 —— 方法分发、配置读写校验、候选数据与降级。
 * 传输面（信封/围栏/405）由宿主 Connection 通道承载，见 rpc-carrier.test.ts。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfigRpcHandler, type ConfigRpcOptions } from './config-routes.ts';
import { readProfileAccess, persistCredentialsToProfile, updateProfileConfig, accessRevision } from '../setup/persist.ts';
import { CONFIG_METHODS, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { RpcResult } from '../rpc-carrier.ts';

/** persist 依赖 getProfileDir：用可控 mock 替换（其余导出保留） */
const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

const signal = (): AbortSignal => new AbortController().signal;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function createHarness(options: ConfigRpcOptions = {}) {
  const handler = createConfigRpcHandler(logger, options);
  const call = (method: string, payload: Record<string, unknown> = {}): Promise<RpcResult> =>
    Promise.resolve(handler(method, method === CONFIG_METHODS.configSet
      ? { expectedAppId: options.boundAppId?.() ?? (options.currentConfig?.().appId as string | undefined) ?? null, ...payload }
      : payload, signal()));
  return { call };
}

afterEach(() => {
  if (profileDirState.dir !== undefined) {
    rmSync(profileDirState.dir, { recursive: true, force: true });
    profileDirState.dir = undefined;
  }
});

describe('config rpc handler', () => {
  it('分发全部已知方法，未知方法报 unknown-method', async () => {
    const commands = vi.fn(() => []);
    const { call } = createHarness({
      boundAppId: () => '102120114',
      onUpdateConfig: () => true,
      commands,
    });
    for (const method of Object.values(CONFIG_METHODS)) {
      const result = await call(method);
      expect(result.ok === true || result.error?.code !== RPC_ERROR_CODES.unknownMethod).toBe(true);
    }
    expect(await call('config.nope')).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.unknownMethod } });
  });

  it('config.get：回显生效配置且剔除 appSecret 与已退役配置', async () => {
    const { call } = createHarness({
      currentConfig: () => ({ appId: '102120114', appSecret: 'SECRET', requireMention: true, cwd: '/tmp/w', memory: { qdrantUrl: 'http://retired.example' } }),
    });
    const result = await call(CONFIG_METHODS.configGet);
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
      const result = await callFn(CONFIG_METHODS.configGet);
      expect(result.ok).toBe(true);
      const config = (result as { value: { config: Record<string, unknown> } }).value.config;
      expect(JSON.stringify(config)).not.toMatch(/old-secret|new-secret/);
      return config;
    };
    const old = await read(oldCall);
    expect(old.appId).toBe('old-app');
    expect(persistCredentialsToProfile({ appId: 'new-app', appSecret: 'new-secret' }, profileDirState.dir)).toBe(true);
    const staleSave = await oldCall(CONFIG_METHODS.configSet, {
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
    const staleNewRoute = await call(CONFIG_METHODS.configSet, {
      access: { ...old.access, commandMode: 'disabled' }, accessRevision: old.accessRevision,
    });
    expect(staleNewRoute).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    const freshSave = await call(CONFIG_METHODS.configSet, {
      access: { ...fresh.access, commandMode: 'disabled' }, accessRevision: fresh.accessRevision,
    });
    expect(freshSave.ok).toBe(true);
    expect((readProfileAccess(initial, profileDirState.dir) as { commandMode?: string }).commandMode).toBe('disabled');
  });

  it.each([undefined, '', 123, 'old-app', null])('rejects config writes with an invalid or stale expected account: %s', async expectedAppId => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ boundAppId: () => 'new-app', onUpdateConfig });
    const result = await call(CONFIG_METHODS.configSet, { expectedAppId, model: 'old-model' });
    expect(result).toMatchObject({ ok: false });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('checks account identity for non-access writes and excludes it from persisted settings', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ boundAppId: () => 'new-app', onUpdateConfig });
    expect(await call(CONFIG_METHODS.configSet, { expectedAppId: 'old-app', model: 'old-model' })).toMatchObject({
      ok: false, error: { code: 'config/account-changed' },
    });
    expect(onUpdateConfig).not.toHaveBeenCalled();
    expect(await call(CONFIG_METHODS.configSet, { expectedAppId: 'new-app', model: 'new-model' })).toMatchObject({ ok: true });
    expect(onUpdateConfig).toHaveBeenCalledExactlyOnceWith({ model: 'new-model' });
  });

  it('rejects non-access writes through an old fiber after the persisted account changes', async () => {
    profileDirState.dir = mkdtempSync(join(tmpdir(), 'qq-config-account-'));
    expect(persistCredentialsToProfile({ appId: 'old-app', appSecret: 'old-secret' }, profileDirState.dir)).toBe(true);
    const { call } = createHarness({ boundAppId: () => 'old-app' });
    expect(persistCredentialsToProfile({ appId: 'new-app', appSecret: 'new-secret' }, profileDirState.dir)).toBe(true);
    const patchPath = join(profileDirState.dir, 'cordis.patch.yml');
    const before = readFileSync(patchPath, 'utf8');
    expect(await call(CONFIG_METHODS.configSet, { expectedAppId: 'old-app', model: 'stale-model' })).toMatchObject({ ok: false });
    expect(readFileSync(patchPath, 'utf8')).toBe(before);
  });

  it('config.set：白名单内合法值通过并触发合并写入', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    const result = await call(CONFIG_METHODS.configSet, {
      requireMention: false, accessRevision: accessRevision(readProfileAccess(undefined)),
      access: { c2cMode: 'allowlist', c2cAllow: ['u1'], groupMode: 'open', groupAllow: [] },
    });
    expect(result).toEqual({ ok: true, value: { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' } });
  });

  it.each(['open', 'allowlist', 'disabled'])('saves command mode %s through the existing config method', async commandMode => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    const result = await call(CONFIG_METHODS.configSet, {
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
      const result = await call(CONFIG_METHODS.configGet);
      return (result as { value: { config: Record<string, unknown> & { access: Record<string, unknown>; accessRevision: string } } }).value.config;
    };
    const old = await read();
    updateProfileConfig({ access: { ...initial, [list]: [] } }, profileDirState.dir);
    const fresh = await read();
    expect((fresh.access as Record<string, unknown>)[list]).toEqual([]);
    const staleSave = await call(CONFIG_METHODS.configSet, {
      access: { ...old.access, commandMode: 'disabled' }, accessRevision: old.accessRevision,
    });
    expect(staleSave).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    expect((readProfileAccess(initial, profileDirState.dir) as Record<string, unknown>)[list]).toEqual([]);
    const save = await call(CONFIG_METHODS.configSet, {
      access: { ...fresh.access, commandMode: 'disabled' }, accessRevision: fresh.accessRevision,
    });
    expect(save.ok).toBe(true);
    expect(readProfileAccess(initial, profileDirState.dir)).toMatchObject({ [list]: [], commandMode: 'disabled' });
  });

  it('rejects access writes without a revision instead of trusting an old browser', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    expect(await call(CONFIG_METHODS.configSet, { access: readProfileAccess(undefined) })).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.configConflict } });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('rejects unknown command modes before writing the profile', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    expect(await call(CONFIG_METHODS.configSet, {
      access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [], commandMode: 'unexpected' },
    })).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
    expect(onUpdateConfig).not.toHaveBeenCalled();
  });

  it('config.set：凭据字段被拒绝并引导绑定功能', async () => {
    const { call } = createHarness();
    const result = await call(CONFIG_METHODS.configSet, { appSecret: 'xxx' });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('凭据') } });
  });

  it('config.set：cwd 只读字段被拒绝', async () => {
    const { call } = createHarness();
    const result = await call(CONFIG_METHODS.configSet, { cwd: '/etc' });
    expect(result).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('只读') } });
  });

  it('config.set：未知/类型错误字段被 Schema 拒绝', async () => {
    const { call } = createHarness();
    expect(await call(CONFIG_METHODS.configSet, { maxQueue: 50 })).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
    expect(await call(CONFIG_METHODS.configSet, { requireMention: 'yes' })).toMatchObject({ ok: false, error: { code: 'config/invalid', message: expect.stringContaining('布尔') } });
  });

  it('config.set：messageHandlingMode 合法值通过，非法值拒绝', async () => {
    const onUpdateConfig = vi.fn(() => true);
    const { call } = createHarness({ onUpdateConfig });
    expect(await call(CONFIG_METHODS.configSet, { messageHandlingMode: 'interrupt' })).toMatchObject({ ok: true });
    expect(onUpdateConfig).toHaveBeenCalledWith({ messageHandlingMode: 'interrupt' });
    expect(await call(CONFIG_METHODS.configSet, { messageHandlingMode: 'bogus' })).toMatchObject({ ok: false, error: { code: 'config/invalid' } });
  });

  it('commands.list：返回注入的命令清单，未注入时为空数组', async () => {
    const commands = [{ name: '/bot-help', description: '帮助' }];
    const { call } = createHarness({ commands: () => commands });
    expect(await call(CONFIG_METHODS.commands)).toEqual({ ok: true, value: { commands } });
    expect(await createHarness().call(CONFIG_METHODS.commands)).toEqual({ ok: true, value: { commands: [] } });
  });

  it('model.options 返回预设候选，model.catalog 一次聚合全部提供方的模型', async () => {
    const models = vi.fn(async (provider: string) => (provider === 'a' ? [{ id: 'a1', name: 'A1' }] : [{ id: 'b1', name: 'B1' }]));
    const modelOptions = {
      providers: () => [{ id: 'a', name: 'A 账号' }, { id: 'b', name: 'B' }],
      presets: async () => [{ id: 'base', name: 'Base' }],
      models,
    };
    const { call } = createHarness({ modelOptions });
    expect(await call(CONFIG_METHODS.modelOptions)).toMatchObject({
      ok: true,
      value: { providers: [{ id: 'a', name: 'A 账号' }, { id: 'b', name: 'B' }], presets: [{ id: 'base', name: 'Base' }] },
    });
    expect(await call(CONFIG_METHODS.modelCatalog)).toEqual({
      ok: true,
      value: {
        providers: [
          { id: 'a', name: 'A 账号', models: [{ id: 'a1', name: 'A1' }] },
          { id: 'b', name: 'B', models: [{ id: 'b1', name: 'B1' }] },
        ],
      },
    });
    expect(models).toHaveBeenCalledTimes(2);

    const bare = createHarness();
    expect(await bare.call(CONFIG_METHODS.modelCatalog)).toEqual({ ok: true, value: { providers: [] } });
    expect(await bare.call(CONFIG_METHODS.modelOptions)).toMatchObject({ ok: true, value: { presets: [] } });
  });

  it('model.catalog：单个提供方读取失败只缺该组，不影响其余候选', async () => {
    const modelOptions = {
      providers: () => [{ id: 'ok', name: 'OK' }, { id: 'bad', name: 'Bad' }],
      presets: async () => [],
      models: async (provider: string) => {
        if (provider === 'bad') throw new Error('boom');
        return [{ id: 'm1', name: 'M1' }];
      },
    };
    const { call } = createHarness({ modelOptions });
    expect(await call(CONFIG_METHODS.modelCatalog)).toEqual({
      ok: true,
      value: {
        providers: [
          { id: 'ok', name: 'OK', models: [{ id: 'm1', name: 'M1' }] },
          { id: 'bad', name: 'Bad', models: [] },
        ],
      },
    });
  });
});

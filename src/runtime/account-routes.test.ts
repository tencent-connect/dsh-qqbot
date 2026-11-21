import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { MemberStore } from './member-store.ts';
import { AccountAccessService } from './account-service.ts';
import { PairingService } from './pairing-service.ts';
import { createAccountRpcHandler } from './account-routes.ts';
import { registerPluginRpc } from '../rpc-carrier.ts';
import { ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => { if (profile.dir) rmSync(profile.dir, { recursive: true, force: true }); profile.dir = undefined; });

function service(): AccountAccessService {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-route-lifecycle-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  return Object.assign(Object.create(AccountAccessService.prototype) as AccountAccessService, {
    config, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    store: new MemberStore(join(profile.dir, 'data'), config.appId),
    pairing: new PairingService({ stateFile: join(profile.dir, 'pairing.json') }),
  });
}

describe('account rpc handler', () => {
  it('applies manual member additions and renames through the account methods', async () => {
    const store = service();
    store.addManualMember('owner', 'alice:Alice');
    const handler = createAccountRpcHandler(store);

    const manual = await handler(ACCOUNT_METHODS.pairManual, { purpose: 'owner', openid: 'bob:Bob' }, new AbortController().signal);
    expect(manual).toMatchObject({ ok: true });

    const rename = await handler(ACCOUNT_METHODS.pairRename, { openid: 'bob', nickname: 'Bobby' }, new AbortController().signal);
    expect(rename).toMatchObject({ ok: true });
    expect(store.isOwner('bob')).toBe(true);
    const status = await handler(ACCOUNT_METHODS.pairStatus, {}, new AbortController().signal);
    expect(status).toMatchObject({ ok: true, value: { owners: expect.arrayContaining([expect.objectContaining({ openid: 'bob', nickname: 'Bobby' })]) } });
  });

  it('rejects invalid pairing payloads without touching the store', async () => {
    const store = service();
    const handler = createAccountRpcHandler(store);
    const result = await handler(ACCOUNT_METHODS.pairManual, { purpose: 'owner' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code: 'pair/invalid' } });
    expect(store.isOwner('alice')).toBe(false);
  });

  it('answers plugin/reloading after disposal, so a late request cannot restore a revoked member', async () => {
    const old = service();
    old.addManualMember('owner', 'alice:Alice');

    // 载体注册（可控 connection 注册表，捕获 effect 清理 = fiber 卸载语义）
    const routes = new Map<string, { fetch: (request: Request) => Promise<Response> }>();
    const ctx = new Context();
    const disposeEffects: Array<() => void> = [];
    ctx.provide('connection', {
      fetch: {
        register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
          routes.set(route.path, route);
          return async () => { routes.delete(route.path); };
        },
      },
    });
    const originalEffect = ctx.effect.bind(ctx);
    vi.spyOn(ctx, 'effect').mockImplementation(((fn: () => (() => void) | void, label?: string) => {
      const cleanup = fn();
      if (typeof cleanup === 'function' && String(label).includes('im-qqbot.rpc')) disposeEffects.push(cleanup);
      return originalEffect(() => { void cleanup; }, label);
    }) as typeof ctx.effect);

    registerPluginRpc(ctx, ACCOUNT_RPC_ENDPOINT, createAccountRpcHandler(old));
    await new Promise(resolve => { setTimeout(resolve, 20); });
    const route = routes.get(`/api/${ACCOUNT_RPC_ENDPOINT}`);
    expect(route).toBeDefined();

    // fiber 卸载 + 现实侧撤销 alice
    for (const dispose of disposeEffects) dispose();
    old.revokePair('alice', 'owner');

    // 卸载后的迟到请求：plugin/reloading，不恢复已撤销成员
    const late = await route!.fetch(new Request(`http://localhost/api/${ACCOUNT_RPC_ENDPOINT}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'late-1', method: ACCOUNT_RPC_ENDPOINT, payload: { method: ACCOUNT_METHODS.pairManual, payload: { purpose: 'owner', openid: 'alice:Alice' } } }),
    }));
    const reply = await late.json() as { result: { ok: boolean; error?: { code: string } } };
    expect(reply.result).toMatchObject({ ok: false, error: { code: RPC_ERROR_CODES.pluginReloading } });
    expect(old.isOwner('alice')).toBe(false);
  });
});

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
afterEach(() => {
  if (profile.dir) rmSync(profile.dir, { recursive: true, force: true });
  profile.dir = undefined;
});

function service(): AccountAccessService {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-route-lifecycle-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  return Object.assign(Object.create(AccountAccessService.prototype) as AccountAccessService, {
    config, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    store: new MemberStore(join(profile.dir, 'data'), config.appId),
    pairing: new PairingService({ stateFile: join(profile.dir, 'pairing.json') }),
  });
}

describe('pairing RPC during reload', () => {
  it('does not dispatch a request still being read when its plugin fiber is disposed', async () => {
    const account = service();
    account.addManualMember('owner', 'alice:Alice');
    const root = new Context();
    const routes = new Map<string, (request: Request) => Promise<Response>>();
    const host = root.plugin(scope => {
      scope.provide('connection', { fetch: { register(route: { path: string; fetch: (request: Request) => Promise<Response> }) {
        routes.set(route.path, route.fetch);
        return async () => { routes.delete(route.path); };
      } } });
    });
    await host.await();
    const rpc = registerPluginRpc(root, ACCOUNT_RPC_ENDPOINT,
      createAccountRpcHandler(() => ({ service: account, enabled: true }), () => []));
    try {
      const path = '/api/' + ACCOUNT_RPC_ENDPOINT;
      await vi.waitFor(() => expect(routes.has(path)).toBe(true));
      const body = Promise.withResolvers<string>();
      const request = new Request('http://localhost' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      });
      vi.spyOn(request, 'text').mockReturnValue(body.promise);
      const pending = routes.get(path)!(request);
      await rpc.dispose();
      service().revokePair('alice', 'owner');
      body.resolve(JSON.stringify({
        type: 'client-request', rpcId: 'late-1', method: ACCOUNT_RPC_ENDPOINT,
        payload: { method: ACCOUNT_METHODS.pairManual, payload: { purpose: 'owner', openid: 'alice:Alice' } },
      }));
      expect((await (await pending).json()).result).toMatchObject({
        ok: false, error: { code: RPC_ERROR_CODES.pluginReloading },
      });
      expect(service().isOwner('alice')).toBe(false);
    } finally {
      await rpc.dispose();
      await host.dispose();
    }
  });
});

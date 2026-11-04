import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigSchema } from '../config.ts';
import { ConversationStore } from '../conversations/index.ts';
import { PAIR_MANUAL_PATH, PAIR_RENAME_PATH } from '../shared/pairing-protocol.ts';
import type { WebRoute } from '../setup/bind-routes.ts';
import { ConversationService } from './conversation-service.ts';
import { PairingService } from './pairing-service.ts';
import { registerConversationRoutes } from './conversation-routes.ts';

const profile = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async original => ({ ...await original<object>(), getProfileDir: () => profile.dir }));
afterEach(() => { if (profile.dir) rmSync(profile.dir, { recursive: true, force: true }); profile.dir = undefined; });
function service(): ConversationService {
  profile.dir ??= mkdtempSync(join(tmpdir(), 'qq-route-lifecycle-'));
  const config = ConfigSchema({ appId: 'fixture', appSecret: 'fixture' });
  return Object.assign(Object.create(ConversationService.prototype) as ConversationService, {
    config, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    store: new ConversationStore(join(profile.dir, 'data'), config.appId),
    pairing: new PairingService({ stateFile: join(profile.dir, 'pairing.json') }),
  });
}

describe('pairing routes during reload', () => {
  it.each([PAIR_RENAME_PATH, PAIR_MANUAL_PATH])('rejects an already dispatched %s request after route disposal without restoring a revoked member', async path => {
    const old = service(); old.addManualMember('owner', 'alice:Alice');
    const routes = new Map<string, WebRoute>();
    let dispose = (): void => {};
    const scoped = {
      get: () => ({ register: (route: WebRoute) => { routes.set(route.path, route); return () => { routes.delete(route.path); }; } }),
      effect: (effect: () => () => void) => { dispose = effect(); },
    };
    const context = { inject: (_dependencies: string[], callback: (scope: typeof scoped) => void) => callback(scoped) };
    registerConversationRoutes(context as unknown as Context, old, () => []);
    let arrived = (): void => {};
    const dispatched = new Promise<void>(resolve => { arrived = resolve; });
    const requests = new Set<Promise<void>>();
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const route = routes.get(req.url ?? '');
      if (!route) { res.writeHead(404).end(); return; }
      const pending = Promise.resolve(route.handler(req, res));
      requests.add(pending); arrived();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind TCP');
    const body = JSON.stringify(path === PAIR_RENAME_PATH
      ? { openid: 'bob', nickname: 'Bob' } : { purpose: 'owner', openid: 'alice:Alice' });
    const req = request({ hostname: '127.0.0.1', port: address.port, method: 'POST', path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } });
    const response = new Promise<number>((resolve, reject) => {
      req.on('error', reject);
      req.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
    });
    try {
      req.write(body.slice(0, 1));
      await dispatched;
      dispose();
      const current = service(); current.revokePair('alice', 'owner');
      req.end(body.slice(1));
      expect(await response).toBe(503);
      expect(service().isOwner('alice')).toBe(false);
    } finally {
      req.destroy(); dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.all(requests);
    }
  });
});

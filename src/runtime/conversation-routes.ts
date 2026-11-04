import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONVERSATIONS_PATH } from '../shared/conversation-protocol.ts';
import { PAIR_END_PATH, PAIR_ISSUE_PATH, PAIR_MANUAL_PATH, PAIR_RENAME_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH, type PairPurpose } from '../shared/pairing-protocol.ts';
import type { WebServerLike } from '../setup/bind-routes.ts';
import type { ConversationService } from './conversation-service.ts';


export function registerConversationRoutes(ctx: Context, service: ConversationService, commands: () => unknown): void {
  ctx.inject(['webServer'], scoped => {
    const server = scoped.get('webServer') as WebServerLike;
    const disposers = [server.register({kind:'exact', path: CONVERSATIONS_PATH, handler: async (_req, res) => json(res,200,{ commands: commands() })})];
    const pairHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '跨来源请求被拒绝' });
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === PAIR_STATUS_PATH) return json(res, 200, service.pairStatus());
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        const body = await readBody(req);
        if (pathname === PAIR_ISSUE_PATH) {
          const purpose = body.purpose;
          if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') throw new Error('认领用途无效');
          const previousCode = body.previousCode === undefined ? undefined : field(body, 'previousCode');
          const previousClaims = previousCode ? service.pairStatus().challenges.find(challenge => challenge.code === previousCode && challenge.purpose === purpose)?.claims ?? [] : [];
          return json(res, 200, { ...service.issuePairCode(purpose, previousCode), previousClaims, ...service.pairStatus() });
        }
        if (pathname === PAIR_END_PATH) {
          const purpose = body.purpose;
          if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') throw new Error('认领用途无效');
          service.endPairCode(field(body, 'code'), purpose);
          return json(res, 200, service.pairStatus());
        }
        if (pathname === PAIR_MANUAL_PATH) {
          const purpose = body.purpose;
          if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') throw new Error('认领用途无效');
          const openid = field(body, 'openid');
          const result = service.addManualMember(purpose as PairPurpose, openid);
          return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
        }
        if (pathname === PAIR_RENAME_PATH) {
          const openid = field(body, 'openid');
          const nickname = typeof body.nickname === 'string' ? body.nickname : '';
          const result = service.renameMember(openid, nickname);
          return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
        }
        if (pathname === PAIR_REVOKE_PATH) {
          const openid = field(body, 'openid'); const purpose = body.purpose;
          if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') throw new Error('认领用途无效');
          const result = service.revokePair(openid, purpose as PairPurpose);
          return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
        }
        return json(res, 404, { error: '未知配对操作' });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : '配对操作失败' });
      }
    };
    disposers.push(server.register({ kind: 'exact', path: PAIR_STATUS_PATH, handler: pairHandler }));
    disposers.push(server.register({ kind: 'exact', path: PAIR_ISSUE_PATH, handler: pairHandler }));
    disposers.push(server.register({ kind: 'exact', path: PAIR_END_PATH, handler: pairHandler }));
    disposers.push(server.register({ kind: 'exact', path: PAIR_REVOKE_PATH, handler: pairHandler }));
    disposers.push(server.register({ kind: 'exact', path: PAIR_MANUAL_PATH, handler: pairHandler }));
    disposers.push(server.register({ kind: 'exact', path: PAIR_RENAME_PATH, handler: pairHandler }));
    scoped.effect(() => () => { for (const dispose of disposers) dispose(); }, 'im-qqbot.conversations');
  });
}
function field(body: Record<string, unknown>, name: string, empty = false): string {
  const value = body[name];
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 100_000) throw new Error(`${name} 无效`);
  return value;
}
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const raw of req) { const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw); bytes += chunk.length; if (bytes > 512 * 1024) throw new Error('请求过大'); chunks.push(chunk); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求内容无效');
  return value as Record<string, unknown>;
}
function json(res: ServerResponse, code: number, data: unknown): void { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); }

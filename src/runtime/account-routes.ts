import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { COMMANDS_PATH } from '../shared/command-protocol.ts';
import { PAIR_END_PATH, PAIR_ISSUE_PATH, PAIR_MANUAL_PATH, PAIR_RENAME_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH } from '../shared/pairing-protocol.ts';
import { accessRevision } from '../setup/persist.ts';
import type { WebServerLike } from '../setup/bind-routes.ts';
import type { AccountAccessService } from './account-service.ts';

interface AccountRouteTarget {
  service: AccountAccessService;
  enabled: boolean;
  revision: number;
}

export function registerAccountRoutes(
  ctx: Context,
  resolve: (appId: string | null) => AccountRouteTarget | undefined,
  commands: (target: AccountRouteTarget) => unknown,
): void {
  ctx.inject(['webServer'], scoped => {
    let active = true;
    const server = scoped.get('webServer') as WebServerLike;
    const disposers: Array<() => void> = [];
    const pairHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        if (!active) return json(res, 503, { error: 'QQ 插件已重载，请刷新后重试' });
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: '跨来源请求被拒绝' });
        const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
        const appId = searchParams.get('appId');
        const target = resolve(appId);
        if (pathname === COMMANDS_PATH) {
          if (appId !== null && !target) return json(res, 404, { error: '找不到这个 QQ 机器人' });
          return json(res, 200, { commands: target ? commands(target) : [] });
        }
        if (!target) return json(res, 404, { error: '找不到这个 QQ 机器人' });
        const { service } = target;
        if (pathname === PAIR_STATUS_PATH) return json(res, 200, service.pairStatus());
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
        const membership = accessRevision(service.currentAccess());
        const owners = JSON.stringify(service.store.ownerIds());
        const body = await readBody(req);
        if (!active) return json(res, 503, { error: 'QQ 插件已重载，请刷新后重试' });
        const current = resolve(appId);
        if (current?.service !== service || current.revision !== target.revision
          || membership !== accessRevision(service.currentAccess()) || owners !== JSON.stringify(service.store.ownerIds())) {
          return json(res, 409, { error: '机器人配置已变化，请刷新后重试' });
        }
        if (pathname === PAIR_ISSUE_PATH) {
          if (!current.enabled) return json(res, 409, { error: '请先启用这台机器人，再生成配对码' });
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
          const result = service.addManualMember(purpose, openid);
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
          const result = service.revokePair(openid, purpose);
          return json(res, result.ok ? 200 : 400, { ...result, ...service.pairStatus() });
        }
        return json(res, 404, { error: '未知配对操作' });
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : '配对操作失败' });
      }
    };
    for (const path of [COMMANDS_PATH, PAIR_STATUS_PATH, PAIR_ISSUE_PATH, PAIR_END_PATH, PAIR_REVOKE_PATH, PAIR_MANUAL_PATH, PAIR_RENAME_PATH]) {
      disposers.push(server.register({ kind: 'exact', path, handler: pairHandler }));
    }
    scoped.effect(() => () => { active = false; for (const dispose of disposers) dispose(); }, 'im-qqbot.conversations');
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

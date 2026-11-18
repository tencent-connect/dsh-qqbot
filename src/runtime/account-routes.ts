/**
 * 账号端点 RPC 处理器 — /api/dsh-qqbot/account
 *
 * 经宿主 Connection 共享通道调用（rpc-carrier.ts 注册）：命令清单与
 * 配对码管理（生成/关闭/手动添加/改名/撤销/状态查询）。来源围栏与
 * 浏览器认证由宿主施加；本模块只做业务校验。
 */
import type { PairPurpose } from '../shared/pairing-protocol.ts';
import type { Context } from '@deepseek-ai/cordis';
import { ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { RpcMethodHandler, RpcResult } from '../rpc-carrier.ts';
import { registerPluginRpc, rpcFailure, rpcOk } from '../rpc-carrier.ts';
import type { AccountAccessService } from './account-service.ts';

function field(payload: Record<string, unknown>, name: string, empty = false): string {
  const value = payload[name];
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 100_000) throw new Error(`${name} 无效`);
  return value;
}

function pairPurpose(payload: Record<string, unknown>): PairPurpose {
  const purpose = payload.purpose;
  if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group') throw new Error('认领用途无效');
  return purpose;
}

/**
 * 创建账号端点的方法处理器（src/index.ts 经 registerPluginRpc 注册）。
 *
 * @param service - 账号访问服务（配对码与名单）
 * @param commands - 斜杠命令清单
 */
interface AccountRouteTarget {
  service: AccountAccessService;
  enabled: boolean;
}

export function registerAccountRoutes(
  ctx: Context,
  resolve: (appId: string | null) => AccountRouteTarget | undefined,
  commands: (target: AccountRouteTarget) => unknown,
): void {
  registerPluginRpc(ctx, ACCOUNT_RPC_ENDPOINT, createAccountRpcHandler(resolve, commands));
}

export function createAccountRpcHandler(
  resolve: (appId: string | null) => AccountRouteTarget | undefined,
  commands: (target: AccountRouteTarget) => unknown,
): RpcMethodHandler {
  return async (method, payload): Promise<RpcResult> => {
    try {
      const appId = payload.appId === undefined ? null : field(payload, 'appId');
      const target = resolve(appId);
      if (method === ACCOUNT_METHODS.commands && !target && appId === null) return rpcOk({ commands: [] });
      if (!target) return rpcFailure('account/not-found', '找不到这个 QQ 机器人');
      const { service } = target;
      switch (method) {
        case ACCOUNT_METHODS.commands:
          return rpcOk({ commands: commands(target) });
        case ACCOUNT_METHODS.pairStatus:
          return rpcOk(service.pairStatus());
        case ACCOUNT_METHODS.pairIssue: {
          if (!target.enabled) return rpcFailure('pair/rejected', '请先启用这台机器人，再生成配对码');
          const purpose = pairPurpose(payload);
          const previousCode = payload.previousCode === undefined ? undefined : field(payload, 'previousCode');
          const previousClaims = previousCode
            ? service.pairStatus().challenges.find(challenge => challenge.code === previousCode && challenge.purpose === purpose)?.claims ?? []
            : [];
          return rpcOk({ ...service.issuePairCode(purpose, previousCode), previousClaims, ...service.pairStatus() });
        }
        case ACCOUNT_METHODS.pairEnd: {
          const purpose = pairPurpose(payload);
          service.endPairCode(field(payload, 'code'), purpose);
          return rpcOk(service.pairStatus());
        }
        case ACCOUNT_METHODS.pairManual: {
          const purpose = pairPurpose(payload);
          const openid = field(payload, 'openid');
          const result = service.addManualMember(purpose, openid);
          if (!result.ok) return rpcFailure('pair/rejected', result.message);
          return rpcOk({ ...result, ...service.pairStatus() });
        }
        case ACCOUNT_METHODS.pairRename: {
          const openid = field(payload, 'openid');
          const nickname = typeof payload.nickname === 'string' ? payload.nickname : '';
          const result = service.renameMember(openid, nickname);
          if (!result.ok) return rpcFailure('pair/rejected', result.message);
          return rpcOk({ ...result, ...service.pairStatus() });
        }
        case ACCOUNT_METHODS.pairRevoke: {
          const purpose = pairPurpose(payload);
          const result = service.revokePair(field(payload, 'openid'), purpose);
          if (!result.ok) return rpcFailure('pair/rejected', result.message);
          return rpcOk({ ...result, ...service.pairStatus() });
        }
        default:
          return rpcFailure(RPC_ERROR_CODES.unknownMethod, `未知方法: ${method}`);
      }
    } catch (error) {
      return rpcFailure('pair/invalid', error instanceof Error ? error.message : '配对操作失败');
    }
  };
}

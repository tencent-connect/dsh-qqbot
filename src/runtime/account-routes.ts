/**
 * 账号端点 RPC 处理器 — /api/dsh-qqbot/account
 *
 * 只负责访问控制：配对码管理（生成/关闭/手动添加/改名/撤销/状态查询）。
 * 配置读写与配置页候选数据在 `/api/dsh-qqbot/config`（config-routes.ts）。
 *
 * 经宿主 Connection 共享通道调用（rpc-carrier.ts 注册）：来源围栏与
 * 浏览器认证由宿主施加；本模块只做业务校验。
 */
import type { PairPurpose } from '../shared/pairing-protocol.ts';
import { ACCOUNT_METHODS, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { RpcMethodHandler, RpcResult } from '../rpc-carrier.ts';
import { rpcFailure, rpcOk } from '../rpc-carrier.ts';
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
 * 创建账号端点的方法处理器（bootstrap 经 registerPluginRpc 注册）。
 *
 * @param service - 账号访问服务（配对码与名单）
 */
export function createAccountRpcHandler(service: AccountAccessService): RpcMethodHandler {
  return async (method, payload): Promise<RpcResult> => {
    try {
      switch (method) {
        case ACCOUNT_METHODS.pairStatus:
          return rpcOk(service.pairStatus());
        case ACCOUNT_METHODS.pairIssue: {
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
          const openid = field(payload, 'openid', true);
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

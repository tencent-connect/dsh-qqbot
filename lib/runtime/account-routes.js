import { ACCOUNT_METHODS, RPC_ERROR_CODES } from "../shared/rpc-protocol.js";
import { rpcFailure, rpcOk } from "../rpc-carrier.js";
function field(payload, name, empty = false) {
    const value = payload[name];
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > 100_000)
        throw new Error(`${name} 无效`);
    return value;
}
function pairPurpose(payload) {
    const purpose = payload.purpose;
    if (purpose !== 'owner' && purpose !== 'allow-c2c' && purpose !== 'allow-group')
        throw new Error('认领用途无效');
    return purpose;
}
/**
 * 创建账号端点的方法处理器（src/index.ts 经 registerPluginRpc 注册）。
 *
 * @param service - 账号访问服务（配对码与名单）
 * @param commands - 斜杠命令清单
 */
export function createAccountRpcHandler(service, commands) {
    return async (method, payload) => {
        try {
            switch (method) {
                case ACCOUNT_METHODS.commands:
                    return rpcOk({ commands: commands() });
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
                    if (!result.ok)
                        return rpcFailure('pair/rejected', result.message);
                    return rpcOk({ ...result, ...service.pairStatus() });
                }
                case ACCOUNT_METHODS.pairRename: {
                    const openid = field(payload, 'openid');
                    const nickname = typeof payload.nickname === 'string' ? payload.nickname : '';
                    const result = service.renameMember(openid, nickname);
                    if (!result.ok)
                        return rpcFailure('pair/rejected', result.message);
                    return rpcOk({ ...result, ...service.pairStatus() });
                }
                case ACCOUNT_METHODS.pairRevoke: {
                    const purpose = pairPurpose(payload);
                    const result = service.revokePair(field(payload, 'openid'), purpose);
                    if (!result.ok)
                        return rpcFailure('pair/rejected', result.message);
                    return rpcOk({ ...result, ...service.pairStatus() });
                }
                default:
                    return rpcFailure(RPC_ERROR_CODES.unknownMethod, `未知方法: ${method}`);
            }
        }
        catch (error) {
            return rpcFailure('pair/invalid', error instanceof Error ? error.message : '配对操作失败');
        }
    };
}
//# sourceMappingURL=account-routes.js.map
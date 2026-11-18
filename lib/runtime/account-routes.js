import { ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT, RPC_ERROR_CODES } from "../shared/rpc-protocol.js";
import { registerPluginRpc, rpcFailure, rpcOk } from "../rpc-carrier.js";
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
export function registerAccountRoutes(ctx, resolve, commands) {
    registerPluginRpc(ctx, ACCOUNT_RPC_ENDPOINT, createAccountRpcHandler(resolve, commands));
}
export function createAccountRpcHandler(resolve, commands) {
    return async (method, payload) => {
        try {
            const appId = payload.appId === undefined ? null : field(payload, 'appId');
            const target = resolve(appId);
            if (method === ACCOUNT_METHODS.commands && !target && appId === null)
                return rpcOk({ commands: [] });
            if (!target)
                return rpcFailure('account/not-found', '找不到这个 QQ 机器人');
            const { service } = target;
            switch (method) {
                case ACCOUNT_METHODS.commands:
                    return rpcOk({ commands: commands(target) });
                case ACCOUNT_METHODS.pairStatus:
                    return rpcOk(service.pairStatus());
                case ACCOUNT_METHODS.pairIssue: {
                    if (!target.enabled)
                        return rpcFailure('pair/rejected', '请先启用这台机器人，再生成配对码');
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
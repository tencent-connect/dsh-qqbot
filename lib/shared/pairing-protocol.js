/**
 * 配对码认领协议 —— Web 与 QQ 两端共享的契约。
 *
 * 背景：官方 QQ 机器人 API 只给 openid（AppID 维度、匿名、群/私两套），用户看不到也拿不到。
 * Web 生成限时配对码，允许多人或多群连续认领同一用途的白名单：
 *   Web 生成码 → 用户在 QQ 直接发送该码 → 机器人把该消息的 openid 记为目标身份。
 *
 * 传输走宿主 Connection 通道（shared/rpc-protocol.ts 的 ACCOUNT_RPC_ENDPOINT 与方法名）。
 * 本模块只含类型 + 常量 + 纯函数（码生成/校验格式），零 node 依赖，
 * 客户端 bundle 会内联。运行期状态（谁生成了哪个码、TTL、是否已用）由配对服务持有。
 */
export const PAIR_PURPOSE_LABEL = {
    owner: '斜杠命令白名单',
    'allow-c2c': '私聊白名单',
    'allow-group': '群白名单',
};
/** 生成配对码：6 位大写字母数字，去掉易混字符（0/O/1/I）。 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generatePairCode(random = Math.random) {
    let out = '';
    for (let i = 0; i < 6; i += 1)
        out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)] ?? '2';
    return out;
}
/** 归一化用户输入的码（大小写、空格、连字符不影响）。 */
export function normalizePairCode(raw) {
    return raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}
/** openid 尾号展示（保留后 4 位，其余打码）。 */
export function openidTail(openid) {
    const tail = openid.slice(-4);
    return `…${tail}`;
}
export function formatWhitelistEntry(openid, nickname) {
    const name = nickname.trim();
    if (!name)
        return openid;
    return openid + ':' + (/[,，;；"\r\n]/.test(name) ? JSON.stringify(name) : name);
}
export function parseWhitelistEntries(text) {
    const entry = (input, openid, nickname) => {
        const id = openid.trim();
        return !id || id.length > 1024 || /\s|\0/.test(id)
            ? { input, message: 'OpenID 无效' }
            : { input, openid: id, nickname: nickname.trim() };
    };
    return text.split(/\r?\n/).flatMap((line) => {
        const input = line.trim();
        if (!input)
            return [];
        // A quoted nickname occupies one line so its punctuation cannot become another OpenID.
        if (/[:：]\s*"/.test(input)) {
            const quoted = /^([^:：,，;；]+)[:：]\s*("(?:[^"\\]|\\.)*")$/.exec(input);
            if (quoted?.[1] && quoted[2]) {
                try {
                    return [entry(input, quoted[1], JSON.parse(quoted[2]))];
                }
                catch { /* malformed quoted nickname; never fall back to splitting it */ }
            }
            return [{ input, message: '带引号的昵称格式无效，请每行填写一个 OpenID。' }];
        }
        return input.split(/[,，;；]+/).map(part => part.trim()).filter(Boolean).map(part => {
            const colon = part.search(/[:：]/);
            return colon < 0 ? entry(part, part, '') : entry(part, part.slice(0, colon), part.slice(colon + 1));
        });
    });
}
//# sourceMappingURL=pairing-protocol.js.map
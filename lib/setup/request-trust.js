/**
 * 取单个请求头（只接受字符串值；数组头一律视为不可判定）。
 * @param headers - 请求头
 * @param name - 头名（Node 已小写化）
 * @returns 头值或 undefined
 */
function header(headers, name) {
    const value = headers[name];
    return typeof value === 'string' ? value : undefined;
}
/** 宿主围栏的 loopback 判定：localhost、IPv6 loopback 或 127/8 */
function isLoopbackHostname(hostname) {
    if (hostname === 'localhost' || hostname === '[::1]')
        return true;
    const parts = hostname.split('.');
    return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/**
 * 解析裸 authority（host / host:port）为已归一化的 URL。
 * @param authority - Host 头或 trustedHosts 条目
 * @param scheme - 解析所用协议（决定被剥掉的默认端口）
 * @returns URL；不可解析时 undefined
 */
function parseAuthority(authority, scheme = 'http:') {
    try {
        // http/https 属 WHATWG 特殊 scheme：解析结果必有 hostname，否则抛错
        return new URL(`${scheme}//${authority}`);
    }
    catch {
        return undefined;
    }
}
/** authority 的规范形态：未写端口时只有 hostname，写了端口才是 hostname:port */
function canonicalAuthority(entry, entryUrl) {
    const port = entryUrl.port !== ''
        ? entryUrl.port
        : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port;
    return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}
/** trustedHosts 匹配：带端口条目精确匹配，无端口条目匹配任意端口 */
function isTrustedAuthority(hostUrl, trustedHosts, protocol) {
    return trustedHosts.some((entry) => {
        const entryUrl = parseAuthority(entry, protocol);
        if (entryUrl === undefined)
            return false;
        return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
            ? entryUrl.hostname === hostUrl.hostname
            : entryUrl.host === hostUrl.host;
    });
}
/** Host 是否为监听地址字面量（忽略端口与 %zone 接口后缀） */
function isBindAddressAuthority(hostUrl, bindHost) {
    if (bindHost === undefined)
        return false;
    const zoneAt = bindHost.indexOf('%');
    const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt);
    const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address);
    return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname;
}
/** Origin 与 Host 是否同一 authority（Host 按 Origin 的 scheme 归一化默认端口） */
function isSameAuthorityOrigin(origin, host) {
    let originUrl;
    try {
        originUrl = new URL(origin);
    }
    catch {
        return false;
    }
    const scheme = originUrl.protocol === 'https:' ? 'https:' : originUrl.protocol === 'http:' ? 'http:' : undefined;
    if (scheme === undefined)
        return false;
    const hostUrl = parseAuthority(host, scheme);
    return hostUrl !== undefined && originUrl.host === hostUrl.host;
}
/**
 * 复刻宿主 /api 的 Host/Origin 围栏。
 *
 * Host 先行：必须是 loopback、监听地址字面量或 trustedHosts 中的 authority——
 * DNS rebinding 无法伪造 Host（浏览器按 URL 填写），这一关即挡掉攻击域名。
 * 随后拒绝显式跨站标记；带 Origin 时要求它等于 Host 同一 authority
 * （同源 POST 必带 Origin，故跨站请求仍被 Origin 关拦住）。
 * @param environment - 监听地址、协议与额外认可的 authority
 * @returns 信任判定函数
 */
export function createHostTrust(environment) {
    const protocol = environment.protocol === 'https:' ? 'https:' : 'http:';
    const trustedHosts = environment.trustedHosts ?? [];
    return (request) => {
        const host = header(request.headers, 'host');
        if (host === undefined)
            return false;
        const hostUrl = parseAuthority(host, protocol);
        if (hostUrl === undefined)
            return false;
        const allowed = isLoopbackHostname(hostUrl.hostname)
            || isTrustedAuthority(hostUrl, trustedHosts, protocol)
            || isBindAddressAuthority(hostUrl, environment.bindHost);
        if (!allowed)
            return false;
        if (header(request.headers, 'sec-fetch-site') === 'cross-site')
            return false;
        const origin = header(request.headers, 'origin');
        if (origin === undefined)
            return true;
        return isSameAuthorityOrigin(origin, host);
    };
}
/**
 * 兼容围栏：只有 Origin/Host 同源比较（旧宿主无信任服务时的行为）。
 *
 * 保留对 DNS rebinding 的已知缺口，仅作降级用；新增的 `sec-fetch-site:
 * cross-site` 拒绝是零成本的补充。
 * @returns 信任判定函数
 */
export function createLegacyTrust() {
    return (request) => {
        if (header(request.headers, 'sec-fetch-site') === 'cross-site')
            return false;
        const origin = header(request.headers, 'origin');
        if (origin === undefined)
            return true;
        try {
            return new URL(origin).host === header(request.headers, 'host');
        }
        catch {
            return false;
        }
    };
}
/**
 * 按宿主能力选择围栏，供 setup 注入端内路由。
 * @param services - 经 ctx.get 取得的宿主服务（缺失即降级）
 * @returns 信任判定函数
 */
export function createRouteTrust(services) {
    const connection = services.connection;
    if (connection !== undefined && typeof connection.isTrusted === 'function') {
        return (request) => {
            try {
                return connection.isTrusted?.(request) === true;
            }
            catch {
                return false;
            }
        };
    }
    const startup = services.webStartup;
    const webServer = services.webServer;
    if (startup !== undefined || webServer !== undefined) {
        return createHostTrust({
            bindHost: webServer?.host ?? startup?.host,
            protocol: webServer?.protocol,
            trustedHosts: startup?.trustedHosts,
        });
    }
    return createLegacyTrust();
}
//# sourceMappingURL=request-trust.js.map
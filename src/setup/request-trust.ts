/**
 * 端内路由的浏览器来源信任围栏
 *
 * 与 DSH 宿主 /api 的 Host/Origin 围栏（`@deepseek-ai/dsh-client-connection`
 * 的 api-request-trust）对齐。只比较 `Origin.host === Host` 挡得住跨站 CSRF，
 * 挡不住 DNS rebinding：攻击页面以自己的域名（如 `evil.example:3080`）同时
 * 充当 Host 与 Origin，二者相等，于是明文 POST 就能写配置或提交凭据。
 * 宿主的围栏额外要求 Host 属于 loopback、监听地址或 `--trusted-host` 声明的
 * authority；本模块复用宿主暴露的同一份事实，在插件自注册的 `/qqbot/*` 路由
 * 上做同等判断。
 *
 * 三级降级（新宿主 → 旧宿主）：
 * 1. `ctx.connection.isTrusted(request)`：直接采用宿主判定（0.2.2+ 暴露）；
 * 2. `ctx.webServer.host/protocol` + `ctx.webStartup.trustedHosts`：本地复刻
 *    同一套围栏（0.2.x 的 dsh web 提供这两个服务）；
 * 3. 只做 Origin/Host 同源比较：宿主不提供上述服务时的兼容路径。
 */
import type { IncomingHttpHeaders } from 'node:http';

/** 围栏只需要请求头（Node IncomingMessage 与 fetch Request 都能满足） */
export interface TrustRequest {
  headers: IncomingHttpHeaders;
}

/** 浏览器来源信任判定：true = 放行 */
export type TrustPolicy = (request: TrustRequest) => boolean;

/** 宿主暴露的信任事实（均为可选；缺省按不可用处理） */
export interface HostTrustEnvironment {
  /** 监听地址字面量（`ctx.webServer.host` 或 `--host`） */
  bindHost?: string;
  /** 监听协议（`ctx.webServer.protocol`；缺省 http） */
  protocol?: string;
  /** 额外认可的 authority（`ctx.webStartup.trustedHosts`，即 `--trusted-host`） */
  trustedHosts?: readonly string[];
}

/** 供工厂探测的宿主服务投影（值来自 ctx.get，类型在工厂内收窄） */
export interface HostTrustServices {
  connection?: unknown;
  webStartup?: unknown;
  webServer?: unknown;
}

/**
 * 取单个请求头（只接受字符串值；数组头一律视为不可判定）。
 * @param headers - 请求头
 * @param name - 头名（Node 已小写化）
 * @returns 头值或 undefined
 */
function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

/** 宿主围栏的 loopback 判定：localhost、IPv6 loopback 或 127/8 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const parts = hostname.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * 解析裸 authority（host / host:port）为已归一化的 URL。
 * @param authority - Host 头或 trustedHosts 条目
 * @param scheme - 解析所用协议（决定被剥掉的默认端口）
 * @returns URL；不可解析时 undefined
 */
function parseAuthority(authority: string, scheme = 'http:'): URL | undefined {
  try {
    // http/https 属 WHATWG 特殊 scheme：解析结果必有 hostname，否则抛错
    return new URL(`${scheme}//${authority}`);
  } catch {
    return undefined;
  }
}

/** authority 的规范形态：未写端口时只有 hostname，写了端口才是 hostname:port */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== ''
    ? entryUrl.port
    : new URL(`${entryUrl.protocol === 'http:' ? 'https:' : 'http:'}//${entry}`).port;
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`;
}

/** trustedHosts 匹配：带端口条目精确匹配，无端口条目匹配任意端口 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[], protocol: string): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, protocol);
    if (entryUrl === undefined) return false;
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host;
  });
}

/** Host 是否为监听地址字面量（忽略端口与 %zone 接口后缀） */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false;
  const zoneAt = bindHost.indexOf('%');
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt);
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address);
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname;
}

/** Origin 与 Host 是否同一 authority（Host 按 Origin 的 scheme 归一化默认端口） */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  const scheme = originUrl.protocol === 'https:' ? 'https:' : originUrl.protocol === 'http:' ? 'http:' : undefined;
  if (scheme === undefined) return false;
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
export function createHostTrust(environment: HostTrustEnvironment): TrustPolicy {
  const protocol = environment.protocol === 'https:' ? 'https:' : 'http:';
  const trustedHosts = environment.trustedHosts ?? [];
  return (request) => {
    const host = header(request.headers, 'host');
    if (host === undefined) return false;
    const hostUrl = parseAuthority(host, protocol);
    if (hostUrl === undefined) return false;
    const allowed = isLoopbackHostname(hostUrl.hostname)
      || isTrustedAuthority(hostUrl, trustedHosts, protocol)
      || isBindAddressAuthority(hostUrl, environment.bindHost);
    if (!allowed) return false;
    if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false;
    const origin = header(request.headers, 'origin');
    if (origin === undefined) return true;
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
export function createLegacyTrust(): TrustPolicy {
  return (request) => {
    if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false;
    const origin = header(request.headers, 'origin');
    if (origin === undefined) return true;
    try {
      return new URL(origin).host === header(request.headers, 'host');
    } catch {
      return false;
    }
  };
}

/**
 * 按宿主能力选择围栏，供 setup 注入端内路由。
 * @param services - 经 ctx.get 取得的宿主服务（缺失即降级）
 * @returns 信任判定函数
 */
export function createRouteTrust(services: HostTrustServices): TrustPolicy {
  const connection = services.connection as { isTrusted?: (request: TrustRequest) => boolean } | undefined;
  if (connection !== undefined && typeof connection.isTrusted === 'function') {
    return (request) => {
      try {
        return connection.isTrusted?.(request) === true;
      } catch {
        return false;
      }
    };
  }
  const startup = services.webStartup as { host?: string; trustedHosts?: readonly string[] } | undefined;
  const webServer = services.webServer as { host?: string; protocol?: string } | undefined;
  if (startup !== undefined || webServer !== undefined) {
    return createHostTrust({
      bindHost: webServer?.host ?? startup?.host,
      protocol: webServer?.protocol,
      trustedHosts: startup?.trustedHosts,
    });
  }
  return createLegacyTrust();
}

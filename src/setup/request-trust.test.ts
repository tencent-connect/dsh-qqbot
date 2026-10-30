/**
 * 端内路由来源信任围栏测试
 *
 * 对齐 DSH 宿主 /api 的 Host/Origin 围栏语义：
 * - Host 必须是 loopback、监听地址字面量或 trustedHosts 中的 authority
 *   （挡 DNS rebinding：浏览器按 URL 填 Host，攻击域名伪造不了这一关）；
 * - 拒绝 `sec-fetch-site: cross-site`；
 * - 带 Origin 时要求与 Host 同一 authority（含默认端口归一化）。
 */
import { describe, expect, it } from 'vitest';
import {
  createHostTrust,
  createLegacyTrust,
  createRouteTrust,
  type TrustRequest,
} from './request-trust.ts';

/** 构造只含请求头的判定输入 */
function request(headers: Record<string, string>): TrustRequest {
  return { headers };
}

describe('createHostTrust', () => {
  const loopbackTrust = createHostTrust({ bindHost: '127.0.0.1', protocol: 'http:' });

  it('loopback Host + 同源 Origin：放行', () => {
    expect(loopbackTrust(request({
      host: '127.0.0.1:3080',
      origin: 'http://127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
    }))).toBe(true);
  });

  it('DNS rebinding：Host 与 Origin 同为攻击域名：拒绝', () => {
    expect(loopbackTrust(request({
      host: 'evil.example:3080',
      origin: 'http://evil.example:3080',
      'sec-fetch-site': 'same-origin',
    }))).toBe(false);
  });

  it('跨站 Origin：拒绝（Host 可信也一样）', () => {
    expect(loopbackTrust(request({ host: '127.0.0.1:3080', origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('缺少 Host：拒绝（浏览器请求必带 Host）', () => {
    expect(loopbackTrust(request({ origin: 'http://127.0.0.1:3080' }))).toBe(false);
  });

  it('无 Origin（Desktop IPC 桥 / 非浏览器）：Host 可信即放行', () => {
    expect(loopbackTrust(request({ host: '127.0.0.1:3080' }))).toBe(true);
  });

  it('显式跨站标记：无 Origin 也拒绝', () => {
    expect(loopbackTrust(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });

  it('trustedHosts 无端口条目：匹配任意端口', () => {
    const trust = createHostTrust({ trustedHosts: ['app.example'] });
    expect(trust(request({ host: 'app.example:8443', origin: 'https://app.example:8443' }))).toBe(true);
  });

  it('trustedHosts 带端口条目：精确匹配端口', () => {
    const trust = createHostTrust({ trustedHosts: ['app.example:8443'] });
    expect(trust(request({ host: 'app.example:8443', origin: 'https://app.example:8443' }))).toBe(true);
    expect(trust(request({ host: 'app.example:8444', origin: 'https://app.example:8444' }))).toBe(false);
  });

  it('默认端口归一化：Host 无端口、Origin 显式 :443 视为同一 authority', () => {
    const trust = createHostTrust({ trustedHosts: ['app.example'] });
    expect(trust(request({ host: 'app.example', origin: 'https://app.example:443' }))).toBe(true);
  });

  it('监听地址字面量：任意端口放行（反代/直连部署）', () => {
    const trust = createHostTrust({ bindHost: '192.168.1.5' });
    expect(trust(request({ host: '192.168.1.5:3080', origin: 'http://192.168.1.5:3080' }))).toBe(true);
  });

  it('https 监听器：loopback 与 https Origin 放行', () => {
    const trust = createHostTrust({ bindHost: '127.0.0.1', protocol: 'https:' });
    expect(trust(request({ host: '127.0.0.1', origin: 'https://127.0.0.1' }))).toBe(true);
  });
});

describe('createLegacyTrust', () => {
  const legacy = createLegacyTrust();

  it('同源放行、跨站拒绝', () => {
    expect(legacy(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }))).toBe(true);
    expect(legacy(request({ host: '127.0.0.1:3080', origin: 'https://evil.example.com' }))).toBe(false);
  });

  it('DNS rebinding 在兼容路径下仍放行（已知缺口，仅旧宿主降级用）', () => {
    expect(legacy(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }))).toBe(true);
  });

  it('显式跨站标记：拒绝', () => {
    expect(legacy(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
});

describe('createRouteTrust', () => {
  it('优先采用宿主 connection.isTrusted 的判定', () => {
    const trust = createRouteTrust({ connection: { isTrusted: () => false } });
    expect(trust(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }))).toBe(false);
  });

  it('connection.isTrusted 抛错：按拒绝处理', () => {
    const trust = createRouteTrust({ connection: { isTrusted: () => { throw new Error('boom'); } } });
    expect(trust(request({ host: '127.0.0.1:3080' }))).toBe(false);
  });

  it('无 connection 时按 webServer/webStartup 复刻围栏：rebinding 拒绝', () => {
    const trust = createRouteTrust({ webStartup: { trustedHosts: [] }, webServer: { host: '127.0.0.1', protocol: 'http:' } });
    expect(trust(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }))).toBe(false);
    expect(trust(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }))).toBe(true);
  });

  it('webStartup 的 trustedHosts 生效（--trusted-host 场景）', () => {
    const trust = createRouteTrust({ webStartup: { trustedHosts: ['app.example'] }, webServer: { host: '127.0.0.1' } });
    expect(trust(request({ host: 'app.example', origin: 'https://app.example' }))).toBe(true);
    expect(trust(request({ host: 'evil.example', origin: 'https://evil.example' }))).toBe(false);
  });

  it('宿主无信任服务：回落 legacy（同源放行）', () => {
    const trust = createRouteTrust({});
    expect(trust(request({ host: 'app.example', origin: 'https://app.example' }))).toBe(true);
  });
});

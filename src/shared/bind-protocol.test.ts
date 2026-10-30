/**
 * toClientUrl 单元测试
 *
 * 背景（issue #95）：DSH 部署在反向代理子路径下（如 `dsh web --public-url
 * https://host/dsh/`）时，浏览器端若用根绝对路径 `/qqbot/...` 发请求，会绕过
 * 反代挂载的前缀而 404；客户端必须使用无前导斜杠的相对路径，交由浏览器按
 * 当前页面地址解析（与 DSH 主工程 `api/upload` 的做法一致）。
 */
import { describe, expect, it } from 'vitest';
import {
  BIND_CONFIG_PATH,
  BIND_MANUAL_PATH,
  BIND_REFRESH_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  toClientUrl,
} from './bind-protocol.ts';

describe('toClientUrl', () => {
  it('剥离开头的斜杠，保留其余路径', () => {
    expect(toClientUrl('/qqbot/im-qqbot/bind')).toBe('qqbot/im-qqbot/bind');
  });

  it('多个前导斜杠一并剥离', () => {
    expect(toClientUrl('///qqbot/im-qqbot/config')).toBe('qqbot/im-qqbot/config');
  });

  it('已为相对路径时保持原样', () => {
    expect(toClientUrl('qqbot/im-qqbot/bind/refresh')).toBe('qqbot/im-qqbot/bind/refresh');
  });

  it('空串与只含斜杠的输入退化为空串（相对当前文档地址）', () => {
    expect(toClientUrl('')).toBe('');
    expect(toClientUrl('/')).toBe('');
  });

  it('全部协议常量转换后均不带前导斜杠', () => {
    const paths = [
      BIND_STATE_PATH,
      BIND_REFRESH_PATH,
      BIND_MANUAL_PATH,
      BIND_UNBIND_PATH,
      BIND_CONFIG_PATH,
    ];
    for (const path of paths) {
      expect(path.startsWith('/')).toBe(true); // 服务端注册契约：绝对路径
      expect(toClientUrl(path).startsWith('/')).toBe(false); // 客户端契约：相对路径
    }
  });

  // issue #95 的核心回归断言：反代子路径下，相对路径必须解析回带前缀的地址
  it('反代子路径部署：解析结果保留 /dsh 前缀', () => {
    const base = 'https://host/dsh/';
    expect(new URL(toClientUrl(BIND_STATE_PATH), base).href)
      .toBe('https://host/dsh/qqbot/im-qqbot/bind');
    expect(new URL(toClientUrl(BIND_CONFIG_PATH), base).href)
      .toBe('https://host/dsh/qqbot/im-qqbot/config');
  });
});

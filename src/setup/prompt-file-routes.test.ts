import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { BIND_CONFIG_PATH, BIND_PROMPT_FILE_PATH, registerBindRoutes, type BindRoutesOptions, type WebRoute } from './bind-routes.ts';

const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

function request(method: string, body?: string, origin?: string): IncomingMessage {
  return {
    method,
    headers: { host: '127.0.0.1:3080', ...(origin === undefined ? {} : { origin }) },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(body, 'utf8'); },
  } as IncomingMessage;
}

function response(): ServerResponse & { body: string; headers: Record<string, string> } {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) { res.statusCode = status; res.headers = headers; },
    end(body: string) { res.body = body; },
  };
  return res as unknown as ServerResponse & { body: string; headers: Record<string, string> };
}

function routes(options: BindRoutesOptions = {}): Map<string, WebRoute> {
  const registered = new Map<string, WebRoute>();
  registerBindRoutes({ register(route) { registered.set(route.path, route); return () => registered.delete(route.path); } },
    null, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, options);
  return registered;
}

async function invoke(registered: Map<string, WebRoute>, path: string, req: IncomingMessage) {
  const res = response();
  const handler = registered.get(path);
  if (!handler) throw new Error(`missing route: ${path}`);
  await handler.handler(req, res);
  return res;
}

describe('本地提示词文件路由与配置保存', () => {
  let dir: string;
  let file: string;
  let patch: string;
  let original: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qqbot-prompt-route-'));
    file = join(dir, 'QQ群提示词_新.md');
    patch = join(dir, 'cordis.patch.yml');
    original = '# 保留其他配置\n- id: im-qqbot\n  config:\n    groupPrompt: 旧文本\n- id: other-plugin\n  config:\n    enabled: true\n';
    writeFileSync(file, '# 文件提示词\n请认真回答群消息。', 'utf8');
    writeFileSync(patch, original, 'utf8');
    profileDirState.dir = dir;
  });

  afterEach(() => {
    profileDirState.dir = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it('校验中文路径只返回元信息，不回传正文也不保存配置', async () => {
    const text = readFileSync(file, 'utf8');
    const res = await invoke(routes(), BIND_PROMPT_FILE_PATH, request('POST', JSON.stringify({ path: file })));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true, path: file, bytes: Buffer.byteLength(text), characters: Array.from(text).length, modifiedAt: expect.any(String),
    });
    expect(res.body).not.toContain('请认真回答群消息');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(readFileSync(patch, 'utf8')).toBe(original);
  });

  it.each(['GET', 'HEAD', 'PUT'])('文件校验 %s 方法返回 405', async (method) => {
    const res = await invoke(routes(), BIND_PROMPT_FILE_PATH, request(method, JSON.stringify({ path: file })));
    expect(res.statusCode).toBe(405);
  });

  it('拦截跨站请求，并允许同源与 Desktop 无 Origin 请求', async () => {
    const registered = routes();
    const body = JSON.stringify({ path: file });
    expect((await invoke(registered, BIND_PROMPT_FILE_PATH, request('POST', body, 'https://evil.example'))).statusCode).toBe(403);
    expect((await invoke(registered, BIND_PROMPT_FILE_PATH, request('POST', body, 'http://127.0.0.1:3080'))).statusCode).toBe(200);
    expect((await invoke(registered, BIND_PROMPT_FILE_PATH, request('POST', body))).statusCode).toBe(200);
  });

  it.each(['', '{', 'null', '[]', '{}', '{"path":42}', '{"path":"relative.md"}', ' '.repeat(4097)])(
    '拒绝非法或超过 4KB 的请求体 %j', async (body) => {
      const res = await invoke(routes(), BIND_PROMPT_FILE_PATH, request('POST', body));
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).ok).toBe(false);
    },
  );

  it('校验失败只返回明确原因，不暴露原生文件错误和绝对路径', async () => {
    rmSync(file);
    const res = await invoke(routes(), BIND_PROMPT_FILE_PATH, request('POST', JSON.stringify({ path: file })));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ ok: false, error: '提示词文件不存在，请重新选择' });
    expect(res.body).not.toContain(dir);
    expect(res.body).not.toContain('ENOENT');
  });

  it('文件模式与中文路径落盘，旧文本与其他插件配置完整保留', async () => {
    const res = await invoke(routes(), BIND_CONFIG_PATH, request('POST', JSON.stringify({
      groupPromptMode: 'file', groupPromptFile: file,
      directPromptMode: 'text', directPrompt: '私聊文本',
    })));
    expect(res.statusCode).toBe(200);
    const saved = parse(readFileSync(patch, 'utf8')) as Array<{ id: string; config: Record<string, unknown> }>;
    expect(saved.find((entry) => entry.id === 'im-qqbot')?.config).toEqual({
      groupPrompt: '旧文本', groupPromptMode: 'file', groupPromptFile: file, directPromptMode: 'text', directPrompt: '私聊文本',
    });
    expect(saved.find((entry) => entry.id === 'other-plugin')?.config).toEqual({ enabled: true });
    expect(readFileSync(patch, 'utf8')).not.toContain('请认真回答群消息');
  });

  it('切换文件模式时使用合并后的现有路径校验', async () => {
    const registered = routes({ currentConfig: () => ({ groupPromptMode: 'text', groupPromptFile: file }) });
    const res = await invoke(registered, BIND_CONFIG_PATH, request('POST', '{"groupPromptMode":"file"}'));
    expect(res.statusCode).toBe(200);
    expect(readFileSync(patch, 'utf8')).toContain('groupPromptMode: file');
  });

  it.each([
    { groupPromptMode: 'file' },
    { groupPromptMode: 'upload' },
    { groupPromptFile: 42 },
    { directPromptMode: 'file', directPromptFile: 'relative.md' },
  ])('保存失败不写入配置：%j', async (body) => {
    const res = await invoke(routes(), BIND_CONFIG_PATH, request('POST', JSON.stringify(body)));
    expect(res.statusCode).toBe(400);
    expect(readFileSync(patch, 'utf8')).toBe(original);
  });

  it('启用文件已失效时修改提示词来源会失败，保留旧配置', async () => {
    rmSync(file);
    const registered = routes({ currentConfig: () => ({ groupPromptMode: 'file', groupPromptFile: file }) });
    const res = await invoke(registered, BIND_CONFIG_PATH, request('POST', '{"groupPrompt":"新文本"}'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('不存在');
    expect(readFileSync(patch, 'utf8')).toBe(original);
  });

  it('失效的既有文件不阻止无关设置保存或切回文本', async () => {
    const registered = routes({ currentConfig: () => ({ groupPromptMode: 'file', groupPromptFile: join(dir, '不存在.md') }) });
    const res = await invoke(registered, BIND_CONFIG_PATH, request('POST', '{"showToolResults":true}'));
    expect(res.statusCode).toBe(200);
    const switched = await invoke(registered, BIND_CONFIG_PATH, request('POST', '{"groupPromptMode":"text"}'));
    expect(switched.statusCode).toBe(200);
  });

  it('另一 scope 的失效文件不阻止本 scope 修改，文本模式不读取保留路径', async () => {
    const registered = routes({ currentConfig: () => ({ directPromptMode: 'file', directPromptFile: join(dir, '不存在.md') }) });
    const res = await invoke(registered, BIND_CONFIG_PATH, request('POST', JSON.stringify({
      groupPromptMode: 'text', groupPromptFile: join(dir, '群聊未选择.md'), groupPrompt: '文本来源',
    })));
    expect(res.statusCode).toBe(200);
  });
});

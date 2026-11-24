import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSendFileTool } from './send-file-tool.ts';
import type { MediaSenderLike } from '../media/send-media.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const TARGET = 'c2c:u';

interface ToolDefinition {
  execute(
    args: { file_path: string; target?: string },
    exec: { signal: AbortSignal; agent?: unknown },
  ): Promise<Record<string, unknown>>;
}

function createMediaBot(): MediaSenderLike {
  return {
    sendImage: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u1' } }),
    sendVideo: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u2' } }),
    sendVoice: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u3' } }),
    sendFile: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u4' }, message: { id: 'm1' } }),
  };
}

function createConfig(cwd: string): ImQQBotConfig {
  return {
    cwd,
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 4 },
  } as unknown as ImQQBotConfig;
}

function createHarness(
  defaultCwd: string,
  currentWorkspace: () => string,
  sourceRecord?: { scope: 'c2c' | 'group'; peerId: string },
) {
  const register = vi.fn();
  const ctx = {
    get: vi.fn().mockReturnValue({ register }),
  } as unknown as Parameters<typeof registerSendFileTool>[0];
  const workspacePathForPeer = vi.fn((_scope: string, _peerId: string) => currentWorkspace());
  const manager = {
    findByAgent: vi.fn(() => sourceRecord),
    findBySessionId: vi.fn(() => sourceRecord),
    workspacePathForPeer,
  } as unknown as Parameters<typeof registerSendFileTool>[2];
  const mediaBot = createMediaBot();

  registerSendFileTool(ctx, mediaBot, manager, createConfig(defaultCwd), logger);

  expect(register).toHaveBeenCalledTimes(1);
  const definition = register.mock.calls[0][0] as ToolDefinition;
  return { definition, mediaBot, workspacePathForPeer };
}

function execute(definition: ToolDefinition, filePath: string, agent?: unknown) {
  return definition.execute(
    { file_path: filePath, target: TARGET },
    { signal: new AbortController().signal, ...(agent !== undefined ? { agent } : {}) },
  );
}

describe('qqbot_send_file peer workspace paths', () => {
  it('切换到工作区 B 后允许 B 内绝对路径并按 B 解析相对路径', async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-a-'));
    const workspaceB = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-b-'));
    const absoluteB = join(workspaceB, 'absolute.txt');
    const relativeB = join(workspaceB, 'relative.txt');
    await Promise.all([writeFile(absoluteB, 'b'), writeFile(relativeB, 'r')]);

    let currentWorkspace = workspaceA;
    const { definition, mediaBot, workspacePathForPeer } = createHarness(
      workspaceA, () => currentWorkspace,
    );
    expect(workspacePathForPeer).not.toHaveBeenCalled(); // 注册时不固定 cwd
    currentWorkspace = workspaceB;

    await execute(definition, absoluteB);
    await execute(definition, 'relative.txt');

    expect(workspacePathForPeer).toHaveBeenCalledWith('c2c', 'u');
    expect(mediaBot.sendFile).toHaveBeenCalledTimes(2);
    expect(mediaBot.sendFile).toHaveBeenNthCalledWith(
      1, { scope: 'c2c', targetId: 'u' }, { localPath: absoluteB }, { fileName: 'absolute.txt' },
    );
    expect(mediaBot.sendFile).toHaveBeenNthCalledWith(
      2, { scope: 'c2c', targetId: 'u' }, { localPath: relativeB }, { fileName: 'relative.txt' },
    );
  });

  it('显式 target 为其他 peer 时仍按文件所属 agent 的 cwd 校验', async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-a-'));
    const sourceWorkspace = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-source-'));
    const sourceFile = join(sourceWorkspace, 'source.txt');
    await writeFile(sourceFile, 'source');
    const { definition, mediaBot, workspacePathForPeer } = createHarness(
      workspaceA,
      () => workspaceA, // 接收方 target=c2c:u 的工作区，不应被用于源文件
      { scope: 'c2c', peerId: 'source-peer' },
    );
    workspacePathForPeer.mockImplementation((scope: string, peerId: string) =>
      peerId === 'source-peer' ? sourceWorkspace : workspaceA,
    );

    await execute(definition, sourceFile, { id: 'session-source' });

    expect(workspacePathForPeer).toHaveBeenCalledWith('c2c', 'source-peer');
    expect(mediaBot.sendFile).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'u' },
      { localPath: sourceFile },
      { fileName: 'source.txt' },
    );
  });

  it('切换后默认目录 A 不再放行，其它越界路径仍拒绝', async () => {
    const workspaceA = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-a-'));
    const workspaceB = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-b-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'dsh-qqbot-send-out-'));
    const defaultFile = join(workspaceA, 'default.txt');
    const outside = join(outsideDir, 'outside.txt');
    await Promise.all([writeFile(defaultFile, 'a'), writeFile(outside, 'x')]);
    const { definition, mediaBot } = createHarness(workspaceA, () => workspaceB);

    await expect(execute(definition, defaultFile)).rejects.toThrow('不在允许的目录内');
    await expect(execute(definition, outside)).rejects.toThrow('不在允许的目录内');
    expect(mediaBot.sendFile).not.toHaveBeenCalled();
  });
});

/**
 * /sendfile 命令安全测试
 *
 * 重点不是「能发出去」，而是「不该发的绝不发」：白名单拒绝时发送器零调用、
 * 目录/不存在不抛错、鉴权回调拦下名单外身份。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import { sendFileCommand } from './sendfile.ts';
import type { CommandDeps } from './types.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { MediaSenderLike } from '../media/send-media.ts';
import type { Logger } from '../types.ts';

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-sendfile-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createLogger(): Logger & { warn: ReturnType<typeof vi.fn> } {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSender(): MediaSenderLike {
  return {
    sendImage: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u1' } }),
    sendVideo: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u2' } }),
    sendVoice: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u3' } }),
    sendFile: vi.fn().mockResolvedValue({ upload: { file_uuid: 'u4' }, message: { id: 'm1' } }),
  };
}

function createConfig(
  cwd: string,
  sendFile: Partial<ImQQBotConfig['sendFile']> = {},
  access: Partial<ImQQBotConfig['access']> = {},
): ImQQBotConfig {
  return {
    cwd,
    textChunkLimit: 4500,
    access: { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [], ...access },
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 4, ...sendFile },
  } as unknown as ImQQBotConfig;
}

function makeCtx(line: string, senderId = 'u1'): SlashCommandHandlerContext {
  // 与 SDK slashCommand 一致：command.raw 是去掉命令名之后的参数原文
  const rawText = line.replace(/^\/sendfile\s*/, '');
  return {
    bot: {},
    message: { senderId, kind: 'c2c' },
    replyTarget: { scope: 'c2c', targetId: senderId, msgId: 'msg-1' },
    state: {},
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, trace: () => {} },
    stop: () => {},
    stopped: false,
    stopReason: undefined,
    signal: new AbortController().signal,
    abort: () => {},
    aborted: false,
    receivedAt: Date.now(),
    command: { name: 'sendfile', args: rawText ? rawText.split(/\s+/) : [], raw: rawText },
  } as unknown as SlashCommandHandlerContext;
}

function command(config: ImQQBotConfig, sender: MediaSenderLike | undefined, logger: Logger) {
  return sendFileCommand({
    manager: undefined as unknown as CommandDeps['manager'],
    config,
    logger,
    getMediaSender: () => sender,
  });
}

describe('/sendfile（复用 qqbot_send_file 的路径白名单与分类发送）', () => {
  it('① 允许路径 → 按扩展名调用 sender 并返回成功提示', async () => {
    const cwd = tempDir();
    const png = join(cwd, 'chart.png');
    writeFileSync(png, 'x');
    const sender = createSender();
    const reply = await command(createConfig(cwd), sender, createLogger()).handler(makeCtx(`/sendfile ${png}`));

    expect(typeof reply).toBe('string');
    expect(reply).toContain('已发送 chart.png');
    expect(sender.sendImage).toHaveBeenCalledOnce();
    expect(sender.sendFile).not.toHaveBeenCalled();
    expect(sender.sendImage).toHaveBeenCalledWith(
      { scope: 'c2c', targetId: 'u1', msgId: 'msg-1' },
      { localPath: png },
    );
  });

  it('② restrictPaths 开启且路径在 root 外 → 拒绝文案 + sender 零调用 + warn', async () => {
    const cwd = tempDir();
    const outsideDir = tempDir();
    const secret = join(outsideDir, 'secret.txt');
    writeFileSync(secret, 'top-secret');
    const sender = createSender();
    const logger = createLogger();
    const reply = await command(createConfig(cwd), sender, logger).handler(makeCtx(`/sendfile ${secret}`));

    expect(reply).toContain('拒绝发送');
    expect(reply).toContain('允许范围');
    expect(reply).toContain(secret);
    expect(sender.sendFile).not.toHaveBeenCalled();
    expect(sender.sendImage).not.toHaveBeenCalled();
    expect(sender.sendVideo).not.toHaveBeenCalled();
    expect(sender.sendVoice).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain(secret);
  });

  it('② 补充：白名单判定先于存在性判定（越权路径即使是幽灵文件也只报拒绝）', async () => {
    const cwd = tempDir();
    const ghost = join(tempDir(), 'ghost-not-there.txt');
    const sender = createSender();
    const reply = await command(createConfig(cwd), sender, createLogger()).handler(makeCtx(`/sendfile ${ghost}`));

    expect(reply).toContain('拒绝发送');
    expect(reply).not.toContain('文件不存在');
    expect(sender.sendFile).not.toHaveBeenCalled();
  });

  it('③ 文件不存在 → 友好提示、不抛错、不调用 sender', async () => {
    const cwd = tempDir();
    const sender = createSender();
    const cmd = command(createConfig(cwd), sender, createLogger());

    await expect(cmd.handler(makeCtx(`/sendfile ${join(cwd, 'ghost.pdf')}`)))
      .resolves.toContain('文件不存在');
    expect(sender.sendFile).not.toHaveBeenCalled();
  });

  it('④ 目录 → 拒绝（非普通文件），不调用 sender', async () => {
    const cwd = tempDir();
    const sub = join(cwd, 'subdir');
    mkdirSync(sub);
    const sender = createSender();
    const reply = await command(createConfig(cwd), sender, createLogger()).handler(makeCtx(`/sendfile ${sub}`));

    expect(reply).toContain('无法发送');
    expect(reply).toContain('不是普通文件');
    expect(sender.sendFile).not.toHaveBeenCalled();
  });

  it('⑤ 鉴权不匹配身份 → authorized 返回拒绝文案（框架层拦截，handler 不执行）', () => {
    const config = createConfig(tempDir(), {}, { c2cMode: 'allowlist', c2cAllow: ['u1'] });
    const cmd = command(config, createSender(), createLogger());

    expect(cmd.scope).toBe('c2c');
    expect(cmd.authorized).toBeTypeOf('function');
    const denied = cmd.authorized?.(makeCtx('/sendfile x', 'stranger'));
    expect(denied).not.toBe(true);
    expect(typeof denied).toBe('string');
    // 名单内身份放行
    expect(cmd.authorized?.(makeCtx('/sendfile x', 'u1'))).toBe(true);
  });

  it('restrictPaths 关闭 → 白名单外的路径也可发送（开关真的生效，非恒拒绝）', async () => {
    const cwd = tempDir();
    const file = join(tempDir(), 'note.txt');
    writeFileSync(file, 'x');
    const sender = createSender();
    const reply = await command(createConfig(cwd, { restrictPaths: false }), sender, createLogger())
      .handler(makeCtx(`/sendfile ${file}`));

    expect(reply).toContain('已发送 note.txt');
    expect(sender.sendFile).toHaveBeenCalledOnce();
  });

  it('相对路径按进程 cwd 解析并经 resolve 规范化（与 qqbot_send_file 工具同口径）', async () => {
    const cwd = tempDir();
    const nested = join(cwd, 'deep');
    mkdirSync(nested);
    const file = join(cwd, 'ok.txt');
    writeFileSync(file, 'x');
    const sender = createSender();
    // 真正的相对路径（含 ../ 段）：与工具一样按进程 cwd 解析，不是按 config.cwd
    const reply = await command(createConfig(cwd), sender, createLogger())
      .handler(makeCtx(`/sendfile ${relative(process.cwd(), join(nested, '..', 'ok.txt'))}`));

    expect(reply).toContain('已发送 ok.txt');
    expect(sender.sendFile).toHaveBeenCalledOnce();
    expect((sender.sendFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toEqual({ localPath: file });
  });

  it('sendFile 配置缺失 → 可理解提示，不抛错', async () => {
    const cwd = tempDir();
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'x');
    const config = { ...createConfig(cwd), sendFile: undefined } as unknown as ImQQBotConfig;
    const sender = createSender();
    const reply = await command(config, sender, createLogger()).handler(makeCtx(`/sendfile ${file}`));

    expect(reply).toContain('未配置');
    expect(sender.sendFile).not.toHaveBeenCalled();
  });

  it('空参数 → 返回用法提示，不调用 sender', async () => {
    const sender = createSender();
    const reply = await command(createConfig(tempDir()), sender, createLogger()).handler(makeCtx('/sendfile'));

    expect(reply).toContain('用法');
    expect(sender.sendFile).not.toHaveBeenCalled();
  });

  it('发送器未就绪 → 提示不可用，不抛错', async () => {
    const cwd = tempDir();
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'x');
    const reply = await command(createConfig(cwd), undefined, createLogger()).handler(makeCtx(`/sendfile ${file}`));

    expect(reply).toContain('未就绪');
  });

  it('平台发送失败 → 透出错误文案，不抛错', async () => {
    const cwd = tempDir();
    const file = join(cwd, 'a.txt');
    writeFileSync(file, 'x');
    const sender = createSender();
    (sender.sendFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('upload timeout'));
    const reply = await command(createConfig(cwd), sender, createLogger()).handler(makeCtx(`/sendfile ${file}`));

    expect(reply).toContain('发送失败');
    expect(reply).toContain('upload timeout');
    expect(sender.sendFile).toHaveBeenCalledOnce();
  });
});
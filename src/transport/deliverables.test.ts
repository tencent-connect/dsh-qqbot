import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliverablesDeliverer } from './deliverables.ts';
import type { MediaSenderLike } from '../media/send-media.ts';
import type { QQBotSender } from './outbound-buffer.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function createSender(): QQBotSender {
  return { sendMarkdown: vi.fn().mockResolvedValue(undefined), openStream: vi.fn() };
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
    textChunkLimit: 4500,
    sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: true, maxFiles: 4 },
  } as unknown as ImQQBotConfig;
}

const TARGET: ReplyTarget = { scope: 'c2c', targetId: 'u' };

describe('DeliverablesDeliverer', () => {
  it('存在的文件按扩展名分发发送', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qqbot-dlv-'));
    const png = join(dir, 'a.png');
    const md = join(dir, 'b.md');
    await writeFile(png, 'x');
    await writeFile(md, 'y');

    const mediaBot = createMediaBot();
    const sender = createSender();
    const deliverer = new DeliverablesDeliverer(sender, mediaBot, createConfig(dir), logger);

    await deliverer.deliver(TARGET, [{ path: png }, { path: md, description: '文档' }]);

    expect(mediaBot.sendImage).toHaveBeenCalledTimes(1);
    expect(mediaBot.sendFile).toHaveBeenCalledTimes(1);
    expect(sender.sendMarkdown).not.toHaveBeenCalled(); // 全部送达，无需降级提示
  });

  it('缺失文件降级为文字提示，不阻断其余文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qqbot-dlv-'));
    const ok = join(dir, 'ok.txt');
    await writeFile(ok, 'x');

    const mediaBot = createMediaBot();
    const sender = createSender();
    const deliverer = new DeliverablesDeliverer(sender, mediaBot, createConfig(dir), logger);

    await deliverer.deliver(TARGET, [{ path: ok }, { path: join(dir, 'gone.txt') }]);

    expect(mediaBot.sendFile).toHaveBeenCalledTimes(1); // 存在的那个已发送
    expect(sender.sendMarkdown).toHaveBeenCalledTimes(1);
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(text).toContain('未能直接发送');
    expect(text).toContain('gone.txt');
  });

  it('白名单外的路径直接进未送达清单，不调用发送器', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qqbot-dlv-'));
    const outside = join(tmpdir(), `outside-${Date.now()}.txt`);
    await writeFile(outside, 'x');

    const mediaBot = createMediaBot();
    const sender = createSender();
    const deliverer = new DeliverablesDeliverer(sender, mediaBot, createConfig(dir), logger);

    await deliverer.deliver(TARGET, [{ path: outside }]);

    expect(mediaBot.sendFile).not.toHaveBeenCalled();
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(text).toContain('路径不在允许范围');
  });

  it('maxFiles 截断单轮投递数量，超限文件进未送达提示', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-qqbot-dlv-'));
    const files = await Promise.all(['a', 'b', 'c'].map(async (n) => {
      const p = join(dir, `${n}.txt`);
      await writeFile(p, n);
      return { path: p };
    }));

    const mediaBot = createMediaBot();
    const sender = createSender();
    const config = createConfig(dir);
    (config as { sendFile: { maxFiles: number } }).sendFile.maxFiles = 2;
    const deliverer = new DeliverablesDeliverer(sender, mediaBot, config, logger);

    await deliverer.deliver(TARGET, files);

    expect(mediaBot.sendFile).toHaveBeenCalledTimes(2);
    const text = (sender.sendMarkdown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(text).toContain('超出单轮投递上限');
    expect(text).toContain('c.txt');
  });
});

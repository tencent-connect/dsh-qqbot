/**
 * /sendfile 命令单测
 *
 * 覆盖：参数校验 / 群聊门禁 / 大小上限 / 引号剥离 / SDK 桥接参数透传 / 失败语义。
 * bot.sendFile 用 spy 桩，不触真实网络。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendFileCommand } from './send-file.ts';

const workspace = mkdtempSync(join(tmpdir(), 'send-file-test-'));

function tempFile(name: string, bytes?: number, sparse = false): string {
  const path = join(workspace, name);
  if (bytes === undefined) {
    writeFileSync(path, 'hello');
  } else if (sparse) {
    // 稀疏文件：声明长度但几乎不占磁盘，秒建
    writeFileSync(path, '');
    truncateSync(path, bytes);
  } else {
    writeFileSync(path, Buffer.alloc(bytes, 1));
  }
  return path;
}

function makeCtx(opts: {
  raw?: string;
  kind?: 'c2c' | 'group';
  sendFile?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  const calls: unknown[][] = [];
  const scope = opts.kind ?? 'c2c';
  const replyTarget = { scope, targetId: scope === 'group' ? 'group-1' : 'user-1', msgId: 'msg-1' };
  const ctx = {
    command: { name: 'sendfile', args: [], raw: opts.raw ?? '' },
    message: { kind: scope, senderId: 'user-1' },
    replyTarget,
    bot: {
      sendFile:
        opts.sendFile ??
        (async (...args: unknown[]) => {
          calls.push(args);
          return { upload: { file_uuid: 'u1' }, message: { id: 'm2' } };
        }),
    },
  };
  return { ctx, calls, replyTarget };
}

function run(ctx: unknown): Promise<string> {
  return sendFileCommand().handler(ctx as never) as Promise<string>;
}

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('/sendfile', () => {
  it('无参数 → 用法提示', async () => {
    const { ctx, calls } = makeCtx({ raw: '' });
    expect(await run(ctx)).toContain('用法');
    expect(calls).toHaveLength(0);
  });

  it('群聊 → 明确拒绝（v1 仅私聊），不触发送', async () => {
    const { ctx, calls } = makeCtx({ raw: 'C:\\any.pdf', kind: 'group' });
    expect(await run(ctx)).toContain('群聊暂不开放');
    expect(calls).toHaveLength(0);
  });

  it('相对路径 → 要求绝对路径', async () => {
    const { ctx } = makeCtx({ raw: 'some/relative.pdf' });
    expect(await run(ctx)).toContain('绝对路径');
  });

  it('文件不存在 → 报错含路径', async () => {
    const missing = join(workspace, 'nope.pdf');
    const { ctx } = makeCtx({ raw: missing });
    expect(await run(ctx)).toContain('文件不存在');
  });

  it('空文件 → 拒发', async () => {
    const empty = tempFile('empty.bin', 0);
    const { ctx } = makeCtx({ raw: empty });
    expect(await run(ctx)).toContain('空文件');
  });

  it('目录 → 非文件拒绝', async () => {
    const { ctx } = makeCtx({ raw: workspace });
    expect(await run(ctx)).toContain('路径不是文件');
  });

  it('超过 20MB 上限 → 友好拒绝并报当前大小', async () => {
    const big = tempFile('big.pdf', 21 * 1024 * 1024, true);
    expect(statSync(big).size).toBe(21 * 1024 * 1024);
    const { ctx, calls } = makeCtx({ raw: big });
    const reply = await run(ctx);
    expect(reply).toContain('超过');
    expect(reply).toContain('20.0 MB');
    expect(calls).toHaveLength(0);
  });

  it('成功路径 → 桥接参数逐字透传 + 确认消息', async () => {
    const file = tempFile('report.pdf');
    const { ctx, calls, replyTarget } = makeCtx({ raw: file });
    const reply = await run(ctx);
    expect(reply).toContain('已发送');
    expect(reply).toContain('report.pdf');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual([replyTarget, { localPath: file }, { fileName: 'report.pdf' }]);
  });

  it('引号包裹的含空格路径 → 剥引号后正常发送', async () => {
    const file = tempFile('my paper.pdf');
    const { ctx, calls } = makeCtx({ raw: `"${file}"` });
    expect(await run(ctx)).toContain('已发送');
    expect(calls[0]?.[1]).toEqual({ localPath: file });
  });

  it('SDK 抛错 → 发送失败语义（markdown 报错不静默）', async () => {
    const file = tempFile('ok.pdf');
    const { ctx } = makeCtx({
      raw: file,
      sendFile: async () => {
        throw new Error('media upload rejected: 429');
      },
    });
    const reply = await run(ctx);
    expect(reply).toContain('发送失败');
    expect(reply).toContain('429');
  });

  it('临时工作区可用（测试自检）', () => {
    expect(existsSync(workspace)).toBe(true);
  });
});

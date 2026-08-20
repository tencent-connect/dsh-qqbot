/**
 * file-sender 单测 — [[FILE:]] 标记协议文本处理（mock bot，不真发）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processFileMarkers, splitPathExpr } from './file-sender.js';
import type { QQBotFileSender } from './outbound-buffer.js';
import type { Logger, ReplyTarget } from '../types.js';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const target: ReplyTarget = { scope: 'c2c', targetId: 'user_x', msgId: 'm1' };

function createBot(impl?: QQBotFileSender['sendFile']): QQBotFileSender {
  return { sendFile: impl ?? vi.fn().mockResolvedValue({ message: { id: 'mock-msg' } }) };
}

describe('processFileMarkers', () => {
  let bot: QQBotFileSender;
  let logger: Logger;

  beforeEach(() => {
    bot = createBot();
    logger = createLogger();
  });

  it('无标记原样返回', () => {
    expect(processFileMarkers(bot, target, '你好，这是普通文本', logger)).toBe('你好，这是普通文本');
    expect(bot.sendFile).not.toHaveBeenCalled();
  });

  it('单个标记被移除，前后文本保留', () => {
    const out = processFileMarkers(bot, target, '文件来了 [[FILE:/etc/hostname]] 请查收', logger);
    expect(out).not.toContain('[[FILE:');
    expect(out).toContain('文件来了');
    expect(out).toContain('请查收');
    expect(bot.sendFile).toHaveBeenCalledWith(target, { localPath: '/etc/hostname' }, { fileName: 'hostname' });
  });

  it('带显示名标记传 fileName', () => {
    processFileMarkers(bot, target, '[[FILE:/etc/hostname|主机名.txt]]', logger);
    expect(bot.sendFile).toHaveBeenCalledWith(target, { localPath: '/etc/hostname' }, { fileName: '主机名.txt' });
  });

  it('不存在的文件不抛错，正文保留', () => {
    const out = processFileMarkers(bot, target, '[[FILE:/no/such/file.xyz]] 正文', logger);
    expect(out).toContain('正文');
  });

  it('未闭合标记降级提示', () => {
    const out = processFileMarkers(bot, target, '前半 [[FILE:/etc/hostname', logger);
    expect(out).toContain('未闭合');
  });

  it('多个标记全部提取', () => {
    const out = processFileMarkers(bot, target, 'A[[FILE:/etc/hostname]]B[[FILE:/etc/hostname|b.txt]]C', logger);
    expect(out).toBe('ABC');
    expect(bot.sendFile).toHaveBeenCalledTimes(2);
  });

  it('空标记提示', () => {
    const out = processFileMarkers(bot, target, '[[FILE:]]', logger);
    expect(out).toContain('文件标记为空');
  });
});

describe('splitPathExpr', () => {
  it('无 | 取 basename', () => {
    expect(splitPathExpr('/a/b/c.txt')).toEqual({ localPath: '/a/b/c.txt', fileName: 'c.txt' });
  });
  it('有 | 拆分并 trim', () => {
    expect(splitPathExpr('/a/b/c.txt | 显示 名.txt')).toEqual({ localPath: '/a/b/c.txt', fileName: '显示 名.txt' });
  });
});

import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as dns from 'node:dns';
import { MEDIA_ROOT } from '../media/media-cleaner.ts';
import { downloadMediaAttachments, imageExtension, correctImageExt } from './attachment.ts';
import type { Logger } from '../types.ts';

vi.mock('../media/media-cleaner.ts', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return { MEDIA_ROOT: mkdtempSync(join(tmpdir(), 'dsh-qqbot-attachment-')) };
});

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const gif = Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1');
const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

beforeEach(() => {
  vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['8.8.8.8']);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

afterAll(() => {
  rmSync(MEDIA_ROOT, { recursive: true, force: true });
});

describe('downloadMediaAttachments', () => {
  it.each([
    { name: 'GIF89a 修正为 .gif', filename: 'photo.png', bytes: gif, contentType: 'image/png', ext: '.gif' },
    { name: 'JPEG 修正为 .jpg', filename: 'photo.png', bytes: jpeg, contentType: 'image/png', ext: '.jpg' },
    { name: '真实 PNG 保留 .png', filename: 'photo.png', bytes: png, contentType: 'image/png', ext: '.png' },
    { name: 'JPEG 保留 .jpeg', filename: 'photo.jpeg', bytes: jpeg, contentType: 'image/png', ext: '.jpeg' },
    { name: '未知格式保留 .png', filename: 'photo.png', bytes: Buffer.from('unknown'), contentType: 'image/png', ext: '.png' },
    { name: '非图片不修正扩展名', filename: 'data.bin', bytes: gif, contentType: 'file', ext: '.bin' },
    { name: '无扩展名补全', filename: 'photo', bytes: gif, contentType: 'image', ext: '.gif' },
    { name: '扩展名比较忽略大小写', filename: 'photo.JPEG', bytes: jpeg, contentType: 'image/png', ext: '.JPEG' },
    { name: 'GIF87a 修正扩展名', filename: 'photo.png', bytes: Buffer.from('GIF87a'), contentType: 'image/png', ext: '.gif' },
    { name: 'WebP 修正扩展名', filename: 'photo.png', bytes: Buffer.from('RIFF0000WEBP'), contentType: 'image/png', ext: '.webp' },
    { name: 'BMP 修正扩展名', filename: 'photo.png', bytes: Buffer.from('BM0000'), contentType: 'image/png', ext: '.bmp' },
  ])('$name', async ({ filename, bytes, contentType, ext }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes))));

    const results = await downloadMediaAttachments(
      [{ filename, content_type: contentType, size: bytes.length, url: 'https://example.com/image' }],
      { enabled: true, maxMB: 1, ttlHours: 24 },
      logger,
    );

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(extname(result.localPath)).toBe(ext);
    expect(result.filename).toBe(filename);
    expect(result.contentType).toBe(contentType === 'file' ? 'file' : 'image');
    expect(readFileSync(result.localPath)).toEqual(bytes);
    expect(readdirSync(MEDIA_ROOT)).toEqual([basename(result.localPath)]);
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(`→ ${result.localPath}`));
  });
});

describe('imageExtension（纯函数：magic bytes 识别）', () => {
  it.each([
    { name: 'GIF89a', buf: Buffer.from('GIF89a\x01\x00', 'latin1'), ext: '.gif' },
    { name: 'GIF87a', buf: Buffer.from('GIF87a', 'latin1'), ext: '.gif' },
    { name: 'PNG', buf: Buffer.from('89504e470d0a1a0a', 'hex'), ext: '.png' },
    { name: 'JPEG', buf: Buffer.from('ffd8ffe0', 'hex'), ext: '.jpg' },
    { name: 'WebP', buf: Buffer.from('RIFF0000WEBP', 'latin1'), ext: '.webp' },
    { name: 'BMP', buf: Buffer.from('BM00', 'latin1'), ext: '.bmp' },
  ])('识别 $name → $ext', ({ buf, ext }) => {
    expect(imageExtension(buf)).toBe(ext);
  });

  it('未知格式 → undefined', () => {
    expect(imageExtension(Buffer.from('unknown-bytes'))).toBeUndefined();
  });

  it('短 buffer 不越界（安全落到 undefined）', () => {
    expect(imageExtension(Buffer.from([0xff]))).toBeUndefined();          // JPEG 需 3 字节
    expect(imageExtension(Buffer.from('RIFF', 'latin1'))).toBeUndefined(); // WebP 需 12 字节
    expect(imageExtension(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('correctImageExt（纯函数：扩展名修正）', () => {
  const gif = Buffer.from('GIF89a', 'latin1');
  const jpeg = Buffer.from('ffd8ff', 'hex');

  it('声明与真实不符 → 替换为真实扩展名，主体不变', () => {
    expect(correctImageExt('/m/photo_123.png', gif)).toBe('/m/photo_123.gif');
  });

  it('声明与真实一致 → 原样返回', () => {
    expect(correctImageExt('/m/photo.gif', gif)).toBe('/m/photo.gif');
  });

  it('jpg≈jpeg 视为等价 → 不改名', () => {
    expect(correctImageExt('/m/photo.jpeg', jpeg)).toBe('/m/photo.jpeg');
  });

  it('大小写不敏感比较 → 保留原名', () => {
    expect(correctImageExt('/m/photo.JPEG', jpeg)).toBe('/m/photo.JPEG');
  });

  it('未识别格式 → 原样返回', () => {
    expect(correctImageExt('/m/photo.png', Buffer.from('xx'))).toBe('/m/photo.png');
  });
});

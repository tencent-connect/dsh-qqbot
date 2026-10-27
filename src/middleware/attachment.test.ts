import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { DownloadedFile } from '../transport/attachment.ts';

const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }));
vi.mock('../transport/attachment.ts', () => ({
  downloadMediaAttachments: downloadMock,
  isImageContentType: (contentType?: string) => contentType === 'image' || contentType?.startsWith('image/') === true,
}));

import { attachmentProcessor, groupImagePreloader } from './attachment.ts';

const config = { media: { enabled: true, maxMB: 10 } } as unknown as ImQQBotConfig;
const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function context(kind: 'group' | 'c2c' = 'group') {
  return {
    message: {
      kind,
      senderId: 'u1', senderName: 'Alice', content: '看图', messageId: 'm1',
      timestamp: '2026-02-03T04:05:06.000Z',
      attachments: [{ content_type: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png' }],
    },
    state: {},
    stop: vi.fn(),
  } as unknown as MiddlewareContext;
}

describe('group image attachment middleware', () => {
  beforeEach(() => downloadMock.mockReset());

  it('preloads group images but does not preload C2C attachments', async () => {
    const downloaded: DownloadedFile = { contentType: 'image', filename: 'a.png', localPath: '/tmp/a.png' };
    downloadMock.mockResolvedValue([downloaded]);
    const preload = groupImagePreloader(config, logger);
    const group = context('group');
    await preload(group, async () => {});
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(downloadMock.mock.calls[0]?.[0]).toEqual([{ content_type: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png', width: undefined, height: undefined }]);
    expect(group.state.preDownloadedFiles).toEqual([downloaded]);

    const c2c = context('c2c');
    await preload(c2c, async () => {});
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  it('does not redownload a successful preload and retries a failed preload downstream', async () => {
    const downloaded: DownloadedFile = { contentType: 'image', filename: 'a.png', localPath: '/tmp/a.png' };
    downloadMock.mockResolvedValueOnce([downloaded]);
    const group = context();
    await groupImagePreloader(config, logger)(group, async () => {});
    await attachmentProcessor(config, logger)(group, async () => {});
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(group.state.downloadedFiles).toEqual([downloaded]);

    downloadMock.mockReset().mockResolvedValue([]);
    const failed = context();
    await groupImagePreloader(config, logger)(failed, async () => {});
    await attachmentProcessor(config, logger)(failed, async () => {});
    expect(downloadMock).toHaveBeenCalledTimes(2);
    expect(downloadMock.mock.calls[1]?.[0]).toEqual([{ content_type: 'image/png', filename: 'a.png', size: 12, url: 'https://example.test/a.png' }]);
    expect(failed.state.downloadedFiles).toEqual([]);
  });
});

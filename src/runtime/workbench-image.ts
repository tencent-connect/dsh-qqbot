import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { imageExtension } from '../transport/attachment.ts';

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const mimeTypes: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp',
};

export async function workbenchImage(root: string, name: string): Promise<Response | undefined> {
  if (!name || name === '.' || name === '..' || /[\\/:\0]/.test(name)) return undefined;
  const path = join(root, name);
  try {
    if (!(await lstat(path)).isFile()) return undefined;
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_PREVIEW_BYTES) return undefined;
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== buffer.length) return undefined;
      const type = mimeTypes[imageExtension(buffer) ?? ''];
      if (!type) return undefined;
      return new Response(buffer, { headers: {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
      } });
    } finally {
      await file.close();
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP')) return undefined;
    throw error;
  }
}

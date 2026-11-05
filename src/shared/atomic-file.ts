import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Replaces the file atomically. A directory sync failure after replacement emits a warning. */
export function atomicWrite(path: string, chunks: Iterable<string>): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    try {
      for (const chunk of chunks) {
        const buffer = Buffer.from(chunk);
        let offset = 0;
        while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }

  // Windows fsync cannot flush the read-only directory handle used below.
  if (process.platform === 'win32') return;
  try {
    const directory = openSync(parent, 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.emitWarning(`QQ state was replaced but directory sync failed: ${reason}`, {
      code: 'QQBOT_DIRECTORY_SYNC_FAILED',
    });
  }
}

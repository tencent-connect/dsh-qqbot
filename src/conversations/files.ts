import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Commit the complete replacement before publishing it to in-memory readers. */
export function atomicWrite(path: string, chunks: Iterable<string>): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    for (const chunk of chunks) {
      const buffer = Buffer.from(chunk);
      let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    }
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd); rmSync(temporary, { force: true }); throw error;
  }
  closeSync(fd);
  try { renameSync(temporary, path); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

function completeSize(fd: number): number {
  let position = fstatSync(fd).size;
  const buffer = Buffer.alloc(32_768);
  while (position > 0) {
    const size = Math.min(buffer.length, position);
    position -= size;
    const count = readSync(fd, buffer, 0, size, position);
    const newline = buffer.subarray(0, count).lastIndexOf(10);
    if (newline >= 0) return position + newline + 1;
  }
  return 0;
}

/** A newline commits a record; discard a torn append before writing the next one. */
export function appendRecord(path: string, value: unknown): void {
  const buffer = Buffer.from(`${JSON.stringify(value)}\n`);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'a+', 0o600);
  try {
    const end = completeSize(fd);
    if (end !== fstatSync(fd).size) ftruncateSync(fd, end);
    let offset = 0;
    while (offset < buffer.length) offset += writeSync(fd, buffer, offset, buffer.length - offset);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** Walk complete JSONL records backwards using bounded buffers. */
export function* reversedLines(path: string): Generator<string> {
  if (!existsSync(path)) return;
  const fd = openSync(path, 'r');
  try {
    let position = completeSize(fd);
    let pending = '';
    while (position > 0) {
      const size = Math.min(32_768, position);
      position -= size;
      const bytes = Buffer.alloc(size);
      readSync(fd, bytes, 0, size, position);
      pending = bytes.toString('latin1') + pending;
      let newline = pending.lastIndexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(newline + 1);
        pending = pending.slice(0, newline);
        if (line) yield Buffer.from(line, 'latin1').toString('utf8');
        newline = pending.lastIndexOf('\n');
      }
      if (pending.length > 1_048_576) throw new Error('QQ conversation log contains an oversized record');
    }
    if (pending) yield Buffer.from(pending, 'latin1').toString('utf8');
  } finally { closeSync(fd); }
}

/** Stream complete records forwards, retaining only one bounded line. */
export function* forwardLines(path: string): Generator<string> {
  if (!existsSync(path)) return;
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(32_768);
    let pending = '';
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      pending += buffer.subarray(0, count).toString('latin1');
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line) yield Buffer.from(line, 'latin1').toString('utf8');
        newline = pending.indexOf('\n');
      }
      if (pending.length > 1_048_576) throw new Error('QQ conversation log contains an oversized record');
    }
  } finally { closeSync(fd); }
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendRecord, forwardLines, reversedLines } from './files.ts';

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'qq-log-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('QQ JSONL recovery', () => {
  it.each(['', '{"id":"unfinished"}', '{"id":'])('repairs a torn append before writing the next record, tail %j', tail => {
    const path = join(root, 'messages.jsonl');
    writeFileSync(path, `{"id":"first"}\n${tail}`);
    appendRecord(path, { id: 'next' });
    expect(readFileSync(path, 'utf8')).toBe('{"id":"first"}\n{"id":"next"}\n');
    expect([...forwardLines(path)]).toEqual(['{"id":"first"}', '{"id":"next"}']);
    expect([...reversedLines(path)]).toEqual(['{"id":"next"}', '{"id":"first"}']);
  });

  it('replaces an initial torn record and creates a new log on the next append', () => {
    const path = join(root, 'nested', 'messages.jsonl');
    appendRecord(path, { id: 'first' });
    expect(readFileSync(path, 'utf8')).toBe('{"id":"first"}\n');
    writeFileSync(path, '{"id":"unfinished"}');
    appendRecord(path, { id: 'next' });
    expect(readFileSync(path, 'utf8')).toBe('{"id":"next"}\n');
  });

  it.each(['{"id":"unfinished"}', '{"id":', ''])('reads only newline-terminated records before a torn tail %j', tail => {
    const path = join(root, 'messages.jsonl');
    const bytes = `{"id":"first"}\n{"id":"second"}\n${tail}`;
    writeFileSync(path, bytes);
    expect([...forwardLines(path)]).toEqual(['{"id":"first"}', '{"id":"second"}']);
    expect([...reversedLines(path)]).toEqual(['{"id":"second"}', '{"id":"first"}']);
    expect(readFileSync(path, 'utf8')).toBe(bytes);
  });

  it('ignores a file containing only an unterminated record', () => {
    const path = join(root, 'messages.jsonl');
    writeFileSync(path, '{"id":"unfinished"}');
    expect([...forwardLines(path)]).toEqual([]);
    expect([...reversedLines(path)]).toEqual([]);
  });

  it('keeps UTF-8 records intact across read buffers while dropping a large partial tail', () => {
    const path = join(root, 'messages.jsonl');
    const line = JSON.stringify({ text: '群消息🙂'.repeat(10_000) });
    writeFileSync(path, `${line}\n${line.slice(0, -2)}`);
    const forward = [...forwardLines(path)];
    const reversed = [...reversedLines(path)];
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0]).toBe(line);
    expect(reversed[0]).toBe(line);
    appendRecord(path, { text: '追加🙂' });
    expect(readFileSync(path, 'utf8')).toBe(`${line}\n{"text":"追加🙂"}\n`);
  });
});

import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { EXTRA_MAX_CHARS } from './extra.ts';
import { readPromptFile } from './file.ts';

describe('path-backed prompts', () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'qq-prompt-file-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const file = async (name: string, data: string | Uint8Array): Promise<string> => {
    const path = join(directory, name);
    await writeFile(path, data);
    return path;
  };

  it('keeps Markdown formatting, template markers and the last line', async () => {
    const source = '# 任务\r\n\r\n- 保留 {{workspace}}\r\n最后一行\r\n';
    await expect(readPromptFile(await file('提示词.MD', '\uFEFF' + source))).resolves.toBe(source.replaceAll('\r\n', '\n'));
  });

  it('reads UTF-16 text with a BOM', async () => {
    const utf16 = new Uint8Array([255, 254, 87, 91, 181, 107]); // 字段
    await expect(readPromptFile(await file('试.txt', utf16))).resolves.toBe('字段');
  });

  it('reopens the path after a file replacement and reflects an empty file', async () => {
    const path = await file('prompt.md', 'first');
    await expect(readPromptFile(path)).resolves.toBe('first');
    await rename(await file('replacement.md', 'second'), path);
    await expect(readPromptFile(path)).resolves.toBe('second');
    await writeFile(path, '');
    await expect(readPromptFile(path)).resolves.toBe('');
  });

  it('rejects relative paths, missing files, directories, and invalid content', async () => {
    await expect(readPromptFile('prompt.md')).rejects.toThrow('绝对');
    await expect(readPromptFile(join(directory, 'missing.md'))).rejects.toThrow('找不到');
    await expect(readPromptFile(await file('bad.csv', 'text'))).rejects.toThrow('.docx');
    const folder = join(directory, 'folder.md');
    await mkdir(folder);
    await expect(readPromptFile(folder)).rejects.toThrow('普通文件');
    await expect(readPromptFile(await file('bad.txt', new Uint8Array([255])))).rejects.toThrow('编码');
    await expect(readPromptFile(await file('large.md', '字'.repeat(EXTRA_MAX_CHARS + 1)))).rejects.toThrow('80,000');
    await expect(readPromptFile(await file('bad.docx', 'bad'))).rejects.toThrow('DOCX');
  });

  it('extracts Word paragraphs, tabs, line breaks and escaped characters', async () => {
    const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body><w:p><w:r><w:t>标题 &amp; {{cwd}}</w:t><w:tab/><w:t>正文</w:t><w:br/><w:t>下一行</w:t>'
      + '</w:r></w:p><w:p><w:r><w:t>附录</w:t></w:r></w:p></w:body></w:document>';
    const doc = await file('prompt.docx', zipSync({ 'word/document.xml': strToU8(xml) }));
    await expect(readPromptFile(doc)).resolves.toBe('标题 & {{cwd}}\t正文\n下一行\n附录');
  });

  it('limits DOCX expansion before parsing XML and ignores other ZIP entries', async () => {
    const large = strToU8('x'.repeat(4 * 1024 * 1024 + 1));
    const oversizedBody = new Uint8Array(zipSync({ 'word/document.xml': large }));
    await expect(readPromptFile(await file('large.docx', oversizedBody))).rejects.toThrow('正文过大');
    const missingBody = new Uint8Array(zipSync({ 'word/media/file.txt': large }));
    await expect(readPromptFile(await file('unreadable.docx', missingBody))).rejects.toThrow('没有可读取的正文');
  });
});

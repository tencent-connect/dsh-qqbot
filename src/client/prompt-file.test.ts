import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { EXTRA_MAX_CHARS } from '../prompt/extra.ts';
import { readPromptFile } from './prompt-file.ts';

describe('prompt file import', () => {
  it('keeps Markdown formatting, template markers and the last line', async () => {
    const source = '# 任务\r\n\r\n- 保留 {{workspace}}\r\n最后一行\r\n';
    await expect(readPromptFile(new File(['\uFEFF', source], '提示词.MD'))).resolves.toBe(source.replaceAll('\r\n', '\n'));
  });

  it('reads UTF-16 text with a BOM', async () => {
    const utf16 = new Uint8Array([255, 254, 87, 91, 181, 107]); // 字段
    await expect(readPromptFile(new File([utf16], '试.txt'))).resolves.toBe('字段');
  });

  it('rejects unsupported, empty, oversized and malformed input', async () => {
    await expect(readPromptFile(new File(['text'], 'bad.csv'))).rejects.toThrow('.docx');
    await expect(readPromptFile(new File([' \n'], 'empty.txt'))).rejects.toThrow('有效');
    await expect(readPromptFile(new File([new Uint8Array([255])], 'bad.txt'))).rejects.toThrow('编码');
    await expect(readPromptFile(new File(['字'.repeat(EXTRA_MAX_CHARS + 1)], 'large.md'))).rejects.toThrow('80,000');
    await expect(readPromptFile(new File(['bad'], 'bad.docx'))).rejects.toThrow('DOCX');
  });

  it('limits DOCX expansion before parsing XML and ignores other ZIP entries', async () => {
    const large = strToU8('x'.repeat(4 * 1024 * 1024 + 1));
    const oversizedBody = new Uint8Array(zipSync({ 'word/document.xml': large }));
    await expect(readPromptFile(new File([oversizedBody], 'large.docx'))).rejects.toThrow('正文过大');
    const missingBody = new Uint8Array(zipSync({ 'word/media/file.txt': large }));
    await expect(readPromptFile(new File([missingBody], 'unreadable.docx'))).rejects.toThrow('没有可读取的正文');
  });
});

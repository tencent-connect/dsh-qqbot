import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Unzip, UnzipInflate } from 'fflate';
import { WORKBENCH_PROMPT_PATH_LIMIT } from '../shared/workbench-agent-settings.ts';
import { EXTRA_MAX_CHARS } from './extra.ts';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024;
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

export class PromptFileError extends Error {}

export function parsePromptFilePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > WORKBENCH_PROMPT_PATH_LIMIT || value.includes('\0') || !isAbsolute(value.trim())) {
    throw new PromptFileError('请输入 DSH 宿主上的绝对文件路径。');
  }
  const path = value.trim();
  if (!['.md', '.txt', '.docx'].includes(extname(path).toLowerCase())) {
    throw new PromptFileError('提示词文件支持 .md、.txt 和 .docx。');
  }
  return path;
}

async function readBytes(path: string, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) throw new PromptFileError('提示词路径必须指向普通文件。');
      if (stat.size > MAX_FILE_BYTES) throw new PromptFileError('提示词文件大小不能超过 8 MiB。');
      const buffer = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        signal?.throwIfAborted();
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) return buffer.subarray(0, offset);
        offset += bytesRead;
      }
      throw new PromptFileError('读取期间提示词文件已更新，请重试。');
    } finally {
      await file.close();
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PromptFileError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new PromptFileError('找不到补充提示词文件。');
    }
    throw new PromptFileError('无法读取补充提示词文件，请检查文件权限。');
  }
}

function decodeText(bytes: Uint8Array): string {
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
    : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function readWordBody(bytes: Uint8Array): string {
  let found = false;
  let complete = false;
  let size = 0;
  const parts: Uint8Array[] = [];
  const archive = new Unzip(file => {
    if (file.name !== 'word/document.xml') return;
    if (found) throw new PromptFileError('DOCX 包含重复的正文。');
    found = true;
    if ((file.originalSize ?? 0) > MAX_DOCUMENT_XML_BYTES) throw new PromptFileError('DOCX 正文过大。');
    file.ondata = (error, chunk, final) => {
      if (error) throw new PromptFileError('无法解压 DOCX 正文。');
      size += chunk.length;
      if (size > MAX_DOCUMENT_XML_BYTES) throw new PromptFileError('DOCX 正文过大。');
      parts.push(chunk);
      complete = final;
    };
    file.start();
  });
  archive.register(UnzipInflate);
  // Bound each inflate step and the total actual output, including archives without a declared size.
  for (let offset = 0; offset < bytes.length; offset += 2048) {
    const end = Math.min(offset + 2048, bytes.length);
    archive.push(bytes.subarray(offset, end), end === bytes.length);
  }
  if (!complete || size === 0) throw new PromptFileError('DOCX 中没有可读取的正文。');
  const bodyBytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bodyBytes.set(part, offset);
    offset += part.length;
  }
  const xml = decodeText(bodyBytes);
  if (xml.includes('<!DOCTYPE')) throw new PromptFileError('DOCX 正文格式无效。');
  const doc = new DOMParser({
    onError: () => { throw new PromptFileError('DOCX 正文格式无效。'); },
  }).parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const namespace = root?.namespaceURI ?? '';
  if (root?.localName !== 'document' || !WORD_NAMESPACES.has(namespace)) {
    throw new PromptFileError('DOCX 正文格式无效。');
  }
  const body = doc.getElementsByTagNameNS(namespace, 'body')[0];
  if (!body) throw new PromptFileError('DOCX 中没有可读取的正文。');
  const paragraphs = body.getElementsByTagNameNS(namespace, 'p');
  return Array.from(paragraphs, paragraph => {
    const text: string[] = [];
    for (const element of paragraph.getElementsByTagNameNS(namespace, '*')) {
      if (element.localName === 't') text.push(element.textContent ?? '');
      else if (element.localName === 'tab') text.push('\t');
      else if (element.localName === 'br' || element.localName === 'cr') text.push('\n');
    }
    return text.join('');
  }).join('\n');
}

export async function readPromptFile(value: unknown, signal?: AbortSignal): Promise<string> {
  const path = parsePromptFilePath(value);
  const word = extname(path).toLowerCase() === '.docx';
  const bytes = await readBytes(path, signal);
  signal?.throwIfAborted();
  let content: string;
  try {
    content = word ? readWordBody(bytes) : decodeText(bytes);
  } catch (error) {
    if (error instanceof PromptFileError) throw error;
    throw new PromptFileError(word ? '无法读取 DOCX 正文，请检查文件。' : '文本编码无法读取，请使用 UTF-8 或带 BOM 的 UTF-16。');
  }
  content = content.replace(/\r\n?/g, '\n');
  if (content.includes('\0')) throw new PromptFileError('提示词文件包含无效字符。');
  if (content.length > EXTRA_MAX_CHARS) throw new PromptFileError(`提示词文件最多 ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')} 字符，请缩短文件内容。`);
  return content;
}

import { Unzip, UnzipInflate } from 'fflate/browser';
import { EXTRA_MAX_CHARS } from '../prompt/extra.ts';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024;
const WORD_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);

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
    if (found) throw new Error('DOCX 包含重复的正文。');
    found = true;
    if ((file.originalSize ?? 0) > MAX_DOCUMENT_XML_BYTES) throw new Error('DOCX 正文过大。');
    file.ondata = (error, chunk, final) => {
      if (error) throw new Error('无法解压 DOCX 正文。');
      size += chunk.length;
      if (size > MAX_DOCUMENT_XML_BYTES) throw new Error('DOCX 正文过大。');
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
  if (!complete || size === 0) throw new Error('DOCX 中没有可读取的正文。');
  const bodyBytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bodyBytes.set(part, offset);
    offset += part.length;
  }
  const xml = decodeText(bodyBytes);
  if (xml.includes('<!DOCTYPE')) throw new Error('DOCX 正文格式无效。');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const namespace = doc.documentElement.namespaceURI ?? '';
  if (doc.documentElement.localName !== 'document' || !WORD_NAMESPACES.has(namespace)) {
    throw new Error('DOCX 正文格式无效。');
  }
  const body = doc.getElementsByTagNameNS(namespace, 'body')[0];
  if (!body) throw new Error('DOCX 中没有可读取的正文。');
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

export async function readPromptFile(file: File): Promise<string> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  if (extension !== 'md' && extension !== 'txt' && extension !== 'docx') {
    throw new Error('请选择 .md、.txt 或 .docx 文件。');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('文件大小不能超过 8 MiB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let content: string;
  try {
    content = extension === 'docx' ? readWordBody(bytes) : decodeText(bytes);
  } catch (error) {
    if (extension === 'docx' && error instanceof Error && error.message.startsWith('DOCX')) throw error;
    throw new Error(extension === 'docx' ? '无法读取 DOCX 正文，请检查文件。' : '文本编码无法读取，请使用 UTF-8 或带 BOM 的 UTF-16。');
  }
  content = content.replace(/\r\n?/g, '\n');
  if (!content.trim() || content.includes('\0')) throw new Error('文件中没有有效的提示词文本。');
  if (content.length > EXTRA_MAX_CHARS) throw new Error(`提示词最多 ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')} 字符，请缩短后再导入。`);
  return content;
}

import { createHash } from 'node:crypto';
import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { open, opendir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { Unzip, UnzipInflate } from 'fflate';
import { atomicWrite } from "../shared/atomic-file.js";
import { WORKBENCH_PROMPT_EXTENSIONS, WORKBENCH_PROMPT_PATH_LIMIT, } from "../shared/workbench-agent-settings.js";
import { EXTRA_MAX_CHARS } from "./extra.js";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_XML_BYTES = 4 * 1024 * 1024;
const WORD_NAMESPACES = new Set([
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
export class PromptFileError extends Error {
}
export class PromptFileConflict extends PromptFileError {
    constructor() { super('文件已被外部修改。请重新读取原文件后合并修改。'); }
}
function absolutePath(value) {
    if (typeof value !== 'string' || value.length > WORKBENCH_PROMPT_PATH_LIMIT || value.includes('\0') || !isAbsolute(value.trim())) {
        throw new PromptFileError('请输入 DSH 宿主上的绝对文件路径。');
    }
    return value.trim();
}
export function parsePromptFilePath(value) {
    const path = absolutePath(value);
    if (!WORKBENCH_PROMPT_EXTENSIONS.has(extname(path).toLowerCase())) {
        throw new PromptFileError('提示词文件支持 .md、.txt 和 .docx。');
    }
    return path;
}
export async function browsePromptFiles(directory, fromFile, signal) {
    const path = directory !== undefined ? resolve(absolutePath(directory)) : absolutePath(homedir());
    let initial = path;
    if (directory === undefined && typeof fromFile === 'string' && isAbsolute(fromFile.trim())) {
        initial = dirname(resolve(absolutePath(fromFile)));
    }
    const entries = [];
    let scanned = 0;
    let truncated = false;
    try {
        signal.throwIfAborted();
        for await (const child of await opendir(initial)) {
            signal.throwIfAborted();
            if (++scanned > 4096 || entries.length === 512) {
                truncated = true;
                break;
            }
            if (child.name.startsWith('.'))
                continue;
            const path = join(initial, child.name);
            if (path.length > WORKBENCH_PROMPT_PATH_LIMIT)
                continue;
            const info = child.isSymbolicLink() ? await stat(path).catch(() => undefined) : child;
            if (!info)
                continue;
            if (info.isDirectory())
                entries.push({ kind: 'directory', path, name: child.name });
            else if (info.isFile() && WORKBENCH_PROMPT_EXTENSIONS.has(extname(child.name).toLowerCase())) {
                entries.push({ kind: 'file', path, name: child.name });
            }
        }
    }
    catch {
        signal.throwIfAborted();
        throw new PromptFileError('无法读取此目录，请选择其他目录。');
    }
    const parent = dirname(initial);
    entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { directory: initial, parent: parent === initial ? null : parent, entries, truncated };
}
function fileIdentity(stat) {
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}
async function readBytes(path, signal) {
    signal?.throwIfAborted();
    try {
        const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
        try {
            const stat = await file.stat();
            if (!stat.isFile())
                throw new PromptFileError('提示词路径必须指向普通文件。');
            if (stat.size > MAX_FILE_BYTES)
                throw new PromptFileError('提示词文件大小不能超过 8 MiB。');
            const buffer = Buffer.alloc(stat.size + 1);
            let offset = 0;
            while (offset < buffer.length) {
                signal?.throwIfAborted();
                const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
                if (bytesRead === 0) {
                    if (fileIdentity(await file.stat()) !== fileIdentity(stat))
                        throw new PromptFileConflict();
                    return { bytes: buffer.subarray(0, offset), info: stat };
                }
                offset += bytesRead;
            }
            throw new PromptFileError('读取期间提示词文件已更新，请重试。');
        }
        finally {
            await file.close();
        }
    }
    catch (error) {
        signal?.throwIfAborted();
        if (error instanceof PromptFileError)
            throw error;
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new PromptFileError('找不到补充提示词文件。');
        }
        throw new PromptFileError('无法读取补充提示词文件，请检查文件权限。');
    }
}
function textEncoding(bytes) {
    return bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
        : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
}
function decodeText(bytes) {
    return new TextDecoder(textEncoding(bytes), { fatal: true }).decode(bytes);
}
function readWordBody(bytes) {
    let found = false;
    let complete = false;
    let size = 0;
    const parts = [];
    const archive = new Unzip(file => {
        if (file.name !== 'word/document.xml')
            return;
        if (found)
            throw new PromptFileError('DOCX 包含重复的正文。');
        found = true;
        if ((file.originalSize ?? 0) > MAX_DOCUMENT_XML_BYTES)
            throw new PromptFileError('DOCX 正文过大。');
        file.ondata = (error, chunk, final) => {
            if (error)
                throw new PromptFileError('无法解压 DOCX 正文。');
            size += chunk.length;
            if (size > MAX_DOCUMENT_XML_BYTES)
                throw new PromptFileError('DOCX 正文过大。');
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
    if (!complete || size === 0)
        throw new PromptFileError('DOCX 中没有可读取的正文。');
    const bodyBytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
        bodyBytes.set(part, offset);
        offset += part.length;
    }
    const xml = decodeText(bodyBytes);
    if (xml.includes('<!DOCTYPE'))
        throw new PromptFileError('DOCX 正文格式无效。');
    const doc = new DOMParser({
        onError: () => { throw new PromptFileError('DOCX 正文格式无效。'); },
    }).parseFromString(xml, 'application/xml');
    const root = doc.documentElement;
    const namespace = root?.namespaceURI ?? '';
    if (root?.localName !== 'document' || !WORD_NAMESPACES.has(namespace)) {
        throw new PromptFileError('DOCX 正文格式无效。');
    }
    const body = doc.getElementsByTagNameNS(namespace, 'body')[0];
    if (!body)
        throw new PromptFileError('DOCX 中没有可读取的正文。');
    const paragraphs = body.getElementsByTagNameNS(namespace, 'p');
    return Array.from(paragraphs, paragraph => {
        const text = [];
        for (const element of paragraph.getElementsByTagNameNS(namespace, '*')) {
            if (element.localName === 't')
                text.push(element.textContent ?? '');
            else if (element.localName === 'tab')
                text.push('\t');
            else if (element.localName === 'br' || element.localName === 'cr')
                text.push('\n');
        }
        return text.join('');
    }).join('\n');
}
function normalizePrompt(content) {
    content = content.replace(/\r\n?/g, '\n');
    if (content.includes('\0'))
        throw new PromptFileError('提示词文件包含无效字符。');
    if (content.length > EXTRA_MAX_CHARS)
        throw new PromptFileError(`提示词文件最多 ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')} 字符，请缩短文件内容。`);
    return content;
}
function parseContent(bytes, word) {
    let content;
    try {
        content = word ? readWordBody(bytes) : decodeText(bytes);
    }
    catch (error) {
        if (error instanceof PromptFileError)
            throw error;
        throw new PromptFileError(word ? '无法读取 DOCX 正文，请检查文件。' : '文本编码无法读取，请使用 UTF-8 或带 BOM 的 UTF-16。');
    }
    return normalizePrompt(content);
}
function revision(path, info, bytes) {
    return createHash('sha256').update(JSON.stringify([path, fileIdentity(info)])).update(bytes).digest('hex');
}
export async function readPromptFile(value, signal) {
    const path = parsePromptFilePath(value);
    const { bytes } = await readBytes(path, signal);
    signal?.throwIfAborted();
    return parseContent(bytes, extname(path).toLowerCase() === '.docx');
}
export async function previewPromptFile(value, signal) {
    const path = parsePromptFilePath(value);
    const { bytes, info } = await readBytes(path, signal);
    signal.throwIfAborted();
    const word = extname(path).toLowerCase() === '.docx';
    const text = parseContent(bytes, word);
    return word ? { kind: 'docx', text } : { kind: 'text', text, revision: revision(path, info, bytes) };
}
function encodeLikeSource(text, original) {
    const lineBreak = /\r\n?|\n/.exec(decodeText(original))?.[0] ?? '\n';
    const document = text.replaceAll('\n', lineBreak);
    const encoding = textEncoding(original);
    if (encoding === 'utf-16le')
        return Buffer.from('\uFEFF' + document, 'utf16le');
    if (encoding === 'utf-16be')
        return Buffer.from('\uFEFF' + document, 'utf16le').swap16();
    return Buffer.from(original[0] === 239 && original[1] === 187 && original[2] === 191 ? '\uFEFF' + document : document);
}
export async function writePromptFile(input, signal, assertWritable) {
    const path = parsePromptFilePath(input.path);
    if (extname(path).toLowerCase() === '.docx')
        throw new PromptFileError('请在原文编辑器里修改 DOCX。');
    if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision) || typeof input.text !== 'string') {
        throw new PromptFileError('提示词文件保存请求无效。');
    }
    const text = normalizePrompt(input.text);
    const { bytes, info } = await readBytes(path, signal);
    if (revision(path, info, bytes) !== input.revision)
        throw new PromptFileConflict();
    const updated = encodeLikeSource(text, bytes);
    try {
        const destination = realpathSync(path);
        if (!['.md', '.txt'].includes(extname(destination).toLowerCase())) {
            throw new PromptFileError('原文件必须为 MD 或 TXT。');
        }
        const verify = () => {
            if (realpathSync(path) !== destination || fileIdentity(lstatSync(destination)) !== fileIdentity(info)) {
                throw new PromptFileConflict();
            }
            accessSync(destination, constants.W_OK);
        };
        signal.throwIfAborted();
        assertWritable();
        verify();
        atomicWrite(destination, [updated], { mode: info.mode & 0o777, verify });
        return { kind: 'text', text, revision: revision(path, lstatSync(destination), updated) };
    }
    catch (error) {
        signal.throwIfAborted();
        assertWritable();
        if (error instanceof PromptFileError)
            throw error;
        throw new PromptFileError('无法保存原文件，请检查文件及目录的写入权限。');
    }
}
//# sourceMappingURL=file.js.map
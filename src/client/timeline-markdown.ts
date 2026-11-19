import { fromMarkdown } from 'mdast-util-from-markdown';
import { qzoneFaceCodes } from './qq-system-faces.ts';

const qqFaceCdn = 'https://qzonestyle.gtimg.cn/qzone/em/';
const special = /(?<image>!\[)|(?<shortcut><qqbot-cmd-input\s+text="[^"\r\n]*"\s+show="(?<show>[^"\r\n]*)"\s*\/>)|<faceType=(?<type>\d{1,3}),faceId="(?<faceId>[^"\r\n]{0,24})",ext="(?<ext>[^"\r\n]{0,2048})">|\[<face,id=(?<oldId>\d{1,4})\/?>]/g;

interface TimelineMarkdownOptions {
  hasImage: boolean;
  faceLabel: string;
  stickerLabel: string;
}

interface SourceNode {
  type: string;
  position?: { start: { offset?: number | undefined }; end: { offset?: number | undefined } };
  children?: readonly SourceNode[];
}

function escapedText(text: string): string {
  return text.replace(/[\\\u0060*_~[\]()<>!&|]/g, '\\$&');
}

function faceName(ext?: string): string | undefined {
  if (!ext) return undefined;
  try {
    const bytes = Uint8Array.from(atob(ext), char => char.charCodeAt(0));
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (data && typeof data === 'object' && 'text' in data && typeof data.text === 'string') {
      return data.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || undefined;
    }
  } catch {
    // The numeric system face ID is usable even when the extension is malformed.
  }
  return undefined;
}

function unicodeEmoji(id: string): string | undefined {
  const numeric = /^\d{4,7}$/.test(id) ? Number(id) : undefined;
  if (numeric !== undefined && numeric > 0x10ffff) return undefined;
  const text = numeric === undefined ? id : String.fromCodePoint(numeric);
  return /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(text) ? escapedText(text) : undefined;
}

function faceMarkdown(groups: Record<string, string | undefined>, options: TimelineMarkdownOptions): string {
  const id = groups.faceId ?? groups.oldId ?? '';
  const type = groups.type ?? '1';
  // Keep a separator so removing a token cannot join "!" and "[" into a remote image.
  if (type === '6' && options.hasImage) return ' ';
  const label = escapedText(faceName(groups.ext) ?? (type === '6' ? options.stickerLabel : options.faceLabel));
  const asset = type === '1' && /^\d{1,4}$/.test(id) ? qzoneFaceCodes[Number(id)] : undefined;
  if (asset !== undefined) return '![' + label + '](' + qqFaceCdn + 'e' + asset + '.gif)';
  if (type === '2') return unicodeEmoji(id) ?? label;
  return label;
}

function displayShortcut(text: string, index: number, length: number, display: string): string {
  const value = display.trim();
  if (!value) return ' ';
  const backtick = '\u0060';
  let width = 1;
  for (const run of value.matchAll(/\u0060+/g)) width = Math.max(width, run[0].length + 1);
  const delimiter = backtick.repeat(width);
  const alone = (index === 0 || text[index - 1] === '\n') && /^[ \t]*(?:\r?\n|$)/.test(text.slice(index + length));
  return (alone ? '- ' : '') + delimiter + ' ' + value + ' ' + delimiter;
}

/** Project QQ tokens to Markdown. Command labels are inert and only known face assets load automatically. */
export function timelineMarkdown(text: string, options: TimelineMarkdownOptions): string {
  const matches = [...text.matchAll(special)];
  if (!matches.length) return text;
  const literals: Array<{ start: number; end: number }> = [];
  const pending: SourceNode[] = [fromMarkdown(text)];
  while (pending.length) {
    const node = pending.pop();
    if (!node) break;
    if (node.type === 'code' || node.type === 'inlineCode') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) literals.push({ start, end });
    } else if (node.children) {
      pending.push(...node.children);
    }
  }
  let output = '';
  let done = 0;
  for (const match of matches) {
    const index = match.index;
    const groups = match.groups;
    if (!groups || literals.some(({ start, end }) => start <= index && index < end)) continue;
    let slashes = 0;
    while (text[index - slashes - 1] === '\\') slashes++;
    if (slashes % 2) continue;
    output += text.slice(done, index);
    output += groups.image ? '\\![' : groups.shortcut
      ? displayShortcut(text, index, match[0].length, groups.show ?? '') : faceMarkdown(groups, options);
    done = index + match[0].length;
  }
  return output + text.slice(done);
}

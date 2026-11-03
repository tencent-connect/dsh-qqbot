/**
 * 人设 role-card：markdown 文本，标题可用 `〔群聊〕` / `〔私聊〕` 标记归属某场景；
 * 无标记的小节两种场景都注入；注入前剥离标记，模型只见干净标题。
 *
 * 与 scope.ts 分工：scope 是"社交规则"，persona 是"你是谁/性格/语气"。
 */
import type { QQScope } from './scope.ts';

export const PERSONA_SECTION_NAME = 'qqbot:persona';
export const PERSONA_ORDER = 440;

interface ModeTag { scope: QQScope; re: RegExp }
const MODE_TAGS: ModeTag[] = [
  { scope: 'group', re: /[\[〔（(]\s*(?:群聊|group)\s*[\]〕）)]/gi },
  { scope: 'c2c', re: /[\[〔（(]\s*(?:私聊|单聊|c2c|dm)\s*[\]〕）)]/gi },
];
type SectionMode = 'all' | QQScope;

function detectMode(heading: string): SectionMode {
  for (const tag of MODE_TAGS) { tag.re.lastIndex = 0; if (tag.re.test(heading)) return tag.scope; }
  return 'all';
}
function stripModeTags(heading: string): string {
  let out = heading;
  for (const tag of MODE_TAGS) { tag.re.lastIndex = 0; out = out.replace(tag.re, ''); }
  return out.replace(/[ \t]+$/, '').replace(/[ \t]{2,}/g, ' ').trim();
}

export interface RoleSection { mode: SectionMode; heading: string | null; lines: string[] }

/** 按 markdown 标题把人设卡拆成小节，并识别场景标记。 */
export function parsePersonaSections(card: string): RoleSection[] {
  const sections: RoleSection[] = [];
  let current: RoleSection | null = null;
  for (const line of String(card ?? '').split('\n')) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) {
      if (!current) { current = { mode: 'all', heading: null, lines: [] }; sections.push(current); }
      current.lines.push(line);
      continue;
    }
    const rawTitle = heading[2] ?? '';
    const title = stripModeTags(rawTitle);
    current = { mode: detectMode(rawTitle), heading: title, lines: [`${heading[1]} ${title}`] };
    sections.push(current);
  }
  return sections;
}

/** 取某场景真正要注入的人设文本（剥标记、压空行）。 */
export function selectPersonaText(card: string, scope: QQScope): string {
  return parsePersonaSections(card)
    .filter((section) => section.mode === 'all' || section.mode === scope)
    .map((section) => section.lines.join('\n'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 供 UI 预览：每个小节在该场景下是否注入。 */
export function roleSectionReport(card: string, scope: QQScope): Array<{ heading: string; mode: SectionMode; injected: boolean; chars: number }> {
  return parsePersonaSections(card).map((section) => ({
    heading: section.heading ?? '(开头部分)',
    mode: section.mode,
    injected: section.mode === 'all' || section.mode === scope,
    chars: section.lines.join('\n').trim().length,
  }));
}

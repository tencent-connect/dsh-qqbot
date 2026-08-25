/**
 * Markdown 文本切分器
 *
 * QQ 单条消息有字符数限制（约 5000），需要在合适边界切分，
 * 并保持 GFM 表格、代码块的完整性。
 */

const CODE_FENCE_OPEN = /^```/;
const GFM_TABLE_LINE = /^\|.+\|$/;

/**
 * 按换行边界切分 Markdown 文本
 * - 不在代码块中间断开
 * - 不在 GFM 表格中间断开
 * - 优先在空行处断开
 */
export function chunkMarkdownText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  let inCodeBlock = false;
  let tableBuffer: string[] = [];

  const flushTable = (): void => {
    if (tableBuffer.length === 0) return;
    const block = tableBuffer.join('\n');
    tableBuffer = [];

    if (!current) {
      current = block;
      return;
    }

    const candidate = `${current}\n${block}`;
    if (candidate.length > limit) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  };

  const appendLine = (line: string): void => {
    // 超长单行硬切：单行超过 limit 时按字符切分（QQ 单条消息有字数上限，超长行会被拒）
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      return;
    }
    if (!current) {
      current = line;
      return;
    }
    const candidate = `${current}\n${line}`;
    if (candidate.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  };

  for (const line of lines) {
    if (CODE_FENCE_OPEN.test(line)) {
      flushTable();
      inCodeBlock = !inCodeBlock;
      appendLine(line);
      continue;
    }

    if (inCodeBlock) {
      appendLine(line);
      continue;
    }

    if (GFM_TABLE_LINE.test(line)) {
      tableBuffer.push(line);
      continue;
    }

    flushTable();
    appendLine(line);
  }

  flushTable();
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [text];
}

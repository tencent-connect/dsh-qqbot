/**
 * QQ markdown 方言降级器
 *
 * QQ 机器人 markdown 消息支持的语法有限（加粗/斜体/链接/行内代码/代码块/引用/列表/标题），
 * 不支持 GFM 表格与图片。本模块在 sendMarkdown 前把不兼容语法降级为 QQ 可渲染形式：
 *  - GFM 表格 → 键值列表（`key: value` 逐行）
 *  - 图片 ![...](url) → 链接文本 [描述](url)（QQ 不支持 markdown 图片）
 *  - 长代码块截断 + 提示（单消息预算有限）
 */

/** 表格分隔行（|---|） */
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]+\|?\s*$/;
/** 表格数据行 */
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;

/** 把一行 GFM 表格行解析为单元格数组（去空白、去转义管道符） */
function splitCells(line: string): string[] {
  const body = line.trim().replace(/^\||\|$/g, '');
  return body.split('|').map((c) => c.trim().replace(/\\([|])/g, '$1'));
}

/**
 * 降级文本中的 GFM 表格为键值列表。
 * 逐行扫描：连续表格行（含分隔行）聚合成块 → 表头+首行数据转 `k: v` 键值列表。
 */
export function downgradeTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let tableBlock: string[] = [];
  const flush = () => {
    if (tableBlock.length === 0) return;
    const rows = tableBlock.filter((l) => !TABLE_SEPARATOR.test(l)).slice(0, 4);
    tableBlock = [];
    if (rows.length === 0) return;
    const headers = splitCells(rows[0] ?? '');
    const dataRows = rows.slice(1);
    if (dataRows.length === 0) {
      out.push(headers.join(' / '));
      return;
    }
    for (const row of dataRows) {
      const cells = splitCells(row);
      const pairs = headers
        .map((h, i) => `${h}: ${cells[i] ?? ''}`)
        .filter((p) => !p.endsWith(': '));
      out.push(pairs.join(' ｜ '));
    }
    if (tableBlock.length > 4) {
      out.push(`…（共 ${tableBlock.length - 1} 行数据，表格已折叠）`);
    }
  };
  for (const line of lines) {
    if (TABLE_ROW.test(line)) {
      tableBlock.push(line);
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join('\n');
}

/** 行内图片 ![...](url) → [描述](url) */
export function downgradeImages(text: string): string {
  return text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) => `[${alt || '图片'}](${url})`);
}

/**
 * 长代码块截断：代码块总长 > maxCodeChars 时截断并附提示。
 */
export function truncateLongCodeBlocks(text: string, maxCodeChars = 1200): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inCode = false;
  let codeBuf: string[] = [];
  const flushCode = () => {
    if (codeBuf.length === 0) return;
    const joined = codeBuf.join('\n');
    codeBuf = [];
    if (joined.length <= maxCodeChars) {
      out.push(joined);
      return;
    }
    let cut = joined.slice(0, maxCodeChars);
    const lastNl = cut.lastIndexOf('\n');
    if (lastNl > maxCodeChars * 0.5) cut = cut.slice(0, lastNl);
    out.push(`${cut}\n…（代码过长已截断，共 ${joined.length} 字符）`);
  };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushCode();
      inCode = !inCode;
      out.push(line);
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
    } else {
      out.push(line);
    }
  }
  flushCode();
  return out.join('\n');
}

/** 完整降级管线（顺序：表格 → 图片 → 长代码块） */
export function sanitizeForQQ(text: string): string {
  return truncateLongCodeBlocks(downgradeImages(downgradeTables(text)));
}

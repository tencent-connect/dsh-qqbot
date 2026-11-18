import { describe, it, expect, vi } from 'vitest';
import {
  formatToolResult,
  type ToolResultData,
  type ToolsRegistryLike,
} from './tool-presenter.ts';

/** 构造 dsh tool/result 的 data（message.content 是扁平 ContentBlock[]） */
function resultData(
  content: Array<{ type: string; text?: string }>,
  extra: Partial<ToolResultData> = {},
): ToolResultData {
  return { message: { content, isError: false }, ...extra };
}

function registry(tool: { presentResult?: (args: unknown, result: unknown) => unknown }): ToolsRegistryLike {
  return { get: () => tool };
}

describe('formatToolResult', () => {
  it('把结果内容块原样交给 presentResult，并渲染 terminal 卡片', () => {
    const presentResult = vi.fn(() => ({ card: 'terminal', output: 'total 0\ndrwxr-xr-x 2', exitCode: 0 }));
    const text = formatToolResult(
      'bash',
      '{"command":"ls -l"}',
      resultData([{ type: 'text', text: 'total 0\ndrwxr-xr-x 2\n' }]),
      registry({ presentResult }),
      undefined,
    );

    expect(presentResult).toHaveBeenCalledWith(
      { command: 'ls -l' },
      { content: [{ type: 'text', text: 'total 0\ndrwxr-xr-x 2\n' }], isError: false },
    );
    expect(text).toBe('🔧 `bash` 完成\n```\ntotal 0\ndrwxr-xr-x 2\n```');
  });

  it('presentResult 返回 undefined 时退回原始结果文本', () => {
    const text = formatToolResult(
      'grep',
      '{}',
      resultData([{ type: 'text', text: 'a.ts:3: hit' }]),
      registry({ presentResult: () => undefined }),
      undefined,
    );

    expect(text).toBe('🔧 `grep` 完成\na.ts:3: hit');
  });

  it('没有注册表时直接展示结果文本', () => {
    const text = formatToolResult('read', '{}', resultData([{ type: 'text', text: 'hello' }]), undefined, undefined);

    expect(text).toBe('🔧 `read` 完成\nhello');
  });

  it('read 卡片按行号渲染 lines', () => {
    const text = formatToolResult(
      'read',
      '{"path":"a.txt"}',
      resultData([{ type: 'text', text: 'hello' }]),
      registry({
        presentResult: () => ({
          card: 'read',
          path: 'a.txt',
          lines: [{ number: 1, text: 'hello' }, { number: 2, text: 'world' }],
        }),
      }),
      undefined,
    );

    expect(text).toBe('🔧 `read` 完成 (a.txt)\n```\n1\thello\n2\tworld\n```');
  });

  it('空结果不发送', () => {
    expect(formatToolResult('bash', '{}', resultData([]), undefined, undefined)).toBeNull();
  });

  it.each([
    { message: { content: [{ type: "text", text: "detail" }] }, error: { code: "EXEC_FAILED" } },
    { message: { content: [{ type: "text", text: "detail" }], isError: true } },
    { message: { content: [{ type: "tool-result", isError: true, content: [{ type: "text", text: "detail" }] }] } },
  ])("keeps failed tool details out of QQ", data => {
    expect(formatToolResult("bash", "{}", data, undefined, undefined)).toBeNull();
  });

  it('presentResult 抛错时降级为结果文本', () => {
    const text = formatToolResult(
      'bash',
      '{"command":"ls"}',
      resultData([{ type: 'text', text: 'ok' }]),
      registry({
        presentResult: () => {
          throw new Error('presenter broken');
        },
      }),
      undefined,
    );

    expect(text).toBe('🔧 `bash` 完成\nok');
  });
});

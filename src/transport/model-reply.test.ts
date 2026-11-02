import { describe, expect, it } from 'vitest';
import { modelReplyText, UNEXECUTED_TOOL_REQUEST_NOTICE } from './model-reply.ts';

const request = '<｜｜DSML｜｜ calls><｜｜DSML｜｜ invoke name="web_fetch"><｜｜DSML｜｜ parameter name="url">https://example.com</｜｜DSML｜｜ parameter></｜｜DSML｜｜ invoke></｜｜DSML｜｜ calls>';

describe('model reply protocol boundary', () => {
  it.each([
    request,
    `准备查询。\n${request}\n已经查到了结果。`,
    '<｜DSML｜function_calls><｜DSML｜invoke name="web_fetch">',
    '<||DSML|| calls><||DSML|| invoke name="web_fetch">',
    '<|DSML|invoke name="web_fetch">',
    '<｜｜DSML｜｜ calls',
    '<｜｜DSML｜｜ inv',
    '<｜｜DSML｜｜ tool_calls>',
    '<｜｜DSML｜｜ tool_calls',
    '<｜｜DSML｜｜ tool_',
  ])('replaces an exposed unexecuted request without claiming a tool result: %s', text => {
    expect(modelReplyText(text)).toBe(UNEXECUTED_TOOL_REQUEST_NOTICE);
  });

  it.each([
    '普通回答：今天可以先看官方文档。',
    'C++: vector<int> xs; if (a < b && b > c) return; <div>hello</div>',
    '说明中的 DSML、calls、invoke 和 <invoke name="ordinary">。',
    `示例：\`${request}\`，这只是代码。`,
    `多反引号：\`\`${request}\`\`。`,
    `示例：\n\`\`\`xml\n${request}\n\`\`\`\n普通结论。`,
    `示例：\n~~~~xml\n${request}\n~~~~`,
    `\`\`\`xml\n${request}`,
    `    ${request}`,
    `> ${request}`,
    '\\<｜｜DSML｜｜ calls>（已转义的示例）',
    '&lt;｜｜DSML｜｜ calls&gt;',
    '格式示例：`<｜｜DSML｜｜ tool_calls>`。',
    '```xml\n<｜｜DSML｜｜ tool_calls>\n```',
  ])('preserves ordinary prose and explicit code or quoted examples: %s', text => {
    expect(modelReplyText(text)).toBe(text);
  });

  it('still rejects a raw request after a legitimate code example', () => {
    expect(modelReplyText(`\`${request}\`\n${request}`)).toBe(UNEXECUTED_TOOL_REQUEST_NOTICE);
  });

  it.each(['<｜｜DSML｜｜', '<｜DSML｜', '<||DSML||', '<|DSML|'].flatMap(marker =>
    ['calls', 'function_calls', 'tool_calls', 'invoke', 'parameter'].map(command => `${marker} ${command}>`)))('withholds every unfinished protocol prefix for %s', input => {
    for (let index = 1; index <= input.length; index++) {
      const visible = modelReplyText(`普通正文 ${input.slice(0, index)}`, false);
      expect(visible === '普通正文 ' || visible === UNEXECUTED_TOOL_REQUEST_NOTICE).toBe(true);
    }
  });

  it('releases an ordinary less-than sign on completion and waits for an unfinished inline code example', () => {
    expect(modelReplyText('x <', false)).toBe('x ');
    expect(modelReplyText('x <')).toBe('x <');
    expect(modelReplyText('x < y', false)).toBe('x < y');
    expect(modelReplyText('示例：`<｜｜DSML｜｜ calls>', false)).toBe('示例：');
    expect(modelReplyText('示例：`<｜｜DSML｜｜ calls>`', false)).toBe('示例：`<｜｜DSML｜｜ calls>`');
  });
});

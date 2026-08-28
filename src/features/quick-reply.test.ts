import { describe, it, expect } from 'vitest';
import { detectTrailingOptions, stripInlineMarkdown } from './quick-reply.ts';

/** 真实案例 A（seq 32151）：澄清提问，编号块结尾 */
const MSG_A = `「同步web端记录」我想确认下具体指哪个，因为有几个不同的目标，操作方式不一样：

1. **推 GitHub 仓库**（silence-spiral-hk）——\`git push\` 到 web，让线上仓库看到最新状态
2. **核对 HTML 网页版**（CV/Proposal 的 .html）与最新 Markdown 内容一致——即"网页端文件同步"
3. **其他**——你告诉我具体想同步什么`;

/** 真实案例 B（seq 50980）：总结合并 + 尾部提问块 + 收尾行 */
const MSG_B = `同步（合并）完成，已验证 ✅。

## 结果

| 项目 | 值 |
|---|---|
| 合并文件 | merged-session.jsonl |

## 我做的三件安全准备

1. 备份活跃会话（zstd）✅
2. 摸清事件格式（seq + seq0 打包 chunk）✅
3. 产出合并文件（非破坏）✅

下一步你要哪个？
1. 只用合并文件做存档/查阅（已够，零风险）
2. 真正加载进活跃会话（我给出精确的安全替换步骤，但需你确认时机）
3. 改成时间交错合并再出一版
回 1 / 2 / 3 即可。`;

describe('detectTrailingOptions', () => {
  it('案例 A：尾部编号块 + 前置确认信号 → 命中，去除行内 markdown', () => {
    const labels = detectTrailingOptions(MSG_A);
    expect(labels).toHaveLength(3);
    expect(labels?.[0]).toBe('推 GitHub 仓库（silence-spiral-hk）——git push 到 web，让线上仓库看到最新状态');
    expect(labels?.[2]).toBe('其他——你告诉我具体想同步什么');
  });

  it('案例 B：跳过中部总结清单，命中尾部提问块（含收尾行「回 1 / 2 / 3 即可。」）', () => {
    const labels = detectTrailingOptions(MSG_B);
    expect(labels).toEqual([
      '只用合并文件做存档/查阅（已够，零风险）',
      '真正加载进活跃会话（我给出精确的安全替换步骤，但需你确认时机）',
      '改成时间交错合并再出一版',
    ]);
  });

  it('总结清单（全部 ✅ 结尾）不命中', () => {
    const text = '都做完了：\n\n1. 备份 ✅\n2. 验证 ✅';
    expect(detectTrailingOptions(text)).toBeUndefined();
  });

  it('无提问信号不命中', () => {
    const text = '步骤如下：\n1. 打开设置页面，进入隐私管理界面，关闭个性化推荐开关后返回上一级目录。\n2. 在账号安全中心修改登录密码，并开启两步验证以增强账号安全性保护。';
    expect(detectTrailingOptions(text)).toBeUndefined();
  });

  it('提问信号只在收尾行（块后）也命中', () => {
    const text = '两个方案：\n1. 方案甲，保守做法，不动现有数据，只新增副本供查阅，适合不想冒险的情况。\n2. 方案乙，直接替换现有数据，一步到位但有风险，需要确认时机后再动手做。\n回复编号即可。';
    expect(detectTrailingOptions(text)).toEqual([
      '方案甲，保守做法，不动现有数据，只新增副本供查阅，适合不想冒险的情况。',
      '方案乙，直接替换现有数据，一步到位但有风险，需要确认时机后再动手做。',
    ]);
  });

  it('单项过长不命中', () => {
    const long = '这是一个特别长的选项'.repeat(20);
    const text = `选哪个？\n1. ${long}\n2. 短选项`;
    expect(detectTrailingOptions(text)).toBeUndefined();
  });

  it('少于 2 项不命中', () => {
    expect(detectTrailingOptions('选哪个？\n1. 只有一个选项')).toBeUndefined();
  });

  it('编号不从 1 开始或不连续不命中', () => {
    expect(detectTrailingOptions('选哪个？\n2. 乙选项内容而已啊朋友你好呀世界真大啊我们去玩吧好不好呀好的好的好的呀')).toBeUndefined();
    expect(detectTrailingOptions('选哪个？\n1. 甲\n3. 丙')).toBeUndefined();
  });

  it('编号块后跟长段落不命中（块不在尾部）', () => {
    const text = '选哪个？\n1. 甲\n2. 乙\n\n后面还有很长一段解释说明文字，超过了收尾行的长度限制，说明编号块并不是消息的尾部而是正文中间的一部分内容。';
    expect(detectTrailingOptions(text)).toBeUndefined();
  });
});

describe('stripInlineMarkdown', () => {
  it('去加粗/行内代码/链接', () => {
    expect(stripInlineMarkdown('**推 GitHub**（`git push`）[官网](https://x.cn)')).toBe('推 GitHub（git push）官网');
  });
});

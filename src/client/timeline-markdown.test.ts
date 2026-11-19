import { expect, it } from 'vitest';
import { timelineMarkdown } from './timeline-markdown.ts';

const options = { faceLabel: 'QQ 表情', stickerLabel: '表情包', hasImage: false };
const face = '<faceType=1,faceId="277",ext="eyJ0ZXh0Ijoi5rGq5rGqIn0=">';
const sticker = '<faceType=6,faceId="0",ext="eyJ0ZXh0IjoiIn0=">';
const command = '<qqbot-cmd-input text="/model example/a" show="/model Alpha"/>';

it('preserves Markdown and presents QQ command tags as read-only list items', () => {
  const text = ['### 模型配置', '', '**当前模型**', command, command].join('\n');
  const rendered = timelineMarkdown(text, options);
  const code = '\u0060 /model Alpha \u0060';
  expect(rendered).toBe(['### 模型配置', '', '**当前模型**', '- ' + code, '- ' + code].join('\n'));
});

it('renders system and Unicode emoji and uses the preview for custom stickers', () => {
  expect(timelineMarkdown(face, options)).toBe('![汪汪](https://qzonestyle.gtimg.cn/qzone/em/e10277.gif)');
  expect(timelineMarkdown('[<face,id=14>]', options)).toBe('![QQ 表情](https://qzonestyle.gtimg.cn/qzone/em/e100.gif)');
  expect(timelineMarkdown('<faceType=1,faceId="9999",ext="">', options)).toBe('QQ 表情');
  expect(timelineMarkdown('<faceType=2,faceId="128514",ext="">', options)).toBe('😂');
  expect(timelineMarkdown(sticker, options)).toBe('表情包');
  expect(timelineMarkdown('文字' + sticker, { ...options, hasImage: true })).toBe('文字 ');
  expect(timelineMarkdown('!' + sticker + '[图片](https://example.com/image.png)', { ...options, hasImage: true }))
    .toBe('! [图片](https://example.com/image.png)');
});

it('keeps protocol and image syntax literal in code while neutralizing authored image requests', () => {
  const tick = '\u0060';
  const inline = tick + command + tick;
  const payload = '![sample](https://example.com/image.png)';
  const fence = tick.repeat(3);
  const text = [inline, '', fence, face + payload, fence, '', payload, '', '![ref][r]', '', '[r]: https://example.com/ref.png'].join('\n');
  expect(timelineMarkdown(text, options)).toBe([
    inline, '', fence, face + payload, fence, '', '\\' + payload, '', '\\![ref][r]', '', '[r]: https://example.com/ref.png',
  ].join('\n'));
});

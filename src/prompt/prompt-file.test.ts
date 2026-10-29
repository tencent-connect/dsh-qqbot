import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPromptFile, MAX_PROMPT_FILE_BYTES, resolveScopePrompt } from './prompt-file.ts';

const directories: string[] = [];
function promptPath(name = 'QQ群提示词_新.md'): string {
  const dir = mkdtempSync(join(tmpdir(), 'qqbot-prompt-'));
  directories.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadPromptFile', () => {
  it('读取中文绝对路径、去除 UTF-8 BOM，并保持正文原样', async () => {
    const path = promptPath();
    const text = '# 系统提示词\r\n你是群聊助手。😀\n';
    writeFileSync(path, `\uFEFF${text}`, 'utf8');
    const loaded = await loadPromptFile(path);
    expect(loaded).toEqual({
      path,
      text,
      bytes: Buffer.byteLength(`\uFEFF${text}`, 'utf8'),
      characters: Array.from(text).length,
      modifiedAt: expect.any(String),
    });
    expect(Number.isFinite(Date.parse(loaded.modifiedAt))).toBe(true);
  });

  it.each(['instructions.txt', 'instructions.markdown', 'instructions.MD'])('支持文本格式 %s', async (name) => {
    const path = promptPath(name);
    writeFileSync(path, 'system instructions', 'utf8');
    expect((await loadPromptFile(path)).text).toBe('system instructions');
  });

  it('每次读取最新正文，不缓存旧文件或失败结果', async () => {
    const path = promptPath();
    await expect(loadPromptFile(path)).rejects.toThrow('不存在');
    writeFileSync(path, '原提示词', 'utf8');
    expect((await loadPromptFile(path)).text).toBe('原提示词');
    writeFileSync(path, '新提示词内容', 'utf8');
    expect((await loadPromptFile(path)).text).toBe('新提示词内容');
    rmSync(path);
    await expect(loadPromptFile(path)).rejects.toThrow('不存在');
  });

  it('拒绝未选择、相对路径与不支持的格式', async () => {
    await expect(loadPromptFile('')).rejects.toThrow('请选择');
    await expect(loadPromptFile('relative.md')).rejects.toThrow('绝对路径');
    await expect(loadPromptFile(promptPath('file.pdf'))).rejects.toThrow('仅支持');
  });

  it('拒绝目录且不暴露完整路径', async () => {
    const path = promptPath('目录.md');
    mkdirSync(path);
    await expect(loadPromptFile(path)).rejects.toThrow('普通文件');
    try { await loadPromptFile(path); } catch (error) {
      expect((error as Error).message).not.toContain(path);
    }
  });

  it.each(['', ' \r\n\t', '\uFEFF\n '])('拒绝空白正文 %j', async (text) => {
    const path = promptPath();
    writeFileSync(path, text, 'utf8');
    await expect(loadPromptFile(path)).rejects.toThrow('不能为空');
  });

  it('拒绝无效 UTF-8、UTF-16 和含 NUL 的二进制文件', async () => {
    const path = promptPath();
    for (const buffer of [Buffer.from([0xc3, 0x28]), Buffer.from([0xff, 0xfe, 0x41, 0x00])]) {
      writeFileSync(path, buffer);
      await expect(loadPromptFile(path)).rejects.toThrow('UTF-8');
    }
    writeFileSync(path, Buffer.from([0x41, 0x00, 0x42]));
    await expect(loadPromptFile(path)).rejects.toThrow('二进制');
  });

  it('允许 1 MiB，拒绝超限文件', async () => {
    const path = promptPath();
    writeFileSync(path, Buffer.alloc(MAX_PROMPT_FILE_BYTES, 0x61));
    expect((await loadPromptFile(path)).bytes).toBe(MAX_PROMPT_FILE_BYTES);
    writeFileSync(path, Buffer.alloc(MAX_PROMPT_FILE_BYTES + 1, 0x61));
    await expect(loadPromptFile(path)).rejects.toThrow('不能超过 1 MiB');
    // 失败路径也释放文件句柄，允许立即替换/删除。
    writeFileSync(path, '已恢复', 'utf8');
    expect((await loadPromptFile(path)).text).toBe('已恢复');
  });
});

describe('resolveScopePrompt', () => {
  it('旧配置缺省为文本来源且群聊、私聊隔离', async () => {
    const config = { groupPrompt: '群聊文本', directPrompt: '私聊文本' };
    expect(await resolveScopePrompt(config, 'group')).toBe('群聊文本');
    expect(await resolveScopePrompt(config, 'c2c')).toBe('私聊文本');
    expect(await resolveScopePrompt({}, 'group')).toBeUndefined();
  });

  it('文件模式只注入对应文件，另一 scope 保持文本模式', async () => {
    const path = promptPath();
    writeFileSync(path, '群聊文件正文', 'utf8');
    const config = {
      groupPromptMode: 'file' as const, groupPromptFile: path, groupPrompt: '过时群聊文本',
      directPromptMode: 'text' as const, directPromptFile: '不存在.md', directPrompt: '私聊文本',
    };
    expect(await resolveScopePrompt(config, 'group')).toBe('群聊文件正文');
    expect(await resolveScopePrompt(config, 'c2c')).toBe('私聊文本');
    expect(await resolveScopePrompt({ ...config, groupPromptMode: 'text' }, 'group')).toBe('过时群聊文本');
  });

  it('私聊可独立使用文件且不与群聊文本合并', async () => {
    const path = promptPath('私聊.txt');
    writeFileSync(path, '私聊文件正文', 'utf8');
    const config = { groupPrompt: '群聊', directPromptMode: 'file' as const, directPromptFile: path };
    expect(await resolveScopePrompt(config, 'c2c')).toBe('私聊文件正文');
    expect(await resolveScopePrompt(config, 'group')).toBe('群聊');
  });

  it('文件失败明确抛错，不能回退旧文本', async () => {
    await expect(resolveScopePrompt({ groupPromptMode: 'file', groupPrompt: '旧文本' }, 'group'))
      .rejects.toThrow('请选择');
    await expect(resolveScopePrompt({ directPromptMode: 'file', directPromptFile: promptPath(), directPrompt: '旧文本' }, 'c2c'))
      .rejects.toThrow('不存在');
  });
});

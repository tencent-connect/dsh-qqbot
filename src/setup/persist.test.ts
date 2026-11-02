import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync, utimesSync, statSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument, isSeq, type YAMLSeq } from 'yaml';
import {
  persistCredentialsToProfile,
  removeCredentialsFromProfile,
  updateProfileConfig,
} from './persist.ts';

const credentials = { appId: 'test-app', appSecret: 'test-secret' };
const log = { info: vi.fn(), warn: vi.fn() };

let dir: string;
let patchPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'im-qqbot-persist-'));
  patchPath = join(dir, 'cordis.patch.yml');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 场景：多插件共享的 profile patch（含注释、insert 行、其他插件条目） */
const SHARED_PATCH = [
  '# 宿主设置与其他插件条目，插件写入不得破坏',
  '- insert:',
  '    - id: custom-plugin',
  '      name: custom-plugin',
  '- id: ui-settings',
  "  name: '@deepseek-ai/dsh-client-ui-settings'",
  '  config:',
  '    enabled: false',
  '- id: im-qqbot',
  '  config:',
  '    requireMention: true',
  '    appId: old-app # 旧凭据',
  '    appSecret: old-secret',
  '- id: llm-deepseek',
  '  config:',
  '    baseURL: https://example.com/v1',
].join('\n');

describe('persistCredentialsToProfile', () => {
  it('更新凭据并完整保留其他插件条目、insert 行与注释', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');

    expect(persistCredentialsToProfile(credentials, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('# 宿主设置与其他插件条目，插件写入不得破坏');
    expect(after).toContain('- insert:');
    expect(after).toContain('custom-plugin');
    expect(after).toContain('ui-settings');
    expect(after).toContain('llm-deepseek');
    expect(after).toContain('# 旧凭据');
    expect(after).toContain('requireMention: true');
    expect(after).not.toContain('old-app');
    expect(after).toContain('appId: test-app');

    expect(entryIds(after)).toEqual(['insert', 'ui-settings', 'im-qqbot', 'llm-deepseek']);
  });

  it('userOpenid 覆盖 c2cAllow 并切到白名单模式（旧扫码者不残留），保留群配置', () => {
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    appId: old-app',
      '    access:',
      '      c2cMode: open',
      '      c2cAllow:',
      '        - old-owner',
      '      groupMode: open',
    ].join('\n'), 'utf8');

    expect(persistCredentialsToProfile({ ...credentials, userOpenid: 'qr-user' }, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('c2cMode: allowlist');
    expect(after).toContain('groupMode: open');
    expect(after).toContain('qr-user');
    expect(after).not.toContain('old-owner');
  });

  it('userOpenid 相同时幂等（不重复）', () => {
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    access:',
      '      c2cAllow: [qr-user]',
    ].join('\n'), 'utf8');

    expect(persistCredentialsToProfile({ ...credentials, userOpenid: 'qr-user' }, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect((after.match(/qr-user/g) ?? []).length).toBe(1);
  });

  it('无 access 配置时新建（白名单模式 + 仅扫码者，不固化群配置）', () => {
    expect(persistCredentialsToProfile({ ...credentials, userOpenid: 'qr-user' }, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('c2cMode: allowlist');
    expect(after).toContain('c2cAllow');
    expect(after).toContain('qr-user');
    expect(after).not.toContain('groupMode');
  });

  it('文件不存在时安全重建（新条目）', () => {
    expect(persistCredentialsToProfile(credentials, dir, log)).toBe(true);
    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('- id: im-qqbot');
    expect(after).toContain('appId: test-app');
    expect(entryIds(after)).toEqual(['im-qqbot']);
  });

  it('覆盖 !!js loader 表达式为字面量，保留其余注释', () => {
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      "    appId: !!js 'env.APP_ID' # identifier",
      "    appSecret: !!js 'env.SECRET'",
    ].join('\n'), 'utf8');

    expect(persistCredentialsToProfile(credentials, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('# identifier');
    const config = (parseDocument(after).toJS() as Array<{ config: Record<string, unknown> }>)[0]?.config;
    expect(config).toEqual(credentials);
  });

  it('锚点共享的 config 拒绝写入（fail-closed，原文件不变）', () => {
    const content = [
      '- id: im-qqbot',
      '  config: &shared { appId: old, appSecret: old }',
      '- id: other',
      '  config: *shared',
    ].join('\n');
    writeFileSync(patchPath, content, 'utf8');

    expect(persistCredentialsToProfile(credentials, dir, log)).toBe(false);
    expect(readFileSync(patchPath, 'utf8')).toBe(content);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('锚点'));
  });

  it('非法 YAML / 顶层非数组 / config 非映射：拒绝写入，原文件不变', () => {
    for (const content of ['- [', 'config: {}', '- id: im-qqbot\n  config: wrong']) {
      writeFileSync(patchPath, content, 'utf8');
      expect(persistCredentialsToProfile(credentials, dir, log)).toBe(false);
      expect(readFileSync(patchPath, 'utf8')).toBe(content);
    }
  });

  it('写入后目录内不留本插件的临时/回滚文件', () => {
    persistCredentialsToProfile(credentials, dir, log);
    const leftovers = readdirSync(dir).filter((name) => name.includes('imqqbot'));
    expect(leftovers).toEqual([]);
  });
});

describe('removeCredentialsFromProfile', () => {
  it('仅移除凭据字段，保留条目其余 config 与其他插件内容', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');

    expect(removeCredentialsFromProfile(dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('requireMention: true');
    expect(after).toContain('- insert:');
    expect(after).not.toContain('test-app');
    expect(after).not.toContain('old-app');
    expect(entryIds(after)).toEqual(['insert', 'ui-settings', 'im-qqbot', 'llm-deepseek']);
  });

  it('凭据已不存在时仍强制写回（mtime 更新触发宿主 HMR）', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    removeCredentialsFromProfile(dir, log);

    const past = new Date(statSync(patchPath).mtimeMs - 1000);
    utimesSync(patchPath, past, past);

    expect(removeCredentialsFromProfile(dir, log)).toBe(true);
    expect(statSync(patchPath).mtimeMs).toBeGreaterThan(past.getTime());
  });

  it('文件不存在时幂等成功（写入新空文档）', () => {
    expect(removeCredentialsFromProfile(dir, log)).toBe(true);
    expect(existsSync(patchPath)).toBe(true);
  });
});

describe('updateProfileConfig', () => {
  it('最小写入：只合并提交键，不触碰凭据字段', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');

    expect(updateProfileConfig({ requireMention: false, access: { c2cMode: 'allowlist' } }, dir, log)).toBe(true);

    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('requireMention: false');
    expect(after).toContain('c2cMode: allowlist');
    expect(after).toContain('appId: old-app');
    expect(entryIds(after)).toEqual(['insert', 'ui-settings', 'im-qqbot', 'llm-deepseek']);
  });

  it('提交键与现值相同（幂等）：不产生写动作，mtime 不变', () => {
    writeFileSync(patchPath, '- id: im-qqbot\n  config:\n    requireMention: true\n', 'utf8');
    const past = new Date(Date.now() - 1000);
    utimesSync(patchPath, past, past);

    expect(updateProfileConfig({ requireMention: true }, dir, log)).toBe(true);
    expect(statSync(patchPath).mtimeMs).toBe(past.getTime());
  });

  it('条目不存在时追加，跳过凭据键', () => {
    expect(updateProfileConfig({ appId: 'x', requireMention: false }, dir, log)).toBe(true);
    const after = readFileSync(patchPath, 'utf8');
    expect(after).toContain('- id: im-qqbot');
    expect(after).toContain('requireMention: false');
    expect(after).not.toContain('appId: x');
  });
});

describe.skipIf(process.platform === 'win32')('profile patch private permissions', () => {
  it('新建凭据文件为 0600', () => {
    expect(persistCredentialsToProfile(credentials, dir, log)).toBe(true);
    expect(statSync(patchPath).mode & 0o777).toBe(0o600);
  });

  it.each(['credentials', 'config', 'unbind'])('%s 写回把现存 0644 patch 和临时文件收紧为 0600', operation => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    const temporaryPath = `${patchPath}.imqqbot.tmp`;
    writeFileSync(temporaryPath, 'stale temporary file', 'utf8');
    chmodSync(patchPath, 0o644);
    chmodSync(temporaryPath, 0o644);

    const ok = operation === 'credentials' ? persistCredentialsToProfile(credentials, dir, log)
      : operation === 'config' ? updateProfileConfig({ requireMention: false }, dir, log)
      : removeCredentialsFromProfile(dir, log);

    expect(ok).toBe(true);
    expect(statSync(patchPath).mode & 0o777).toBe(0o600);
    expect(existsSync(temporaryPath)).toBe(false);
    expect(entryIds(readFileSync(patchPath, 'utf8'))).toEqual(['insert', 'ui-settings', 'im-qqbot', 'llm-deepseek']);
  });

  it.each(['credentials', 'config'])('%s 幂等保存仅收紧权限，正文和 mtime 不变', operation => {
    const content = '- id: im-qqbot\n  config:\n    appId: test-app\n    appSecret: test-secret\n    requireMention: true\n';
    writeFileSync(patchPath, content, 'utf8');
    chmodSync(patchPath, 0o644);
    const past = new Date(Date.now() - 1000);
    utimesSync(patchPath, past, past);

    expect(operation === 'credentials' ? persistCredentialsToProfile(credentials, dir, log)
      : updateProfileConfig({ requireMention: true }, dir, log)).toBe(true);

    expect(statSync(patchPath).mode & 0o777).toBe(0o600);
    expect(statSync(patchPath).mtimeMs).toBe(past.getTime());
    expect(readFileSync(patchPath, 'utf8')).toBe(content);
  });

  it('读回校验失败经现存 0644 回滚文件恢复原文，结果为 0600', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    const rollbackPath = `${patchPath}.imqqbot.rollback`;
    writeFileSync(rollbackPath, 'stale rollback', 'utf8');
    chmodSync(rollbackPath, 0o644);
    let secretReads = 0;
    // Change the expected value only at verification to exercise real rollback I/O.
    const changingCredentials = { appId: 'test-app', get appSecret() { return ++secretReads === 1 ? 'test-secret' : 'verification-mismatch'; } };

    expect(persistCredentialsToProfile(changingCredentials, dir, log)).toBe(false);

    expect(readFileSync(patchPath, 'utf8')).toBe(SHARED_PATCH);
    expect(statSync(patchPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['cordis.patch.yml']);
  });

  it('并发编辑触发重读合并，保留外部内容并收紧权限', () => {
    writeFileSync(patchPath, SHARED_PATCH, 'utf8');
    const external = `${SHARED_PATCH}\n- id: added-externally\n  config: { enabled: true }\n`;
    let edits = 0;
    const patch = { get requireMention() {
      if (++edits === 1) writeFileSync(patchPath, external, 'utf8');
      return false;
    } };

    expect(updateProfileConfig(patch, dir, log)).toBe(true);
    expect(edits).toBe(2);
    expect(readFileSync(patchPath, 'utf8')).toContain('added-externally');
    expect(readFileSync(patchPath, 'utf8')).toContain('requireMention: false');
    expect(statSync(patchPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(['cordis.patch.yml']);
  });
});

/** 提取顶层行标识：id 条目取 id 值，insert 行记 'insert' */
function entryIds(content: string): string[] {
  const doc = parseDocument(content);
  const seq = doc.contents;
  if (!isSeq(seq)) return [];
  return (seq as YAMLSeq).items.map((item) => {
    if (item && typeof item === 'object' && 'get' in item) {
      const id = (item as { get(key: string): unknown }).get('id');
      if (id !== undefined) return String(id);
    }
    return 'insert';
  });
}

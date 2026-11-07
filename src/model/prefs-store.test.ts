import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrefsStore } from './prefs-store.ts';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-prefs-'));
  path = join(dir, 'model-prefs.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const store = (): PrefsStore => new PrefsStore(undefined, { path });

describe('PrefsStore 并发安全（E3）', () => {
  it('写前合并：后写实例保留磁盘上其他写者的条目（多实例共存）', () => {
    const a = store();
    a.setSessionId('botA:peer1', 'session-a1');

    const b = store(); // 另一实例：load 读到 botA 的条目
    b.setSessionId('botB:peer2', 'session-b1');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds).toEqual({
      'botA:peer1': 'session-a1',
      'botB:peer2': 'session-b1',
    });
  });

  it('内存覆盖磁盘同 key：本进程视角权威', () => {
    const a = store();
    a.setSessionId('k', 'old');

    const b = store();
    b.setSessionId('k', 'new');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds.k).toBe('new');
    expect(b.getSessionId('k')).toBe('new');
  });

  it('写前重读合并：实例未重启时磁盘被外部写入的新 key 也不丢', () => {
    const a = store();
    a.setSessionId('k1', 'v1');

    // 外部进程（不经 a 的内存）直接写入了 k2
    const external = JSON.parse(readFileSync(path, 'utf8'));
    external.sessionIds.k2 = 'v2';
    writeFileSync(path, JSON.stringify(external), 'utf8');

    a.setSessionId('k1', 'v1-updated');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.sessionIds).toEqual({ k1: 'v1-updated', k2: 'v2' });
  });

  it('删除墓碑：clear 后并发写盘的旧值不复活', () => {
    const a = store();
    a.setPreset('k', 'p1');

    // 外部进程写入了 k 的旧值（模拟另一写者把条目落盘）
    const external = JSON.parse(readFileSync(path, 'utf8'));
    external.presets.k = 'p-external';
    writeFileSync(path, JSON.stringify(external), 'utf8');

    a.clearPreset('k'); // 本进程显式删除 → 墓碑

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect('k' in disk.presets).toBe(false);

    // 墓碑解除：重新 set 后正常落盘
    a.setPreset('k', 'p2');
    expect(JSON.parse(readFileSync(path, 'utf8')).presets.k).toBe('p2');
  });

  it('原子写：崩溃不留半截 JSON（写入后文件始终可解析），tmp 带唯一后缀且已清理', () => {
    const a = store();
    for (let i = 0; i < 5; i += 1) {
      a.setSessionId(`k${i}`, `v${i}`);
      expect(() => JSON.parse(readFileSync(path, 'utf8'))).not.toThrow();
    }
    // 唯一后缀（pid+随机）：跨进程并发写互不覆盖对方的临时文件
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]); // rename 后临时文件已清理
  });

  it('半截 JSON：load 报错可见，覆盖前备份原文件（丢失的映射可人工恢复）', () => {
    const corrupted = '{"sessionIds":{"k1":"v1","k2":"v2"'; // 尾部截断，前面条目完好
    writeFileSync(path, corrupted, 'utf8');
    const onError = vi.fn();

    const a = new PrefsStore(undefined, { path, onError });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('loadPrefs failed'));
    expect(a.getSessionId('k1')).toBeUndefined(); // 解析失败，内存为空

    a.setSessionId('fresh', 'v'); // 触发写入：覆盖损坏文件前应先备份

    const backups = readdirSync(dir).filter((f) => f.includes('.corrupted.'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]!), 'utf8')).toBe(corrupted); // 原文完整留证
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('已备份原文件'));
    expect(JSON.parse(readFileSync(path, 'utf8')).sessionIds.fresh).toBe('v');
  });

  it('损坏文件只备份一次（多次写入不堆积备份）', () => {
    writeFileSync(path, '{broken', 'utf8');
    const a = new PrefsStore(undefined, { path });
    a.setSessionId('a', '1');
    a.setSessionId('b', '2');
    a.setSessionId('c', '3');
    expect(readdirSync(dir).filter((f) => f.includes('.corrupted.'))).toHaveLength(1);
  });
});

describe('PrefsStore 新段：workspaces / permissions', () => {
  it('CRUD 往返：set 后读取、落盘、重启（新实例）后仍在', () => {
    const a = store();
    a.setWorkspace('k', '/tmp/ws-a');
    a.setPermission('k', { sandbox: 'workspace-write', approval: 'ask' });

    expect(a.getWorkspace('k')).toBe('/tmp/ws-a');
    expect(a.getPermission('k')).toEqual({ sandbox: 'workspace-write', approval: 'ask' });

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.workspaces.k).toBe('/tmp/ws-a');
    expect(disk.permissions.k).toEqual({ sandbox: 'workspace-write', approval: 'ask' });

    // 重启：新实例从磁盘恢复
    const b = store();
    expect(b.getWorkspace('k')).toBe('/tmp/ws-a');
    expect(b.getPermission('k')).toEqual({ sandbox: 'workspace-write', approval: 'ask' });
  });

  it('写前合并：其他写者的新段条目不丢（多实例共存）', () => {
    const a = store();
    a.setWorkspace('botA:peer1', '/tmp/ws-a');

    const b = store();
    b.setWorkspace('botB:peer2', '/tmp/ws-b');
    b.setPermission('botB:peer2', { sandbox: 'read-only', approval: 'ask' });

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect(disk.workspaces).toEqual({ 'botA:peer1': '/tmp/ws-a', 'botB:peer2': '/tmp/ws-b' });
    expect(disk.permissions['botB:peer2']).toEqual({ sandbox: 'read-only', approval: 'ask' });
  });

  it('删除墓碑：clear 后并发写盘的旧值不复活', () => {
    const a = store();
    a.setPermission('k', { sandbox: 'workspace-write', approval: 'ask' });
    a.setWorkspace('k', '/tmp/ws-mine');

    // 外部写者把旧值落盘
    const external = JSON.parse(readFileSync(path, 'utf8'));
    external.permissions.k = { sandbox: 'danger-full-access', approval: 'never' };
    external.workspaces.k = '/tmp/ws-ext';
    writeFileSync(path, JSON.stringify(external), 'utf8');

    a.clearPermission('k');
    a.clearWorkspace('k');

    const disk = JSON.parse(readFileSync(path, 'utf8'));
    expect('k' in disk.permissions).toBe(false);
    expect('k' in disk.workspaces).toBe(false);

    // 墓碑解除：重新 set 后正常落盘
    a.setWorkspace('k', '/tmp/ws-new');
    expect(JSON.parse(readFileSync(path, 'utf8')).workspaces.k).toBe('/tmp/ws-new');
  });

  it('load 跳过非法条目（空路径 / 缺字段的权限对象）', () => {
    writeFileSync(path, JSON.stringify({
      workspaces: { ok: '/tmp/ws', empty: '', notString: 1 },
      permissions: {
        ok: { sandbox: 'read-only', approval: 'ask' },
        missingApproval: { sandbox: 'read-only' },
      },
    }), 'utf8');

    const a = store();
    expect(a.getWorkspace('ok')).toBe('/tmp/ws');
    expect(a.getWorkspace('empty')).toBeUndefined();
    expect(a.getWorkspace('notString')).toBeUndefined();
    expect(a.getPermission('ok')).toEqual({ sandbox: 'read-only', approval: 'ask' });
    expect(a.getPermission('missingApproval')).toBeUndefined();
  });
});

describe('PrefsStore.findSessionKey 反向索引', () => {
  it('随 set/clear 同步维护：换新会话后旧 id 不再命中', () => {
    const s = store();
    s.setSessionId('k', 'session-1');
    expect(s.findSessionKey('session-1')).toBe('k');

    s.setSessionId('k', 'session-2');
    expect(s.findSessionKey('session-1')).toBeUndefined();
    expect(s.findSessionKey('session-2')).toBe('k');

    s.clearSessionId('k');
    expect(s.findSessionKey('session-2')).toBeUndefined();
  });

  it('load 时从磁盘重建索引', () => {
    store().setSessionId('k', 'session-1');

    expect(store().findSessionKey('session-1')).toBe('k');
  });
});

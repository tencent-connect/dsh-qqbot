import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PeerMap } from './peer-map.ts';

describe('PeerMap', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peermap-'));
    file = join(dir, 'session-peers.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips set/get in memory', () => {
    const map = new PeerMap(undefined, file);
    map.set('sess-1', { scope: 'c2c', peerId: 'P1', senderId: 'U1', lastMsgId: 'm1', updatedAt: 1 });
    const info = map.get('sess-1');
    expect(info?.scope).toBe('c2c');
    expect(info?.peerId).toBe('P1');
    expect(info?.lastMsgId).toBe('m1');
  });

  it('persists to disk and reloads in a fresh instance', () => {
    new PeerMap(undefined, file).set('sess-1', { scope: 'group', peerId: 'G1', senderId: 'U1', updatedAt: 1 });
    const fresh = new PeerMap(undefined, file);
    const info = fresh.get('sess-1');
    expect(info?.scope).toBe('group');
    expect(info?.peerId).toBe('G1');
  });

  it('returns undefined for unknown sessions', () => {
    expect(new PeerMap(undefined, file).get('nope')).toBeUndefined();
  });

  it('treats a corrupt file as an empty table', () => {
    writeFileSync(file, '{corrupt', 'utf8');
    expect(new PeerMap(undefined, file).get('sess-1')).toBeUndefined();
  });

  it('skips invalid entries on load but keeps valid ones', () => {
    writeFileSync(file, JSON.stringify({
      good: { scope: 'c2c', peerId: 'P1', senderId: 'U1', updatedAt: 1 },
      badScope: { scope: 'channel', peerId: 'P2', senderId: 'U2', updatedAt: 2 },
      badPeer: { scope: 'c2c', senderId: 'U3', updatedAt: 3 },
    }), 'utf8');
    const map = new PeerMap(undefined, file);
    expect(map.get('good')?.peerId).toBe('P1');
    expect(map.get('badScope')).toBeUndefined();
    expect(map.get('badPeer')).toBeUndefined();
  });

  it('overwrites existing entries for the same session', () => {
    const map = new PeerMap(undefined, file);
    map.set('sess-1', { scope: 'c2c', peerId: 'P1', senderId: 'U1', updatedAt: 1 });
    map.set('sess-1', { scope: 'c2c', peerId: 'P1', senderId: 'U1', lastMsgId: 'm2', updatedAt: 2 });
    const reloaded = new PeerMap(undefined, file);
    expect(reloaded.get('sess-1')?.lastMsgId).toBe('m2');
  });
});

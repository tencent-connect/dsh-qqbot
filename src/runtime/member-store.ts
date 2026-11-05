import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite } from '../shared/atomic-file.ts';
import type { ClaimedMember } from '../shared/pairing-protocol.ts';

type MemberProfile = Omit<ClaimedMember, 'openid'>;
interface MemberState { version: 1; appId: string; owners: string[]; profiles: Record<string, MemberProfile> }

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('QQ 名单数据无效');
  return Object.fromEntries(Object.entries(value));
}
function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new TypeError('QQ 成员资料无效');
  return value;
}
function ownerIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new TypeError('QQ 命令名单无效');
  const ids = [...new Set(value.map(id => text(id).trim()).filter(Boolean))];
  if (ids.length > 100) throw new TypeError('Too many QQ owner identities');
  return ids;
}
function memberProfile(value: unknown): MemberProfile {
  const data = object(value);
  if ((data.scene !== 'group' && data.scene !== 'c2c') || typeof data.claimedAt !== 'number'
    || !Number.isSafeInteger(data.claimedAt) || data.claimedAt < 0) throw new TypeError('QQ 成员资料无效');
  return { nickname: text(data.nickname, 100_000), scene: data.scene, sceneName: text(data.sceneName, 100_000), claimedAt: data.claimedAt };
}
function profiles(value: unknown): Record<string, MemberProfile> {
  return Object.fromEntries(Object.entries(object(value)).map(([id, input]) => {
    if (!text(id)) throw new TypeError('QQ 成员身份无效');
    return [id, memberProfile(input)];
  }));
}

/** Account identities only. Native Session preferences and QQ message files remain untouched. */
export class MemberStore {
  private readonly path: string;
  private readonly legacyPath: string;

  constructor(private readonly dataDir: string, private readonly appId: string, legacyOwners: () => readonly string[] = () => []) {
    if (!appId) throw new TypeError('QQ AppID is required');
    const hash = createHash('sha256').update(appId).digest('hex');
    this.path = join(dataDir, `members-${hash}.json`);
    this.legacyPath = join(dataDir, `conversations-${hash}.json`);
    if (existsSync(this.path)) { this.load(); return; }
    const legacy = this.legacyCatalog();
    const owners = legacy ? ownerIds(legacy.owners) : this.hasLegacyPreferences() ? ownerIds([...legacyOwners()]) : [];
    const memberProfiles = legacy?.memberProfiles === undefined ? {} : profiles(legacy.memberProfiles);
    // Even an empty initialized list is authoritative; restarting must not reimport revoked members.
    this.save({ version: 1, appId, owners, profiles: memberProfiles });
  }

  ownerIds(): string[] { return this.load().owners; }
  memberProfiles(): Record<string, MemberProfile> { return this.load().profiles; }
  setMemberProfile(openid: string, profile: MemberProfile): void {
    if (!text(openid).trim()) throw new TypeError('QQ 成员身份无效');
    const state = this.load();
    state.profiles = { ...state.profiles, [openid]: memberProfile(profile) };
    this.save(state);
  }
  setMemberNickname(openid: string, nickname: string): void {
    const previous = this.memberProfiles()[openid];
    this.setMemberProfile(openid, { nickname, scene: previous?.scene ?? 'c2c', sceneName: previous?.sceneName ?? '', claimedAt: previous?.claimedAt ?? Date.now() });
  }
  claimOwner(openid: string, profile: MemberProfile): void {
    const state = this.load();
    state.owners = ownerIds([...state.owners, openid]);
    state.profiles = { ...state.profiles, [openid]: memberProfile(profile) };
    this.save(state);
  }
  revokeOwner(openid: string): void {
    const state = this.load();
    state.owners = state.owners.filter(id => id !== openid);
    this.save(state);
  }

  /** Read a previously saved display name without importing or rewriting its Session or policy. */
  peerName(scope: 'group' | 'c2c', peerId: string): { name: string; alias: string } {
    const entries = this.legacyCatalog()?.entries;
    const entry = Array.isArray(entries) ? entries.find(input => {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
      const data = object(input);
      return data.key === `qqbot:${this.appId}:${scope}:${peerId}` && data.scope === scope && data.peerId === peerId;
    }) : undefined;
    const data = entry === undefined ? {} : object(entry);
    return { name: typeof data.name === 'string' ? data.name.slice(0, 300) : '', alias: typeof data.alias === 'string' ? data.alias.slice(0, 300) : '' };
  }

  private legacyCatalog(): Record<string, unknown> | undefined {
    if (!existsSync(this.legacyPath)) return undefined;
    const data = object(JSON.parse(readFileSync(this.legacyPath, 'utf8')));
    if (data.appId !== this.appId || (data.format !== 1 && data.format !== 2)) throw new TypeError('QQ 旧名单账号或版本无效');
    return data;
  }
  private hasLegacyPreferences(): boolean {
    const path = join(this.dataDir, 'model-prefs.json');
    if (!existsSync(path)) return false;
    const data = object(JSON.parse(readFileSync(path, 'utf8')));
    return ['sessionIds', 'overrides', 'presets'].some(field => Object.keys(object(data[field] ?? {})).some(key =>
      ['group', 'c2c'].some(scope => {
        const prefix = `qqbot:${this.appId}:${scope}:`;
        const id = key.slice(prefix.length);
        return key.startsWith(prefix) && id.trim().length > 0 && id.length <= 1024 && !id.includes('\0');
      })));
  }
  private load(): MemberState {
    const data = object(JSON.parse(readFileSync(this.path, 'utf8')));
    if (data.version !== 1 || data.appId !== this.appId) throw new TypeError('QQ 名单账号或版本无效');
    return { version: 1, appId: this.appId, owners: ownerIds(data.owners), profiles: profiles(data.profiles) };
  }
  private save(state: MemberState): void { atomicWrite(this.path, [JSON.stringify(state)]); }
}

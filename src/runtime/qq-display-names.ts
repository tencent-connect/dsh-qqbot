import { readFileSync } from 'node:fs';
import { atomicWrite } from '../shared/atomic-file.ts';
import type { ChatScope, Logger } from '../types.ts';

function displayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().replace(/\s+/g, ' ').slice(0, 300) || undefined;
}

/** QQ metadata has its own file so it never advances a settings revision. */
export class QqDisplayNames {
  private readonly names = new Map<string, string>();
  private writable = true;

  constructor(private readonly path: string, private readonly logger: Logger) {
    try {
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid QQ display names');
      for (const [key, raw] of Object.entries(value)) {
        const name = displayName(raw);
        if (name) this.names.set(key, name);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      this.writable = false;
      this.logger.warn('无法读取 QQ 平台名称缓存。');
    }
  }

  peer(appId: string, scope: ChatScope, openId: string): string | undefined {
    return this.names.get(JSON.stringify([appId, scope, openId]))
      ?? (scope === 'c2c' ? this.names.get(JSON.stringify([appId, 'group-member', openId])) : undefined);
  }

  savePeer(appId: string, scope: ChatScope, openId: string, name: unknown): void {
    this.save(JSON.stringify([appId, scope, openId]), name);
  }

  saveGroupMember(appId: string, openId: string, value: unknown): void {
    const name = displayName(value);
    if (openId && name && name !== openId) this.save(JSON.stringify([appId, 'group-member', openId]), name);
  }

  saveBotIdentity(appId: string, openId: unknown, value: unknown, groupId?: string): void {
    if (typeof openId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(openId)) return;
    const key = JSON.stringify([appId, 'bot-mention', openId, groupId ?? '']);
    this.save(key, displayName(value) ?? this.names.get(key) ?? '机器人');
  }

  botMention(appId: string, groupId: string, openId: string): string | undefined {
    return this.names.get(JSON.stringify([appId, 'bot-mention', openId, '']))
      ?? this.names.get(JSON.stringify([appId, 'bot-mention', openId, groupId]));
  }

  private save(key: string, value: unknown): void {
    const name = displayName(value);
    if (!name || this.names.get(key) === name) return;
    this.names.set(key, name);
    if (!this.writable) return;
    try {
      atomicWrite(this.path, [JSON.stringify(Object.fromEntries(this.names))]);
    } catch {
      this.logger.warn('无法保存 QQ 平台名称缓存。');
    }
  }
}

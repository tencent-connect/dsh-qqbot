/**
 * PeerMap — sessionId → QQ 对端 的持久化映射
 *
 * Web 端发起的回合不经过 QQ 入站管道，且会话被闲置回收/宿主重启后
 * SessionManager 内存记录也会丢失。出站路由器凭此映射仍可从
 * session/event 解析出 QQ 目标，把 Web 回合桥接推送到 QQ（完整镜像）。
 *
 * 存储路径：~/.dsh-qqbot/session-peers.json（与 PrefsStore 同目录约定）。
 * 读写全 fail-soft：文件缺失/损坏按空表处理，写失败仅 debug 日志。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ChatScope, Logger } from '../types.ts';

export interface PeerInfo {
  scope: ChatScope;
  peerId: string;
  senderId: string;
  /** 最近一次 QQ 入站消息 id（仅作记录；桥接发送走主动消息） */
  lastMsgId?: string;
  updatedAt: number;
}

/** 映射表条目上限（超出按 updatedAt 淘汰最旧） */
const MAX_ENTRIES = 500;

export class PeerMap {
  private cache: Map<string, PeerInfo> | null = null;
  private readonly filePath: string;

  public constructor(
    private readonly logger?: Logger,
    filePath?: string,
  ) {
    this.filePath = filePath ?? resolve(homedir(), '.dsh-qqbot', 'session-peers.json');
  }

  public get(sessionId: string): PeerInfo | undefined {
    return this.load().get(sessionId);
  }

  public set(sessionId: string, info: PeerInfo): void {
    const map = this.load();
    map.set(sessionId, info);
    this.save(map);
  }

  private load(): Map<string, PeerInfo> {
    if (this.cache !== null) return this.cache;
    const cache = new Map<string, PeerInfo>();
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const data = JSON.parse(raw) as Record<string, PeerInfo>;
      if (data && typeof data === 'object') {
        for (const [sessionId, info] of Object.entries(data)) {
          if (
            info
            && typeof info === 'object'
            && typeof info.peerId === 'string'
            && (info.scope === 'c2c' || info.scope === 'group')
          ) {
            cache.set(sessionId, info);
          }
        }
      }
    } catch {
      // 文件不存在或损坏 → 空表起步
    }
    this.cache = cache;
    return cache;
  }

  private save(map: Map<string, PeerInfo>): void {
    try {
      if (map.size > MAX_ENTRIES) {
        const ordered = [...map.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt);
        map.clear();
        for (const [sessionId, info] of ordered.slice(0, MAX_ENTRIES)) map.set(sessionId, info);
      }
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(map), null, 2), 'utf8');
    } catch (err) {
      this.logger?.debug(`im-qqbot: peer-map save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

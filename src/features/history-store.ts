/** 群历史存储共享模块。图片只保存元数据与本地路径，不保留图片字节。 */
import { MemoryHistoryStore } from '@tencent-connect/qqbot-nodejs';
import type { HistoryEntry, HistoryStore } from '@tencent-connect/qqbot-nodejs';
import type { RawAttachment } from '../types.ts';
import type { DownloadedFile } from '../transport/attachment.ts';

export interface GroupHistoryImage {
  contentType: string;
  filename: string;
  size: number;
  url: string;
  width?: number;
  height?: number;
  localPath?: string;
}

export interface GroupHistoryEntry extends HistoryEntry {
  images?: GroupHistoryImage[];
}

export interface GroupHistoryStore {
  append(groupKey: string, entry: GroupHistoryEntry, limit: number): void | Promise<void>;
  list(groupKey: string, limit: number): GroupHistoryEntry[] | Promise<GroupHistoryEntry[]>;
  clear?(groupKey: string): void | Promise<void>;
}

class ExtendedHistoryStore implements GroupHistoryStore {
  private readonly sdkStore: HistoryStore = new MemoryHistoryStore();
  append(key: string, entry: GroupHistoryEntry, limit: number): void | Promise<void> {
    return this.sdkStore.append(key, entry, limit);
  }
  async list(key: string, limit: number): Promise<GroupHistoryEntry[]> {
    return await this.sdkStore.list(key, limit) as GroupHistoryEntry[];
  }
  clear(key: string): void | Promise<void> { return this.sdkStore.clear?.(key); }
}

let store: GroupHistoryStore | null = null;
export function getHistoryStore(): GroupHistoryStore {
  if (!store) store = new ExtendedHistoryStore();
  return store;
}

export function historyImagesToAttachments(images: GroupHistoryImage[] | undefined): RawAttachment[] {
  return (images ?? []).map(image => ({
    content_type: image.contentType, filename: image.filename, size: image.size, url: image.url,
    ...(image.width === undefined ? {} : { width: image.width }),
    ...(image.height === undefined ? {} : { height: image.height }),
  }));
}

export function historyImagesToDownloadedFiles(images: GroupHistoryImage[] | undefined): DownloadedFile[] {
  return (images ?? []).filter(image => image.localPath).map(image => ({
    filename: image.filename, contentType: 'image', localPath: image.localPath!,
  }));
}

export function clearGroupHistory(appId: string, groupId: string): void {
  store?.clear?.(historyGroupKey(appId, groupId));
}
export function historyGroupKey(appId: string, groupId: string): string { return `${appId}:${groupId}`; }

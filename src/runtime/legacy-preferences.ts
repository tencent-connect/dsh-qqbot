import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type LegacyPreference, type PrefsStore } from '../model/prefs-store.ts';
import { legacyDerivedSessionId } from '../session/session-id.ts';
import { atomicWrite } from '../shared/atomic-file.ts';
import type { Logger } from '../types.ts';
import { deliveryKey } from '../transport/delivery-ledger.ts';
import { validOpenId } from './workbench-conversations.ts';

function object(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

export async function importLegacyPreferences(options: {
  source: string;
  directory: string;
  appId: string;
  prefs: PrefsStore;
  logger: Logger;
  ownsSession: (id: string) => Promise<boolean>;
  active: () => boolean;
}): Promise<void> {
  const { source, directory, appId, prefs, logger, ownsSession, active } = options;
  const marker = join(directory, `imported-0.5.5-${deliveryKey(appId)}`);
  if (source === prefs.path || existsSync(marker) || !existsSync(source)) return;
  try {
    const data = object(JSON.parse(readFileSync(source, 'utf8')));
    if (!data) throw new Error('Invalid 0.5.5 preferences file');
    const ids = object(data.sessionIds) ?? {};
    const overrides = object(data.overrides) ?? {};
    const presets = object(data.presets) ?? {};
    const entries = new Map<string, LegacyPreference>();
    const prefix = `qqbot:${appId}:`;
    let skipped = 0;
    for (const key of new Set([...Object.keys(ids), ...Object.keys(overrides), ...Object.keys(presets)])) {
      if (!active()) return;
      if (!key.startsWith(prefix)) continue;
      const peer = /^(group|c2c):(.+)$/s.exec(key.slice(prefix.length));
      if (!peer || !validOpenId(peer[2]) || Object.hasOwn(ids, key) && !validSessionId(ids[key])) {
        skipped++;
        continue;
      }
      const savedId = ids[key];
      const derivedId = legacyDerivedSessionId(key);
      const id = validSessionId(savedId) && await ownsSession(savedId) ? savedId
        : await ownsSession(derivedId) ? derivedId : undefined;
      if (savedId !== undefined && id === undefined) {
        skipped++;
        continue;
      }
      const model = object(overrides[key]);
      const preset = presets[key];
      entries.set(key, {
        sessionId: id,
        route: typeof model?.provider === 'string' && model.provider && typeof model.model === 'string' && model.model
          ? { provider: model.provider, model: model.model } : undefined,
        preset: typeof preset === 'string' && preset ? preset : undefined,
      });
    }
    if (!active()) return;
    prefs.seedLegacy(entries);
    atomicWrite(marker, ['0.5.5\n']);
    if (skipped) logger.warn(`QQBot skipped ${skipped} invalid or foreign 0.5.5 preference entries.`);
  } catch {
    logger.warn('QQBot could not import 0.5.5 preferences. The original file is available for recovery.');
  }
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

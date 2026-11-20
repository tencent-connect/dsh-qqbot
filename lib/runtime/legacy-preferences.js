import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { legacyDerivedSessionId, mintSessionId } from "../session/session-id.js";
import { atomicWrite } from "../shared/atomic-file.js";
import { deliveryKey } from "../transport/delivery-ledger.js";
import { validOpenId } from "./workbench-conversations.js";
function object(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    return Object.fromEntries(Object.entries(value));
}
export async function importLegacyPreferences(options) {
    const { source, directory, appId, prefs, logger, ownsSession, active } = options;
    const marker = join(directory, `imported-0.5.5-${deliveryKey(appId)}`);
    if (source === prefs.path || existsSync(marker) || !existsSync(source))
        return;
    try {
        const data = object(JSON.parse(readFileSync(source, 'utf8')));
        if (!data)
            throw new Error('Invalid 0.5.5 preferences file');
        const ids = object(data.sessionIds) ?? {};
        const overrides = object(data.overrides) ?? {};
        const presets = object(data.presets) ?? {};
        const entries = new Map();
        const prefix = `qqbot:${appId}:`;
        let skipped = 0;
        for (const key of new Set([...Object.keys(ids), ...Object.keys(overrides), ...Object.keys(presets)])) {
            if (!active())
                return;
            if (!key.startsWith(prefix))
                continue;
            const peer = /^(group|c2c):(.+)$/s.exec(key.slice(prefix.length));
            if (!peer || !validOpenId(peer[2]) || Object.hasOwn(ids, key) && !validSessionId(ids[key])) {
                skipped++;
                continue;
            }
            const savedId = ids[key];
            let id;
            if (validSessionId(savedId)) {
                if (await ownsSession(savedId)) {
                    id = savedId;
                }
                else if (/^session-[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(savedId)) {
                    // 0.5.5 reserves an ID on /new before a Session exists. Keep the reset
                    // without claiming an ID the current profile cannot verify.
                    id = mintSessionId();
                }
                else {
                    skipped++;
                    continue;
                }
            }
            else {
                const derivedId = legacyDerivedSessionId(key);
                if (await ownsSession(derivedId))
                    id = derivedId;
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
        if (!active())
            return;
        prefs.seedLegacy(entries);
        atomicWrite(marker, ['0.5.5\n']);
        if (skipped)
            logger.warn(`QQBot skipped ${skipped} invalid or foreign 0.5.5 preference entries.`);
    }
    catch {
        logger.warn('QQBot could not import 0.5.5 preferences. The original file is available for recovery.');
    }
}
function validSessionId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
}
//# sourceMappingURL=legacy-preferences.js.map
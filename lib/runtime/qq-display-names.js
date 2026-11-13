import { readFileSync } from 'node:fs';
import { atomicWrite } from "../shared/atomic-file.js";
function displayName(value) {
    if (typeof value !== 'string')
        return undefined;
    return value.trim().replace(/\s+/g, ' ').slice(0, 300) || undefined;
}
/** QQ metadata has its own file so it never advances a settings revision. */
export class QqDisplayNames {
    path;
    logger;
    names = new Map();
    writable = true;
    constructor(path, logger) {
        this.path = path;
        this.logger = logger;
        try {
            const value = JSON.parse(readFileSync(path, 'utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('Invalid QQ display names');
            for (const [key, raw] of Object.entries(value)) {
                const name = displayName(raw);
                if (name)
                    this.names.set(key, name);
            }
        }
        catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                return;
            this.writable = false;
            this.logger.warn('无法读取 QQ 平台名称缓存。');
        }
    }
    peer(appId, scope, openId) {
        return this.names.get(JSON.stringify([appId, scope, openId]));
    }
    savePeer(appId, scope, openId, name) {
        this.save(JSON.stringify([appId, scope, openId]), name);
    }
    save(key, value) {
        const name = displayName(value);
        if (!name || this.names.get(key) === name)
            return;
        this.names.set(key, name);
        if (!this.writable)
            return;
        try {
            atomicWrite(this.path, [JSON.stringify(Object.fromEntries(this.names))]);
        }
        catch {
            this.logger.warn('无法保存 QQ 平台名称缓存。');
        }
    }
}
//# sourceMappingURL=qq-display-names.js.map
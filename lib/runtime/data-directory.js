import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export const legacyPreferencesPath = join(homedir(), '.dsh-qqbot', 'model-prefs.json');
export function profileDataDirectory(profileDir) {
    return resolve(profileDir ?? (process.env.DSH_HOME || join(homedir(), '.dsh')), 'qqbot-state');
}
export function dataDirectory(profileDir) {
    const configured = process.env.QQBOT_DATA_DIR;
    if (!configured?.trim())
        return profileDataDirectory(profileDir);
    if (!isAbsolute(configured))
        throw new Error('QQBOT_DATA_DIR must be an absolute path');
    return resolve(configured);
}
export class QqDataDirectoryBusy extends Error {
    constructor() { super('QQ 机器人数据目录已被另一个 Host 占用。请选择其他 profile 或数据目录。'); }
}
/** Hold an OS-backed write lock in a separate database for the runtime's lifetime. */
export function lockDataDirectories(paths) {
    const roots = new Set(paths.map(path => {
        mkdirSync(path, { recursive: true, mode: 0o700 });
        return realpathSync(path);
    }));
    const locks = [];
    const release = () => {
        for (const db of locks.splice(0).reverse())
            db.close();
    };
    try {
        for (const root of [...roots].sort()) {
            const db = new DatabaseSync(join(root, 'owner.sqlite'));
            locks.push(db);
            db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
        }
        return release;
    }
    catch (error) {
        release();
        if (error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 0xff) === 5) {
            throw new QqDataDirectoryBusy();
        }
        throw error;
    }
}
//# sourceMappingURL=data-directory.js.map
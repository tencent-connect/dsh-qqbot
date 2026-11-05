import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Commit the complete replacement before publishing it to in-memory readers. */
export function atomicWrite(path, chunks) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try {
        for (const chunk of chunks) {
            const buffer = Buffer.from(chunk);
            let offset = 0;
            while (offset < buffer.length)
                offset += writeSync(fd, buffer, offset, buffer.length - offset);
        }
        fsyncSync(fd);
    }
    catch (error) {
        closeSync(fd);
        rmSync(temporary, { force: true });
        throw error;
    }
    closeSync(fd);
    try {
        renameSync(temporary, path);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
    const directory = openSync(dirname(path), 'r');
    try {
        fsyncSync(directory);
    }
    finally {
        closeSync(directory);
    }
}
//# sourceMappingURL=atomic-file.js.map
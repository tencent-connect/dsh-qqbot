import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
function missing(error) {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
function within(root, target) {
    const rest = relative(root, target);
    return rest === '' || (rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
}
/** Resolve existing targets and the nearest existing parent of a new write target. */
export async function canonicalTarget(path, allowMissing) {
    if (path.includes('\0') || !isAbsolute(path))
        throw new Error('资源路径必须是本机绝对路径');
    const suffix = [];
    let current = resolve(path);
    for (;;) {
        try {
            const info = await lstat(current);
            // A dangling symlink is not a missing write destination.
            if (info.isSymbolicLink()) {
                try {
                    return resolve(await realpath(current), ...suffix);
                }
                catch {
                    throw new Error('无法验证符号链接目标');
                }
            }
            return resolve(await realpath(current), ...suffix);
        }
        catch (error) {
            if (!allowMissing || !missing(error))
                throw error;
            const parent = dirname(current);
            if (parent === current)
                throw new Error('无法验证目标目录');
            suffix.unshift(relative(parent, current));
            current = parent;
        }
    }
}
/** Check canonical containment; a configured root must exist and be a directory. */
export async function assertPathAllowed(path, roots, cwd, allowMissing = false) {
    if (roots.length === 0)
        throw new Error('该群没有授权资源目录');
    if (!cwd || !isAbsolute(cwd))
        throw new Error('该群缺少明确的绝对工作目录');
    // Native FS expands home prefixes and preserves physical symlink/.. semantics.
    // Reject parent segments instead of normalizing away a traversal before checking.
    if (path.split(/[\\/]/).includes('..'))
        throw new Error('资源路径不能包含父目录跳转');
    const expanded = path === '~' || path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path;
    const absolute = resolve(cwd, expanded);
    const target = await canonicalTarget(absolute, allowMissing);
    for (const root of roots) {
        const canonicalRoot = await realpath(root);
        if (!(await stat(canonicalRoot)).isDirectory())
            throw new Error('授权根目录必须是目录');
        if (within(canonicalRoot, target))
            return target;
    }
    throw new Error('目标超出该群授权的资源目录');
}
//# sourceMappingURL=paths.js.map
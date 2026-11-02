import { SessionId } from '@deepseek-ai/dsh-session';
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
/** Read-only, resumable native-log evidence; never activates an Agent or sends. */
export class OperationRetention {
    scans = new Map();
    nextSession = 0;
    issues = [];
    sweeping = false;
    errors() { return [...this.issues]; }
    async sweep(persistence, operations, cutoff, protectedOperation, bodyExpired = () => false) {
        if (this.sweeping)
            return;
        this.sweeping = true;
        try {
            const candidates = operations.all().filter(item => item.terminalAt === undefined && ((item.preparedAt ?? Infinity) < cutoff(item.conversationKey) || bodyExpired(item)) && !protectedOperation(item));
            if (!candidates.length) {
                operations.retireExpired(cutoff, protectedOperation, bodyExpired);
                this.issues = [];
                return;
            }
            if (!object(persistence) || typeof persistence.open !== 'function' || typeof persistence.stat !== 'function') {
                this.issues = [`${candidates.length} 条旧 QQ 请求缺少终态证据；宿主未提供只读持久化接口，正文暂保留，未自动重投。`];
                return;
            }
            const sessionIds = [...new Set(candidates.map(item => item.sessionId))];
            const issues = [];
            for (let index = 0; index < Math.min(8, sessionIds.length); index += 1) {
                const sessionId = sessionIds[(this.nextSession + index) % sessionIds.length];
                if (!sessionId)
                    continue;
                let close;
                try {
                    const before = await persistence.stat(sessionId);
                    if (!object(before) || typeof before.revision !== 'string')
                        throw new Error('原生 Session 不存在或缺少版本凭据');
                    let scan = this.scans.get(sessionId);
                    if (!scan || scan.revision !== before.revision) {
                        scan = { revision: before.revision, offset: 0, openTurn: null, inbox: { 'next-turn': [], 'next-step': [] }, admitted: new Set(), canceled: new Set() };
                        this.scans.set(sessionId, scan);
                    }
                    const handle = await persistence.open(SessionId(sessionId), 'read');
                    if (!object(handle) || typeof handle.read !== 'function' || typeof handle.close !== 'function')
                        throw new Error('只读 Session 句柄无效');
                    const closeHandle = handle.close;
                    close = async () => closeHandle.call(handle);
                    const read = await handle.read(scan.offset, 4096);
                    if (!object(read) || !Array.isArray(read.events))
                        throw new Error('原生日志读取无效');
                    for (const event of read.events)
                        this.fold(scan, event);
                    const after = await persistence.stat(sessionId);
                    if (!object(after) || after.revision !== scan.revision) {
                        this.scans.delete(sessionId);
                        continue;
                    }
                    if (read.events.length === 4096)
                        continue;
                    const queued = new Set([...scan.inbox['next-turn'], ...scan.inbox['next-step']]);
                    for (const operation of candidates.filter(item => item.sessionId === sessionId)) {
                        if (scan.openTurn === null && !queued.has(operation.message.id) && (scan.admitted.has(operation.message.id) || scan.canceled.has(operation.message.id)) && !protectedOperation(operation))
                            operations.markTerminal(operation.operationId);
                    }
                    this.scans.delete(sessionId);
                }
                catch (error) {
                    this.scans.delete(sessionId);
                    issues.push(`旧 QQ 请求保留待核对：${error instanceof Error ? error.message : '原生日志读取失败'}；未重投或修改原生日志。`);
                }
                finally {
                    await close?.().catch(() => { });
                }
            }
            this.nextSession = (this.nextSession + 8) % sessionIds.length;
            const pending = candidates.filter(item => !operations.lookup(item.operationId)?.terminalAt).length;
            this.issues = [...new Set(issues), ...(pending ? [`${pending} 条旧 QQ 请求正在等待完整的终态证据；大日志按每轮 4096 条事件继续只读核对。`] : [])];
            operations.retireExpired(cutoff, protectedOperation, bodyExpired);
        }
        finally {
            this.sweeping = false;
        }
    }
    fold(scan, input) {
        if (!object(input) || input.seq !== scan.offset || typeof input.type !== 'string' || !object(input.data))
            throw new Error('原生日志不连续或内容无效');
        scan.offset += 1;
        const data = input.data;
        if (input.type === 'turn/start') {
            if (!Number.isSafeInteger(data.turn) || scan.openTurn !== null)
                throw new Error('原生轮次边界无效');
            scan.openTurn = Number(data.turn);
        }
        else if (input.type === 'turn/end') {
            if (scan.openTurn !== data.turn)
                throw new Error('原生轮次边界无效');
            scan.openTurn = null;
        }
        else if (input.type === 'user/message') {
            if (typeof data.id === 'string')
                scan.admitted.add(data.id);
        }
        else if (input.type === 'agent/inbox/spliced') {
            if ((data.target !== 'next-turn' && data.target !== 'next-step') || !Array.isArray(data.inserted) || !Number.isSafeInteger(data.start))
                throw new Error('原生输入队列凭据无效');
            const queue = scan.inbox[data.target];
            const start = Number(data.start);
            const count = data.removedCount === undefined ? 0 : Number(data.removedCount);
            if (!Number.isSafeInteger(count) || count < 0 || start < 0 || start + count > queue.length)
                throw new Error('原生输入队列范围无效');
            const ids = data.inserted.map((message) => { if (!object(message) || typeof message.id !== 'string')
                throw new Error('原生输入标识无效'); return message.id; });
            const removed = queue.splice(start, count, ...ids);
            if (data.outcome === 'canceled')
                for (const id of removed)
                    scan.canceled.add(id);
        }
    }
}
//# sourceMappingURL=operation-retention.js.map
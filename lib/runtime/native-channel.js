import { Session, SessionId } from '@deepseek-ai/dsh-session';
export function nativeSession(record) {
    if (record.agent.session instanceof Session)
        return record.agent.session;
    const session = record.agent.ctx.get('sessions')?.get(SessionId(record.sessionId));
    if (!session)
        throw new Error('当前原生会话不可用，请重新打开会话');
    return session;
}
//# sourceMappingURL=native-channel.js.map
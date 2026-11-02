export function registerGroupHistoryTool(ctx, manager) {
    const tools = ctx.get('tools');
    if (!tools)
        return;
    tools.register({
        name: 'qqbot_group_history',
        description: '查询当前 QQ 对话获准保存的消息记录，是否可查由此对话工具授权决定。不能查询其他群或联系人。',
        parameters: { type: 'object', properties: { query: { type: 'string' }, before: { type: 'integer', minimum: 0 } }, additionalProperties: false },
        output: { schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
            render: (_args, value) => [{ type: 'text', text: value.text }] },
        async execute(input, exec) {
            exec.signal.throwIfAborted();
            const service = manager.conversations;
            const entry = exec.agent ? service?.conversationForSession(exec.agent.id) : undefined;
            if (!entry || !service || !entry.policy.tools.qqbot_group_history || entry.policy.tools.qqbot_group_history === 'deny')
                throw new Error('当前 QQ 对话未授权群记录查询');
            if (!input || typeof input !== 'object' || Array.isArray(input))
                throw new Error('查询参数无效');
            const args = Object.fromEntries(Object.entries(input));
            if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 2000))
                throw new Error('查询文字无效');
            if (args.before !== undefined && (typeof args.before !== 'number' || !Number.isSafeInteger(args.before) || args.before < 0))
                throw new Error('分页位置无效');
            let remaining = entry.policy.context.maxChars;
            const messages = service.store.messages(entry.key, { before: typeof args.before === 'number' ? args.before : undefined, query: typeof args.query === 'string' ? args.query : undefined })
                .flatMap(message => { if (remaining <= 0)
                return []; const text = message.text.slice(0, remaining); remaining -= text.length; return [{ ...message, text }]; });
            exec.signal.throwIfAborted();
            return { text: JSON.stringify({ messages, nextBefore: messages.at(-1)?.cursor ?? null }) };
        },
    });
}
//# sourceMappingURL=history-tool.js.map
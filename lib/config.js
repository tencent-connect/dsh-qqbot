/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
/** 访问控制子 Schema（独立导出：config 路由的服务端校验复用） */
export const AccessControlSchema = Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('allowlist').description('C2C访问模式（默认白名单，空名单拒绝所有人）'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单（QQ OpenID）'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 OpenID）'),
});
/** 分条发送子 Schema（独立导出：config 路由的服务端校验复用） */
export const SegmentedReplySchema = Schema.object({
    enable: Schema.boolean().default(false).description('分条发送总开关（关闭时一次回复只发一条）'),
    onlyLlmResult: Schema.boolean().default(true).description('只对模型回复分条；工具结果 / 系统提示不分'),
    splitMode: Schema.union(['regex', 'words', 'line']).default('regex').description('切分方式：regex 标点/换行、words 词表、line 逐行'),
    regex: Schema.string()
        .default('.*?(?:[。！？!?~…]+|\\n+)|.+$')
        .description('regex 模式的切分正则（须匹配出带分隔符的片段）'),
    splitWords: Schema.array(Schema.string())
        .default(['。', '？', '！', '~', '…'])
        .description('words 模式的切分词表'),
    contentCleanupRule: Schema.string().default('[。]+$').description('每段收尾清理正则（只锚定结尾，勿写 [。]+）'),
    wordsCountThreshold: Schema.number().min(1).default(150).description('整段可见字数 <= 该值才分条（防长分析被切碎）'),
    forwardThreshold: Schema.number().min(1).default(1500).description('整段可见字数 > 该值不分条（QQ 无合并转发，整条发送）'),
    intervalMethod: Schema.union(['random', 'log']).default('random').description('条间间隔算法'),
    intervalMin: Schema.number().min(0).default(2.5).description('random 模式最小间隔(秒)，风控敏感参数'),
    intervalMax: Schema.number().min(0).default(5).description('random 模式最大间隔(秒)'),
    logBase: Schema.number().min(1.01).default(2.6).description('log 模式底数（越大越平缓，仅 intervalMethod=log 生效）'),
    logJitter: Schema.number().min(0).default(0.5).description('log 模式随机抖动上限(秒)'),
    maxBubbles: Schema.number().min(1).default(3).description('单轮最多气泡数（QQ 同一来源消息被动回复限额 4 次）'),
});
export const ConfigSchema = Schema.object({
    appId: Schema.string().default('').description('QQ 机器人 AppID'),
    appSecret: Schema.string().default('').description('QQ 机器人 AppSecret'),
    provider: Schema.string().description('LLM provider name'),
    model: Schema.string().description('Model name'),
    preset: Schema.string().description('Agent preset id'),
    cwd: Schema.string().description('Agent working directory (default ~/.dsh-qqbot/workspace)'),
    requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
    groupPrompt: Schema.string().description('群聊额外system prompt'),
    directPrompt: Schema.string().description('私聊额外system prompt'),
    textChunkLimit: Schema.number().default(4500).description('单条消息最大字符数'),
    streaming: Schema.boolean().default(true).description('是否启用流式输出（群聊始终不启用）'),
    segmentedReply: SegmentedReplySchema.default({
        enable: false,
        onlyLlmResult: true,
        splitMode: 'regex',
        regex: '.*?(?:[。！？!?~…]+|\\n+)|.+$',
        splitWords: ['。', '？', '！', '~', '…'],
        contentCleanupRule: '[。]+$',
        wordsCountThreshold: 150,
        forwardThreshold: 1500,
        intervalMethod: 'random',
        intervalMin: 2.5,
        intervalMax: 5,
        logBase: 2.6,
        logJitter: 0.5,
        maxBubbles: 3,
    }).description('分条发送（多气泡）：把一段回复拆成多条 QQ 消息'),
    sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
    maxQueue: Schema.number().default(20).description('并发队列最大长度'),
    processingTimeoutMs: Schema.number().default(30 * 60 * 1000).description('处理超时(ms)，超时中断当前 LLM 调用'),
    askTimeoutMs: Schema.number().default(5 * 60 * 1000).description('待答问题超时(ms)，超时自动拒绝并提示'),
    historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
    access: AccessControlSchema.default({
        c2cMode: 'allowlist',
        c2cAllow: [],
        groupMode: 'open',
        groupAllow: [],
    }).description('访问控制'),
    showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
    debug: Schema.boolean().default(false),
    media: Schema.object({
        enabled: Schema.boolean().default(true).description('是否启用富媒体理解（图片/视频下载 + 工具分析）'),
        maxMB: Schema.number().default(200).description('富媒体下载大小上限(MB)'),
        ttlHours: Schema.number().default(24).description('富媒体存活时长(小时)，0=永不过期'),
    }).default({
        enabled: true,
        maxMB: 200,
        ttlHours: 24,
    }).description('富媒体理解配置'),
    vision: Schema.object({
        enabled: Schema.boolean().default(false).description('是否启用视觉理解（qqbot_describe_image 工具）'),
        provider: Schema.string().default('').description('视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai）'),
        model: Schema.string().default('').description('视觉模型 id（如 qwen-vl-max）'),
        defaultPrompt: Schema.string().default('Describe this image in detail.').description('默认描述 prompt'),
        maxBytes: Schema.number().default(10 * 1024 * 1024).description('图片字节上限'),
        maxTokens: Schema.number().default(1024).description('输出 token 上限'),
        timeoutMs: Schema.number().default(120000).description('视觉调用超时(ms)'),
    }).default({
        enabled: false,
        provider: '',
        model: '',
        defaultPrompt: 'Describe this image in detail.',
        maxBytes: 10 * 1024 * 1024,
        maxTokens: 1024,
        timeoutMs: 120000,
    }).description('视觉理解配置'),
    sendFile: Schema.object({
        restrictPaths: Schema.boolean().default(true).description('是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots）'),
        extraRoots: Schema.array(Schema.string()).default([]).description('额外允许访问的根目录'),
        sendPresentedFiles: Schema.boolean().default(true).description('是否将 present 声明的交付文件发送到当前会话'),
        maxFiles: Schema.number().default(4).description('单轮最多投递的交付文件数'),
    }).default({
        restrictPaths: true,
        extraRoots: [],
        sendPresentedFiles: true,
        maxFiles: 4,
    }).description('附件发送配置'),
});
//# sourceMappingURL=config.js.map
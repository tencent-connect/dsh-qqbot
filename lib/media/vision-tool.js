/**
 * 内置 qqbot_describe_image 视觉工具。
 *
 * 复用 dsh 生态的 llm + attachments 服务：
 *   1. 加载图片（本地绝对路径 / http URL）→ magic bytes 嗅探 mediaType
 *   2. attachments.saveImage → ImageAttachmentRef（字节不进 session log）
 *   3. createUserMessage(ImageBlock + text) → llm.stream → BlockAssembler 收集文本
 *
 * 手写 ToolDefinition（标准 JSON Schema），避免引入 dsh-tools 的 8 个 peer 依赖。
 */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseDocument, isMap, isSeq, isScalar } from 'yaml';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
/** 工具名（qqbot 前缀避免与外部 describe-image 包的同名工具冲突） */
export const DESCRIBE_IMAGE_TOOL_NAME = 'qqbot_describe_image';
const DESCRIPTION = 'Inspect one image and return the text the user needs. The image is a local absolute path '
    + '(downloaded by the QQ bot) or an http(s) URL. Use this when the user references an image, '
    + 'or when a task needs OCR, chart/diagram reading, screenshot or UI analysis, translation of '
    + 'image text, or photo understanding. Always pass an explicit `prompt` with a precise '
    + 'instruction (e.g. "transcribe all text", "extract the table as CSV", "translate the text '
    + 'into Chinese") instead of relying on the generic default.';
/** 图片 magic bytes 嗅探 → 标准 MIME（不信声明，安全底线） */
function sniffImageMediaType(bytes) {
    if (bytes.length < 12)
        return null;
    // PNG: 89 50 4E 47
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    // JPEG: FF D8 FF
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
        return 'image/jpeg';
    // GIF: 47 49 46 38
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
        return 'image/gif';
    // WEBP: 52 49 46 46 .. 57 45 42 50
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
        return 'image/webp';
    return null;
}
/** 加载图片字节（本地路径 / http URL），校验大小 + 嗅探 MIME */
async function loadImageBytes(image, maxBytes, signal) {
    let data;
    if (/^https?:\/\//i.test(image)) {
        const resp = await fetch(image, { signal, redirect: 'error' });
        if (!resp.ok)
            throw new Error(`qqbot_describe_image: download failed (HTTP ${resp.status})`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > maxBytes)
            throw new Error(`qqbot_describe_image: image too large (${buf.length} bytes)`);
        data = new Uint8Array(buf);
    }
    else {
        const info = await stat(image).catch(() => null);
        if (!info?.isFile())
            throw new Error(`qqbot_describe_image: image file not found: ${image}`);
        if (info.size > maxBytes)
            throw new Error(`qqbot_describe_image: image too large (${info.size} bytes)`);
        data = new Uint8Array(await readFile(image));
    }
    const mediaType = sniffImageMediaType(data);
    if (mediaType === null)
        throw new Error('qqbot_describe_image: unrecognized image format (png/jpeg/gif/webp only)');
    return { data, mediaType };
}
/** 将终端 finish reason 转成辅助调用失败 */
function finishError(finish) {
    switch (finish.kind) {
        case 'error':
        case 'aborted':
            return new Error(finish.failure.message);
        default:
            return undefined;
    }
}
/** 调视觉模型描述图片，返回纯文本 */
async function callVision(llm, vision, prompt, imageRef, signal) {
    const message = createUserMessage({
        content: [
            { type: 'image', attachment: imageRef },
            { type: 'text', text: prompt },
        ],
        source: { kind: 'plugin:dsh-im-qqbot' },
    });
    const options = {
        provider: vision.provider,
        model: vision.model,
        messages: [message],
        maxTokens: vision.maxTokens,
        signal,
    };
    const assembler = new BlockAssembler();
    for await (const chunk of llm.stream(options)) {
        assembler.push(chunk);
    }
    const terminalError = finishError(assembler.finish);
    if (terminalError !== undefined)
        throw terminalError;
    const text = assembler.blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' ')
        .trim();
    if (text.length === 0)
        throw new Error('qqbot_describe_image: vision model returned no text');
    return text;
}
/** 展开 `~`/`~/`/`~\` 前缀 */
function expandHomePath(path) {
    if (path === '~')
        return homedir();
    if (path.startsWith('~/') || path.startsWith('~\\'))
        return join(homedir(), path.slice(2));
    return path;
}
/**
 * 解析 DSH_HOME 的优先级与跨平台处理：
 * 显式配置 > `$DSH_HOME`（空/空白视为未设置）> `~/.dsh`，展开 `~` 后 resolve 为绝对路径。
 */
function resolveDshHome() {
    const fromEnv = process.env.DSH_HOME;
    const selected = fromEnv !== undefined && fromEnv.trim().length > 0
        ? fromEnv
        : join(homedir(), '.dsh');
    return resolve(expandHomePath(selected));
}
/**
 * 启动时检查 settings.yaml 里 vision 模型的 input 模态是否声明了 image。
 *
 * 模型配置界面不暴露 `input` 字段，用户通过界面配置的视觉模型默认是纯文本，
 * 会导致 pi-ai adapter 拒绝图片输入。这里在启动时兜底：未声明 image 时自动补 `[text, image]`。
 *
 * 写入遵循与 setup/persist.ts 相同的约束（该文件是宿主用户级配置，多写者共存）：
 * - 文档保真：eemeli/yaml Document API 原地编辑，注释/锚点/其他配置原样保留；
 * - 原子写：同目录临时文件 + rename，崩溃不留半份文件；
 * - 乐观校验：写入窗口内文件被外部改动则放弃本次补写（幂等，下次启动再补）；
 * - fail-closed：解析失败仅 warn 不阻断启动（视觉功能可另行手动配置）。
 * 幂等：已声明 image 则不写（不触 mtime，不引发宿主重载）。
 */
export function ensureVisionInputModal(vision, logger) {
    if (!vision.enabled || !vision.provider || !vision.model)
        return;
    const settingsPath = resolve(resolveDshHome(), 'settings.yaml');
    try {
        if (!existsSync(settingsPath))
            return;
        // YAML 禁止 tab 缩进（配置界面/编辑器可能写入），读入时把行首 tab 规范化为空格
        const before = readFileSync(settingsPath, 'utf8');
        const normalized = before.replace(/^\t+/gm, (tabs) => '  '.repeat(tabs.length));
        // intAsBigInt：整数不经 double 中转，避免回写时把用户其他配置里的大整数
        // （安装 id、时间戳等）截断到 2^53 精度
        const doc = parseDocument(normalized, { intAsBigInt: true });
        if (doc.errors.length > 0)
            throw new Error(`settings.yaml 解析失败: ${doc.errors[0]?.message ?? 'unknown'}`);
        const root = doc.contents;
        if (!isMap(root))
            throw new Error('settings.yaml 顶层不是映射');
        // 逐层定位 llm-pi-ai.providers.{provider}.models（原地遍历，保留原文）
        const piAi = root.get('llm-pi-ai', true);
        if (!isMap(piAi)) {
            logger.warn(`im-qqbot: settings.yaml 未找到 llm-pi-ai，请手动确认 vision 模型已声明 image 输入`);
            return;
        }
        const providers = piAi.get('providers', true);
        if (!isMap(providers)) {
            logger.warn(`im-qqbot: settings.yaml 未找到 llm-pi-ai.providers.${vision.provider}，请手动确认 vision 模型已声明 image 输入`);
            return;
        }
        const provider = providers.get(vision.provider, true);
        if (!isMap(provider)) {
            logger.warn(`im-qqbot: settings.yaml 未找到 llm-pi-ai.providers.${vision.provider}，请手动确认 vision 模型已声明 image 输入`);
            return;
        }
        const models = provider.get('models', true);
        if (!isSeq(models)) {
            logger.warn(`im-qqbot: settings.yaml 未找到 llm-pi-ai.providers.${vision.provider}.models，请手动确认 vision 模型已声明 image 输入`);
            return;
        }
        const model = models.items.find((item) => isMap(item) && isScalar(item.get('id', true)) && String(item.get('id', true)) === vision.model);
        if (model === undefined || !isMap(model)) {
            logger.warn(`im-qqbot: settings.yaml 未找到 vision 模型 ${vision.model}，请手动确认已声明 image 输入`);
            return;
        }
        // 幂等：已声明 image 则不写（不触 mtime）
        const input = model.get('input', true);
        if (isSeq(input) && input.items.some((i) => isScalar(i) && i.value === 'image'))
            return;
        // 原地补写 input: [text, image]，其余内容（注释/锚点/格式）原样保留
        model.set('input', ['text', 'image']);
        const next = doc.toString({ lineWidth: 0 });
        // 乐观校验：写入窗口内被外部改动（宿主设置流程）则放弃，下次启动幂等重试
        if (readFileSync(settingsPath, 'utf8') !== before) {
            logger.warn('im-qqbot: settings.yaml 在写入窗口内被外部修改，跳过 vision input 补写（下次启动重试）');
            return;
        }
        // 原子写：同目录临时文件 + rename
        const tmpPath = `${settingsPath}.imqqbot.tmp`;
        try {
            writeFileSync(tmpPath, next, 'utf8');
            renameSync(tmpPath, settingsPath);
        }
        catch (err) {
            try {
                unlinkSync(tmpPath);
            }
            catch { /* 临时文件可能不存在 */ }
            throw err;
        }
        logger.info(`im-qqbot: 已为 vision 模型补充 input: [text, image] (${vision.provider}/${vision.model})`);
    }
    catch (err) {
        logger.warn(`im-qqbot: 检查 settings.yaml vision input 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/** 注册 qqbot_describe_image 工具（服务缺失时优雅降级，不阻断插件启动） */
export function registerDescribeImageTool(ctx, vision, logger) {
    if (!vision.enabled)
        return;
    if (!vision.provider || !vision.model) {
        logger.warn('im-qqbot: vision.provider/model 未配置，qqbot_describe_image 工具未注册');
        return;
    }
    const tools = ctx.get('tools');
    const llm = ctx.get('llm');
    const attachments = ctx.get('attachments');
    if (!tools?.register || !llm?.stream || !attachments?.saveImage) {
        logger.warn('im-qqbot: tools/llm/attachments 服务不可用，qqbot_describe_image 工具未注册');
        return;
    }
    const definition = {
        name: DESCRIBE_IMAGE_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                image: {
                    type: 'string',
                    description: 'Absolute path to a local image file, or an http(s) URL of the image.',
                },
                prompt: {
                    type: 'string',
                    description: 'Your precise instruction for the vision model about this image.',
                },
            },
            required: ['image'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    model: { type: 'string' },
                    image: { type: 'string' },
                    mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
                    bytes: { type: 'integer' },
                },
                required: ['text', 'model', 'image', 'mimeType', 'bytes'],
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.text },
            ],
        },
        async execute(args, exec) {
            const { image, prompt } = args;
            if (typeof image !== 'string' || image.length === 0) {
                throw new Error('qqbot_describe_image: `image` must be a non-empty string');
            }
            const loaded = await loadImageBytes(image, vision.maxBytes, exec.signal);
            const ref = await attachments.saveImage({
                data: loaded.data,
                mediaType: loaded.mediaType,
                name: /^https?:\/\//i.test(image) ? undefined : basename(image),
            });
            const text = await callVision(llm, vision, prompt ?? vision.defaultPrompt, ref, exec.signal);
            return { text, model: vision.model, image, mimeType: loaded.mediaType, bytes: loaded.data.length };
        },
    };
    tools.register(definition);
    logger.info(`im-qqbot: qqbot_describe_image 工具已注册 (provider=${vision.provider} model=${vision.model})`);
}
//# sourceMappingURL=vision-tool.js.map
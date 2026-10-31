/**
 * QQ 渠道自声明 —— `qqChannel` 会话投影单元。
 *
 * 宿主 `MessageSourceMap` 在类型层明确标注为 merge-extensible sum type
 * （"plugins add their own `kind`s"），持久化与 `session/event` 推送帧对
 * `source` 的校验均为 looseObject（额外字段直通）。入站消息据此携带
 * `source.channel`（'qq/c2c' / 'qq/group'），本单元在日志折叠时对该声明
 * 做一次性锁存——输入是会话日志本身：重放安全，随投影 checkpoint 落盘，
 * 冷会话经 cachedSnapshot 依然可读。
 *
 * 与 RFC-0001（deepseek-ai/deepseek-harness discussion #3897）的关系：
 * 该 RFC 提议渠道进入 session header（"创建即知、永不变化"的属性应随
 * 列表行直发而非投影折叠）。本单元是 header 落地前的过渡实现，语义完全
 * 一致（首条消息即定渠道），对消费方（如 dsh-channel-view）透明可替换。
 *
 * 注册形态参照 @deepseek-ai/dsh-tool-todo 的 todos 单元官方姿势；
 * schema 用鸭子类型，零运行时依赖（注册表只在边界消费 `parse`）。
 */

/** 渠道值域。`'unobserved'` 是状态机初始态，永不作为线上值下发。 */
export type QqChannelState = 'unobserved' | 'qq/c2c' | 'qq/group';

/** 折叠所需的最小事件形状（结构收窄，不依赖宿主事件类型版本）。 */
interface ProjectionLogEvent {
  type?: unknown;
  data?: { source?: { kind?: unknown; channel?: unknown } };
}

/** 字符串值 schema（鸭子类型；注册表只在边界调用 parse）。 */
const stringSchema = {
  parse: (value: unknown): string => {
    if (typeof value !== 'string') {
      throw new TypeError(`[im-qqbot] qqChannel projection value must be a string, got ${typeof value}`);
    }
    return value;
  },
};

/**
 * 由会话 scope 得出要打进 `source.channel` 的声明值。
 * @param scope - QQ 会话范围（私聊 / 群聊）。
 * @returns 渠道值（'qq/c2c' | 'qq/group'）。
 */
export function qqChannelOf(scope: 'c2c' | 'group'): Exclude<QqChannelState, 'unobserved'> {
  return scope === 'group' ? 'qq/group' : 'qq/c2c';
}

/** 注册入口所需的最小服务面（结构性声明，避免绑定宿主类型版本）。 */
interface QqChannelRegistrationHost {
  sessionProjections?: {
    register(definition: unknown): () => void;
  };
}

/**
 * 在携带 sessionProjections 服务的上下文上注册 qqChannel 单元。
 * 服务缺席（如极老宿主）时静默降级为空句柄，不影响插件其余功能。
 * @param ctx - 已注入 sessionProjections 的 cordis 上下文（或等价结构）。
 * @returns 单元反注册句柄。
 */
export function registerQqChannelProjection(ctx: QqChannelRegistrationHost | unknown): () => void {
  const registry = (ctx as QqChannelRegistrationHost | null | undefined)?.sessionProjections;
  if (registry === undefined || typeof registry.register !== 'function') {
    return () => {};
  }
  return registry.register({
    key: 'qqChannel',
    stateSchema: stringSchema,
    init: (): QqChannelState => 'unobserved',
    apply: (state: QqChannelState, event: ProjectionLogEvent): QqChannelState => {
      if (state !== 'unobserved') return state;
      if (event?.type !== 'user/message') return state;
      const channel = event.data?.source?.channel;
      return channel === 'qq/c2c' || channel === 'qq/group' ? channel : state;
    },
    stateVersion: 1,
    // wire 在场 = 值随快照/推送帧下发客户端；view 恒等。
    wire: {
      viewSchema: stringSchema,
      view: (state: QqChannelState) => state,
    },
  });
}

/**
 * ApprovalChannel — 把 dsh 的审批 seam（`approval/request` waterfall）桥接到 QQ。
 *
 * 接入方式：监听 `approval/request` waterfall，按 `request.agent.id` 路由到 QQ
 * 会话；非 QQ 会话委托链上其他 answerer（`next()`），多通道（Web/TUI）共存。
 *
 * 每个会话同一时间最多一个 pending 审批（审批是阻塞式的）；outcome 是 dsh
 * 协议的闭合集合，无 allow-always，只提供「允许一次 / 拒绝」两个按钮。
 */
import type { EventOptions } from '@deepseek-ai/cordis';
import type { InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import { randomUUID } from 'node:crypto';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { decodeButtonData } from './button-utils.ts';
import { buildApprovalKeyboard, buildApprovalText } from './approval-renderer.ts';
import type { DeliveryTargetResolver } from '../transport/turn-tracker.ts';

// ── 最小契约（对齐 dsh-user-approval，避免硬依赖） ──

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/** session log 中 tool/call 事件的最小结构（commandOf 回显命令用） */
interface ApprovalSessionEvent {
  type: string;
  data?: { callId?: unknown; arguments?: unknown; [key: string]: unknown };
}

export interface ApprovalRequest {
  agent: {
    id: string;
    /**
     * dsh-agent 的 `Agent.session` 在类型上是必选，但审批请求可能来自跨进程或
     * 投影后的上下文，运行时拿不到 live session（类型契约与运行时的 gap）。此时
     * 只是无法回显命令原文，不应让整个审批失败，故这里标为可选。
     */
    session?: { snapshotEvents?(): readonly ApprovalSessionEvent[] };
  };
  toolName: string;
  /** 关联的 tool/call 事件 id，用于从 session log 找回被 gate 的命令 */
  callId?: string;
  /** asker 的人类可读解释 */
  reason?: string;
  signal?: AbortSignal;
}

// ── 依赖接口（结构化，便于单测） ──

export interface ApprovalSessionRecordLike {
  sessionKey: string;
  scope: ChatScope;
  replyTarget: ReplyTarget;
}

export interface ApprovalChannelManagerLike {
  findBySessionId(sessionId: string): ApprovalSessionRecordLike | undefined;
  getSessionRecord(scope: ChatScope, peerId: string): ApprovalSessionRecordLike | undefined;
}

export interface ApprovalChannelSenderLike {
  sendMarkdown(target: ReplyTarget, content: string, opts?: { keyboard?: unknown }): Promise<unknown>;
}

/** 配置投影（审批按钮校验 allowlist 用） */
export interface ApprovalChannelConfigLike {
  access: {
    c2cMode: 'open' | 'allowlist' | 'disabled';
    c2cAllow: readonly string[];
  };
}

/** approval/request waterfall 的 answerer handler */
export interface ApprovalChannelContext {
  on(
    event: string,
    handler: (...args: unknown[]) => unknown,
    options?: EventOptions,
  ): () => boolean;
}

// ── 每会话 pending 状态 ──

interface PendingApproval {
  record: ApprovalSessionRecordLike;
  request: ApprovalRequest;
  resolve: (outcome: ApprovalOutcome) => void;
  /** 本审批的唯一标识，编码进按钮 data，点击时必须匹配（防旧卡片混淆） */
  nonce: string;
  onAbort?: () => void;
}

const COMMAND_CLIP = 500;

/**
 * 从 session log 按 callId 找回被 gate 的命令（审批请求本身不重复携带 arguments）。
 * 对齐 TUI/web 的 `commandOf` 语义。
 */
function commandOf(req: ApprovalRequest): string | undefined {
  if (req.callId === undefined) return undefined;
  // 审批请求可能来自没有 live session 的上下文（例如跨进程/投影后的 Agent），
  // 此时只是拿不到命令原文，不能因此让整个审批失败。
  const events = req.agent.session?.snapshotEvents?.();
  if (!Array.isArray(events)) return undefined;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== 'tool/call') continue;
    const data = event.data;
    if (String(data?.callId) !== String(req.callId)) continue;
    const raw = data?.arguments;
    if (typeof raw !== 'string') return undefined;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && 'command' in parsed) {
        const command = (parsed as { command?: unknown }).command;
        if (typeof command === 'string') return command;
      }
    } catch {
      // 非 JSON，回退到原始字符串
    }
    return raw.length <= COMMAND_CLIP ? raw : `${raw.slice(0, COMMAND_CLIP)}…`;
  }
  return undefined;
}

export class ApprovalChannel {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly manager: ApprovalChannelManagerLike;
  private readonly sender: ApprovalChannelSenderLike;
  private readonly logger: Logger;
  private readonly config: ApprovalChannelConfigLike;
  private readonly targets: DeliveryTargetResolver | undefined;

  /**
   * @param targets 回合投递目标解析（与出站共享）。缺省时按会话 replyTarget 被动回复。
   */
  public constructor(
    manager: ApprovalChannelManagerLike,
    sender: ApprovalChannelSenderLike,
    config: ApprovalChannelConfigLike,
    logger: Logger,
    targets?: DeliveryTargetResolver,
  ) {
    this.manager = manager;
    this.sender = sender;
    this.config = config;
    this.logger = logger;
    this.targets = targets;
  }

  /**
   * 注册 approval/request waterfall answerer。
   *
   * 不再探测 approval 服务是否已挂载：它是 optional peer，挂载时机可能晚于
   * 本插件的 apply，一次性探测失败会让通道永久失效。监听事件本身不依赖服务
   * 存在——服务就绪后请求自然经过同一条瀑布，未挂载时不会有请求到达。
   *
   * `global` 是必需的：approval/request 按 agent 作用域派发，根作用域注册的
   * 监听器不带 global 会被作用域过滤掉。
   */
  public install(ctx: ApprovalChannelContext): void {
    const self = this;
    ctx.on('approval/request', (req: unknown, next: unknown) => {
      const request = req as ApprovalRequest;
      const nextFn = next as () => Promise<ApprovalOutcome>;
      const record = self.manager.findBySessionId(request.agent.id);
      // 本回合按策略不投递到 QQ → 交给链上其他 answerer（Web/TUI）
      const target = record ? self.resolveTarget(request.agent.id, record) : undefined;
      if (record && target) return self.park(record, target, request);
      return nextFn();
    }, { global: true, prepend: true });
    this.logger.info('im-qqbot: QQ approval channel installed');
  }

  /** 会话回收时清理其 pending 审批，避免 Promise 悬挂 */
  public cancelPending(sessionKey: string): void {
    const entry = this.pending.get(sessionKey);
    if (!entry) return;
    this.pending.delete(sessionKey);
    this.removeAbort(entry);
    entry.resolve('cancelled');
  }

  /** 按钮点击决策：解码 button_data，校验点击者授权，settle pending 审批 */
  public handleInteraction(event: InteractionEvent): boolean {
    const peerId = event.group_openid ?? event.user_openid;
    if (!peerId) return false;
    const scope: ChatScope = event.group_openid ? 'group' : 'c2c';
    const record = this.manager.getSessionRecord(scope, peerId);
    if (!record) return false;
    const entry = this.pending.get(record.sessionKey);
    if (!entry) return false;

    const data = event.data?.resolved?.button_data;
    if (!data) return false;
    const button = decodeButtonData(data);
    if (!button || button.t !== 'approval') return false;

    // nonce 必须匹配 pending：旧卡片/其它会话的卡片点击不 settle（#94-3）
    if (button.n !== entry.nonce) {
      this.logger.warn(`im-qqbot: approval button nonce mismatch: key=${record.sessionKey}`);
      return false;
    }

    // 白名单模式下审批只认名单内用户；点击者身份缺失同样拒绝（fail-closed，#94-3）
    const clicker = event.group_member_openid ?? event.user_openid;
    if (this.config.access.c2cMode === 'allowlist'
      && (!clicker || !this.config.access.c2cAllow.includes(clicker))) {
      this.logger.warn(`im-qqbot: approval button rejected (clicker not allowlisted): user=${clicker ?? '(missing)'} key=${record.sessionKey}`);
      return false;
    }

    this.pending.delete(record.sessionKey);
    this.removeAbort(entry);
    entry.resolve(button.d === 'allow' ? 'allowed-once' : 'rejected');
    return true;
  }

  /** 走 QQ 通道：发审批消息 + 挂起 Promise，等待用户决策 */
  private async park(
    record: ApprovalSessionRecordLike,
    target: ReplyTarget,
    request: ApprovalRequest,
  ): Promise<ApprovalOutcome> {
    const key = record.sessionKey;
    // 会话回收/取消可能在发送前发生：signal 已 abort 则直接失败
    if (request.signal?.aborted) return 'cancelled';

    const command = commandOf(request);
    const nonce = randomUUID().slice(0, 8);
    try {
      await this.sender.sendMarkdown(
        target,
        buildApprovalText(request, command),
        { keyboard: buildApprovalKeyboard(nonce) },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`im-qqbot: approval send failed key=${key}: ${msg}`);
      return 'unavailable'; // 无法呈现审批，fail-closed
    }

    return new Promise<ApprovalOutcome>((resolve) => {
      const entry: PendingApproval = { record, request, resolve, nonce };
      if (request.signal) {
        const onAbort = (): void => {
          if (this.pending.get(key) !== entry) return;
          this.pending.delete(key);
          resolve('cancelled');
        };
        entry.onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      this.pending.set(key, entry);
      this.logger.info(`im-qqbot: approval sent to QQ, waiting for decision key=${key}`);
    });
  }

  /** 本回合的投递目标；未注入解析器时沿用会话 replyTarget */
  private resolveTarget(sessionId: string, record: ApprovalSessionRecordLike): ReplyTarget | undefined {
    return this.targets ? this.targets.targetFor(sessionId) : record.replyTarget;
  }

  private removeAbort(entry: PendingApproval): void {
    if (entry.onAbort && entry.request.signal) {
      entry.request.signal.removeEventListener('abort', entry.onAbort);
    }
  }
}

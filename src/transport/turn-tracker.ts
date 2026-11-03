/**
 * TurnTracker — 回合归属与投递目标的单一事实源。
 *
 * 出站文本、交付文件、提问卡片、审批卡片、qqbot_send_file 都通过
 * {@link DeliveryTargetResolver.targetFor} 拿「本回合发到哪、怎么发」，
 * 不再各自读 `SessionRecord.replyTarget`，保证同一回合所有出站一致。
 *
 * 只跟踪 QQ 会话：session/event 是全局监听，桌面/web 会话的回合在
 * turn/start 时即被过滤，不进入状态表。
 */
import type { ExternalTurnDelivery } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';
import type { QqInputRegistry } from './qq-input-origin.ts';
import {
  classifyTurnInput,
  createTurnState,
  deliveryMode,
  noteTurnInput,
  type TurnDeliveryState,
  type TurnInputSource,
} from './turn-origin.ts';

/** 本回合的投递计划 */
export interface DeliveryPlan {
  target: ReplyTarget;
  /** 主动推送：不复用被动回复窗口，不走流式 */
  proactive: boolean;
}

/** 按会话解析投递目标。undefined = 不是 QQ 会话，或本回合按策略不投递到 QQ。 */
export interface DeliveryTargetResolver {
  targetFor: (sessionId: string) => ReplyTarget | undefined;
}

/** 会话地址查询的最小契约（SessionManager 实现） */
export interface TurnTrackerManagerLike {
  findBySessionId: (sessionId: string) => { replyTarget: ReplyTarget } | undefined;
  deliveryAddress?: (sessionId: string) => ReplyTarget | undefined;
}

export interface TurnTrackerOptions {
  externalTurns: ExternalTurnDelivery;
}

interface TrackedTurn {
  state: TurnDeliveryState;
  /** 本回合认领的 QQ 入站消息 id，回合结束时释放登记 */
  inputs: Set<string>;
}

/** user/message 事件数据（宿主契约：data 即 UserMessage；兼容 { message } 包裹形态） */
interface UserMessageData {
  id?: unknown;
  source?: TurnInputSource;
  message?: { id?: unknown; source?: TurnInputSource };
}

export class TurnTracker implements DeliveryTargetResolver {
  private readonly turns = new Map<string, TrackedTurn>();
  private readonly manager: TurnTrackerManagerLike;
  private readonly inputs: QqInputRegistry;
  private readonly options: TurnTrackerOptions;
  private readonly logger: Logger;

  public constructor(
    manager: TurnTrackerManagerLike,
    inputs: QqInputRegistry,
    options: TurnTrackerOptions,
    logger: Logger,
  ) {
    this.manager = manager;
    this.inputs = inputs;
    this.options = options;
    this.logger = logger;
  }

  /**
   * turn/start：开启新回合。
   * @returns true 表示确实换了一轮（调用方据此清理上一轮的出站状态）
   */
  public begin(sessionId: string, turn: number | undefined): boolean {
    if (turn === undefined) return false;
    const current = this.turns.get(sessionId);
    if (current?.state.turn === turn) return false;
    if (this.addressOf(sessionId) === undefined) return false;
    if (current !== undefined) this.release(current);
    this.turns.set(sessionId, { state: createTurnState(turn), inputs: new Set() });
    return true;
  }

  /** user/message：按这一条消息归类，不发送 */
  public note(sessionId: string, data: Record<string, unknown>): void {
    const tracked = this.turns.get(sessionId);
    if (tracked === undefined) return;
    const { messageId, source } = readUserMessage(data);
    const qqOwned = this.inputs.has(messageId);
    if (qqOwned && messageId !== undefined) tracked.inputs.add(messageId);

    const before = deliveryMode(tracked.state);
    noteTurnInput(tracked.state, classifyTurnInput(source, qqOwned));
    if (before === 'proactive' || deliveryMode(tracked.state) !== 'proactive') return;

    const plan = this.planFor(sessionId);
    if (plan === undefined) {
      this.logger.info(`im-qqbot: turn not delivered to QQ (externalTurns=${this.options.externalTurns}): sessionId=${sessionId}`);
      return;
    }
    this.logger.info(`im-qqbot: turn will be pushed proactively: sessionId=${sessionId} peer=${plan.target.targetId}`);
  }

  /**
   * 事件是否属于当前回合。
   * - 没有回合状态时放行，兼容不带 turn 的旧事件；
   * - turn/end 没有回合号也算没对上，避免迟到的结束清掉新一轮。
   */
  public isCurrent(sessionId: string, type: string, turn: number | undefined): boolean {
    const tracked = this.turns.get(sessionId);
    if (tracked === undefined) return true;
    if (type === 'turn/end') return turn === tracked.state.turn;
    return turn === undefined || turn === tracked.state.turn;
  }

  /** turn/end：结束回合并释放本回合认领的入站登记 */
  public end(sessionId: string): void {
    const tracked = this.turns.get(sessionId);
    if (tracked === undefined) return;
    this.turns.delete(sessionId);
    this.release(tracked);
  }

  /**
   * 本回合怎么发。
   * - 不是 QQ 会话 → undefined；
   * - 无回合状态或被动回合 → 沿用会话的 replyTarget（含 msgId）；
   * - 主动回合 → 只保留地址并打 forceProactive；external 回合按策略可能不投递。
   */
  public planFor(sessionId: string): DeliveryPlan | undefined {
    const base = this.addressOf(sessionId);
    if (base === undefined) return undefined;
    const tracked = this.turns.get(sessionId);
    if (tracked === undefined || deliveryMode(tracked.state) === 'passive') {
      return { target: base, proactive: false };
    }
    if (tracked.state.origin === 'external' && !this.allowsExternal(base)) return undefined;
    return {
      target: { scope: base.scope, targetId: base.targetId, forceProactive: true },
      proactive: true,
    };
  }

  public targetFor(sessionId: string): ReplyTarget | undefined {
    return this.planFor(sessionId)?.target;
  }

  /** 当前跟踪中的回合数（可观测性/测试用） */
  public get activeTurns(): number {
    return this.turns.size;
  }

  private allowsExternal(target: ReplyTarget): boolean {
    const policy = this.options.externalTurns;
    if (policy === 'all') return true;
    if (policy === 'c2c') return target.scope === 'c2c';
    return false;
  }

  private addressOf(sessionId: string): ReplyTarget | undefined {
    const record = this.manager.findBySessionId(sessionId);
    if (record !== undefined) return record.replyTarget;
    return this.manager.deliveryAddress?.(sessionId);
  }

  private release(tracked: TrackedTurn): void {
    for (const id of tracked.inputs) this.inputs.release(id);
  }
}

function readUserMessage(data: Record<string, unknown>): { messageId: string | undefined; source: TurnInputSource | undefined } {
  const raw = data as UserMessageData;
  const id = raw.id ?? raw.message?.id;
  return {
    messageId: typeof id === 'string' && id !== '' ? id : undefined,
    source: raw.source ?? raw.message?.source,
  };
}

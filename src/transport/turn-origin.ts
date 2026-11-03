/**
 * 回合来源。对齐 dsh-im 的 turn 归属：一条 user/message 只说明它自己。
 *
 * - qq：本插件入站的 user 消息。回复沿用被动窗口。
 * - external：读者在别的界面输入。kind 仍是 user，但消息 id 不是本插件登记的。
 * - internal：宿主自己发起的一条消息，例如 schedule、已回答的提问、notice，
 *   或每轮注入的上下文。它不锁定回合。整轮都没有读者输入时，才按服务回合主动推到 QQ。
 *
 * 已知边界：一个 external 回合中途插入 QQ 入站时会改判为被动，但本回合已创建的
 * 出站缓冲仍按创建时的主动目标发送（目标在缓冲创建时拍下，回合内不改）。
 */

export type MessageOrigin = 'qq' | 'external' | 'internal';
export type DeliveryMode = 'passive' | 'proactive';

export interface TurnInputSource {
  kind?: string;
  form?: string;
}

/** 宿主自己发起的回合，不是读者在某个界面打的字。 */
const INTERNAL_KINDS = new Set(['schedule', 'user-question-reply']);

export interface TurnDeliveryState {
  turn: number;
  /** null：还没有读者输入。qq 压过 external。 */
  origin: 'qq' | 'external' | null;
  sawInternal: boolean;
}

export function createTurnState(turn: number): TurnDeliveryState {
  return { turn, origin: null, sawInternal: false };
}

/**
 * 按这一条消息自己的 source 归类。
 * `qqOwned` 只在这条消息的 id 是本插件入站登记过的时候为真。
 */
export function classifyTurnInput(source: TurnInputSource | undefined, qqOwned: boolean): MessageOrigin {
  if (source?.form === 'notice') return 'internal';
  if (source?.kind !== undefined && INTERNAL_KINDS.has(source.kind)) return 'internal';
  if (source?.kind !== 'user') return 'internal';
  return qqOwned ? 'qq' : 'external';
}

/** 把一条消息记进当前回合。internal 不抢归属；qq 可以改判已经记成 external 的回合。 */
export function noteTurnInput(state: TurnDeliveryState, origin: MessageOrigin): void {
  if (origin === 'qq') {
    state.origin = 'qq';
    return;
  }
  if (origin === 'external') {
    if (state.origin !== 'qq') state.origin = 'external';
    return;
  }
  state.sawInternal = true;
}

/**
 * 本回合怎么发到 QQ。
 * 尚无任何输入时保持被动：这是 QQ 入站回合在第一条 user/message 之前的既有路径。
 */
export function deliveryMode(state: TurnDeliveryState): DeliveryMode {
  if (state.origin === 'qq') return 'passive';
  if (state.origin === 'external') return 'proactive';
  if (state.sawInternal) return 'proactive';
  return 'passive';
}

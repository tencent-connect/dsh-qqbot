/**
 * 会话管理层类型定义
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, ReplyTarget } from '../types.ts';

/** AgentSetup hook 类型 */
export type AgentSetup = (agentCtx: Context) => Promise<void> | void;

/** dsh SessionEvent 简化类型（用于统计 token 用量 / 导出） */
export interface SessionEventLike {
  type: string;
  seq?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  message?: {
    content?: Array<{ type: string; text?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** dsh Agent 简化接口 */
export interface DshAgent {
  readonly id: string;
  readonly ctx: Context;
  /** 当前生命周期状态（用于判断是否正在生成） */
  readonly status: 'idle' | 'running';
  /** 底层 session（fork 时作为 source，events 用于统计/导出） */
  readonly session: {
    readonly id: string;
    readonly events?: readonly SessionEventLike[];
  };
  cancel(cause: { kind: string }): void;
  followup(message: unknown): void;
  /** 注入模型上下文：不唤起新回合，运行中的回合在下一 step 边界认领 */
  inject(message: unknown): void;
  whenIdle(): Promise<void>;
  /** 运行一个非 turn 维护任务（compact 等需要 idle 时串行执行的操作） */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}

/** compactNow 返回结果的精简视图（只取展示所需字段） */
export interface CompactionResultLike {
  shadowedSeqs: readonly number[];
  shadowedTokenCount: number;
}

/** ctx.compaction 服务的最小接口（compactNow 依赖，可选注入） */
export interface CompactionServiceLike {
  compactNow(
    agent: unknown,
    signal: AbortSignal,
    sourceCommandId?: string,
  ): Promise<CompactionResultLike | null>;
}

/** compact 操作结果 */
export interface CompactOutcome {
  ok: boolean;
  reason?: 'no-session' | 'busy' | 'unavailable' | 'failed';
  shadowed?: number;
  tokens?: number;
  message?: string;
}

/** preset 切换结果 */
export interface PresetSwitchOutcome {
  ok: boolean;
  reason?: 'unavailable' | 'unknown-preset' | 'broken' | 'failed';
  presetId?: string;
  message?: string;
}

export interface DshAgentHandle {
  agent: DshAgent;
  dispose(): Promise<void>;
}

/** sessions 服务（fork 能力） */
export interface SessionsService {
  fork(source: unknown, boundary?: number): { events: readonly unknown[] };
}

export interface DshAgentRegistry {
  /** 获取进程内已存活的 agent */
  get(sessionId: string): DshAgent | undefined;
  /** 从持久化存储恢复 session */
  resume(options: {
    resumeSessionId: string;
    agentOptions?: { provider?: string; model?: string };
    setup?: AgentSetup;
  }): Promise<DshAgentHandle>;
  /** 创建全新 session */
  create(options: {
    sessionId: string;
    meta?: { cwd?: string; parentSession?: string; seedLength?: number; agentPreset?: string };
    seed?: readonly unknown[];
    agentOptions?: { provider?: string; model?: string };
    setup?: AgentSetup;
  }): Promise<DshAgentHandle>;
}

/** agent-presets 服务接口（可选，部署中可能没有） */
export interface AgentPresetsLike {
  readonly defaultId: string;
  resolve(id?: string): Promise<{ id: string; broken?: string }>;
  mount(agentCtx: Context, id?: string): Promise<unknown>;
  /** 列出所有可用 preset */
  list(): Promise<Array<{ id: string; name?: string; description?: string; broken?: string }>>;
  /** 从 agent 的 preset scope 解析隔离服务（如 compaction），未挂载返回 undefined */
  serviceFor(agent: { ctx: Context }, name: string): unknown | undefined;
}

/** 可用 preset 条目（/preset 命令展示用） */
export interface PresetEntry {
  id: string;
  name?: string;
  description?: string;
}

/** preset 组合结果 */
export interface PresetComposition {
  agentPreset?: string;
  setup?: AgentSetup;
}

/** 单个会话记录 */
export interface SessionRecord {
  sessionKey: string;
  sessionId: string;
  agent: DshAgent;
  handle: DshAgentHandle;
  replyTarget: ReplyTarget;
  scope: ChatScope;
  peerId: string;
  senderId: string;
  lastActivity: number;
  agentPreset?: string;
  /** 已 followup 但尚未消费 user/message 事件的 QQ 入站回合数（镜像去重用） */
  qqPendingTurns?: number;
}

/** 会话状态信息（/status 用） */
export interface SessionStatus {
  active: boolean;
  sessionId?: string;
  provider?: string;
  model?: string;
  preset?: string;
  lastActivity?: number;
  messageCount?: number;
}

/** token 用量统计（/cost 用） */
export interface TokenUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

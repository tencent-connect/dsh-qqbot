/**
 * 会话管理层类型定义
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, ReplyTarget } from '../types.ts';
import type { ModelRoute } from '../model/types.ts';

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
  /** 宿主记录的当前选择；较早宿主可能不提供。 */
  readonly model?: {
    current(): Readonly<ModelRoute> | undefined;
    select?(route: Readonly<ModelRoute>): void;
  };
  readonly inbox?: { readonly nextTurn: readonly unknown[]; readonly nextStep: readonly unknown[] };
  /** 底层 session（snapshotEvents 用于统计/导出） */
  readonly session: {
    readonly id: string;
    readonly header?: { readonly cwd?: string };
    snapshotEvents(): readonly SessionEventLike[];
  };
  cancel(cause: { kind: string }, options?: { keepInbox?: boolean }): void;
  followup(message: unknown): void;
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
export type PresetSwitchOutcome =
  | { ok: true; presetId?: string; sessionId?: string }
  | { ok: false; reason: 'unavailable' | 'unknown-preset' | 'broken' | 'failed'; message?: string };

export interface DshAgentHandle {
  agent: DshAgent;
  dispose(): Promise<void>;
}

export interface DshAgentRegistry {
  /** 获取进程内已存活的 agent */
  get(sessionId: string): DshAgent | undefined;
  /** 从持久化存储恢复 session */
  resume(options: {
    resumeSessionId: string;
    agentOptions?: Partial<ModelRoute>;
    setup?: AgentSetup;
  }): Promise<DshAgentHandle>;
  /** 创建全新 session */
  create(options: {
    sessionId: string;
    meta?: { cwd?: string; agentPreset?: string };
    agentOptions?: Partial<ModelRoute>;
    setup?: AgentSetup;
  }): Promise<DshAgentHandle>;
}

/** agent-presets 服务接口（可选，部署中可能没有） */
export interface AgentPresetsLike {
  readonly defaultId: string;
  resolve(id?: string): Promise<{ id: string; broken?: string }>;
  mount(agentCtx: Context, id?: string): Promise<unknown>;
  presetForSession?(session: DshAgent['session']): string | null;
  /** 列出所有可用 preset */
  list(): Promise<Array<{ id: string; name?: string; description?: string; broken?: string }>>;
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
  /** 本 record 建立或切换时采用的路由，供旧宿主回显。 */
  modelRoute?: ModelRoute;
}

/** 会话状态信息（/status 用） */
export interface SessionStatus {
  active: boolean;
  sessionId?: string;
  provider?: string;
  model?: string;
  preset?: string;
  /** 新会话采用的预设，可与当前 Session 已选择的组合不同。 */
  nextPreset?: string;
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

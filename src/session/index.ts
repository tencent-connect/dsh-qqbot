/**
 * 会话管理层
 *
 * 管理 QQ peer → dsh Agent 的映射和生命周期。
 */
export { SessionManager } from './session-manager.js';
export { IdleEvictor } from './idle-evictor.js';
export type {
  AgentSetup,
  SessionEventLike,
  DshAgent,
  DshAgentHandle,
  SessionsService,
  DshAgentRegistry,
  AgentPresetsLike,
  PresetComposition,
  PresetEntry,
  PresetSwitchOutcome,
  SessionRecord,
  SessionStatus,
  TokenUsageStats,
} from './types.js';

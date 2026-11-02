/**
 * 模型路由层类型定义
 */
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';

/** 模型路由 */
export interface ModelRoute {
  provider: string;
  model: string;
  /** 未指定时使用目标模型自己的默认推理等级。 */
  reasoningEffort?: ReasoningEffortId;
}

/** 模型信息条目 */
export interface ModelEntry {
  provider: string;
  id: string;
  name?: string;
}

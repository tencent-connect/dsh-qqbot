/**
 * 模型路由层类型定义
 */

/** 模型路由 */
export interface ModelRoute {
  provider: string;
  model: string;
}

/** 模型信息条目 */
export interface ModelEntry {
  provider: string;
  id: string;
  name?: string;
  /** 适配器公布的思考深度元数据（未公布则为 undefined） */
  reasoning?: ModelReasoning;
}

/** 适配器公布的一个思考深度档位 */
export interface ReasoningEffortEntry {
  /** 稳定 id，作为请求参数回传 */
  id: string;
  /** 展示名（缺省用 id） */
  name?: string;
  /** 补充说明 */
  description?: string;
}

/** 某个精确 provider/model 的思考深度元数据 */
export interface ModelReasoning {
  /** 由弱到强的可选档位 */
  efforts: ReasoningEffortEntry[];
  /** 省略 effort 时适配器采用的默认档位 */
  defaultEffort?: string;
}

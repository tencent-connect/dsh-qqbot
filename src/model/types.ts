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
}

/**
 * 会话权限偏好：宿主两个权限 knob 的组合
 * （对齐 dsh-sandbox-policy 的 sandbox/mode 与 dsh-user-approval 的 approval/policy）
 */
export interface PermissionPrefs {
  /** 沙箱模式：read-only | workspace-write | danger-full-access */
  sandbox: string;
  /** 审批策略：ask | never */
  approval: string;
}

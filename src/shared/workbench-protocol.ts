import type { AccessControlConfig } from '../config.ts';
import type { BindStateWire } from './bind-protocol.ts';

export const WORKBENCH_ROBOTS_PATH = '/api/qqbot/workbench/robots';
export const WORKBENCH_ROBOT_BIND_PATH = '/api/qqbot/workbench/robots/bind';
export const WORKBENCH_GROUP_GUIDE_IMAGES = {
  'message-scope.png': '/api/qqbot/workbench/group-permissions/message-scope.png',
  'proactive.png': '/api/qqbot/workbench/group-permissions/proactive.png',
} as const;

export type WorkbenchRobotBinding = Exclude<BindStateWire, { phase: 'bound' }> | { phase: 'bound'; robot: WorkbenchRobot };

export type WorkbenchRobotState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'disabled';

export interface WorkbenchRobot {
  readonly appId: string;
  readonly state: WorkbenchRobotState;
  readonly primary: boolean;
  readonly enabled: boolean;
  readonly alias: string;
  readonly revision: number;
  readonly access: AccessControlConfig;
}

export interface WorkbenchRobotsResponse {
  readonly robots: readonly WorkbenchRobot[];
}

export interface WorkbenchRobotPatch {
  appId: string;
  /** null creates an additional account. A revision updates an existing account. */
  revision: number | null;
  enabled?: boolean;
  alias?: string;
  appSecret?: string;
  access?: Partial<AccessControlConfig>;
}

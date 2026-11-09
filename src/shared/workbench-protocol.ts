export const WORKBENCH_ROBOTS_PATH = '/api/qqbot/workbench/robots';

export interface WorkbenchRobot {
  readonly appId: string;
  readonly state: 'connecting' | 'connected' | 'reconnecting' | 'failed';
}

export interface WorkbenchRobotsResponse {
  readonly robots: readonly WorkbenchRobot[];
}

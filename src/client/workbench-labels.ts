import { t, locale } from './qq-locale.ts';
import type { WorkbenchConversation, WorkbenchSession } from '../shared/workbench-conversation-protocol.ts';
import type { WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { robotStateLabel } from './robot-accounts.ts';


export function peerName(peer: WorkbenchConversation): string {
  return peer.alias || peer.name || `${peer.scope === 'group' ? t("群聊") : t("私聊")} ${peer.openId.slice(-8)}`;
}

export function sessionDate(session: WorkbenchSession): string {
  const time = new Date(session.createdAt);
  return Number.isFinite(time.valueOf()) ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(time) : '';
}

export function workspaceName(cwd: string | undefined): string {
  return cwd?.split(/[\\/]/).filter(Boolean).at(-1) || cwd || '';
}

export function receivingLabel(robot: WorkbenchRobot, peer: WorkbenchConversation, archived = false): string {
  if (!robot.enabled) return t("机器人已停用");
  if (!peer.admitted) return t("未获准接入");
  if (peer.executionBlocked) return t("工具策略不可用");
  if (!peer.receiving) return t("已暂停接收");
  if (robot.state !== 'connected') return robotStateLabel(robot.state);
  if (archived) return t("当前 Session 已归档");
  return peer.currentSessionId ? t("当前接收") : t("等待首个 Session");
}

export function accessLabel(robot: WorkbenchRobot, peer: WorkbenchConversation): string {
  const mode = peer.scope === 'group' ? robot.access.groupMode : robot.access.c2cMode;
  return { open: t("所有人"), allowlist: t("白名单"), disabled: t("关闭") }[mode];
}

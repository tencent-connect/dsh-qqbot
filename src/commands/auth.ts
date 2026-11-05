/** Applies after conversation admission and also guards direct command-handler calls. */
export function commandAccessError(mode: string | undefined, senderId: string | undefined, allowed: boolean): string | undefined {
  if (mode === 'disabled') return 'QQ 斜杠命令已关闭。';
  if (!senderId) return '无法确认发送者身份，不能执行斜杠命令。';
  if (mode === undefined || mode === 'open') return undefined;
  if (mode === 'allowlist' && allowed) return undefined;
  return '你不在斜杠命令白名单中，请联系机器人管理者。';
}

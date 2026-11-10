export const title = 'QQ 配对撤权后旧码重新加白';

export function state(value) {
  if (value.staleGrant) return '旧码把成员加回白名单';
  const { step, code } = value.operation;
  if (step === 'write-fence') return '等待保存撤销记录';
  if (step === 'remove-member') return '撤销记录已保存，等待移除成员';
  if (step === 'write-member' && value.revokedCodes.includes(code)) return '旧码被受理，等待写入成员';
  if (step === 'write-member' || step === 'write-result') return '等待完成认领';
  if (value.member) return '成员已加入名单';
  const hasOldCode = value.active.some(code => value.revokedCodes.includes(code));
  if (!hasOldCode) return '成员已移除，无有效旧码';
  if (value.fenced.length) return '成员已移除，旧码已封禁';
  return '成员已移除，撤销记录丢失';
}

export function step(action, _before, after) {
  if (action === 'StartClaim') {
    return after.revokedCodes.includes(after.operation.code) ? '再次提交第二枚旧码' : '提交配对码';
  }
  return {
    StartRevoke: '管理员请求撤权',
    PersistRevocationFence: '保存撤销记录',
    PersistRemoval: '移除成员',
    Restart: '服务重启',
    PersistMember: '白名单写入成功',
    IssueCode: '签发配对码',
    CloseOrExpire: '旧码结束或到期',
    PersistClaimResult: '保存认领结果',
    WriteFailed: '写入失败',
  }[action];
}

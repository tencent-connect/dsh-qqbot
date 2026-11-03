/**
 * 本轮 user 消息的正文 block 组装。正文只承载用户真实内容；元信息走 turn-meta。
 * TODO(split-2): 尚未接线，当前 inbound 直接提交正文。
 */
export interface UserBlockInput {
  /** 用户正文（已含语音转录/附件媒体行）。 */
  body: string;
}

/** 生成 user 消息的分段文本块；空正文省略。 */
export function assembleUserBlocks(input: UserBlockInput): string[] {
  return input.body ? [input.body] : [];
}

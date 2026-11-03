/**
 * 本轮 user 消息的正文 block 组装。
 * 目前正文只承载「用户真实内容（含语音转录/附件媒体行）」；引用块由 inbound 的 buildQuotePart 产出，
 * 群聊背景不再进入正文。元信息（来源/@/发送者/时间）走 turn-meta 的 runtime context。
 */
export interface UserBlockInput {
  /** 用户正文（已含语音转录/附件媒体行）。 */
  body: string;
}

/** 生成 user 消息的分段文本块；空正文省略。 */
export function assembleUserBlocks(input: UserBlockInput): string[] {
  return input.body ? [input.body] : [];
}

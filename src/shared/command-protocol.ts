/** 斜杠命令描述符（commands.list 方法的返回元素；传输见 shared/rpc-protocol.ts） */
export interface SlashCommandDescriptor { name: string; aliases: string[]; description: string; category: 'agent' | 'qqbot'; scope: 'owner' | 'all' | 'disabled'; hidden?: boolean }

/** Command catalog endpoint retained for existing QQ settings clients. */
export const COMMANDS_PATH = '/qqbot/im-qqbot/conversations';
export interface SlashCommandDescriptor { name: string; aliases: string[]; description: string; category: 'agent' | 'qqbot'; scope: 'owner' | 'all' | 'disabled'; hidden?: boolean }

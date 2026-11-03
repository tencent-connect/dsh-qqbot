import { createElement as h, type ReactNode } from 'react';
import type { SlashCommandDescriptor } from '../shared/conversation-protocol.ts';

/** 全局超管面板中的命令清单，内容来自服务端注册表。 */
export function SlashCommandList({ commands }: { commands: readonly SlashCommandDescriptor[] }): ReactNode {
  const visible = commands.filter((command) => command.hidden !== true);
  return h('details', { className: 'imqc-cmdList' },
    h('summary', null, `查看支持的斜杠命令（${visible.length} 个）`),
    visible.length === 0 ? h('p', { className: 'imqc-hint' }, '暂无可用命令。') : null,
    ...(['agent', 'qqbot'] as const).map((category) => {
      const items = visible.filter((command) => command.category === category);
      if (items.length === 0) return null;
      return h('div', { className: 'imqc-cmdGroup', key: category },
        h('strong', null, category === 'agent' ? '通用能力' : 'QQ 内置'),
        ...items.map((command) => h('div', { className: 'imqc-cmdRow', key: command.name },
          h('code', null, `/${command.name}`),
          command.aliases.length ? h('span', { className: 'imqc-hint' }, `（别名 /${command.aliases.join('、/')}）`) : null,
          command.scope === 'owner' ? h('span', { className: 'imqc-hint' }, '仅超管') : null,
          h('span', { className: 'imqc-hint' }, command.description))));
    }));
}

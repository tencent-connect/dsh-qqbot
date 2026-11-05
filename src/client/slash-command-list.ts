import { createElement as h, useCallback, useState, type ReactNode } from 'react';
import { DisclosureRow, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import type { SlashCommandDescriptor } from '../shared/command-protocol.ts';

/** 命令访问面板中的命令清单，内容来自服务端注册表。 */
export function SlashCommandList({ commands }: { commands: readonly SlashCommandDescriptor[] }): ReactNode {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(value => !value), []);
  const visible = commands.filter((command) => command.hidden !== true);
  return h(DisclosureRow, { className: 'imqc-cmdList',
    icon: h(IconChevronDownOutlineRegular),
    title: `支持的斜杠命令（${visible.length} 个）`,
    open, expandable: true, expandOnRowClick: true, previewChevron: false, onToggle: toggle,
  }, h('div', { className: 'imqc-cmdContent' },
    visible.length === 0 ? h('p', { className: 'imqc-hint' }, '暂无可用命令。') : null,
    ...(['agent', 'qqbot'] as const).map((category) => {
      const items = visible.filter((command) => command.category === category);
      if (items.length === 0) return null;
      return h('div', { className: 'imqc-cmdGroup', key: category },
        h('strong', null, category === 'agent' ? '通用能力' : 'QQ 内置'),
        ...items.map((command) => h('div', { className: 'imqc-cmdRow', key: command.name },
          h('code', null, `/${command.name}`),
          command.aliases.length ? h('span', { className: 'imqc-hint' }, `（别名 /${command.aliases.join('、/')}）`) : null,
          command.scope === 'owner' ? h('span', { className: 'imqc-hint' }, '仅命令白名单') : null,
          command.scope === 'disabled' ? h('span', { className: 'imqc-hint' }, '已关闭') : null,
          h('span', { className: 'imqc-hint' }, command.description))));
    })));
}

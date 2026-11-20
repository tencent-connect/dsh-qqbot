import { createElement as h, type ReactNode } from 'react';
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';

export function SettingsGroup({ title, hint, defaultOpen, children }: {
  title: string; hint?: string; defaultOpen?: boolean; children: ReactNode;
}): ReactNode {
  return h('details', { className: 'imqw-settings-group', open: defaultOpen },
    h('summary', null, h(IconChevronDownOutlineRegular, { size: 14 }), h('strong', null, title),
      hint ? h('span', { className: 'imqw-muted' }, hint) : null),
    h('div', { className: 'imqw-settings-group-body' }, children));
}

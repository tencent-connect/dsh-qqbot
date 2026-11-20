import { t } from './qq-locale.ts';
import { createElement as h, Fragment, useId, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { Button, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { accountName, robotBindingKey, RobotAccounts, robotStateLabel, type RobotAccountsProps } from './robot-accounts.ts';
import { BindPanelBody } from './bind-page.ts';
import type { WorkbenchExtensions } from './workbench-extensions.ts';
import { useWorkbenchLayout } from './workbench-layout.ts';
import styles, { sheet } from './workbench.module.css';
import type { AgentFormSource } from './workbench-agent-form.ts';
import { WorkbenchDefaultsForm } from './workbench-defaults.ts';
import { RobotConversations } from './workbench-conversations.ts';
import type { Navigation, SessionNavigation, WorkbenchState } from './workbench-state.ts';

type RobotView = 'conversation' | 'settings' | 'add' | 'bind-primary';
export interface QQWorkbenchProps extends SessionNavigation {
  extensions: WorkbenchExtensions;
  state: WorkbenchState;
  settingsRequest?: () => void;
  configFileAction?: ReactNode;
  agentSource?: AgentFormSource;
}

export function QQWorkbench({ extensions, state, settingsRequest, configFileAction, agentSource, ...sessionNavigation }: QQWorkbenchProps): ReactNode {
  const views = useSyncExternalStore(extensions.subscribe, extensions.getViews);
  const settingsSections = useSyncExternalStore(extensions.subscribe, extensions.getSettingsSections);
  const [nav, setNav] = useState(() => ({ ...state.navigation }));
  const [robotView, setRobotView] = useState<RobotView>('conversation');
  const [robotPage, setRobotPage] = useState('account');
  const robotTabsId = useId();
  const layout = useWorkbenchLayout(nav.collapsed, robotView === 'conversation', nav.peerSettingsOpen);

  const navigate = (patch: Partial<Navigation>): void => {
    Object.assign(state.navigation, patch);
    setNav({ ...state.navigation });
  };
  const selectRobot = (appId: string): void => {
    setRobotView('conversation');
    if (nav.appId === appId) return;
    navigate({ appId, smallPage: 'list' });
  };

  return h<RobotAccountsProps>(RobotAccounts, {
    selectedAppId: nav.appId, draftStore: state.accountDrafts,
    onSelect: selectRobot,
    workbench: {
      collapsed: layout.iconsOnly,
      compact: layout.compact,
      onToggleCollapse: () => navigate({ collapsed: !nav.collapsed }),
      onAdd: () => setRobotView('add'),
      onCancelAdd: () => setRobotView('conversation'),
      settingsRequest,
      primaryBinding: robotView === 'bind-primary',
      onBindPrimary: () => setRobotView('bind-primary'),
      onOpenSettings: appId => {
        if (nav.appId !== appId) navigate({ appId });
        setRobotPage('account');
        setRobotView('settings');
      },
      render: ({ robots, unavailable, error, rail, accountSettings, cancelAdd, busy }) => {
        const robot = robots?.find(candidate => candidate.appId === nav.appId)
          ?? robots?.find(candidate => candidate.primary) ?? robots?.[0];
        const primaryUnbound = !unavailable && (robots?.length === 0 || robotView === 'bind-primary');
        const adding = robotView === 'add';
        const editing = !unavailable && robotView === 'settings' && robot !== undefined && accountSettings !== null;
        const showRobotSettings = primaryUnbound || adding || editing;
        const settingsSubtitle = editing && robot
          ? `${accountName(robot)} · ${robotStateLabel(robot.state)}`
          : primaryUnbound ? t("主机器人 · 未绑定") : t("新机器人 · 未绑定");
        const settingsBody = editing && robot ? h(Fragment, null,
          h(SegmentedControl, { id: robotTabsId, label: t("机器人设置页面"), value: robotPage,
            options: [{ value: 'account', label: t("账号与权限") }, { value: 'defaults', label: t("新会话默认设置") }],
            onChange: setRobotPage,
          }),
          h('div', { className: 'imqw-robot-tab', role: 'tabpanel', id: `${robotTabsId}-account-panel`, 'aria-labelledby': `${robotTabsId}-account`, hidden: robotPage !== 'account' },
            accountSettings),
          h('div', { className: 'imqw-robot-tab', role: 'tabpanel', id: `${robotTabsId}-defaults-panel`, 'aria-labelledby': `${robotTabsId}-defaults`, hidden: robotPage !== 'defaults' },
            h(WorkbenchDefaultsForm, { key: robotBindingKey(robot), appId: robot.appId, bindingRevision: robot.bindingRevision, source: agentSource })),
        ) : primaryUnbound ? h(BindPanelBody) : accountSettings;
        return h('div', { className: ['imqw-root', styles.root].join(' '), ref: layout.root },
          h('style', null, sheet),
          h('div', {
            className: 'imqw-layout', 'data-collapsed': layout.iconsOnly, 'data-single-page': layout.singlePage,
            style: {
              '--imqw-rail': `${layout.railWidth}px`, '--imqw-tree': `${layout.treeWidth}px`,
              '--imqw-settings': `${layout.settingsWidth}px`,
            } as CSSProperties,
          },
            h('aside', { className: 'imqw-robots', 'aria-label': t("机器人列表") }, rail),
            layout.divider('robots'),
            h('div', { className: 'imqw-content' },
              unavailable ? h('section', { className: 'imqw-empty' }, h('p', { role: 'status' }, t("请更新 DSH 以打开 QQ 工作台。已绑定机器人仍可在 QQ 收发。")))
                : robot ? h('div', {
                className: 'imqw-conversation-grid', hidden: showRobotSettings,
                'data-settings': nav.peerSettingsOpen, 'data-page': nav.smallPage,
              }, h(RobotConversations, {
                key: robot.appId, state, robot, agentSource, views, settingsSections: showRobotSettings ? [] : settingsSections, settingsOpen: nav.peerSettingsOpen,
                settingsVisible: nav.peerSettingsOpen && (!layout.singlePage || nav.smallPage === 'settings'),
                singlePage: layout.singlePage, ...sessionNavigation,
                treeDivider: layout.divider('tree'), settingsDivider: layout.divider('settings'),
                onToggleSettings: open => navigate({ peerSettingsOpen: open, smallPage: open ? 'settings' : 'conversation' }),
                onSmallPage: page => navigate({ smallPage: page }),
              })) : showRobotSettings ? null : h('section', { className: 'imqw-empty' },
                h('p', { role: error ? 'alert' : 'status' }, error || (rail ? t("机器人列表暂不可用") : t("正在读取机器人…")))),
              showRobotSettings ? h('section', { className: 'imqw-robot-settings', 'aria-label': t("机器人设置") },
                h('div', { className: 'imqw-robot-settings-inner' },
                  h('header', { className: 'imqw-column-head imqw-robot-settings-head' },
                    h('div', null, h('h2', null, t("机器人设置")),
                      h('p', { className: 'imqw-muted' }, settingsSubtitle)),
                    h('div', { className: 'imqw-actions' }, configFileAction,
                      robot ? h(Button, { size: 'sm', variant: 'outline', disabled: adding && busy,
                        onClick: adding ? cancelAdd : () => setRobotView('conversation'),
                      }, t("返回会话")) : null)),
                  settingsBody,
                ),
              ) : null,
            ),
          ),
        );
      },
    },
  });
}

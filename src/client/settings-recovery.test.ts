import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIND_CONFIG_PATH } from '../shared/bind-protocol.ts';
import { WORKBENCH_ROBOTS_PATH, type WorkbenchRobot } from '../shared/workbench-protocol.ts';
import { PAIR_ISSUE_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH, type PairChallenge } from '../shared/pairing-protocol.ts';
import { WORKBENCH_DEFAULTS_PATH, type WorkbenchAgentSettings } from '../shared/workbench-agent-settings.ts';
import type { ConfigWire } from './config-form-state.ts';
import { AccessSettings, PrimaryAccountSettings } from './config-panel.ts';
import { PairClaimPanel } from './qq-pairing.ts';
import { WorkbenchDefaultsForm } from './workbench-defaults.ts';
import { RobotAccounts, type RobotAccountsProps } from './robot-accounts.ts';

type Dependencies = readonly unknown[];
type Effect = () => void | (() => void);
type Update = (value: unknown) => unknown;
interface Hooks {
  useState(initial: unknown): [unknown, (update: unknown) => void];
  useRef(initial: unknown): { current: unknown };
  useCallback(callback: unknown, deps: Dependencies): unknown;
  useEffect(effect: Effect, deps: Dependencies): void;
}

const active = vi.hoisted(() => ({ hooks: undefined as Hooks | undefined }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'fixture-form',
  useState: (initial: unknown) => active.hooks!.useState(initial),
  useRef: (initial: unknown) => active.hooks!.useRef(initial),
  useCallback: (callback: unknown, deps: Dependencies) => active.hooks!.useCallback(callback, deps),
  useEffect: (effect: Effect, deps: Dependencies) => active.hooks!.useEffect(effect, deps),
}));
vi.mock('./qq-pairing-styles.ts', () => ({ usePairingStyles() {} }));

// Exercise the real component handlers and effects with mocked HTTP in the Node test suite.
function mount(component: () => ReactNode) {
  const state = new Map<number, unknown>();
  const refs = new Map<number, { current: unknown }>();
  const callbacks = new Map<number, { deps: Dependencies; callback: unknown }>();
  const effects = new Map<number, { deps: Dependencies; cleanup?: () => void }>();
  const queue: (() => void)[] = [];
  let index = 0;
  const sameDeps = (previous: Dependencies | undefined, current: Dependencies): boolean =>
    previous?.length === current.length && current.every((value, position) => Object.is(previous[position], value));
  const hooks: Hooks = {
    useState(initial) {
      const slot = index++;
      if (!state.has(slot)) state.set(slot, typeof initial === 'function' ? initial() : initial);
      return [state.get(slot), (update) => {
        state.set(slot, typeof update === 'function' ? (update as Update)(state.get(slot)) : update);
      }];
    },
    useRef(initial) {
      const slot = index++;
      const ref = refs.get(slot) ?? { current: initial };
      refs.set(slot, ref);
      return ref;
    },
    useCallback(callback, deps) {
      const slot = index++;
      const previous = callbacks.get(slot);
      if (previous && sameDeps(previous.deps, deps)) return previous.callback;
      callbacks.set(slot, { deps, callback });
      return callback;
    },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = effects.get(slot);
      if (sameDeps(previous?.deps, deps)) return;
      queue.push(() => {
        previous?.cleanup?.();
        const cleanup = effect();
        effects.set(slot, { deps, cleanup: cleanup || undefined });
      });
    },
  };
  return () => {
    index = 0;
    active.hooks = hooks;
    try {
      const tree = component();
      for (const commit of queue.splice(0)) commit();
      return tree;
    } finally {
      active.hooks = undefined;
    }
  };
}

interface TestProps {
  children?: ReactNode;
  footer?: ReactNode;
  disabled?: boolean;
  label?: string;
  value?: string;
  onClick?: () => void;
  placeholder?: string;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  onSubmit?: (event: { preventDefault(): void }) => void;
  access?: Pick<NonNullable<ConfigWire['access']>, 'groupMode' | 'c2cMode' | 'commandMode'>;
  onMode?: NonNullable<Parameters<typeof AccessSettings>[0]>['onMode'];
  settings?: WorkbenchAgentSettings;
  'aria-label'?: string;
}

function find(tree: ReactNode, predicate: (props: TestProps) => boolean): ReactElement<TestProps> | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const match = find(child, predicate);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement<TestProps>(tree)) return undefined;
  if (predicate(tree.props)) return tree;
  return find(tree.props.children, predicate) ?? find(tree.props.footer, predicate);
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('QQ settings recovery', () => {
  it('submits the name and access changes from one form and retries only the unsaved fields', async () => {
    vi.useFakeTimers();
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    let rejectAccess = true;
    let robot = { appId: 'test-primary', primary: true, alias: '', revision: 1, enabled: true };
    let config: ConfigWire = {
      appId: robot.appId, accessRevision: 'access-one',
      access: { c2cMode: 'open', groupMode: 'open', commandMode: 'open', c2cAllow: [], groupAllow: [] },
    };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        return Response.json(path === WORKBENCH_ROBOTS_PATH ? { robots: [robot] } : { config });
      }
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path === WORKBENCH_ROBOTS_PATH) {
        robot = { ...robot, alias: body.alias, revision: 2 };
        return Response.json({ robot });
      }
      if (rejectAccess) return Response.json({ error: 'test conflict' }, { status: 409 });
      config = { ...config, access: body.access, accessRevision: 'access-two' };
      return Response.json({ ok: true });
    }));
    const render = mount(() => PrimaryAccountSettings({
      appId: robot.appId, revision: 1, enabled: true, formId: 'qq-account', controls: null, credentials: null, onAliasSaved: vi.fn(),
    }));
    render();
    await vi.advanceTimersByTimeAsync(0);
    const input = { value: '我的机器人' };
    find(render(), props => props.placeholder === '可选，便于区分机器人')!.props.onChange!({ target: input, currentTarget: input });
    find(render(), props => props.onMode !== undefined)!.props.onMode!('groupMode', 'allowlist');
    const save = () => find(render(), props => !!props.onSubmit)!.props.onSubmit!({ preventDefault() {} });
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map(write => write.path)).toEqual([WORKBENCH_ROBOTS_PATH, BIND_CONFIG_PATH]);
    expect(find(render(), props => typeof props.children === 'string' && props.children.startsWith('机器人名称已保存。'))).toBeDefined();

    rejectAccess = false;
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes.map(write => write.path)).toEqual([WORKBENCH_ROBOTS_PATH, BIND_CONFIG_PATH, BIND_CONFIG_PATH]);
    expect(writes[2]?.body).toMatchObject({ expectedAppId: robot.appId, accessRevision: 'access-one', access: { groupMode: 'allowlist' } });
    expect(find(render(), props => props.children === '保存')?.props.disabled).toBe(true);
  });

  it('saves with the refreshed access revision while keeping an unsaved mode edit', async () => {
    vi.useFakeTimers();
    const writes: ConfigWire[] = [];
    let config: ConfigWire = {
      appId: 'bot', accessRevision: 'initial',
      access: { c2cMode: 'allowlist', c2cAllow: ['kept', 'revoked'], groupMode: 'open', groupAllow: [], commandMode: 'open' },
    };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      if (path === WORKBENCH_ROBOTS_PATH) return Response.json({ robots: [{ appId: 'bot', alias: '', revision: 1, primary: true }] });
      expect(path).toBe(BIND_CONFIG_PATH);
      if (init.method !== 'POST') return Response.json({ config });
      const patch = JSON.parse(String(init.body)) as ConfigWire;
      writes.push(patch);
      if (patch.accessRevision !== config.accessRevision) return Response.json({ error: 'conflict' }, { status: 409 });
      config = { ...config, ...patch, accessRevision: `revision-${writes.length}` };
      if (writes.length === 1 && config.access) {
        // Another tab removes a member after the save and before the first readback.
        config = { ...config, accessRevision: 'after-revoke', access: { ...config.access, c2cAllow: ['kept'] } };
      }
      return Response.json({ ok: true });
    }));

    const render = mount(() => PrimaryAccountSettings({
      appId: 'bot', revision: 1, enabled: true, formId: 'qq-account', controls: null, credentials: null, onAliasSaved: vi.fn(),
    }));
    const accessSettings = () => find(render(), props => props.onMode !== undefined)!.props;
    const save = () => find(render(), props => !!props.onSubmit)!.props.onSubmit!({ preventDefault() {} });
    const refresh = () => find(render(), props => props.children === '刷新配置' && !!props.onClick)!.props.onClick!();
    render();
    await vi.advanceTimersByTimeAsync(0);

    accessSettings().onMode!('commandMode', 'disabled');
    save();
    await vi.advanceTimersByTimeAsync(3000);
    accessSettings().onMode!('groupMode', 'disabled');
    refresh();
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(accessSettings().access?.groupMode).toBe('disabled');

    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[1]).toMatchObject({
      accessRevision: 'after-revoke',
      access: { c2cAllow: ['kept'], groupMode: 'disabled', commandMode: 'disabled' },
    });
  });

  it('keeps a valid code usable through a missing route and stops on a confirmed end', async () => {
    vi.useFakeTimers();
    let unavailable = false;
    const challenges: PairChallenge[] = [];
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      if (path === PAIR_ISSUE_PATH) {
        const challenge: PairChallenge = {
          code: 'ABCDEF', purpose: 'allow-c2c', createdAt: Date.now(), expiresAt: Date.now() + 600_000, claims: [],
        };
        challenges.push(challenge);
        return Response.json({ ...challenge, previousClaims: [] });
      }
      expect(path).toBe(PAIR_STATUS_PATH);
      if (unavailable) return Response.json({ error: 'not found' }, { status: 404 });
      return Response.json({ challenges, owners: [], allowC2c: [], allowGroup: [] });
    }));

    const render = mount(() => PairClaimPanel({ purpose: 'allow-c2c', title: '私聊白名单' }));
    const button = (text: string) => find(render(), props => props.children === text && !!props.onClick)!.props;
    render();
    await vi.advanceTimersByTimeAsync(0);
    button('添加').onClick!();
    await vi.advanceTimersByTimeAsync(0);
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(button('复制配对码').disabled).toBe(false);

    unavailable = true;
    await vi.advanceTimersByTimeAsync(2000);
    render();
    unavailable = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(button('复制配对码').disabled).toBe(false);

    challenges.length = 0;
    await vi.advanceTimersByTimeAsync(2000);
    render();
    expect(button('复制配对码').disabled).toBe(true);
  });

  it.each([
    { purpose: 'allow-c2c', list: 'allowC2c', title: '私聊白名单' },
    { purpose: 'allow-group', list: 'allowGroup', title: '群白名单' },
    { purpose: 'owner', list: 'owners', title: '命令白名单' },
  ] as const)('renders the confirmed $title removal while the status read is unavailable', async ({ purpose, list, title }) => {
    vi.useFakeTimers();
    const empty = { challenges: [], owners: [], allowGroup: [], allowC2c: [] };
    const member = { openid: 'fixture-member', nickname: '待移除成员', scene: 'c2c', createdAt: 1 };
    let removed = false;
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path.startsWith(PAIR_REVOKE_PATH)) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ purpose, openid: member.openid });
        removed = true;
        return Response.json({ ...empty, ok: true, message: '已从白名单移除' });
      }
      expect(path).toBe(PAIR_STATUS_PATH);
      if (removed) return Response.json({ error: '插件正在重载' }, { status: 503 });
      return Response.json({ ...empty, [list]: [member] });
    }));
    const render = mount(() => PairClaimPanel({ purpose, title }));
    render();
    await vi.advanceTimersByTimeAsync(0);
    find(render(), props => props.children === '移除')!.props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    const result = render();
    expect(find(result, props => props.children === `已从${title}移除。`)).toBeDefined();
    expect(find(result, props => props.children === '待移除成员')).toBeUndefined();
  });

  it('merges a default draft onto the latest revision and keeps an explicit empty tool list', async () => {
    vi.useFakeTimers();
    const settings: WorkbenchAgentSettings = {
      model: null, reasoningEffort: '', preset: '', cwd: '', permission: 'read-only',
      groupPrompt: '', directPrompt: '', streaming: true, showToolResults: false,
    };
    let persisted = { revision: 1, settings };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method !== 'POST') {
        expect(path).toBe(`${WORKBENCH_DEFAULTS_PATH}?appId=robot`);
        return Response.json(persisted);
      }
      expect(path).toBe(WORKBENCH_DEFAULTS_PATH);
      const next = JSON.parse(String(init.body)) as typeof persisted;
      if (next.revision !== persisted.revision) return Response.json({ error: '已更新' }, { status: 409 });
      persisted = { revision: next.revision + 1, settings: next.settings };
      return Response.json(persisted);
    }));
    const render = mount(() => WorkbenchDefaultsForm({ appId: 'robot' }));
    const fields = () => find(render(), props => !!props.settings)!.props;
    const edit = (patch: Partial<WorkbenchAgentSettings>) =>
      (fields() as { onChange: (next: Partial<WorkbenchAgentSettings>) => void }).onChange(patch);
    const save = () => find(render(), props => !!props.onSubmit)!.props.onSubmit!({ preventDefault() {} });
    render();
    await vi.advanceTimersByTimeAsync(0);
    edit({ tools: [], streaming: false });
    persisted = { revision: 2, settings: { ...settings, directPrompt: '另一标签页的文字' } };
    save();
    await vi.advanceTimersByTimeAsync(0);
    const merge = find(render(), props => props.children === '合并草稿' && !!props.onClick);
    expect(merge).toBeDefined();
    merge!.props.onClick!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fields().settings).toMatchObject({ tools: [], streaming: false, directPrompt: '另一标签页的文字' });
    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(persisted.revision).toBe(3);
    expect(persisted.settings).toMatchObject({ tools: [], streaming: false, directPrompt: '另一标签页的文字' });
  });

  it('keeps each additional robot’s own name draft when changing accounts', async () => {
    vi.useFakeTimers();
    const robots: WorkbenchRobot[] = ['alpha', 'beta'].map((appId, index) => ({
      appId, alias: appId, revision: index + 1, bindingRevision: index + 1,
      state: 'connected', primary: false, enabled: true, access: {
        c2cMode: 'open', groupMode: 'open', commandMode: 'open', c2cAllow: [], groupAllow: [],
      },
    }));
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      expect(path).toBe(WORKBENCH_ROBOTS_PATH);
      return Response.json({ robots });
    }));
    const workbench: RobotAccountsProps['workbench'] = {
      collapsed: false, compact: false, onAdd() {}, onCancelAdd() {}, onOpenSettings() {}, onToggleCollapse() {},
      render: ({ rail, accountSettings }) => [rail, accountSettings],
    };
    const draftStore: RobotAccountsProps['draftStore'] = new Map();
    const render = mount(() => RobotAccounts({ draftStore, onSelect() {}, workbench }));
    render();
    await vi.advanceTimersByTimeAsync(0);
    const open = (name: string) => find(render(), props => props['aria-label'] === `设置${name}`)!.props.onClick!();
    const field = () => find(render(), props => props.placeholder === '可选，便于区分机器人')!.props;
    const edit = (value: string) => field().onChange!({ target: { value }, currentTarget: { value } });
    open('alpha');
    edit('草稿甲');
    open('beta');
    expect(field().value).toBe('beta');
    edit('草稿乙');
    open('alpha');
    expect(field().value).toBe('草稿甲');
    open('beta');
    expect(field().value).toBe('草稿乙');
  });
});

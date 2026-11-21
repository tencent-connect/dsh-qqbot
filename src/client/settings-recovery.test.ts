import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_METHODS, CONFIG_METHODS, ACCOUNT_RPC_ENDPOINT, CONFIG_RPC_ENDPOINT, RPC_ERROR_CODES } from '../shared/rpc-protocol.ts';
import type { PairChallenge } from '../shared/pairing-protocol.ts';
import type { ConfigWire } from './config-form-state.ts';
import { ConfigPanel } from './config-panel.ts';
import { PairClaimPanel } from './qq-pairing.ts';
import { RpcError } from './rpc.ts';
import { QQBotView } from './views.ts';
import type { BindSnapshot } from './store.ts';

type Dependencies = readonly unknown[];
type Effect = () => void | (() => void);
type Update = (value: unknown) => unknown;
interface Hooks {
  useState(initial: unknown): [unknown, (update: unknown) => void];
  useRef(initial: unknown): { current: unknown };
  useCallback(callback: unknown, deps: Dependencies): unknown;
  useEffect(effect: Effect, deps: Dependencies): void;
}

const active = vi.hoisted(() => ({
  hooks: undefined as Hooks | undefined,
  bind: { state: null, gone: false, error: null } as BindSnapshot,
}));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => active.hooks!.useState(initial),
  useRef: (initial: unknown) => active.hooks!.useRef(initial),
  useCallback: (callback: unknown, deps: Dependencies) => active.hooks!.useCallback(callback, deps),
  useEffect: (effect: Effect, deps: Dependencies) => active.hooks!.useEffect(effect, deps),
  useSyncExternalStore: () => active.bind,
}));
vi.mock('./styles.ts', () => ({
  usePairingStyles() {},
  useConfigPanelStyles() {},
  useBindPanelStyles() {},
  installBindPanelStyles: () => () => {},
}));

// RPC 替身：按 (endpoint, method) 分发，取代旧的 global fetch 桩
const rpcBus = vi.hoisted(() => ({
  dispatch: null as null | ((endpoint: string, method: string, payload: Record<string, unknown>) => Promise<unknown>),
}));
vi.mock('./rpc.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./rpc.ts')>();
  return {
    ...actual,
    rpcCall: vi.fn(async (endpoint: string, method: string, payload: Record<string, unknown>) => {
      if (rpcBus.dispatch === null) throw new RpcError('transport/network', 'network');
      return rpcBus.dispatch(endpoint, method, payload);
    }),
  };
});

// Exercise the real component handlers and effects with a mocked RPC channel in the Node test suite.
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
      if (!state.has(slot)) state.set(slot, initial);
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
  id?: string;
  disabled?: boolean;
  label?: string;
  value?: string;
  onClick?: () => void;
  onChange?: (value: string) => void;
  onSubmit?: (event: { preventDefault(): void }) => void;
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
  rpcBus.dispatch = null;
});

describe('QQ settings recovery', () => {
  it('gives configuration and its nested lists a new identity on bound account changes', () => {
    const panel = (appId: string) => {
      active.bind = { state: { phase: 'bound', appId }, gone: false, error: null };
      const view = QQBotView() as ReactElement<{ children: ReactElement[] }>;
      return view.props.children[1]!;
    };
    const first = panel('account-a');
    const second = panel('account-b');
    expect(first.key).not.toBeNull();
    expect(second.key).not.toBe(first.key);
    expect(first.props).toMatchObject({ appId: 'account-a', bindPhase: 'bound' });
    expect(second.props).toMatchObject({ appId: 'account-b', bindPhase: 'bound' });
    expect(panel('account-b').key).toBe(second.key);
  });

  it.each(['starting', 'waiting', 'saving'])('waits silently when config binds before the %s snapshot converges', async bindPhase => {
    vi.useFakeTimers();
    let account: string | null = null;
    rpcBus.dispatch = async (_endpoint, method) => method === CONFIG_METHODS.commands
      ? { commands: [] }
      : { config: { appId: 'account-a', model: 'model-a' } };
    const render = mount(() => ConfigPanel({ bindPhase: account === null ? bindPhase : 'bound', appId: account }));
    render();
    await vi.advanceTimersByTimeAsync(0);
    const pending = render();
    expect(find(pending, props => !!props.onSubmit)).toBeUndefined();
    expect(find(pending, props => typeof props.children === 'string' && props.children.includes('配置加载失败'))).toBeUndefined();
    expect(find(pending, props => props.children === '正在加载配置…')).toBeDefined();
    account = 'account-a';
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(find(render(), props => !!props.onSubmit)).toBeDefined();
  });

  it('refuses to display configuration read from a different bound account', async () => {
    vi.useFakeTimers();
    rpcBus.dispatch = async (_endpoint, method) => method === CONFIG_METHODS.commands
      ? { commands: [] }
      : { config: { appId: 'account-b', model: 'private-model-b' } };
    const render = mount(() => ConfigPanel({ bindPhase: 'bound', appId: 'account-a' }));
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(find(render(), props => !!props.onSubmit)).toBeUndefined();
    expect(find(render(), props => typeof props.children === 'string' && props.children.includes('账号已变化'))).toBeDefined();
  });

  it('saves with the refreshed access revision while keeping an unsaved mode edit', async () => {
    vi.useFakeTimers();
    const writes: ConfigWire[] = [];
    let config: ConfigWire = {
      appId: 'bot', accessRevision: 'initial',
      access: { c2cMode: 'allowlist', c2cAllow: ['kept', 'revoked'], groupMode: 'open', groupAllow: [], commandMode: 'open' },
    };
    rpcBus.dispatch = async (endpoint, method, payload) => {
      expect(endpoint).toBe(CONFIG_RPC_ENDPOINT);
      if (method === CONFIG_METHODS.configGet) return { config };
      expect(method).toBe(CONFIG_METHODS.configSet);
      const patch = payload as unknown as ConfigWire;
      writes.push(patch);
      if (patch.accessRevision !== config.accessRevision) {
        throw new RpcError(RPC_ERROR_CODES.configConflict, 'conflict');
      }
      config = { ...config, ...patch, accessRevision: `revision-${writes.length}` };
      if (writes.length === 1 && config.access) {
        // Another tab removes a member after the save and before the first readback.
        config = { ...config, accessRevision: 'after-revoke', access: { ...config.access, c2cAllow: ['kept'] } };
      }
      return { ok: true };
    };

    const render = mount(() => ConfigPanel({ bindPhase: 'starting' }));
    const mode = (label: string) => find(render(), props => props.label === label && !!props.onChange)!.props;
    const save = () => find(render(), props => !!props.onSubmit)!.props.onSubmit!({ preventDefault() {} });
    const refresh = () => find(render(), props => props.children === '刷新配置' && !!props.onClick)!.props.onClick!();
    render();
    await vi.advanceTimersByTimeAsync(0);

    mode('斜杠命令').onChange!('disabled');
    save();
    await vi.advanceTimersByTimeAsync(3000);
    mode('群聊').onChange!('disabled');
    refresh();
    render();
    await vi.advanceTimersByTimeAsync(0);
    expect(mode('群聊').value).toBe('disabled');

    save();
    await vi.advanceTimersByTimeAsync(0);
    expect(writes[1]).toMatchObject({
      expectedAppId: 'bot',
      accessRevision: 'after-revoke',
      access: { c2cAllow: ['kept'], groupMode: 'disabled', commandMode: 'disabled' },
    });
  });

  it('renders one merged model field and writes provider/model back as two keys', async () => {
    vi.useFakeTimers();
    const writes: ConfigWire[] = [];
    let config: ConfigWire = { appId: 'bot', provider: 'deepseek', model: 'deepseek-chat' };
    rpcBus.dispatch = async (_endpoint, method, payload) => {
      switch (method) {
        case CONFIG_METHODS.configGet:
          return { config };
        case CONFIG_METHODS.modelOptions:
          return { providers: [], presets: [] };
        case CONFIG_METHODS.modelCatalog:
          return { providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }] };
        case CONFIG_METHODS.commands:
          return { commands: [] };
        case CONFIG_METHODS.configSet: {
          const patch = payload as unknown as ConfigWire;
          writes.push(patch);
          config = { ...config, ...patch };
          return { ok: true };
        }
        default:
          return {};
      }
    };

    const render = mount(() => ConfigPanel({ bindPhase: 'bound', appId: 'bot' }));
    const modelField = () => find(render(), props => props.id === 'imqq-model')!.props;
    render();
    await vi.advanceTimersByTimeAsync(0);

    expect(modelField().value).toBe('deepseek/deepseek-chat');
    expect(find(render(), props => props.label === '模型提供方')).toBeUndefined();

    modelField().onChange!('openai/gpt-4o');
    find(render(), props => !!props.onSubmit)!.props.onSubmit!({ preventDefault() {} });
    await vi.advanceTimersByTimeAsync(0);

    expect(writes[0]).toMatchObject({ expectedAppId: 'bot', provider: 'openai', model: 'gpt-4o' });
  });

  it('keeps a valid code usable through a missing endpoint and stops on a confirmed end', async () => {
    vi.useFakeTimers();
    let unavailable = false;
    const challenges: PairChallenge[] = [];
    rpcBus.dispatch = async (endpoint, method) => {
      expect(endpoint).toBe(ACCOUNT_RPC_ENDPOINT);
      if (method === ACCOUNT_METHODS.pairIssue) {
        const challenge: PairChallenge = {
          code: 'ABCDEF', purpose: 'allow-c2c', createdAt: Date.now(), expiresAt: Date.now() + 600_000, claims: [],
        };
        challenges.push(challenge);
        return { ...challenge, previousClaims: [] };
      }
      expect(method).toBe(ACCOUNT_METHODS.pairStatus);
      if (unavailable) throw new RpcError(RPC_ERROR_CODES.routeMissing, '插件重载中', true);
      return { challenges, owners: [], allowC2c: [], allowGroup: [] };
    };

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
});

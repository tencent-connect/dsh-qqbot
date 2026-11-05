import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIND_CONFIG_PATH } from '../shared/bind-protocol.ts';
import { PAIR_ISSUE_PATH, PAIR_STATUS_PATH, type PairChallenge } from '../shared/pairing-protocol.ts';
import type { ConfigWire } from './config-form-state.ts';
import { ConfigPanel } from './config-panel.ts';
import { PairClaimPanel } from './qq-pairing.ts';

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
  vi.unstubAllGlobals();
});

describe('QQ settings recovery', () => {
  it('saves with the refreshed access revision while keeping an unsaved mode edit', async () => {
    vi.useFakeTimers();
    const writes: ConfigWire[] = [];
    let config: ConfigWire = {
      appId: 'bot', accessRevision: 'initial',
      access: { c2cMode: 'allowlist', c2cAllow: ['kept', 'revoked'], groupMode: 'open', groupAllow: [], commandMode: 'open' },
    };
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
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
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { PrefsStore } from './prefs-store.ts';

const paths = vi.hoisted(() => ({ root: '' }));
vi.mock('../shared/dirs.ts', () => ({ get PLUGIN_HOME() { return paths.root; } }));

beforeEach(() => { paths.root = mkdtempSync(join(tmpdir(), 'qq-model-prefs-')); });
afterEach(() => { rmSync(paths.root, { recursive: true, force: true }); });

describe('durable model selections', () => {
  it('preserves an explicit effort across reload and drops it when a different selection omits it', () => {
    const route = { provider: 'live', model: 'reasoner', reasoningEffort: ReasoningEffortId('high') };
    new PrefsStore().setOverride('private-a', route);
    const reloaded = new PrefsStore();
    expect(reloaded.getOverride('private-a')).toEqual(route);
    reloaded.setOverride('private-a', { provider: 'other', model: 'plain' });
    expect(new PrefsStore().getOverride('private-a')).toEqual({ provider: 'other', model: 'plain' });
  });

  it('keeps legacy routes and ignores invalid optional efforts', () => {
    writeFileSync(join(paths.root, 'model-prefs.json'), JSON.stringify({
      overrides: {
        legacy: { provider: 'live', model: 'old' },
        invalid: { provider: 'live', model: 'plain', reasoningEffort: 42 },
        empty: { provider: 'live', model: 'plain', reasoningEffort: '' },
      },
    }));
    const prefs = new PrefsStore();
    expect(prefs.getOverride('legacy')).toEqual({ provider: 'live', model: 'old' });
    expect(prefs.getOverride('invalid')).toEqual({ provider: 'live', model: 'plain' });
    expect(prefs.getOverride('empty')).toEqual({ provider: 'live', model: 'plain' });
  });
});

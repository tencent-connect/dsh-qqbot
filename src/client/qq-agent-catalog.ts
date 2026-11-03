import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAgentPresets, parseModelCatalog, type ModelDirectory, type PresetChoice, type SelectorSource } from './host-selectors.ts';

export interface QQAgentCatalog {
  readonly models: ModelDirectory | null;
  readonly presets: readonly PresetChoice[] | null;
  readonly loading: boolean;
  readonly errors: readonly string[];
}

export function useQQAgentCatalog(source: SelectorSource | undefined, enabled = true): QQAgentCatalog & { refresh: () => void } {
  const [value, setValue] = useState<QQAgentCatalog>({ models: null, presets: null, loading: enabled, errors: [] });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => setAttempt(current => current + 1), []);
  useEffect(() => {
    const request = ++generation.current;
    if (!enabled) {
      setValue(current => current.loading || current.errors.length ? { ...current, loading: false, errors: [] } : current);
      return;
    }
    setValue(current => ({ ...current, loading: true, errors: [] }));
    const timeout = setTimeout(() => {
      if (generation.current !== request) return;
      generation.current += 1;
      setValue(current => ({ ...current, loading: false, errors: ['宿主目录请求超时，请重试。'] }));
    }, 10_000);
    void Promise.allSettled([
      source ? Promise.resolve().then(() => source.modelCatalog()).then(parseModelCatalog) : Promise.reject(new Error('宿主模型目录暂不可用。')),
      source ? Promise.resolve().then(() => source.listAgentPresets()).then(parseAgentPresets) : Promise.reject(new Error('宿主 Agent 预设目录暂不可用。')),
    ]).then(([models, presets]) => {
      if (generation.current !== request) return;
      clearTimeout(timeout);
      setValue(current => ({
        models: models.status === 'fulfilled' ? models.value : current.models,
        presets: presets.status === 'fulfilled' ? presets.value : current.presets,
        loading: false,
        errors: [models, presets].flatMap(result => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : '宿主目录读取失败。'] : []),
      }));
    });
    return () => { generation.current += 1; clearTimeout(timeout); };
  }, [source, attempt, enabled]);
  return { ...value, refresh };
}

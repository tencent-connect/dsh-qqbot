import { createElement as h, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_DEFAULTS_PATH, type WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';
import { fetchJson, HttpError } from './http.ts';
import { WorkbenchAgentFields, WorkbenchReplyFields, type AgentFormSource } from './workbench-agent-form.ts';

export function readDefaults(appId: string, signal?: AbortSignal): Promise<WorkbenchDefaults> {
  return fetchJson<WorkbenchDefaults>(`${WORKBENCH_DEFAULTS_PATH}?${new URLSearchParams({ appId })}`, { cache: 'no-store', signal });
}

export function WorkbenchDefaultsForm({ appId, source }: { appId: string; source?: AgentFormSource }): ReactNode {
  const [base, setBase] = useState<WorkbenchDefaults>();
  const [settings, setSettings] = useState<WorkbenchDefaults['settings']>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = JSON.stringify(settings) !== JSON.stringify(base?.settings);

  useEffect(() => {
    const controller = new AbortController();
    void readDefaults(appId, controller.signal).then(value => {
      setBase(value);
      setSettings(value.settings);
      setError('');
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '默认设置加载失败。');
    });
    return () => controller.abort();
  }, [appId, attempt]);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!base || !settings || busy || !dirty || conflict) return;
    setBusy(true);
    setError('');
    try {
      const next = await fetchJson<WorkbenchDefaults>(WORKBENCH_DEFAULTS_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appId, revision: base.revision, settings }),
      });
      setBase(next);
      setSettings(next.settings);
      setSaved(true);
    } catch (error) {
      setConflict(error instanceof HttpError && error.status === 409);
      setError(error instanceof Error ? error.message : '默认设置保存失败。');
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<WorkbenchDefaults['settings']>): void => {
    setSettings(current => current && { ...current, ...patch });
    setSaved(false);
  };
  return h('form', { className: 'imqw-form imqw-defaults-form', onSubmit: save },
    h('p', { className: 'imqw-muted' }, '仅用于首次接入的群聊和私聊。'),
    settings ? h('section', { className: 'imqw-defaults-section', 'aria-label': 'Agent 基本设置' },
      h('h3', null, 'Agent 基本设置'),
      h(WorkbenchAgentFields, { settings, source, disabled: busy, onChange: change }),
    ) : null,
    settings ? h('section', { className: 'imqw-defaults-section', 'aria-label': 'QQ 回复' },
      h('h3', null, 'QQ 回复'),
      h(WorkbenchReplyFields, { settings, disabled: busy, onChange: change }),
    ) : null,
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null,
    saved ? h('p', { className: 'imqw-muted', role: 'status' }, '默认设置已保存。') : null,
    settings ? h('footer', { className: 'imqw-actions imqw-savebar' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: busy || !dirty, onClick: () => {
        setSettings(undefined);
        setBase(undefined);
        setConflict(false);
        setError('');
        setSaved(false);
        setAttempt(value => value + 1);
      } }, '放弃修改'),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: busy || !dirty || conflict }, busy ? '保存中…' : '保存默认设置'),
    ) : error ? h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick: () => setAttempt(value => value + 1) }, '重新读取') : h('p', { role: 'status', className: 'imqw-muted' }, '正在读取默认设置…'),
  );
}

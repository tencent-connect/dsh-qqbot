import { t } from './qq-locale.ts';
import { createElement as h, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_DEFAULTS_PATH, type WorkbenchAgentSettings, type WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';
import { agentSettingsPatch } from './agent-settings-draft.ts';
import { fetchJson, HttpError } from './http.ts';
import { WorkbenchAgentFields, WorkbenchReplyFields, type AgentFormSource } from './workbench-agent-form.ts';
import { SettingsGroup } from './workbench-settings-group.ts';

export function readDefaults(appId: string, signal?: AbortSignal): Promise<WorkbenchDefaults> {
  return fetchJson<WorkbenchDefaults>(`${WORKBENCH_DEFAULTS_PATH}?${new URLSearchParams({ appId })}`, { cache: 'no-store', signal });
}

interface DefaultsDraft {
  base: WorkbenchDefaults;
  settings: WorkbenchAgentSettings;
}

const drafts = new Map<string, DefaultsDraft>();

function changes(draft: DefaultsDraft): Partial<WorkbenchAgentSettings> {
  return agentSettingsPatch(draft.base.settings, draft.settings);
}

export function WorkbenchDefaultsForm({ appId, bindingRevision = 0, source }: {
  appId: string; bindingRevision?: number; source?: AgentFormSource;
}): ReactNode {
  const key = JSON.stringify([appId, bindingRevision]);
  const [draft, setDraft] = useState(() => drafts.get(key));
  const currentDraft = useRef(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController>();
  const dirty = draft !== undefined && Object.keys(changes(draft)).length > 0;

  const replace = (next: DefaultsDraft): void => {
    if (Object.keys(changes(next)).length) drafts.set(key, next);
    else drafts.delete(key);
    currentDraft.current = next;
    setDraft(next);
  };

  const run = async (action: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action(controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof HttpError && cause.status === 409) setConflict(true);
      setError(cause instanceof Error ? cause.message : t("无法更新默认设置。"));
    } finally {
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
        setLoading(false);
      }
    }
  };

  const read = (mode: 'restore' | 'merge' | 'discard'): Promise<void> => run(async signal => {
    const latest = await readDefaults(appId, signal);
    if (signal.aborted) return;
    const previous = drafts.get(key);
    if (mode === 'discard' || !previous) {
      replace({ base: latest, settings: latest.settings });
    } else {
      const merged = { base: latest, settings: { ...latest.settings, ...changes(previous) } };
      if (mode === 'restore' && Object.keys(changes(merged)).length
        && (latest.revision !== previous.base.revision || Object.keys(agentSettingsPatch(previous.base.settings, latest.settings)).length)) {
        setConflict(true);
        setError(t("默认设置已更新，草稿已保留。"));
        return;
      }
      replace(merged);
      if (mode === 'merge') setNotice(t("草稿已合并，请核对后保存。"));
    }
    setConflict(false);
  });

  useEffect(() => {
    void read('restore');
    return () => { request.current?.abort(); request.current = undefined; };
    // The parent keys this form by the robot binding.
  }, [key]);

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (!draft || !dirty || conflict || loading) return;
    void run(async signal => {
      const next = await fetchJson<WorkbenchDefaults>(WORKBENCH_DEFAULTS_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal,
        body: JSON.stringify({ appId, revision: draft.base.revision, settings: draft.settings }),
      });
      if (signal.aborted) return;
      replace({ base: next, settings: next.settings });
      setNotice(t("默认设置已保存。"));
    });
  };
  const change = (patch: Partial<WorkbenchAgentSettings>): void => {
    // Read the current draft so two edits from the same render compose.
    const current = currentDraft.current;
    if (current) replace({ ...current, settings: { ...current.settings, ...patch } });
    setNotice('');
  };
  const fields = draft && { settings: draft.settings, disabled: busy || loading, onChange: change };
  return h('form', { className: 'imqw-form imqw-defaults-form', onSubmit: save },
    h('p', { className: 'imqw-muted' }, t("首次建立 QQ 群聊或私聊的配置时采用。")),
    fields ? h(SettingsGroup, { title: t("Agent 设置"), defaultOpen: true, children: h(WorkbenchAgentFields, { ...fields, source }) }) : null,
    fields ? h(SettingsGroup, { title: t("QQ 回复"), defaultOpen: true, children: h(WorkbenchReplyFields, { ...fields, source }) }) : null,
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null,
    notice ? h('p', { className: 'imqw-muted', role: 'status' }, notice) : null,
    fields ? h('footer', { className: 'imqw-actions imqw-savebar' },
      conflict ? h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: busy, onClick: () => { void read('merge'); } }, t("合并草稿")) : null,
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: busy || (!dirty && !conflict),
        onClick: () => { void read('discard'); } }, t("撤销修改")),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: busy || loading || !dirty || conflict }, busy ? t("处理中…") : t("保存")),
    ) : error ? h(Button, { type: 'button', size: 'sm', variant: 'outline', onClick: () => { void read('restore'); } }, t("重新读取"))
      : h('p', { role: 'status', className: 'imqw-muted' }, t("正在读取默认设置…")),
  );
}

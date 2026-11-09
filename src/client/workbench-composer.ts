import { createElement as h, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { QQ_MANUAL_MESSAGE_LIMIT, WORKBENCH_SEND_PATH, type WorkbenchSendResult } from '../shared/workbench-timeline-protocol.ts';
import type { WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { fetchJson, HttpError } from './http.ts';

const drafts = new Map<string, string>();
const activeOperations = new Map<string, string>();

function rememberedOperation(key: string): string | undefined {
  try { return activeOperations.get(key) ?? sessionStorage.getItem(key) ?? undefined; }
  catch { return activeOperations.get(key); }
}

function rememberOperation(key: string, id?: string): void {
  if (id) activeOperations.set(key, id);
  else activeOperations.delete(key);
  try {
    if (id) sessionStorage.setItem(key, id);
    else sessionStorage.removeItem(key);
  } catch { /* Session storage is optional; keep the in-memory operation. */ }
}

export function QqComposer({ appId, peer, robotName, disabledReason, onUpdate }: {
  appId: string; peer: WorkbenchConversation; robotName: string; disabledReason?: string; onUpdate(): void;
}): ReactNode {
  const target = { appId, scope: peer.scope, openId: peer.openId };
  const key = 'qqbot-send:' + JSON.stringify([appId, peer.scope, peer.openId]);
  const [draft, setDraft] = useState(() => drafts.get(key) ?? '');
  const [operation, setOperation] = useState(() => rememberedOperation(key));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  const edit = (value: string): void => {
    if (value) {
      drafts.delete(key);
      drafts.set(key, value);
      if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
    } else drafts.delete(key);
    setDraft(value);
  };
  const finish = (result: WorkbenchSendResult): void => {
    const done = result.status === 'accepted' || result.status === 'rejected';
    if (done) rememberOperation(key);
    if (result.status === 'accepted') drafts.delete(key);
    if (!mounted.current) return;
    if (result.status === 'accepted') setDraft('');
    if (done) setOperation(undefined);
    setUncertain(result.status === 'unknown');
    const codes = [result.httpStatus && `HTTP ${result.httpStatus}`, result.platformCode && `QQ ${result.platformCode}`].filter(Boolean).join(' · ');
    setStatus(result.status === 'accepted' ? 'QQ 接口已接受'
      : result.status === 'rejected' ? `消息未发送${codes ? `（${codes}）` : ''}，请检查连接或权限后重试。`
        : result.status === 'sending' ? '正在等待 QQ 回执…' : '发送结果未知，请先在 QQ 核对。');
    onUpdate();
  };
  const run = async (id: string, submit?: string): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatus(submit !== undefined ? '发送中…' : '正在查询发送结果…');
    try {
      const query = new URLSearchParams({ ...target, operation: id });
      const result = await fetchJson<WorkbenchSendResult>(
        submit === undefined ? `${WORKBENCH_SEND_PATH}?${query}` : WORKBENCH_SEND_PATH,
        submit === undefined ? { cache: 'no-store' } : {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, operation: id, text: submit }),
        },
        24_000,
      );
      finish(result);
    } catch (cause) {
      const declined = submit !== undefined && cause instanceof HttpError && [400, 401, 403, 404, 409].includes(cause.status);
      if (declined) rememberOperation(key);
      if (mounted.current) {
        if (declined) setOperation(undefined);
        setUncertain(!declined);
        setStatus(declined ? cause.message : '暂未确认发送结果，请查询回执或先在 QQ 核对。');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const id = rememberedOperation(key);
    if (id) void run(id);
    return () => { mounted.current = false; };
  }, [key]);

  const send = (): void => {
    if (inFlight.current || disabledReason || !draft.trim() || operation || rememberedOperation(key)) return;
    const id = crypto.randomUUID();
    rememberOperation(key, id);
    setOperation(id);
    setUncertain(false);
    void run(id, draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  };

  return h('form', { className: 'imqw-composer', onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); send(); } },
    h('div', { className: 'imqw-composer-input' },
      h('textarea', {
        ref: input, 'aria-label': '发送到 QQ 的消息', rows: 1, maxLength: QQ_MANUAL_MESSAGE_LIMIT,
        value: draft, readOnly: !!operation, disabled: !!disabledReason,
        placeholder: disabledReason || `以 ${robotName} 的身份发送到 QQ`,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { edit(event.currentTarget.value); setStatus(''); }, onKeyDown,
      }),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: !!disabledReason || busy || !!operation || !draft.trim() }, '发送'),
    ),
    h('div', { className: 'imqw-composer-footer' },
      h('span', { className: 'imqw-muted', role: 'status' }, status || (disabledReason ? '' : '直接发到 QQ · Shift + Enter 换行')),
      operation && !busy ? h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: () => { void run(operation); } }, '查询回执') : null,
      operation && !busy && uncertain ? h(Button, {
        type: 'button', variant: 'ghost', size: 'sm', onClick: () => {
          rememberOperation(key); setOperation(undefined); setUncertain(false); setStatus('已结束查询。发送前请在 QQ 核对。');
          input.current?.focus();
        },
      }, '结束查询') : null,
    ),
  );
}

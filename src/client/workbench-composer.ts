import { createElement as h, forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { QQ_MANUAL_ATTACHMENT_LIMIT, QQ_MANUAL_MESSAGE_LIMIT, WORKBENCH_SEND_PATH, type TimelineEntry, type WorkbenchSendResult } from '../shared/workbench-timeline-protocol.ts';
import type { WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { fetchJson, HttpError } from './http.ts';

interface ComposerDraft { text: string; attachment?: File; quote?: Pick<TimelineEntry, 'id' | 'text' | 'attachments'> & { sender: string } }
export interface QqComposerHandle { replyTo(row: TimelineEntry, sender: string): void }
const drafts = new Map<string, ComposerDraft>();
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

export const QqComposer = forwardRef<QqComposerHandle, {
  appId: string; peer: WorkbenchConversation; robotName: string; disabledReason?: string; onUpdate(): void;
}>(function QqComposer({ appId, peer, robotName, disabledReason, onUpdate }, ref): ReactNode {
  const target = { appId, scope: peer.scope, openId: peer.openId };
  const key = 'qqbot-send:' + JSON.stringify([appId, peer.scope, peer.openId]);
  const [draft, setDraft] = useState<ComposerDraft>(() => drafts.get(key) ?? { text: '' });
  const [operation, setOperation] = useState(() => rememberedOperation(key));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const edit = (value: ComposerDraft): void => {
    if (value.text || value.attachment || value.quote) {
      drafts.delete(key);
      drafts.set(key, value);
      if (drafts.size > 100) drafts.delete(drafts.keys().next().value!);
    } else drafts.delete(key);
    setDraft(value);
  };
  const finish = (id: string, result: WorkbenchSendResult): void => {
    const current = rememberedOperation(key);
    if (current && current !== id) return;
    const done = result.status === 'accepted' || result.status === 'rejected';
    if (done && current === id) {
      rememberOperation(key);
      if (result.status === 'accepted') drafts.delete(key);
    }
    if (!mounted.current) return;
    if (result.status === 'accepted') setDraft({ text: '' });
    if (done) setOperation(undefined);
    setUncertain(result.status === 'unknown');
    const codes = [result.httpStatus && `HTTP ${result.httpStatus}`, result.platformCode && `QQ ${result.platformCode}`].filter(Boolean).join(' · ');
    setStatus(result.status === 'accepted' ? 'QQ 接口已接受'
      : result.status === 'rejected' ? `消息未发送${codes ? `（${codes}）` : ''}，请检查连接或权限后重试。`
        : result.status === 'sending' ? '正在等待 QQ 回执…' : '发送结果未知，请先在 QQ 核对。');
    onUpdate();
  };
  const run = async (id: string, submit?: ComposerDraft): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatus(submit !== undefined ? '发送中…' : '正在查询发送结果…');
    try {
      const query = new URLSearchParams({ ...target, operation: id });
      let request: RequestInit = { cache: 'no-store' };
      if (submit?.attachment) {
        const form = new FormData();
        query.forEach((value, key) => form.set(key, value));
        form.set('text', submit.text);
        form.set('attachment', submit.attachment);
        request = { method: 'POST', body: form };
      } else if (submit) {
        request = {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...target, operation: id, text: submit.text, replyTo: submit.quote?.id }),
        };
      }
      const result = await fetchJson<WorkbenchSendResult>(
        submit === undefined ? `${WORKBENCH_SEND_PATH}?${query}` : WORKBENCH_SEND_PATH,
        request,
        24_000,
      );
      finish(id, result);
    } catch (cause) {
      if (rememberedOperation(key) !== id) return;
      const declined = submit !== undefined && cause instanceof HttpError && [400, 401, 403, 404, 409, 413].includes(cause.status);
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
    if (inFlight.current || disabledReason || (!draft.text.trim() && !draft.attachment) || operation || rememberedOperation(key)) return;
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

  const editLocked = !!disabledReason || busy || !!operation;
  useImperativeHandle(ref, () => ({
    replyTo(row, sender) {
      if (editLocked || inFlight.current || rememberedOperation(key)) return;
      if (draft.attachment) {
        setStatus('请先移除附件，再引用回复。');
        return;
      }
      edit({ ...draft, quote: { id: row.id, text: row.text.slice(0, 400), attachments: row.attachments, sender } });
      setStatus('');
      input.current?.focus();
    },
  }));
  return h('form', { className: 'imqw-composer', onSubmit: (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); send(); } },
    h('input', {
      ref: fileInput, type: 'file', hidden: true, 'aria-label': '选择 QQ 附件', disabled: editLocked,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file || editLocked || draft.quote) return;
        if (!file.size || file.size > QQ_MANUAL_ATTACHMENT_LIMIT) {
          setStatus('请选择一个非空附件，最多 4 MiB。');
          return;
        }
        edit({ ...draft, attachment: file });
        setStatus('');
      },
    }),
    draft.attachment ? h('div', { className: 'imqw-composer-attachment' },
      h('span', { title: draft.attachment.name }, draft.attachment.name),
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: editLocked, onClick: () => {
        edit({ text: draft.text }); setStatus('');
      } }, '移除附件'),
    ) : null,
    draft.quote ? h('div', { className: 'imqw-composer-attachment imqw-composer-quote' },
      h('span', { title: draft.quote.text }, `回复 ${draft.quote.sender} · ${draft.quote.text || `附件 ${draft.quote.attachments} 项`}`),
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: editLocked, onClick: () => {
        edit({ text: draft.text }); setStatus(''); input.current?.focus();
      } }, '取消引用'),
    ) : null,
    h('div', { className: 'imqw-composer-input' },
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: editLocked || !!draft.quote,
        onClick: () => fileInput.current?.click(), title: draft.quote ? '取消引用后可添加附件' : '每次可发送一个附件，最多 4 MiB' }, '附件'),
      h('textarea', {
        ref: input, 'aria-label': '发送到 QQ 的消息', rows: 1, maxLength: QQ_MANUAL_MESSAGE_LIMIT,
        value: draft.text, readOnly: !!operation, disabled: !!disabledReason,
        placeholder: disabledReason || `以 ${robotName} 的身份发送到 QQ`,
        onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { edit({ ...draft, text: event.currentTarget.value }); setStatus(''); }, onKeyDown,
      }),
      h(Button, { type: 'submit', size: 'sm', variant: 'primary', disabled: editLocked || (!draft.text.trim() && !draft.attachment) }, '发送'),
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
});

import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_ANSWER_PATH, type AnswerPreview } from '../shared/workbench-answer-protocol.ts';
import type { WorkbenchSendResult } from '../shared/workbench-timeline-protocol.ts';
import { fetchJson, HttpError } from './http.ts';

const availability = new Map<string, { expires: number; request: Promise<boolean> }>();
function hasDestination(sessionId: string): Promise<boolean> {
  const cached = availability.get(sessionId);
  if (cached && cached.expires > Date.now()) return cached.request;
  const query = new URLSearchParams({ sessionId });
  const request = fetchJson<{ available: boolean }>(`${WORKBENCH_ANSWER_PATH}?${query}`)
    .then(result => result.available, () => false);
  availability.delete(sessionId);
  availability.set(sessionId, { expires: Date.now() + 15_000, request });
  if (availability.size > 64) availability.delete(availability.keys().next().value!);
  return request;
}

function receiptLabel(receipt: WorkbenchSendResult): string {
  switch (receipt.status) {
    case 'accepted': return 'QQ 接口已接受。';
    case 'sending': return '正在等待 QQ 回执。';
    case 'unknown': return '发送结果未知，请在 QQ 核对。';
    case 'rejected': {
      const codes = [receipt.httpStatus && `HTTP ${receipt.httpStatus}`, receipt.platformCode && `QQ ${receipt.platformCode}`].filter(Boolean);
      return `消息未发送${codes.length ? `（${codes.join(' · ')}）` : ''}。`;
    }
  }
}

export function QqAnswerAction({ sessionId, messageId }: { sessionId: string; messageId: string }): ReactNode {
  const [visibleFor, setVisibleFor] = useState<string>();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AnswerPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    void hasDestination(sessionId).then(available => {
      if (active && available) setVisibleFor(sessionId);
    });
    return () => { active = false; };
  }, [sessionId]);

  const run = async (confirm?: AnswerPreview): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (confirm) {
        const receipt = await fetchJson<WorkbenchSendResult>(WORKBENCH_ANSWER_PATH, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId, messageId, confirmation: confirm.confirmation }),
        }, 25_000);
        setPreview({ ...confirm, receipt });
      } else {
        const query = new URLSearchParams({ sessionId, messageId });
        setPreview(await fetchJson<AnswerPreview>(`${WORKBENCH_ANSWER_PATH}?${query}`));
      }
    } catch (cause) {
      if (!confirm) setPreview(undefined);
      setError(confirm && !(cause instanceof HttpError && cause.status < 500)
        ? '暂未取得发送回执，请查询状态。'
        : cause instanceof Error ? cause.message : '暂时无法取得 QQ 发送结果。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const close = (): void => {
    if (pending.current) return;
    setOpen(false);
    setPreview(undefined);
    setError('');
  };
  if (visibleFor !== sessionId) return null;
  const receipt = preview?.receipt;
  const refresh = !!error || receipt?.status === 'sending' || receipt?.status === 'unknown';
  return h('span', null,
    h(Button, { type: 'button', variant: 'toolbar', size: 'sm', onClick: () => {
      setOpen(true);
      void run();
    } }, '发送到 QQ'),
    open ? h(Modal, {
      open, title: '发送到 QQ', closeLabel: '关闭', onClose: close,
      description: '请核对机器人、接收方和正文。',
      footer: h('div', { className: 'imqb-row' },
        h(Button, { type: 'button', variant: 'ghost', disabled: busy, onClick: close }, receipt ? '完成' : '取消'),
        refresh ? h(Button, { type: 'button', variant: 'outline', disabled: busy, onClick: () => { void run(); } }, '查询发送状态')
          : preview && !receipt ? h(Button, { type: 'button', variant: 'primary', disabled: busy || !!preview.blockedReason,
            onClick: () => { void run(preview); } }, busy ? '正在发送…' : '确认发送') : null),
    },
    preview ? h('div', { className: 'imqb-answer' },
      h('dl', null,
        h('dt', null, '机器人'), h('dd', null, preview.robotName, h('small', null, `AppID ${preview.appId}`)),
        h('dt', null, '接收方'), h('dd', null, preview.peerName, h('small', null, preview.scope === 'group' ? 'QQ 群聊' : 'QQ 私聊'))),
      h('div', { className: 'imqb-answer-text', role: 'region', 'aria-label': '待发送正文', tabIndex: 0 }, preview.text),
      preview.automaticWebReplies && !receipt ? h('small', null, '此对话允许网页回答自动推送。若 QQ 已有这条回答，手动发送会再发一条。') : null,
      !preview.recording ? h('small', null, '此对话已关闭消息保存，发送结果在此查看。') : null,
      preview.blockedReason && !receipt ? h('p', { className: 'imqb-error', role: 'alert' }, preview.blockedReason) : null,
      receipt ? h('p', { role: 'status' }, receiptLabel(receipt)) : null)
      : busy ? h('p', { role: 'status' }, '正在读取回答…') : null,
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null) : null);
}

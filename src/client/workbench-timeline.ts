import { createElement as h, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_TIMELINE_PATH, type TimelineEntry, type TimelineInboundOutcome, type TimelinePage, type TimelineStatus } from '../shared/workbench-timeline-protocol.ts';
import type { WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { fetchJson } from './http.ts';
import { QqComposer } from './workbench-composer.ts';

const statusLabel: Record<TimelineStatus, string> = {
  received: '已收到', sending: '发送中', partial: 'QQ 已接受部分内容',
  accepted: 'QQ 接口已接受', rejected: 'QQ 拒绝', unknown: '结果未知',
};
const inboundLabel: Record<TimelineInboundOutcome, string> = {
  'mention-required': '已收到，未 @ 机器人',
  'rate-limited': '触发频率限制',
  'queue-full': '处理队列已满',
  empty: '没有可提交给 DSH 的内容',
  submitted: '已提交到 DSH',
  'submit-failed': '提交到 DSH 失败',
};
const sourceLabel: Record<NonNullable<TimelineEntry['source']>, string> = {
  automatic: '自动回复', agent: 'Agent 投递', manual: '网页直发', answer: 'Session 回答',
};
const dateFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'short' });

function grouped(previous: TimelineEntry | undefined, row: TimelineEntry): boolean {
  return !!previous && previous.direction === row.direction
    && (row.direction === 'outbound' || (!!row.senderId && previous.senderId === row.senderId))
    && row.at >= previous.at && row.at - previous.at < 3 * 60_000;
}

function updateLatest(current: TimelinePage | undefined, latest: TimelinePage): TimelinePage {
  if (!current || !latest.entries.length) return latest;
  const overlap = current.entries.findIndex(row => row.id === latest.entries[0]?.id);
  if (overlap < 0) return latest;
  return {
    entries: [...current.entries.slice(0, overlap), ...latest.entries],
    before: overlap > 0 ? current.before : latest.before,
    incomplete: latest.incomplete,
  };
}

export function QqTimelineView({ appId, peer, robotName, disabledReason, openSession }: {
  appId: string;
  peer: WorkbenchConversation;
  robotName: string;
  disabledReason?: string;
  openSession?: (id: string) => void;
}): ReactNode {
  const [page, setPage] = useState<TimelinePage>();
  const [error, setError] = useState('');
  const [readingOlder, setReadingOlder] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [newMessages, setNewMessages] = useState(false);
  const latestId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const follow = useRef(true);
  const olderHeight = useRef<number | undefined>(undefined);
  const { scope, openId, recording } = peer;

  const params = (before?: string): string => {
    const query = new URLSearchParams({ appId, scope, openId });
    if (before) query.set('before', before);
    return `${WORKBENCH_TIMELINE_PATH}?${query}`;
  };

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async (): Promise<void> => {
      try {
        const latest = await fetchJson<TimelinePage>(params(), { signal: controller.signal, cache: 'no-store' });
        if (controller.signal.aborted) return;
        const tail = latest.entries.at(-1)?.id;
        if (!follow.current && latestId.current && tail !== latestId.current) setNewMessages(true);
        latestId.current = tail;
        setPage(previous => updateLatest(previous, latest));
        setError('');
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取 QQ 流水');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void read(); }, 4000);
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [appId, scope, openId, refresh]);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (olderHeight.current !== undefined) {
      node.scrollTop += node.scrollHeight - olderHeight.current;
      olderHeight.current = undefined;
    } else if (follow.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [page]);

  const loadOlder = async (): Promise<void> => {
    const before = page?.before;
    const signal = lifetime.current?.signal;
    if (!before || !signal || readingOlder) return;
    setReadingOlder(true);
    try {
      const older = await fetchJson<TimelinePage>(params(before), { signal, cache: 'no-store' });
      if (signal.aborted) return;
      olderHeight.current = list.current?.scrollHeight;
      setPage(current => current?.before === before ? {
        entries: [...older.entries, ...current.entries],
        before: older.before,
        incomplete: current.incomplete || older.incomplete,
      } : current);
      setError('');
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : '无法读取更早记录');
    } finally {
      setReadingOlder(false);
    }
  };

  const refreshEntry = async (id: string): Promise<TimelineEntry | undefined> => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return undefined;
    const query = new URLSearchParams({ appId, scope, openId, entryId: id });
    const entry = await fetchJson<TimelineEntry>(`${WORKBENCH_TIMELINE_PATH}?${query}`, { signal, cache: 'no-store' });
    if (signal.aborted) return undefined;
    setPage(current => current && { ...current, entries: current.entries.map(row => row.id === id ? entry : row) });
    return entry;
  };
  const reload = (): void => setRefresh(value => value + 1);
  const jump = (): void => {
    follow.current = true;
    setNewMessages(false);
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  };
  const entries = page?.entries ?? [];
  return h('section', { className: 'imqw-timeline', 'aria-label': 'QQ 消息' },
    h('div', { className: 'imqw-timeline-header' },
      h('span', { className: 'imqw-muted' }, !recording ? '消息保存已关闭' : 'QQ 消息'),
      h(Button, { variant: 'ghost', size: 'sm', disabled: readingOlder, onClick: reload }, '刷新消息')),
    error || page?.incomplete ? h('p', { role: 'alert', className: 'imqb-error' }, error || '消息记录可能不完整。') : null,
    h('div', { className: 'imqw-timeline-scroll', ref: list, onScroll: () => {
      const node = list.current;
      if (!node) return;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      if (follow.current) setNewMessages(false);
    } },
      !page && !error ? h('p', { role: 'status', className: 'imqw-timeline-empty imqw-muted' }, '正在读取消息…') : null,
      page?.entries.length === 0 ? h('p', { className: 'imqw-timeline-empty imqw-muted' }, '还没有已保存的 QQ 消息。') : null,
      page?.before ? h('div', { className: 'imqw-timeline-older' },
        h(Button, { variant: 'ghost', size: 'sm', disabled: readingOlder, onClick: () => { void loadOlder(); } },
          readingOlder ? '正在读取…' : '加载更早消息')) : null,
      h('ol', { className: 'imqw-timeline-list' }, entries.flatMap((row, index) => {
        const previous = entries[index - 1];
        const newDay = !previous || dateFormat.format(previous.at) !== dateFormat.format(row.at);
        const message = h(MessageRow, { key: row.id, row, robotName, openSession, refreshEntry, compact: !newDay && grouped(previous, row) });
        return newDay ? [h('li', { key: 'date-' + row.id, className: 'imqw-message-day' }, dateFormat.format(row.at)), message] : [message];
      })),
    ),
    newMessages ? h('div', { className: 'imqw-message-jump' }, h(Button, { variant: 'outline', size: 'sm', onClick: jump }, '查看最新消息 ↓')) : null,
    h(QqComposer, { appId, peer, robotName, disabledReason, onUpdate: reload }),
  );
}

function MessageRow({ row, robotName, openSession, refreshEntry, compact }: {
  row: TimelineEntry;
  robotName: string;
  openSession?: (id: string) => void;
  refreshEntry(id: string): Promise<TimelineEntry | undefined>;
  compact: boolean;
}): ReactNode {
  const [checking, setChecking] = useState(false);
  const [receiptNote, setReceiptNote] = useState('');
  const outbound = row.direction === 'outbound';
  const sender = outbound ? robotName : row.senderName || (row.senderId ? `成员 ${row.senderId.slice(-8)}` : 'QQ 成员');
  const errorCode = [row.httpStatus && `HTTP ${row.httpStatus}`, row.platformCode && `QQ ${row.platformCode}`].filter(Boolean).join(' · ');
  const linkedSession = row.sessionId;
  const queryReceipt = async (): Promise<void> => {
    setChecking(true);
    setReceiptNote('');
    try {
      const latest = await refreshEntry(row.id);
      if (latest?.status === 'unknown') setReceiptNote('记录仍未确认结果，请在 QQ 核对。');
    } catch (error) {
      setReceiptNote(error instanceof Error ? error.message : '无法查询发送记录。');
    } finally {
      setChecking(false);
    }
  };
  const detail = row.inboundOutcome ? inboundLabel[row.inboundOutcome] : statusLabel.received;
  return h('li', { className: 'imqw-timeline-row', 'data-direction': row.direction, 'data-compact': compact },
    h('span', { className: 'imqw-message-avatar', 'aria-hidden': true }, !compact && [...sender][0]?.toUpperCase()),
    h('div', { className: 'imqw-message-body' },
      compact ? null : h('div', { className: 'imqw-timeline-meta' },
        h('strong', { title: sender }, sender), h('time', { dateTime: new Date(row.at).toISOString() }, timeFormat.format(row.at))),
      h('div', { className: 'imqw-timeline-bubble' },
        row.quote ? h('blockquote', null, row.quote.text) : null,
        row.text ? h('div', { className: 'imqw-timeline-text' }, row.text) : null,
        row.attachments ? h('div', { className: 'imqw-muted' }, `附件 · ${row.attachments} 项`) : null),
      h('div', { className: 'imqw-timeline-meta imqw-message-details' },
        outbound ? h('span', { 'data-status': row.status }, statusLabel[row.status]) : null,
        row.source ? h('span', null, sourceLabel[row.source]) : null,
        linkedSession && openSession ? h('button', { type: 'button', className: 'imqw-message-action',
          'aria-label': '打开关联 Session', title: '打开关联 Session', onClick: () => openSession(linkedSession) }, '↗') : null),
      h('details', { className: 'imqw-response-detail' },
        h('summary', null, '响应详情'),
        outbound
          ? h('p', null, row.source ? `来源 · ${sourceLabel[row.source]}` : '来源未记录',
            h('br'), statusLabel[row.status], errorCode ? ` · ${errorCode}` : '')
          : h('p', null, detail),
        outbound && (row.status === 'unknown' || row.status === 'sending')
          ? h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: checking,
            onClick: () => { void queryReceipt(); } }, checking ? '查询中…' : '查询回执') : null,
        receiptNote ? h('p', { role: 'status' }, receiptNote) : null),
    ),
  );
}

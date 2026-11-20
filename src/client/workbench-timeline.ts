import { locale, t, useQqLocale } from './qq-locale.ts';
import { createElement as h, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, IconEllipsisOutlineRegular, MarkdownText, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives';
import { canQuoteTimelineEntry, WORKBENCH_TIMELINE_PATH, type TimelineEntry, type TimelineInboundOutcome, type TimelinePage, type TimelineStatus } from '../shared/workbench-timeline-protocol.ts';
import type { QqWorkbenchViewProps } from '../shared/workbench-extension.ts';
import type { WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { fetchJson, HttpError } from './http.ts';
import { ComposerState, QqComposer, type QqComposerHandle } from './workbench-composer.ts';
import { timelineMarkdown } from './timeline-markdown.ts';

function statusLabel(status: TimelineStatus): string {
  return {
  received: t("已收到"), sending: t("发送中"), partial: t("QQ 已接受部分内容"),
  accepted: t("QQ 接口已接受"), rejected: t("QQ 拒绝"), unknown: t("结果未知"),
  }[status];
}
function inboundLabel(outcome: TimelineInboundOutcome): string {
  return {
  'mention-required': t("已收到，未 @ 机器人"),
  'rate-limited': t("触发频率限制"),
  'queue-full': t("处理队列已满"),
  empty: t("没有可提交给 DSH 的内容"),
  submitted: t("已提交到 DSH"),
  'submit-failed': t("提交到 DSH 失败"),
  'session-archived': t("当前 Session 已归档，消息未提交"),
  }[outcome];
}
function sourceLabel(source: NonNullable<TimelineEntry['source']>): string {
  return {
  automatic: t("自动回复"), agent: t("Agent 投递"), manual: t("网页直发"), answer: t("Session 回答"),
  }[source];
}

interface TimelinePosition { entryId: string; offset: number }
export class TimelineState {
  readonly readingPositions = new Map<string, TimelinePosition>();
  readonly composer = new ComposerState();
}

function rowOffset(list: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - list.getBoundingClientRect().top;
}

function visiblePosition(list: HTMLElement): TimelinePosition | undefined {
  const top = list.getBoundingClientRect().top;
  for (const row of list.querySelectorAll<HTMLElement>('[data-entry-id]')) {
    const entryId = row.dataset.entryId;
    if (entryId && row.getBoundingClientRect().bottom > top) return { entryId, offset: rowOffset(list, row) };
  }
}

function grouped(previous: TimelineEntry | undefined, row: TimelineEntry): boolean {
  return !!previous && previous.direction === row.direction
    && (row.direction === 'outbound' || (!!row.senderId && previous.senderId === row.senderId))
    && row.at >= previous.at && row.at - previous.at < 3 * 60_000;
}

function updateLatest(current: TimelinePage | undefined, latest: TimelinePage): TimelinePage {
  if (!current || current.generation !== latest.generation || !latest.entries.length) return latest;
  const overlap = current.entries.findIndex(row => row.id === latest.entries[0]?.id);
  if (overlap < 0) return latest;
  return {
    ...latest,
    entries: [...current.entries.slice(0, overlap), ...latest.entries],
    before: overlap > 0 ? current.before : latest.before,
  };
}

export function QqTimelineView({ state, appId, peer, robotName, disabledReason, openSession, refreshKey }: QqWorkbenchViewProps & { state: TimelineState }): ReactNode {
  const language = useQqLocale();
  const dateFormat = new Intl.DateTimeFormat(language, { dateStyle: 'medium' });
  const { readingPositions } = state;
  const { scope, openId, recording } = peer;
  const key = JSON.stringify([appId, scope, openId]);
  const [resume] = useState(() => readingPositions.get(key));
  const [page, setPage] = useState<TimelinePage>();
  const [error, setError] = useState('');
  const [readingOlder, setReadingOlder] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [newMessages, setNewMessages] = useState(false);
  const latestId = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement>(null);
  const composer = useRef<QqComposerHandle>(null);
  const lifetime = useRef<AbortController | null>(null);
  const follow = useRef(!resume);
  const olderHeight = useRef<number | undefined>(undefined);
  const pendingPosition = useRef(resume);
  const openedFrom = useRef<TimelinePosition>();

  useLayoutEffect(() => {
    const node = list.current;
    return () => {
      readingPositions.delete(key);
      const position = openedFrom.current ?? pendingPosition.current
        ?? (node && node.clientHeight > 0 && !follow.current ? visiblePosition(node) : undefined);
      if (!position) return;
      readingPositions.set(key, position);
      if (readingPositions.size > 100) {
        const oldest = readingPositions.keys().next();
        if (!oldest.done) readingPositions.delete(oldest.value);
      }
    };
  }, [key]);

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
        const options = { signal: controller.signal, cache: 'no-store' } as const;
        const latest = await fetchJson<TimelinePage>(params(), options);
        let visible = latest;
        const position = pendingPosition.current;
        if (position && latest.before && !latest.entries.some(row => row.id === position.entryId)) {
          const target = `${params()}&${new URLSearchParams({ entryId: position.entryId })}`;
          const exists = await fetch(target, options);
          void exists.body?.cancel();
          if (exists.ok) {
            while (visible.before && !visible.entries.some(row => row.id === position.entryId)) {
              const older = await fetchJson<TimelinePage>(params(visible.before), options);
              if (older.generation !== visible.generation) break;
              visible = {
                ...visible,
                entries: [...older.entries, ...visible.entries],
                before: older.before,
                incomplete: older.incomplete || visible.incomplete,
              };
            }
          }
        }
        if (controller.signal.aborted) return;
        const tail = latest.entries.at(-1)?.id;
        if (!follow.current && latestId.current && tail !== latestId.current) setNewMessages(true);
        latestId.current = tail;
        setPage(previous => position ? visible : updateLatest(previous, latest));
        setError('');
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("无法读取 QQ 流水"));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void read(); }, 4000);
      }
    };
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [appId, scope, openId, refresh, refreshKey]);

  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const position = pendingPosition.current;
    if (position && page) {
      pendingPosition.current = undefined;
      const row = node.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(position.entryId)}"]`);
      if (row) node.scrollTop += rowOffset(node, row) - position.offset;
      else follow.current = true;
      if (follow.current) node.scrollTop = node.scrollHeight;
    } else if (olderHeight.current !== undefined) {
      node.scrollTop += node.scrollHeight - olderHeight.current;
      olderHeight.current = undefined;
    } else if (follow.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [page]);

  const openLinked = async (row: TimelineEntry, element: HTMLElement): Promise<void> => {
    if (!openSession || !row.sessionId) return;
    const node = list.current;
    const message = element.closest<HTMLElement>('[data-entry-id]');
    const position = node && message ? { entryId: row.id, offset: rowOffset(node, message) } : undefined;
    openedFrom.current = position;
    if (await openSession(row.sessionId) === false && openedFrom.current === position) openedFrom.current = undefined;
  };

  const loadOlder = async (): Promise<void> => {
    const before = page?.before;
    const signal = lifetime.current?.signal;
    if (!before || !signal || readingOlder) return;
    setReadingOlder(true);
    try {
      const older = await fetchJson<TimelinePage>(params(before), { signal, cache: 'no-store' });
      if (signal.aborted) return;
      olderHeight.current = list.current?.scrollHeight;
      setPage(current => current?.before === before && current.generation === older.generation ? {
        ...current,
        entries: [...older.entries, ...current.entries],
        before: older.before,
        incomplete: current.incomplete || older.incomplete,
      } : current);
      setError('');
    } catch (cause) {
      if (!signal.aborted) {
        if (cause instanceof HttpError && cause.status === 404) setRefresh(value => value + 1);
        else setError(cause instanceof Error ? cause.message : t("无法读取更早记录"));
      }
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
  return h('section', { className: 'imqw-timeline', 'aria-label': t("QQ 消息") },
    !recording || refreshKey === undefined ? h('div', { className: 'imqw-timeline-notice' },
      !recording ? h('span', { className: 'imqw-muted' }, t("已暂停记录新消息")) : null,
      refreshKey === undefined ? h(Button, { variant: 'ghost', size: 'sm', disabled: readingOlder, onClick: reload }, t("刷新消息")) : null,
    ) : null,
    error || page?.incomplete ? h('div', { className: 'imqw-timeline-notice' },
      h('p', { role: 'alert', className: 'imqb-error' }, error || t("消息记录可能不完整。")),
      h(Button, { variant: 'ghost', size: 'sm', disabled: readingOlder, onClick: reload }, t("重试")),
    ) : null,
    h('div', { className: 'imqw-timeline-scroll', ref: list, onScroll: () => {
      const node = list.current;
      if (!node) return;
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
      if (follow.current) setNewMessages(false);
    } },
      !page && !error ? h('p', { role: 'status', className: 'imqw-timeline-empty imqw-muted' }, t("正在读取消息…")) : null,
      page?.entries.length === 0 ? h('p', { className: 'imqw-timeline-empty imqw-muted' }, t("还没有已保存的 QQ 消息。")) : null,
      page?.before ? h('div', { className: 'imqw-timeline-older' },
        h(Button, { variant: 'ghost', size: 'sm', disabled: readingOlder, onClick: () => { void loadOlder(); } },
          readingOlder ? t("正在读取…") : t("加载更早消息"))) : null,
      h('ol', { className: 'imqw-timeline-list' }, entries.flatMap((row, index) => {
        const previous = entries[index - 1];
        const newDay = !previous || dateFormat.format(previous.at) !== dateFormat.format(row.at);
        const message = h(MessageRow, { key: row.id, row, appId, scope, openId, robotName, openLinked: openSession && openLinked, refreshEntry,
          peerName: scope === 'c2c' ? peer.alias || peer.name : undefined,
          onReply: !disabledReason && canQuoteTimelineEntry(row) ? (sender: string) => composer.current?.replyTo(row, sender) : undefined,
          compact: !newDay && grouped(previous, row) });
        return newDay ? [h('li', { key: 'date-' + row.id, className: 'imqw-message-day' }, dateFormat.format(row.at)), message] : [message];
      })),
    ),
    newMessages ? h('div', { className: 'imqw-message-jump' }, h(Button, { variant: 'outline', size: 'sm', onClick: jump }, t("查看最新消息 ↓"))) : null,
    h(QqComposer, { state: state.composer, ref: composer, appId, peer, robotName, disabledReason, onUpdate: reload }),
  );
}

function MessageRow({ row, appId, scope, openId, robotName, peerName, openLinked, refreshEntry, onReply, compact }: {
  row: TimelineEntry;
  appId: string;
  scope: WorkbenchConversation['scope'];
  openId: string;
  robotName: string;
  peerName?: string;
  openLinked?: (row: TimelineEntry, element: HTMLElement) => Promise<void>;
  refreshEntry(id: string): Promise<TimelineEntry | undefined>;
  onReply?: (sender: string) => void;
  compact: boolean;
}): ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [checking, setChecking] = useState(false);
  const [receiptNote, setReceiptNote] = useState('');
  const menuButton = useRef<HTMLButtonElement>(null);
  const outbound = row.direction === 'outbound';
  const sender = outbound ? robotName : peerName || row.senderName
    || (scope === 'c2c' ? t("私聊 {0}", openId.slice(-8)) : row.senderId ? t("成员 {0}", row.senderId.slice(-8)) : t("QQ 成员"));
  const errorCode = [row.httpStatus && `HTTP ${row.httpStatus}`, row.platformCode && `QQ ${row.platformCode}`].filter(Boolean).join(' · ');
  const linkedSession = row.sessionId;
  const actions: MenuEntry[] = [];
  if (onReply) actions.push({ id: 'quote', label: t("引用回复") });
  if (linkedSession && openLinked) actions.push({ id: 'session', label: t("打开关联 Session") });
  if (row.text) actions.push({ id: 'source', label: showSource ? t("查看排版") : t("查看原文") });
  actions.push({ id: 'details', label: detailsOpen ? t("收起响应详情") : t("响应详情") });
  const queryReceipt = async (): Promise<void> => {
    setChecking(true);
    setReceiptNote('');
    try {
      const latest = await refreshEntry(row.id);
      if (latest?.status === 'unknown') setReceiptNote(t("记录仍未确认结果，请在 QQ 核对。"));
    } catch (error) {
      setReceiptNote(error instanceof Error ? error.message : t("无法查询发送记录。"));
    } finally {
      setChecking(false);
    }
  };
  const detail = row.inboundOutcome ? inboundLabel(row.inboundOutcome) : statusLabel('received');
  const pendingReceipt = outbound && (row.status === 'unknown' || row.status === 'sending');
  const showStatus = outbound && row.status !== 'accepted';
  const submissionFailed = !outbound && row.inboundOutcome === 'submit-failed';
  const imageCount = row.imageCount ?? 0;
  const remaining = (row.attachments ?? 0) - imageCount;
  return h('li', { className: 'imqw-timeline-row', 'data-direction': row.direction, 'data-compact': compact, 'data-entry-id': row.id },
    h('span', { className: 'imqw-message-avatar', 'aria-hidden': true }, !compact && [...sender][0]?.toUpperCase()),
    h('div', { className: 'imqw-message-body' },
      compact ? null : h('div', { className: 'imqw-timeline-meta' },
        h('strong', { title: sender }, sender), h('time', { dateTime: new Date(row.at).toISOString() }, new Intl.DateTimeFormat(locale(), { timeStyle: 'short' }).format(row.at))),
      h('div', { className: 'imqw-message-line' }, h('div', { className: 'imqw-timeline-bubble' },
        row.quote ? h('blockquote', null,
          row.quote.senderName ? h('strong', null, row.quote.senderName) : null,
          row.quote.text ? h('div', null, row.quote.displayText ?? row.quote.text) : null,
          row.quote.attachments ? h('span', { className: 'imqw-muted' }, t("引用附件 · {0} 项", row.quote.attachments)) : null) : null,
        row.text ? (showSource
          ? h('pre', { className: 'imqw-timeline-text imqw-timeline-source', 'aria-label': t("消息原文") }, row.text)
          : h(MessageMarkdown, { text: row.displayText ?? row.text, hasImage: imageCount > 0 })) : null,
        imageCount > 0 ? h('div', { className: 'imqw-message-images' },
          Array.from({ length: imageCount }, (_, index) => {
            const query = new URLSearchParams({ appId, scope, openId, entryId: row.id, image: String(index) });
            return h(MessageImage, { key: index, url: `${WORKBENCH_TIMELINE_PATH}?${query}`, number: index + 1 });
          })) : null,
        remaining > 0 ? h('div', { className: 'imqw-muted' }, row.attachmentName ? t("附件 · {0}", row.attachmentName) : t("附件 · {0} 项", remaining)) : null),
        h(Menu, {
          open: menuOpen, items: actions, portal: true, align: outbound ? 'end' : 'start', compact: true, autoFocus: true,
          onClose: () => setMenuOpen(false),
          onSelect: id => {
            setMenuOpen(false);
            if (id === 'quote') onReply?.(sender);
            if (id === 'session' && menuButton.current) void openLinked?.(row, menuButton.current);
            if (id === 'source') setShowSource(value => !value);
            if (id === 'details') setDetailsOpen(value => !value);
          },
          anchor: h(Button, { ref: menuButton, type: 'button', size: 'sm', variant: 'ghost', className: 'imqw-message-action',
            'aria-label': t("{0}的消息操作", sender), title: t("消息操作"), 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
            onClick: () => setMenuOpen(open => !open),
          }, h(IconEllipsisOutlineRegular, { size: 14 })),
        }),
      ),
      showStatus || submissionFailed ? h('div', { className: 'imqw-timeline-meta' },
        h('span', { 'data-status': submissionFailed ? 'rejected' : row.status }, submissionFailed ? detail : statusLabel(row.status)),
        pendingReceipt ? h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: checking,
          onClick: () => { void queryReceipt(); } }, checking ? t("查询中…") : t("查询回执")) : null,
      ) : null,
      detailsOpen ? h('div', { className: 'imqw-response-detail', role: 'region', 'aria-label': t("响应详情") },
        outbound
          ? h('p', null, row.source ? t("来源 · {0}", sourceLabel(row.source)) : t("来源未记录"),
            h('br'), statusLabel(row.status), errorCode ? ` · ${errorCode}` : '')
          : h('p', null, detail),
      ) : null,
      receiptNote ? h('p', { className: 'imqw-response-detail', role: 'status' }, receiptNote) : null,
    ),
  );
}

function MessageMarkdown({ text, hasImage }: { text: string; hasImage: boolean }): ReactNode {
  const language = useQqLocale();
  const faceLabel = t("QQ 表情");
  const stickerLabel = t("表情包");
  const prepared = useMemo(() => timelineMarkdown(text, { hasImage, faceLabel, stickerLabel }),
    [text, hasImage, faceLabel, stickerLabel]);
  const labels = useMemo(() => ({
    code: { copyLabel: t("复制"), copiedLabel: t("已复制") }, footnotes: t("脚注"),
  }), [language]);
  if (!prepared.trim()) return null;
  if (!MarkdownText) return h('div', { className: 'imqw-timeline-text' }, text);
  return h('div', { className: 'imqw-timeline-markdown' }, h(MarkdownText, {
    text: prepared, labels, variant: 'compact', omitHtml: true,
  }));
}

function MessageImage({ url, number }: { url: string; number: number }): ReactNode {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) return h('span', { className: 'imqw-muted' }, t("图片已过期或无法预览"));
  return h('a', { className: 'imqw-message-image', href: url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t("打开原图 {0}", number) },
    h('img', { src: url, alt: t("QQ 图片 {0}", number), loading: 'lazy', decoding: 'async', onError: () => setUnavailable(true) }));
}

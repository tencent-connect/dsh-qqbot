import {
  createElement as h, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode,
} from 'react';

type Column = 'robots' | 'tree' | 'settings';
type Widths = Record<Column, number>;

const storageKey = 'dsh-qqbot.workbench.widths.v1';
const defaults: Widths = { robots: 192, tree: 236, settings: 356 };
const minimum: Widths = { robots: 140, tree: 164, settings: 256 };
const maximum: Widths = { robots: 288, tree: 420, settings: 576 };
const columns: Column[] = ['robots', 'tree', 'settings'];
const avatarWidth = 60;
const dividerWidth = 6;
const minimumMessageWidth = 224;
const compactWidth = 920;
const singlePageWidth = 720;

function clampWidth(column: Column, value: number): number {
  return Math.max(minimum[column], Math.min(maximum[column], Math.round(value)));
}

function readWidths(): Widths {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<Widths> | null;
    const widths = { ...defaults };
    for (const column of columns) {
      const value = saved?.[column];
      if (typeof value === 'number' && Number.isFinite(value)) widths[column] = clampWidth(column, value);
    }
    return widths;
  } catch {
    return defaults;
  }
}

const columnLabels: Record<Column, string> = {
  robots: '调整机器人栏宽度', tree: '调整会话列表宽度', settings: '调整会话设置宽度',
};

interface DividerProps {
  column: Column;
  width: number;
  max: number;
  onResize: (width: number, done: boolean) => void;
}

function Divider({ column, width, max, onResize }: DividerProps): ReactNode {
  const drag = useRef<{ x: number; width: number; pointer: number; resize: DividerProps['onResize'] }>();
  const direction = column === 'settings' ? -1 : 1;
  return h('div', {
    className: 'imqw-divider', role: 'separator', tabIndex: 0,
    'aria-orientation': 'vertical', 'aria-label': columnLabels[column], 'aria-valuemin': minimum[column],
    'aria-valuemax': max, 'aria-valuenow': width,
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || drag.current) return;
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, width, pointer: event.pointerId, resize: onResize };
      event.preventDefault();
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (start?.pointer === event.pointerId) start.resize(start.width + (event.clientX - start.x) * direction, false);
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      const start = drag.current;
      if (start?.pointer !== event.pointerId) return;
      drag.current = undefined;
      start.resize(start.width + (event.clientX - start.x) * direction, true);
    },
    onLostPointerCapture: () => {
      const start = drag.current;
      if (!start) return;
      drag.current = undefined;
      start.resize(start.width, false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 8;
      const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      if (!delta) return;
      event.preventDefault();
      onResize(width + delta * direction, true);
    },
  });
}

export function useWorkbenchLayout(collapsed: boolean, treeVisible: boolean, settingsVisible: boolean) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [preferred, setPreferred] = useState(readWidths);
  const compact = width <= compactWidth;
  const singlePage = width <= singlePageWidth;
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const measure = (): void => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const iconsOnly = collapsed || compact;
  const active = columns.filter(column => {
    if (column === 'robots') return !iconsOnly;
    return treeVisible && !singlePage && (column === 'tree' || settingsVisible);
  });
  const budget = width - (iconsOnly ? avatarWidth : 0) - active.length * dividerWidth - minimumMessageWidth - 2;
  const sum = (widths: Widths): number => active.reduce((total, column) => total + widths[column], 0);
  const extras = sum(preferred) - sum(minimum);
  const scale = extras > 0 ? Math.max(0, Math.min(1, (budget - sum(minimum)) / extras)) : 1;
  const fitted = { ...preferred };
  for (const column of active) {
    fitted[column] = minimum[column] + Math.floor((preferred[column] - minimum[column]) * scale);
  }

  return {
    root, compact, singlePage, iconsOnly,
    railWidth: iconsOnly ? avatarWidth : fitted.robots,
    treeWidth: fitted.tree,
    settingsWidth: fitted.settings,
    divider(column: Column): ReactNode {
      if (!active.includes(column)) return null;
      const max = Math.max(minimum[column], Math.min(maximum[column], budget - sum(fitted) + fitted[column]));
      return h(Divider, { column, width: fitted[column], max, onResize: (nextWidth, done) => {
        const next = Math.max(minimum[column], Math.min(max, Math.round(nextWidth)));
        const widths = { ...preferred };
        if (next !== fitted[column]) {
          for (const visible of active) widths[visible] = fitted[visible];
          widths[column] = next;
        }
        setPreferred(widths);
        if (done && next !== fitted[column]) {
          try { localStorage.setItem(storageKey, JSON.stringify(widths)); } catch { /* Storage can be unavailable. */ }
        }
      } });
    },
  };
}

import { createElement as h, Fragment, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Input, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { EXTRA_MAX_CHARS } from '../prompt/extra.ts';
import { WORKBENCH_PROMPT_PATH_LIMIT, WORKBENCH_PROMPT_PREVIEW_PATH, type WorkbenchPrompt } from '../shared/workbench-agent-settings.ts';
import { fetchJson } from './http.ts';

type EditorPage = 'edit' | 'preview';
type SourceMode = 'text' | 'file';
interface PreviewJob { path: string }
type PreviewResult =
  | { job: PreviewJob; kind: 'ready'; text: string }
  | { job: PreviewJob; kind: 'error'; message: string };

export function PromptEditor({ label, value, hint, disabled, onChange }: {
  label: string;
  value: WorkbenchPrompt;
  hint?: string;
  disabled: boolean;
  onChange(value: WorkbenchPrompt): void;
}): ReactNode {
  const id = useId();
  const [page, setPage] = useState<EditorPage>('edit');
  const [job, setJob] = useState<PreviewJob>();
  const [result, setResult] = useState<PreviewResult>();
  const alternate = useRef({ text: '', path: '' });
  const path = typeof value === 'string' ? undefined : value.path;
  const activeJob = path === job?.path ? job : undefined;
  const preview = activeJob && result?.job === activeJob ? result : undefined;
  const reading = activeJob !== undefined && preview === undefined;

  useEffect(() => {
    if (!activeJob) return;
    const controller = new AbortController();
    void fetchJson<{ text: string }>(WORKBENCH_PROMPT_PREVIEW_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: activeJob.path }), signal: controller.signal,
    }).then(response => {
      if (!controller.signal.aborted) setResult({ job: activeJob, kind: 'ready', text: response.text });
    }, error => {
      if (!controller.signal.aborted) setResult({ job: activeJob, kind: 'error',
        message: error instanceof Error ? error.message : '无法预览补充提示词。' });
    });
    return () => controller.abort();
  }, [activeJob]);

  const changeSource = (mode: SourceMode): void => {
    if (mode === 'file' && typeof value === 'string') {
      alternate.current.text = value;
      onChange({ kind: 'file', path: alternate.current.path });
    } else if (mode === 'text' && typeof value !== 'string') {
      alternate.current.path = value.path;
      onChange(alternate.current.text);
    }
    setJob(undefined);
  };
  const read = (): void => {
    if (path?.trim() && !disabled && !reading) setJob({ path });
  };
  const text = typeof value === 'string' ? value : preview?.kind === 'ready' ? preview.text : undefined;
  const brace = text?.indexOf('{{') ?? -1;
  const hasVariables = text !== undefined && brace >= 0 && text.indexOf('}}', brace + 2) >= 0;

  return h('div', { className: 'imqw-prompt-fields' },
    h('div', { className: 'imqw-prompt-toolbar' },
      h(SegmentedControl<SourceMode>, {
        id: `${id}-source`, label: `${label}来源`, value: path === undefined ? 'text' : 'file', onChange: changeSource, disabled,
        options: [{ value: 'text', label: '直接输入' }, { value: 'file', label: '文件路径' }],
      }),
      path === undefined ? h(SegmentedControl<EditorPage>, {
        id, label: `${label}视图`, value: page, onChange: setPage,
        options: [{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }],
      }) : null,
    ),
    typeof value === 'string' ? h('div', { className: 'imqw-prompt-surface' },
      h('div', { role: 'tabpanel', id: `${id}-edit-panel`, 'aria-labelledby': `${id}-edit`, hidden: page !== 'edit' },
        h('textarea', { value, maxLength: EXTRA_MAX_CHARS, disabled, 'aria-label': label, placeholder: `输入${label}`,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
        })),
      h('div', { role: 'tabpanel', id: `${id}-preview-panel`, 'aria-labelledby': `${id}-preview`, hidden: page !== 'preview' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': `${label}预览`, tabIndex: 0 }, value || '暂无补充提示词。')),
    ) : h(Fragment, null,
      h('div', { className: 'imqw-prompt-path' },
        h(Input, {
          'aria-label': `${label}文件路径`, placeholder: '输入 DSH 宿主上的绝对文件路径',
          value: value.path, maxLength: WORKBENCH_PROMPT_PATH_LIMIT, disabled,
          onChange: event => { setJob(undefined); onChange({ kind: 'file', path: event.currentTarget.value }); },
          onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); read(); } },
        }),
        h(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: disabled || reading || !value.path.trim(),
          'aria-label': `预览${label}文件`, onClick: read,
        }, reading ? '正在读取…' : preview?.kind === 'ready' ? '刷新预览' : '预览文件')),
      reading ? h('p', { className: 'imqw-muted', role: 'status' }, '正在读取提示词文件…') : null,
      preview?.kind === 'ready' ? h('div', { className: 'imqw-prompt-surface' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': `${label}预览`, tabIndex: 0 }, preview.text || '文件内容为空。')) : null,
      preview?.kind === 'error' ? h('p', { className: 'imqb-error', role: 'alert' }, preview.message) : null,
    ),
    h('div', { className: 'imqw-prompt-status imqw-muted' },
      h('span', null, path === undefined ? hint : '支持 MD、TXT、DOCX。保存路径后，每次组装请求都会读取文件。'),
      text !== undefined ? h('span', null, `${text.length.toLocaleString('zh-CN')} / ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')}`) : null),
    hasVariables ? h('p', { className: 'imqw-muted' }, '含 {{…}}，DSH 会在组装提示词时解析变量。') : null,
  );
}

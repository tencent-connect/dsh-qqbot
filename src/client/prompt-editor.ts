import { t } from './qq-locale.ts';
import styles from './workbench.module.css';
import { createElement as h, Fragment, useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Input, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { EXTRA_MAX_CHARS } from '../prompt/extra.ts';
import { WORKBENCH_PROMPT_EXTENSIONS, WORKBENCH_PROMPT_PATH_LIMIT, WORKBENCH_PROMPT_PREVIEW_PATH, WORKBENCH_PROMPT_WRITE_PATH, type WorkbenchPrompt, type WorkbenchPromptPreview } from '../shared/workbench-agent-settings.ts';
import { fetchJson, HttpError } from './http.ts';
import { PromptFilePicker } from './prompt-file-picker.ts';

type EditorPage = 'edit' | 'preview';
type SourceMode = 'text' | 'file';
interface PreviewJob { path: string; edit?: boolean }
type PreviewResult =
  | { job: PreviewJob; kind: 'ready'; snapshot: WorkbenchPromptPreview }
  | { job: PreviewJob; kind: 'error'; message: string };

type TextSnapshot = Extract<WorkbenchPromptPreview, { kind: 'text' }>;
function editorTabs() {
  return [{ value: 'edit', label: t("编辑") }, { value: 'preview', label: t("预览") }] as const;
}

export function PromptEditor({ label, value, hint, disabled, openPromptFile, onChange }: {
  label: string;
  value: WorkbenchPrompt;
  hint?: string;
  disabled: boolean;
  openPromptFile?(path: string): Promise<void>;
  onChange(value: WorkbenchPrompt): void;
}): ReactNode {
  const id = useId();
  const [page, setPage] = useState<EditorPage>('edit');
  const [job, setJob] = useState<PreviewJob>();
  const [result, setResult] = useState<PreviewResult>();
  const [editing, setEditing] = useState<{ job: PreviewJob; snapshot: TextSnapshot }>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [fileError, setFileError] = useState('');
  const nativeInput = useRef<HTMLInputElement>(null);
  const hostPaths = (globalThis as { __DSH_HOST_PATHS__?: { pathFor(file: File): string } }).__DSH_HOST_PATHS__;
  const alternate = useRef({ text: '', path: '' });
  const path = typeof value === 'string' ? undefined : value.path;
  const activeJob = path === job?.path ? job : undefined;
  const preview = activeJob && result?.job === activeJob ? result : undefined;
  const reading = activeJob !== undefined && preview === undefined;

  useEffect(() => {
    if (!activeJob) return;
    const controller = new AbortController();
    void fetchJson<WorkbenchPromptPreview>(WORKBENCH_PROMPT_PREVIEW_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: activeJob.path }), signal: controller.signal,
    }).then(snapshot => {
      if (controller.signal.aborted) return;
      setResult({ job: activeJob, kind: 'ready', snapshot });
      if (activeJob.edit && snapshot.kind === 'text') setEditing({ job: activeJob, snapshot });
    }, error => {
      if (!controller.signal.aborted) setResult({ job: activeJob, kind: 'error',
        message: error instanceof Error ? error.message : t("无法预览补充提示词。") });
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
    setFileError('');
  };
  const read = (edit?: boolean): void => {
    if (path?.trim() && !disabled && !reading) {
      setFileError('');
      setJob({ path, edit });
    }
  };
  const choose = (selected: string): void => {
    setPickerOpen(false);
    const suffix = /\.[^.\\/]+$/.exec(selected)?.[0].toLowerCase() ?? '';
    if (!selected || !WORKBENCH_PROMPT_EXTENSIONS.has(suffix)) {
      setFileError(t("请选择 MD、TXT 或 DOCX 文件。"));
      return;
    }
    setFileError('');
    onChange({ kind: 'file', path: selected });
    setJob({ path: selected });
  };
  const openDocument = async (): Promise<void> => {
    if (!path || !openPromptFile || opening) return;
    setFileError('');
    setOpening(true);
    try { await openPromptFile(path.trim()); }
    catch (error) { setFileError(error instanceof Error ? error.message : t("无法打开原文件。")); }
    finally { setOpening(false); }
  };
  const text = typeof value === 'string' ? value : preview?.kind === 'ready' ? preview.snapshot.text : undefined;
  const word = /\.docx$/i.test(path?.trim() ?? '');
  const editable = /\.(md|txt)$/i.test(path?.trim() ?? '');
  const brace = text?.indexOf('{{') ?? -1;
  const hasVariables = text !== undefined && brace >= 0 && text.indexOf('}}', brace + 2) >= 0;

  return h('div', { className: 'imqw-prompt-fields' },
    h('div', { className: 'imqw-prompt-toolbar' },
      h(SegmentedControl<SourceMode>, {
        id: `${id}-source`, label: t("{0}来源", label), value: path === undefined ? 'text' : 'file', onChange: changeSource, disabled,
        options: [{ value: 'text', label: t("直接输入") }, { value: 'file', label: t("文件路径") }],
      }),
      path === undefined ? h(SegmentedControl<EditorPage>, {
        id, label: t("{0}视图", label), value: page, onChange: setPage,
        options: editorTabs(),
      }) : null,
    ),
    typeof value === 'string' ? h('div', { className: 'imqw-prompt-surface' },
      h('div', { role: 'tabpanel', id: `${id}-edit-panel`, 'aria-labelledby': `${id}-edit`, hidden: page !== 'edit' },
        h('textarea', { value, maxLength: EXTRA_MAX_CHARS, disabled, 'aria-label': label, placeholder: t("输入{0}", label),
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
        })),
      h('div', { role: 'tabpanel', id: `${id}-preview-panel`, 'aria-labelledby': `${id}-preview`, hidden: page !== 'preview' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': t("{0}预览", label), tabIndex: 0 }, value || t("暂无补充提示词。"))),
    ) : h(Fragment, null,
      h('div', { className: 'imqw-prompt-path' },
        h('div', { className: 'imqw-prompt-path-input' }, h(Input, {
          'aria-label': t("{0}文件路径", label), placeholder: t("输入 DSH 宿主上的绝对文件路径"),
          value: value.path, maxLength: WORKBENCH_PROMPT_PATH_LIMIT,
          disabled: disabled || opening,
          onChange: event => {
            setJob(undefined); setFileError(''); onChange({ kind: 'file', path: event.currentTarget.value });
          },
          onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); read(); }
          },
        })),
        hostPaths ? h('input', {
          ref: nativeInput, type: 'file', accept: [...WORKBENCH_PROMPT_EXTENSIONS].join(','), hidden: true,
          onChange: (event: ChangeEvent<HTMLInputElement>) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            const localPath = hostPaths.pathFor(file);
            if (localPath) choose(localPath);
            else setPickerOpen(true);
          },
        }) : null,
        h(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: disabled || opening,
          onClick: () => nativeInput.current ? nativeInput.current.click() : setPickerOpen(true),
        }, t("选择文件"))),
      h('div', { className: 'imqw-actions' },
        h(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: disabled || reading || !value.path.trim(),
          'aria-label': t("预览{0}文件", label), onClick: () => read(),
        }, preview?.kind === 'ready' ? t("刷新预览") : t("预览文件")),
        editable ? h(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: disabled || reading, onClick: () => read(true),
        }, t("编辑原文件")) : null,
        word ? h(Button, {
          type: 'button', size: 'sm', variant: 'outline', disabled: disabled || opening || !openPromptFile,
          onClick: () => { void openDocument(); },
          title: !openPromptFile ? t("此宿主暂不支持打开原文件。") : undefined,
        }, opening ? t("正在打开…") : t("打开原文编辑")) : null),
      pickerOpen ? h(PromptFilePicker, { fromFile: value.path, onChoose: choose, onClose: () => setPickerOpen(false) }) : null,
      editing && editing.job === activeJob ? h(PromptTextEdit, {
        path: editing.job.path, initial: editing.snapshot, onClose: () => setEditing(undefined),
        onSaved: snapshot => {
          setResult({ job: editing.job, kind: 'ready', snapshot });
          setEditing(undefined);
        },
      }) : null,
      reading ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取提示词文件…")) : null,
      preview?.kind === 'ready' ? h('div', { className: 'imqw-prompt-surface' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': t("{0}预览", label), tabIndex: 0 },
          preview.snapshot.text || t("文件内容为空。"))) : null,
      preview?.kind === 'error' || fileError ? h('p', { className: 'imqb-error', role: 'alert' },
        fileError || (preview?.kind === 'error' && preview.message)) : null,
    ),
    h('div', { className: 'imqw-prompt-status imqw-muted' },
      h('span', null, path === undefined ? hint : t("支持 MD、TXT、DOCX。保存路径后，每次组装请求都会读取文件。")),
      text !== undefined ? h('span', null, `${text.length.toLocaleString('zh-CN')} / ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')}`) : null),
    hasVariables ? h('p', { className: 'imqw-muted' }, t("含 {{…}}，DSH 会在组装提示词时解析变量。")) : null,
  );
}

function PromptTextEdit({ path, initial, onClose, onSaved }: {
  path: string;
  initial: TextSnapshot;
  onClose(): void;
  onSaved(snapshot: WorkbenchPromptPreview): void;
}): ReactNode {
  const id = useId();
  const [text, setText] = useState(initial.text);
  const [baseline, setBaseline] = useState(initial);
  const [page, setPage] = useState<EditorPage>('edit');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController>();
  useEffect(() => () => request.current?.abort(), []);

  const save = async (): Promise<void> => {
    if (request.current || conflict || text === baseline.text) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError('');
    try {
      const snapshot = await fetchJson<WorkbenchPromptPreview>(WORKBENCH_PROMPT_WRITE_PATH, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ path, revision: baseline.revision, text }),
      });
      if (!controller.signal.aborted) onSaved(snapshot);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof HttpError && error.status === 409) setConflict(true);
        setError(error instanceof Error ? error.message : t("无法保存原文件。"));
      }
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const refresh = async (): Promise<void> => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    try {
      const snapshot = await fetchJson<WorkbenchPromptPreview>(WORKBENCH_PROMPT_PREVIEW_PATH, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }), signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (snapshot.kind !== 'text') throw new Error(t("无法预览补充提示词。"));
      setBaseline(snapshot);
      setConflict(false);
      setError('');
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : t("无法预览补充提示词。"));
    } finally {
      request.current = undefined;
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  return h(Modal, {
    className: styles.dialog,
    open: true, title: t("编辑提示词原文件"), closeLabel: t("关闭"), description: path,
    onClose: () => { if (!request.current) onClose(); },
    footer: h(Fragment, null,
      h(Button, { type: 'button', variant: 'ghost', disabled: saving, onClick: onClose }, t("取消")),
      conflict ? h(Button, { type: 'button', variant: 'outline', disabled: saving, onClick: () => { void refresh(); } }, t("读取最新版本")) : null,
      h(Button, { type: 'button', variant: 'primary', disabled: saving || conflict || text === baseline.text, onClick: () => { void save(); } },
        saving ? t("正在保存…") : t("保存到原文件"))),
  }, h('div', { className: 'imqw-prompt-fields' },
    h('div', { className: 'imqw-prompt-toolbar' },
      h(SegmentedControl<EditorPage>, { id, label: t("原文件视图"), value: page, onChange: setPage, options: editorTabs() }),
      h('span', { className: 'imqw-muted' }, `${text.length.toLocaleString('zh-CN')} / ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')}`)),
    h('div', { className: 'imqw-prompt-surface imqw-prompt-document' },
      h('div', { role: 'tabpanel', id: `${id}-edit-panel`, 'aria-labelledby': `${id}-edit`, hidden: page !== 'edit' },
        h('textarea', { value: text, maxLength: EXTRA_MAX_CHARS, disabled: saving, 'aria-label': t("原文件正文"),
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.currentTarget.value) })),
      h('div', { role: 'tabpanel', id: `${id}-preview-panel`, 'aria-labelledby': `${id}-preview`, hidden: page !== 'preview' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': t("原文件编辑预览"), tabIndex: 0 }, text || t("文件内容为空。")))),
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null,
    baseline !== initial && !conflict ? h('details', null,
      h('summary', null, t("最新文件内容")),
      h('p', { className: 'imqw-muted', role: 'status' }, t("已保留草稿。请核对最新文件后再保存。")),
      h('pre', { className: 'imqw-prompt-preview', tabIndex: 0 }, baseline.text || t("文件内容为空。")),
    ) : null,
  ));
}

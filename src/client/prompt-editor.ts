import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives';
import { EXTRA_MAX_CHARS } from '../prompt/extra.ts';
import { readPromptFile } from './prompt-file.ts';

type EditorPage = 'edit' | 'preview';
type ImportDraft = { name: string; text: string };

export function PromptEditor({ label, value, hint, disabled, onChange }: {
  label: string;
  value: string;
  hint?: string;
  disabled: boolean;
  onChange(value: string): void;
}): ReactNode {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(0);
  const current = useRef({ value, disabled, onChange });
  const [page, setPage] = useState<EditorPage>('edit');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [imported, setImported] = useState('');
  const [pending, setPending] = useState<ImportDraft>();
  useLayoutEffect(() => { current.current = { value, disabled, onChange }; }, [value, disabled, onChange]);
  useEffect(() => () => { started.current++; }, []);

  const useImportedText = (draft: ImportDraft): void => {
    if (current.current.disabled) return;
    current.current.onChange(draft.text);
    setImported(`已导入 ${draft.name}`);
    setPending(undefined);
    setPage('preview');
  };
  const pick = async (file: File): Promise<void> => {
    const sequence = ++started.current;
    setReading(true);
    setError('');
    setImported('');
    try {
      const text = await readPromptFile(file);
      if (sequence !== started.current) return;
      if (current.current.disabled) {
        setError('设置正在处理中，请重新导入文件。');
        return;
      }
      const draft = { text, name: file.name };
      if (current.current.value.trim() && current.current.value !== text) setPending(draft);
      else useImportedText(draft);
    } catch (cause) {
      if (sequence === started.current) setError(cause instanceof Error ? cause.message : '无法读取文件。');
    } finally {
      if (sequence === started.current) setReading(false);
    }
  };
  const brace = value.indexOf('{{');
  const hasVariables = brace >= 0 && value.indexOf('}}', brace + 2) >= 0;
  return h('div', { className: 'imqw-prompt-fields' },
    h('div', { className: 'imqw-prompt-toolbar' },
      h(SegmentedControl<EditorPage>, {
        id, label: `${label}视图`, value: page, onChange: setPage,
        options: [{ value: 'edit', label: '编辑' }, { value: 'preview', label: '预览' }],
      }),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: disabled || reading,
        'aria-label': `从文件导入${label}`, title: '支持 MD、TXT 和 DOCX', onClick: () => fileInput.current?.click(),
      }, reading ? '正在读取…' : '导入文件'),
    ),
    h('input', { type: 'file', accept: '.md,.txt,.docx', hidden: true, ref: fileInput,
      'aria-label': `选择${label}文件`, disabled: disabled || reading,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.item(0);
        event.currentTarget.value = '';
        if (file && !disabled && !reading) void pick(file);
      },
    }),
    h('div', { className: 'imqw-prompt-surface' },
      h('div', { role: 'tabpanel', id: `${id}-edit-panel`, 'aria-labelledby': `${id}-edit`, hidden: page !== 'edit' },
        h('textarea', { value, maxLength: EXTRA_MAX_CHARS, disabled, 'aria-label': label, placeholder: `输入${label}`,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { setImported(''); onChange(event.currentTarget.value); },
        })),
      h('div', { role: 'tabpanel', id: `${id}-preview-panel`, 'aria-labelledby': `${id}-preview`, hidden: page !== 'preview' },
        h('pre', { className: 'imqw-prompt-preview', 'aria-label': `${label}预览`, tabIndex: 0 }, value || '暂无补充提示词。')),
    ),
    h('div', { className: 'imqw-prompt-status imqw-muted' },
      h('span', null, hint),
      h('span', null, `${value.length.toLocaleString('zh-CN')} / ${EXTRA_MAX_CHARS.toLocaleString('zh-CN')}`)),
    hasVariables ? h('p', { className: 'imqw-muted' }, '含 {{…}}，DSH 会在组装提示词时解析变量。') : null,
    imported ? h('p', { className: 'imqw-muted', role: 'status' }, imported) : null,
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null,
    pending ? h(Modal, { open: true, title: '替换补充提示词？', closeLabel: '关闭',
      description: `使用 ${pending.name} 的正文替换当前草稿。`,
      onClose: () => setPending(undefined),
      footer: h('div', { className: 'imqw-actions' },
        h(Button, { type: 'button', size: 'sm', variant: 'ghost', onClick: () => setPending(undefined) }, '取消'),
        h(Button, { type: 'button', size: 'sm', variant: 'primary', disabled, onClick: () => useImportedText(pending) }, '替换草稿')),
    }) : null,
  );
}

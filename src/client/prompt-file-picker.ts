import { t } from './qq-locale.ts';
import styles from './workbench.module.css';
import { createElement as h, Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { WORKBENCH_PROMPT_BROWSE_PATH, WORKBENCH_PROMPT_PATH_LIMIT, type WorkbenchPromptFiles } from '../shared/workbench-agent-settings.ts';
import { fetchJson } from './http.ts';

export function PromptFilePicker({ fromFile, onChoose, onClose }: {
  fromFile: string;
  onChoose(path: string): void;
  onClose(): void;
}): ReactNode {
  const [request, setRequest] = useState<{ directory?: string; fromFile?: string }>({ fromFile });
  const [listing, setListing] = useState<WorkbenchPromptFiles>();
  const [directory, setDirectory] = useState('');
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListing(undefined);
    setSelected('');
    setError('');
    void fetchJson<WorkbenchPromptFiles>(WORKBENCH_PROMPT_BROWSE_PATH, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: controller.signal,
    }).then(result => {
      if (controller.signal.aborted) return;
      setListing(result);
      setDirectory(result.directory);
      setLoading(false);
    }, error => {
      if (controller.signal.aborted) return;
      setError(error instanceof Error ? error.message : t("无法读取宿主目录。"));
      setLoading(false);
    });
    return () => controller.abort();
  }, [request]);

  const go = (): void => { if (directory.trim() && !loading) setRequest({ directory }); };
  return h(Modal, {
    className: styles.dialog,
    open: true, title: t("选择提示词文件"), closeLabel: t("关闭"), onClose,
    description: t("浏览 DSH 宿主上的 MD、TXT、DOCX 文件。"),
    footer: h(Fragment, null,
      h(Button, { type: 'button', variant: 'ghost', onClick: onClose }, t("取消")),
      h(Button, { type: 'button', variant: 'primary', disabled: loading || !selected,
        onClick: () => onChoose(selected),
      }, t("使用此文件"))),
  }, h('div', { className: 'imqw-prompt-browser' },
    h('div', { className: 'imqw-prompt-path' },
      h('div', { className: 'imqw-prompt-path-input' }, h(Input, {
        'aria-label': t("宿主目录路径"), placeholder: t("输入宿主目录路径"),
        value: directory, maxLength: WORKBENCH_PROMPT_PATH_LIMIT,
        onChange: event => setDirectory(event.currentTarget.value),
        onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') { event.preventDefault(); go(); }
        },
      })),
      h(Button, { type: 'button', size: 'sm', variant: 'outline', disabled: loading || !directory.trim(), onClick: go }, t("前往"))),
    h('div', { className: 'imqw-actions' },
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: loading, onClick: () => setRequest({}) }, t("主目录")),
      h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: loading || !listing?.parent,
        onClick: () => { if (listing?.parent) setRequest({ directory: listing.parent }); },
      }, t("上一级"))),
    loading ? h('p', { className: 'imqw-muted', role: 'status' }, t("正在读取目录…")) : null,
    error ? h('p', { className: 'imqb-error', role: 'alert' }, error) : null,
    listing && !loading ? h('ul', { className: 'imqw-prompt-files', 'aria-label': t("宿主目录内容") },
      ...listing.entries.map(entry => h('li', { key: entry.path },
        h(Button, { type: 'button', size: 'sm', variant: 'ghost', title: entry.name,
          'aria-pressed': entry.kind === 'file' ? selected === entry.path : undefined,
          onClick: () => {
            if (entry.kind === 'directory') setRequest({ directory: entry.path });
            else setSelected(entry.path);
          },
        }, h('span', { className: 'imqw-prompt-file-name' }, entry.name),
        entry.kind === 'directory' ? h('span', { className: 'imqw-muted' }, t("文件夹 ›")) : null))),
      listing.entries.length ? null : h('li', { className: 'imqw-muted' }, t("此目录没有可选文件。"))) : null,
    listing?.truncated && !loading ? h('p', { className: 'imqw-muted' }, t("目录内容较多。也可以直接填写文件路径。")) : null,
  ));
}

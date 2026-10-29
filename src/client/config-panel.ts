/**
 * QQ 机器人配置面板 — 必要配置的 UI 编辑
 *
 * UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
 * 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
 * Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
 * 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
 * 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
 *
 * 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
 * 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
 * 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
 *
 * 字段策略：只开放用户必要的配置；cwd 只读展示；超时与性能调优
 * 类字段走 profile patch / 环境变量。
 */
import { createElement, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { BIND_CONFIG_PATH, BIND_PROMPT_FILE_PATH } from '../shared/bind-protocol.ts';

/** 访问控制配置（与 src/config.ts 的 AccessControlConfig 对应的局部投影） */
interface AccessControlWire {
  c2cMode: 'open' | 'allowlist' | 'disabled';
  c2cAllow: string[];
  groupMode: 'open' | 'allowlist' | 'disabled';
  groupAllow: string[];
}

/** GET 回显的生效配置（appSecret 已剔除） */
type ConfigWire = {
  requireMention?: boolean;
  streaming?: boolean;
  showToolResults?: boolean;
  debug?: boolean;
  provider?: string;
  model?: string;
  preset?: string;
  groupPrompt?: string;
  directPrompt?: string;
  groupPromptMode?: 'text' | 'file';
  directPromptMode?: 'text' | 'file';
  groupPromptFile?: string;
  directPromptFile?: string;
  access?: AccessControlWire;
  cwd?: string;
};

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-qqbot-config-panel-styles';

/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
function useConfigPanelStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID) !== null) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; }
.imqb2-form-fields { display: flex; flex-direction: column; width: 100%; min-width: 0; margin: 0; padding: 0; border: 0; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */
.imqb2-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;
}
.imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.imqb2-switch:disabled { cursor: default; opacity: 0.5; }
.imqb2-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.imqb2-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: transform 120ms ease;
}
.imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
/* 输入（官方 fields.input 复刻） */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* 本地提示词文件：保持与宿主输入框和开关一致的尺寸 */
.imqb2-prompt-mode { display: inline-flex; align-items: center; gap: 8px; flex: none; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.imqb2-file-row { display: flex; align-items: center; gap: 8px; }
.imqb2-file-row .imqb2-input { flex: 1; min-width: 0; }
.imqb2-file-pick {
  box-sizing: border-box; flex: none; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; cursor: pointer;
}
.imqb2-file-pick:hover { background: var(--dsw-alias-interactive-bg-hover); }
.imqb2-file-pick:disabled { opacity: 0.4; cursor: default; }
.imqb2-file-pick:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.imqb2-file-status { overflow-wrap: anywhere; }
.imqb2-file-status--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
/* 分段控件（官方 SegmentedControl 复刻：指示器按段数/索引定位） */
.imqb2-seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-seg-indicator {
  position: absolute; top: 4px; left: 4px;
  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));
  height: calc(100% - 8px);
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}
.imqb2-seg-tab {
  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;
}
.imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-seg-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* 底栏（官方 SettingsForm.footer 复刻） */
.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
.imqb2-save {
  appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.imqb2-save:disabled { opacity: 0.4; cursor: default; }
.imqb2-save:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);
}

/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
function Switch({ checked, label, onChange }: {
  checked: boolean; label: string; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    className: 'imqb2-switch',
    onClick: () => { onChange(!checked); },
  }, createElement('span', { className: 'imqb2-switch-thumb' }));
}

/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
function Segmented({ value, options, onChange, label }: {
  value: AccessMode; options: ReadonlyArray<{ value: AccessMode; label: string }>;
  onChange: (next: AccessMode) => void; label: string;
}): ReactNode {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const trackStyle = {
    '--imqb2-seg-count': options.length,
    '--imqb2-seg-index': index,
  } as CSSProperties;
  return createElement('div', { className: 'imqb2-seg', role: 'tablist', 'aria-label': label, style: trackStyle },
    createElement('span', { className: 'imqb2-seg-indicator' }),
    options.map((o) => createElement('button', {
      key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value,
      className: 'imqb2-seg-tab', onClick: () => { onChange(o.value); },
    }, o.label)),
  );
}

/** 开关行（label 左 + Switch 右 + 可选 help） */
function SwitchRow({ label, help, checked, onChange }: {
  label: string; help?: string; checked: boolean; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Switch, { checked, label, onChange }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-help' }, help),
  );
}

/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
function FieldRow({ label, help, value, placeholder, onChange }: {
  label: string; help?: string; value: string; placeholder?: string; onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('input', {
      className: 'imqb2-input', value, placeholder, spellCheck: false,
      onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 多行文本行 */
function AreaRow({ label, help, value, rows, onChange }: {
  label: string; help?: string; value: string; rows?: number; onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('textarea', {
      className: 'imqb2-input imqb2-textarea', value, rows: rows ?? 3,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value); },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** Desktop 预加载桥仅负责由用户选择的 File 获取真实本地路径。 */
interface HostPathsBridge {
  pathFor(file: File): string;
}

function hostPathsBridge(): HostPathsBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = (window as Window & { __DSH_HOST_PATHS__?: HostPathsBridge }).__DSH_HOST_PATHS__;
  return typeof bridge?.pathFor === 'function' ? bridge : undefined;
}

type PromptFileCheck = {
  path: string;
  state: 'checking' | 'ok' | 'error';
  message: string;
};

/** 文本与文件两种来源独立保存；只把所选来源交给宿主加载。 */
function PromptField({ scopeLabel, mode, text, filePath, onModeChange, onTextChange, onFileChange }: {
  scopeLabel: string;
  mode: 'text' | 'file';
  text: string;
  filePath: string;
  onModeChange: (next: 'text' | 'file') => void;
  onTextChange: (next: string) => void;
  onFileChange: (next: string) => void;
}): ReactNode {
  const inputId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [check, setCheck] = useState<PromptFileCheck | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [checkVersion, setCheckVersion] = useState(0);
  const path = filePath.trim();
  const fileMode = mode === 'file';
  const canPickFile = hostPathsBridge() !== undefined;

  useEffect(() => {
    if (!fileMode || path.length === 0) {
      setCheck(null);
      return;
    }
    let stopped = false;
    const controller = new AbortController();
    setCheck({ path, state: 'checking', message: '正在校验文件…' });
    const timer = setTimeout(() => {
      void fetch(BIND_PROMPT_FILE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
        signal: controller.signal,
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as {
            ok?: boolean; path?: string; bytes?: number; characters?: number; error?: string;
          };
          if (stopped) return;
          if (!res.ok || body.ok !== true) {
            throw new Error(body.error ?? `文件校验失败（HTTP ${res.status}）`);
          }
          if (typeof body.path !== 'string' || typeof body.bytes !== 'number' || typeof body.characters !== 'number') {
            throw new Error('文件校验响应不完整，请稍后重试');
          }
          const name = body.path.split(/[\\/]/).pop() || body.path;
          const size = body.bytes < 1024 ? `${body.bytes} B` : `${(body.bytes / 1024).toFixed(1)} KB`;
          setCheck({
            path, state: 'ok',
            message: `已校验：${name} · ${size} · ${body.characters.toLocaleString('zh-CN')} 字符`,
          });
        })
        .catch((err: unknown) => {
          if (!stopped) {
            setCheck({ path, state: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
    }, 500);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [fileMode, path, checkVersion]);

  const currentCheck = check?.path === path ? check : null;
  const statusMessage = pickerError ?? currentCheck?.message
    ?? (path.length === 0 ? '支持 .md、.markdown 和 .txt 文件' : '正在校验文件…');
  const hasError = pickerError !== null || currentCheck?.state === 'error';

  const pickFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    // 清空原生输入，允许再次选择同一文件并重新校验。
    event.currentTarget.value = '';
    if (file === undefined) return;
    try {
      const selectedPath = hostPathsBridge()?.pathFor(file);
      if (!selectedPath) throw new Error('无法取得文件路径，请手动填写运行 Harness 的电脑上的文件路径');
      setPickerError(null);
      onFileChange(selectedPath);
      setCheckVersion((version) => version + 1);
    } catch (err: unknown) {
      setPickerError(err instanceof Error ? err.message : String(err));
    }
  };

  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('label', { className: 'imqb2-label', htmlFor: inputId }, `${scopeLabel}额外 system prompt`),
      createElement('span', { className: 'imqb2-prompt-mode' },
        createElement('span', null, '使用本地文件'),
        createElement(Switch, {
          checked: fileMode, label: `${scopeLabel}使用本地文件`,
          onChange: (next) => { setPickerError(null); onModeChange(next ? 'file' : 'text'); },
        }),
      ),
    ),
    fileMode
      ? createElement('div', { className: 'imqb2-file-row' },
          createElement('input', {
            id: inputId, className: 'imqb2-input', value: filePath, spellCheck: false, autoComplete: 'off',
            placeholder: '请选择或填写提示词文件的完整路径', 'aria-label': `${scopeLabel}提示词文件路径`,
            'aria-describedby': `${inputId}-status`, 'aria-invalid': hasError,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              setPickerError(null);
              onFileChange(event.currentTarget.value);
            },
          }),
          createElement('button', {
            type: 'button', className: 'imqb2-file-pick', disabled: !canPickFile,
            'aria-label': `${scopeLabel}选择提示词文件`,
            onClick: () => { picker.current?.click(); },
          }, '选择文件'),
          createElement('input', {
            type: 'file', hidden: true, ref: picker, accept: '.md,.markdown,.txt',
            'aria-label': `${scopeLabel}提示词文件`, onChange: pickFile,
          }),
        )
      : createElement('textarea', {
          id: inputId, className: 'imqb2-input imqb2-textarea', value: text, rows: 3,
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { onTextChange(event.currentTarget.value); },
        }),
    fileMode
      ? createElement('p', { className: 'imqb2-help' }, '文件正文将作为额外系统提示词。修改原文件后，下轮对话自动生效。')
      : null,
    fileMode && !canPickFile
      ? createElement('p', { className: 'imqb2-hint' }, '当前环境无法选择本地文件，请手动填写运行 Harness 的电脑上的文件路径。')
      : null,
    fileMode
      ? createElement('p', {
          id: `${inputId}-status`, role: 'status', 'aria-live': 'polite',
          className: `imqb2-hint imqb2-file-status${hasError ? ' imqb2-file-status--error' : ''}`,
        }, statusMessage)
      : null,
  );
}

/** 访问模式分段选择行 */
function SegmentedRow({ label, help, value, options, onChange }: {
  label: string; help?: string; value: AccessMode;
  options: ReadonlyArray<{ value: AccessMode; label: string }>; onChange: (next: AccessMode) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Segmented, { value, options, onChange, label }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

type AccessMode = AccessControlWire['c2cMode'];

const MODE_OPTIONS: ReadonlyArray<{ value: AccessMode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'disabled', label: '禁用' },
];

/** 深比较（表单值与初始回显值的 dirty 判断） */
function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 配置面板主体。
 *
 * 保存仅提交变更键（服务端按白名单合并），保存成功后提示
 * HMR 重载语义（进行中的机器人会话将重置）。
 */
export function ConfigPanel(): ReactNode {
  useConfigPanelStyles();
  const [initial, setInitial] = useState<ConfigWire | null>(null);
  const [form, setForm] = useState<ConfigWire | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    void fetch(BIND_CONFIG_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { config: ConfigWire };
        if (stopped) return;
        const config: ConfigWire = {
          ...body.config,
          groupPromptMode: body.config.groupPromptMode ?? 'text',
          directPromptMode: body.config.directPromptMode ?? 'text',
          groupPromptFile: body.config.groupPromptFile ?? '',
          directPromptFile: body.config.directPromptFile ?? '',
        };
        setInitial(config);
        setForm(config);
      })
      .catch((err: unknown) => {
        if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { stopped = true; };
  }, []);

  const patch = useCallback(<K extends keyof ConfigWire>(key: K, value: ConfigWire[K]): void => {
    setForm((current) => current === null ? current : { ...current, [key]: value });
    setResult(null);
  }, []);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (busy || initial === null || form === null) return;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(form) as Array<keyof ConfigWire>) {
      if (!shallowEqual(form[key], initial[key])) {
        changed[key] = form[key];
      }
    }
    if (Object.keys(changed).length === 0) return;

    // 白名单编辑期间保留原始换行/空行（textarea 可正常回车），提交时才规范化
    if (changed.access !== undefined) {
      const a = changed.access as AccessControlWire;
      changed.access = {
        ...a,
        c2cAllow: a.c2cAllow.map((s) => s.trim()).filter(Boolean),
        groupAllow: a.groupAllow.map((s) => s.trim()).filter(Boolean),
      };
    }

    setBusy(true);
    void fetch(BIND_CONFIG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changed),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
        if (res.ok && body.ok === true) {
          setResult({ ok: true, message: body.message ?? '配置已保存，插件将自动重载' });
          setInitial(form);
          return;
        }
        setResult({ ok: false, message: body.error ?? `保存失败（HTTP ${res.status}）` });
      })
      .catch((err: unknown) => {
        setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => { setBusy(false); });
  }, [busy, form, initial]);

  if (loadError !== null) {
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } },
      `配置加载失败：${loadError}`);
  }
  if (initial === null || form === null) {
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } }, '正在加载配置…');
  }

  const dirty = (Object.keys(form) as Array<keyof ConfigWire>).some((key) => !shallowEqual(form[key], initial[key]));
  const access: AccessControlWire = form.access ?? { c2cMode: 'open', c2cAllow: [], groupMode: 'open', groupAllow: [] };

  // 保存会触发 HMR；请求期间锁定编辑，避免新增改动被重载丢失。
  const fields = createElement('fieldset', { className: 'imqb2-form-fields', disabled: busy, 'aria-label': 'QQ 机器人设置' },
    createElement('div', { className: 'imqb2-group-title' }, '服务范围'),
    createElement(SegmentedRow, {
      label: '私聊', value: access.c2cMode, options: MODE_OPTIONS,
      onChange: (v) => { patch('access', { ...access, c2cMode: v }); },
    }),
    access.c2cMode === 'allowlist'
      ? createElement(AreaRow, {
          label: '私聊白名单', help: '请输入用户 openid，多个请换行输入', rows: 3,
          value: access.c2cAllow.join('\n'),
          onChange: (v) => { patch('access', { ...access, c2cAllow: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
    createElement(SegmentedRow, {
      label: '群聊', value: access.groupMode, options: MODE_OPTIONS,
      onChange: (v) => { patch('access', { ...access, groupMode: v }); },
    }),
    access.groupMode === 'allowlist'
      ? createElement(AreaRow, {
          label: '群聊白名单', help: '请输入群 openid，多个请换行输入', rows: 3,
          value: access.groupAllow.join('\n'),
          onChange: (v) => { patch('access', { ...access, groupAllow: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,

    createElement('div', { className: 'imqb2-group-title' }, '基础设置'),
    createElement(SwitchRow, {
      label: '群聊仅回复 @机器人的消息', checked: form.requireMention ?? true,
      help: '开启后，机器人仅可回复 @机器人的群聊消息',
      onChange: (v) => { patch('requireMention', v); },
    }),
    createElement(SwitchRow, {
      label: '流式输出', checked: form.streaming ?? true,
      help: '回复内容分段实时推送到聊天',
      onChange: (v) => { patch('streaming', v); },
    }),
    createElement(SwitchRow, {
      label: '显示工具调用结果', checked: form.showToolResults ?? false,
      help: '在聊天中展示 agent 工具调用的结构化结果',
      onChange: (v) => { patch('showToolResults', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '模型'),
    createElement(FieldRow, {
      label: 'Provider', value: form.provider ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('provider', v); },
    }),
    createElement(FieldRow, {
      label: 'Model', value: form.model ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('model', v); },
    }),
    createElement(FieldRow, {
      label: 'Preset', value: form.preset ?? '', placeholder: 'Agent preset id',
      onChange: (v) => { patch('preset', v); },
    }),

    createElement('div', { className: 'imqb2-group-title' }, '个性化提示词'),
    createElement(PromptField, {
      scopeLabel: '群聊', mode: form.groupPromptMode ?? 'text',
      text: form.groupPrompt ?? '', filePath: form.groupPromptFile ?? '',
      onModeChange: (v) => { patch('groupPromptMode', v); },
      onTextChange: (v) => { patch('groupPrompt', v); },
      onFileChange: (v) => { patch('groupPromptFile', v); },
    }),
    createElement(PromptField, {
      scopeLabel: '私聊', mode: form.directPromptMode ?? 'text',
      text: form.directPrompt ?? '', filePath: form.directPromptFile ?? '',
      onModeChange: (v) => { patch('directPromptMode', v); },
      onTextChange: (v) => { patch('directPrompt', v); },
      onFileChange: (v) => { patch('directPromptFile', v); },
    }),

    form.cwd !== undefined
      ? createElement('div', { className: 'imqb2-field' },
          createElement('div', { className: 'imqb2-head' },
            createElement('span', { className: 'imqb2-label' }, 'Agent 工作目录'),
            createElement('span', { className: 'imqb2-hint' }, '只读'),
          ),
          createElement('p', { className: 'imqb2-readonly' }, form.cwd),
        )
      : null,

    createElement('div', { className: 'imqb2-footer' },
      result !== null
        ? createElement('p', { className: `imqb2-note${result.ok ? ' imqb2-note--ok' : ' imqb2-note--error'}` },
            (result.ok ? '' : '⚠️ ') + result.message)
        : dirty
          ? createElement('p', { className: 'imqb2-note' }, '保存后插件将重载，进行中的机器人会话将重置')
          : createElement('p', { className: 'imqb2-note' }),
      createElement('button', { className: 'imqb2-save', type: 'submit', disabled: busy || !dirty },
        busy ? '正在保存…' : '保存'),
    ),
  );
  return createElement('form', { className: 'imqb2-form', onSubmit: submit }, fields);
}

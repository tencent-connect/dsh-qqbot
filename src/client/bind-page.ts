/**
 * 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
 *
 * 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
 * - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
 * - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
 * 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
 *
 * 样式为注入式 CSS 类（imqb-* 命名空间，随面板挂载注入一次）：
 * hover/过渡/focus 样式无法用 inline style 表达，统一走类；
 * 颜色尽量取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
 *
 * 同一组件复用于两种展示位（侧栏绑定页 / 设置页 QQ Bot 栏目）。
 * 运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走同源 fetch，
 * Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
 */
import { createElement, useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BIND_MANUAL_PATH,
  BIND_REFRESH_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  type BindStateWire,
} from '../shared/bind-protocol.ts';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { fetchJson } from './http.ts';

/** 轮询间隔（毫秒）：活跃轮询 / 失败退避 */
const ACTIVE_POLL_MS = 2000;
const RETRY_POLL_MS = 3000;

/** 样式注入标记（幂等） */
const STYLE_ID = 'im-qqbot-bind-panel-styles';

/**
 * 注入面板样式（全局一次，幂等）。交互态（hover/active/focus）无法用 inline
 * style 表达，统一收敛到类；DSW 主题变量缺失时用中性值兜底。
 * 插件激活时即安装：插件详情按钮渲染在面板之外，需提前可见；
 * 安装后不再随挂载移除，避免多个展示位互相清掉样式。
 */
export function installPanelStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.imqb-panel {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 24px 16px; text-align: center; font-size: 13px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-title { margin: 0; font-size: 16px; font-weight: 600; }
.imqb-hint { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
.imqb-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.imqb-link { font-size: 12px; color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 3px; }
.imqb-link:hover { text-decoration: underline; }
.imqb-icon { font-size: 32px; line-height: 1; }
.imqb-qr { box-sizing: content-box; border-radius: var(--dsw-radius-md); padding: 8px; max-width: calc(100% - 16px); height: auto; }
.imqb-row { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
/* 主面板页面容器（layout.selectPanel 目标）：滚动 + 留白 */
.imqb-pluginPage {
  height: 100%; min-height: 0; overflow: auto; box-sizing: border-box;
  padding: 24px clamp(16px, 4vw, 48px) 32px;
  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family);
}
.imqb-pluginPageContent { max-width: 680px; margin: 0 auto; }
.imqb-pageTitle { margin: 0 0 12px; font-size: 20px; line-height: 1.5; font-weight: 600; }
.imqb-pageDescription { margin: 0 0 16px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.imqb-form { display: flex; flex-direction: column; gap: 12px; width: min(320px, 100%); box-sizing: border-box; }
.imqb-credentialsModal { width: min(440px, 100%); max-height: 100%; overflow-y: auto; }
.imqb-form--credentials { width: 100%; gap: 16px; }
.imqb-form--credentials .imqb-field { gap: 6px; line-height: 1.5; }
.imqb-form--credentials .imqb-field > span { box-sizing: border-box; }
.imqb-field { display: flex; flex-direction: column; gap: 5px; text-align: left; font-size: 13px; }
.imqb-error { margin: 0; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--dsw-alias-state-error-primary); }
/* 紧凑状态视图（已绑定 / 过渡态）：设置行风格，无居中大卡留白 */
.imqb-status { display: flex; flex-direction: column; text-align: left; font-size: 13px; color: var(--dsw-alias-label-primary); }
.imqb-status-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-status-icon { font-size: 24px; line-height: 1; flex: none; }
.imqb-qqicon {
  flex: none; display: block; border-radius: 8px; /* 透明底，QQ 蓝徽标在明暗主题下均清晰 */
}
.imqb-status-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.imqb-status-title { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.5; }
.imqb-status-sub { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.imqb-status-actions { display: flex; align-items: center; gap: 8px; padding: 4px 0 12px; }
.imqb-account {
  display: flex; align-items: center; flex-wrap: wrap; column-gap: 24px;
  border-bottom: .5px solid var(--dsw-alias-border-l2); padding-bottom: 12px;
}
.imqb-account > .imqb-status-row { flex: 1 1 240px; min-width: 0; }
.imqb-account > .imqb-status-actions { padding: 12px 0; flex-wrap: wrap; }
/* 扫码成功后的连接过渡：二维码模糊变暗 + 覆盖层 */
.imqb-scanned { position: relative; display: inline-block; }
.imqb-scanned-qr {
  display: block; border-radius: var(--dsw-radius-md); padding: 8px;
  filter: blur(6px) saturate(0.6); opacity: 0.55;
}
.imqb-scanned-veil {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px; text-align: center;
}
.imqb-scanned-title { margin: 0; font-size: 15px; font-weight: 600; }
.imqb-scanned-sub { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.6; }
    `;
  style.textContent += `\n.imqb-danger { color: var(--dsw-alias-state-error-primary); }
.imqb-field > span { width: 100%; }
.imqb-cards { display: flex; flex-direction: column; gap: 20px; }
.imqb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 16px 16px; background: var(--dsw-alias-bg-layer-1); }
.imqb-cardTitle { margin: 14px 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb-cardHint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }`;
  document.head.appendChild(style);
}

function usePanelStyles(): void {
  useEffect(() => { installPanelStyles(); }, []);
}

/**
 * 绑定状态轮询 hook。
 *
 * 404 语义分两种：从未拿到过路由 = 插件未启用（终态）；
 * 曾经拿到过 = HMR 重载窗口期（manual/unbind 保存后路由短暂消失），
 * 低频等待恢复而不是判定终态——否则保存成功提示会被
 * 「插件未启用」覆盖且无法自愈。
 *
 * bound 为稳定态：轮询大幅降频（30s）。因此解绑等本地动作后必须
 * 调用 recheck() 立即重置节拍——否则视图最长停留 30s+ 才收敛到
 * 新相位（如解绑后的 waiting 二维码）。
 *
 * @returns 轮询快照与 recheck：state 为宿主相位（null = 加载中），
 *          gone 表示插件未启用（从未注册过路由），recheck 废弃当前
 *          定时器并立即重新轮询（新轮询链取代旧链，不产生双计时器）。
 */
export function useBindState(enabled = true): { state: BindStateWire | null; gone: boolean; error: string | null; recheck: () => void } {
  const [state, setState] = useState<BindStateWire | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheckRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const controller = new AbortController();
    let sawRoute = false;
    let generation = 0;
    let running = false;
    let restartAfterFlight = false;
    // recheck 后的快速收敛窗口：解绑等动作改变的是服务端状态（经
    // HMR 异步生效），动作后立即轮询拿到的可能仍是旧 fiber 的相位
    // （如 bound→30s 降频），窗口期内强制快轮询直到相位真正变化
    let urgentUntil = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number): void => {
      timer = setTimeout(() => { void tick(); }, ms);
    };

    const intervalFor = (phase: BindStateWire['phase']): number => {
      const base = phase === 'saving' ? 500 : phase === 'bound' ? 30000 : ACTIVE_POLL_MS;
      return Date.now() < urgentUntil ? Math.min(base, ACTIVE_POLL_MS) : base;
    };

    const tick = async (): Promise<void> => {
      if (stopped || running) return;
      running = true;
      const myGeneration = generation;
      const alive = (): boolean => myGeneration === generation && !stopped;
      try {
        const body = await fetchJson<BindStateWire>(BIND_STATE_PATH, { cache: 'no-store', signal: controller.signal });
        sawRoute = true;
        if (!alive()) return;
        setGone(false);
        setError(null);
        setState(body);
        schedule(intervalFor(body.phase));
        return;
      } catch (cause) {
        if (alive()) {
          const message = cause instanceof Error ? cause.message : '无法获取绑定状态';
          setError(message);
          if (!sawRoute && message.includes('HTTP 404')) setGone(true);
        }
      } finally {
        running = false;
        // 在飞期间被 recheck 取代：接力启动新轮询链（否则链会断）
        if (restartAfterFlight && !stopped) {
          restartAfterFlight = false;
          void tick();
        }
      }
      if (alive()) schedule(RETRY_POLL_MS);
    };

    // 立即重置节拍：废弃当前计时器，旧轮询链（在飞请求）作废，
    // 新链立即发起，并进入快速收敛窗口
    recheckRef.current = (): void => {
      generation += 1;
      setGone(false);
      setError(null);
      urgentUntil = Date.now() + 15000;
      if (timer !== undefined) clearTimeout(timer);
      if (running) {
        restartAfterFlight = true;
        return;
      }
      void tick();
    };

    void tick();
    return () => { stopped = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [enabled]);

  const recheck = useCallback((): void => { recheckRef.current(); }, []);

  return { state, gone, error, recheck };
}

interface ManualResult { ok: boolean; message?: string; error?: string }

/** 手动提交凭据（填写 / 更换共用） */
export async function submitManualCredentials(appId: string, appSecret: string): Promise<ManualResult> {
  try {
    const body = await fetchJson<ManualResult>(BIND_MANUAL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId, appSecret }),
    });
    return body.ok ? { ok: true, message: body.message } : { ok: false, error: body.error ?? '保存失败，请重试' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 手动凭据表单（填写 / 更换共用）。
 *
 * appSecret 永不回显（占位符提示），提交成功后展示保存结果；
 * 宿主写入 profile patch 并经 HMR 重载，状态轮询随后收敛为 bound。
 */
function ManualForm({ initialAppId, recheck, onCancel }: { initialAppId?: string; recheck: () => void; onCancel?: () => void }): ReactNode {
  const formId = useId();
  const [appId, setAppId] = useState(initialAppId ?? '');
  const [appSecret, setAppSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ManualResult | null>(null);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    const trimmedId = appId.trim();
    const trimmedSecret = appSecret.trim();
    if (trimmedId.length === 0 || trimmedSecret.length === 0) {
      setResult({ ok: false, error: '请填写 AppID 和 AppSecret。' });
      return;
    }
    setBusy(true);
    setResult(null);
    void submitManualCredentials(trimmedId, trimmedSecret).then((outcome) => {
      setResult(outcome);
      if (outcome.ok) {
        setAppSecret('');
        recheck();
      }
      setBusy(false);
    });
  }, [appId, appSecret, busy, recheck]);

  const saveButton = createElement(Button, {
    key: 'save', variant: 'primary', size: 'sm', type: 'submit', form: formId,
    disabled: busy || !appId.trim() || !appSecret.trim(),
  }, busy ? '正在保存…' : onCancel ? '保存凭据' : '保存');

  const content = result !== null && result.ok
    ? createElement('div', { className: 'imqb-status', role: 'status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-icon' }, '✅'),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, result.message ?? '凭据已保存'),
          createElement('p', { className: 'imqb-status-sub' }, '插件将自动重载，连接结果可在左侧 QQ 导航底部查看'),
        ),
        createElement(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: recheck }, '刷新状态'),
      ),
    )
    : createElement('form', {
      id: formId, className: `imqb-form${onCancel ? ' imqb-form--credentials' : ''}`,
      onSubmit: submit, 'aria-busy': busy,
    },
    createElement('label', { className: 'imqb-field' },
      'AppID',
      createElement(Input, {
        value: appId, placeholder: 'QQ 机器人 AppID',
        disabled: busy,
        onChange: (event) => { setAppId(event.currentTarget.value); },
        autoComplete: 'off', spellCheck: false, required: true,
      }),
    ),
    createElement('label', { className: 'imqb-field' },
      'AppSecret',
      createElement(Input, {
        type: 'password', value: appSecret,
        disabled: busy,
        placeholder: initialAppId === undefined ? 'QQ 机器人 AppSecret' : '输入新的 AppSecret',
        onChange: (event) => { setAppSecret(event.currentTarget.value); },
        autoComplete: 'new-password', required: true,
        ...(onCancel ? { 'data-modal-autofocus': true } : {}),
      }),
    ),
    result !== null && !result.ok
      ? createElement('p', { className: 'imqb-error', role: 'alert' }, result.error)
      : null,
    onCancel ? null : saveButton,
  );

  if (!onCancel) return content;
  return createElement(Modal, {
    open: true, title: '更换凭据', closeLabel: '关闭更换凭据',
    className: 'imqb-credentialsModal',
    description: '填写 QQ 机器人凭据，保存后将重新连接。已有 AppSecret 不会回显。',
    onClose: () => { if (!busy) onCancel(); },
    children: content,
    footer: result?.ok
      ? createElement(Button, { type: 'button', variant: 'primary', size: 'sm', onClick: onCancel }, '完成')
      : [
        createElement(Button, { key: 'cancel', type: 'button', variant: 'outline', size: 'sm', disabled: busy, onClick: onCancel }, '取消'),
        saveButton,
      ],
  });
}

/** QQ 机器人 logo 路径（assets/icons/qqbot_logo.svg，内嵌以保持 bundle 自包含） */
export const QQ_BOT_LOGO_PATH =
  'M19.3862 15.5001C19.3861 11.4203 16.0789 8.11296 11.999 8.11292C7.91915 8.11292 4.61203 11.4203 4.61182 15.5001V17.0001C4.61182 18.5949 5.90429 19.8873 7.49902 19.8873H16.499C18.0937 19.8873 19.3862 18.5949 19.3862 17.0001V15.5001ZM10.6118 14.0001C10.6118 14.6145 10.1129 15.1134 9.49853 15.1134C8.8843 15.1132 8.38672 14.6144 8.38672 14.0001V12.0006C8.38672 11.3863 8.8843 10.8875 9.49853 10.8873C10.1129 10.8873 10.6118 11.3862 10.6118 12.0006V14.0001ZM15.6113 14.0001C15.6113 14.6143 15.1136 15.1131 14.4995 15.1134C13.8851 15.1134 13.3862 14.6145 13.3862 14.0001V12.0006C13.3862 11.3862 13.8851 10.8873 14.4995 10.8873C15.1136 10.8876 15.6113 11.3864 15.6113 12.0006V14.0001ZM14.2607 3.04895C14.2607 3.89351 13.7957 4.62474 13.1108 5.0133V5.95374C17.8958 6.50514 21.6112 10.5676 21.6113 15.5001V17.0001C21.6113 19.8237 19.3225 22.1124 16.499 22.1124H7.49902C4.67546 22.1124 2.38672 19.8237 2.38672 17.0001V15.5001C2.38691 10.568 6.10139 6.50571 10.8857 5.95374V5.01185C10.2017 4.62305 9.73583 3.89286 9.73583 3.04895C9.73609 1.79961 10.7496 0.787231 11.999 0.787231C13.2484 0.787297 14.2605 1.79966 14.2607 3.04895Z';

/** QQ 机器人图标（logo 矢量渲染，透明底，随 size 缩放） */
function QqBotIcon({ size = 28 }: { size?: number }): ReactNode {
  return createElement('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    'aria-hidden': true, className: 'imqb-qqicon',
  },
    createElement('path', { d: QQ_BOT_LOGO_PATH, fill: 'currentColor' }),
  );
}
/** 已绑定视图：回显 appId + 更换凭据 / 解绑入口 */
function BoundView({ appId, recheck }: { appId: string; recheck: () => void }): ReactNode {
  const [editing, setEditing] = useState(false);
  const [confirmUnbind, setConfirmUnbind] = useState(false);
  const [unbindResult, setUnbindResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const unbind = useCallback((): void => {
    if (busy) return;
    setConfirmUnbind(false);
    setBusy(true);
    setUnbindResult(null);
    void fetchJson<{ ok?: boolean; message?: string; error?: string }>(BIND_UNBIND_PATH, { method: 'POST' })
      .then((body) => {
        if (body.ok === true) {
          setUnbindResult({ ok: true, message: body.message ?? '已解绑，插件将重载并重新进入绑定流程' });
          // bound 态轮询已降频到 30s：立即重置节拍，让 waiting（二维码）
          // 尽快出现而不是等下一个 30s 周期
          recheck();
          return;
        }
        setUnbindResult({ ok: false, message: body.error ?? '解绑失败，请重试' });
      })
      .catch((err: unknown) => {
        setUnbindResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => { setBusy(false); });
  }, [recheck, busy]);

  if (unbindResult?.ok === true) {
    // 非终态视图：解绑成功后正常由轮询收敛到 waiting；若 HMR 未
    // 触发（状态停留 bound），用户仍有「刷新状态」出口而不是死胡同
    return createElement('div', { className: 'imqb-status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-icon' }, '👋'),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, unbindResult.message),
        ),
        createElement(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: recheck }, '刷新状态'),
      ),
    );
  }

  return createElement('div', { className: 'imqb-status' },
    createElement('div', { className: 'imqb-account' },
      createElement('div', { className: 'imqb-status-row' },
        createElement(QqBotIcon, { size: 28 }),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, '凭据已保存'),
          createElement('p', { className: 'imqb-status-sub imqb-mono' }, `AppID ${appId}`),
        ),
      ),
      createElement('div', { className: 'imqb-status-actions' },
        createElement(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: busy, onClick: () => { setEditing(true); } }, '更换凭据'),
        createElement(Button, { type: 'button', variant: 'outline', size: 'sm', className: 'imqb-danger', disabled: busy, onClick: () => setConfirmUnbind(true) }, busy ? '正在解绑…' : '解绑'),
      ),
    ),
    unbindResult !== null && !unbindResult.ok
      ? createElement('p', { className: 'imqb-error', role: 'alert' }, unbindResult.message) : null,
    editing ? createElement(ManualForm, { initialAppId: appId, recheck, onCancel: () => setEditing(false) }) : null,
    createElement(Modal, { open: confirmUnbind, onClose: () => setConfirmUnbind(false), title: '解绑 QQ 机器人', closeLabel: '关闭', description: '清除本机保存的 QQ 凭据并重载连接，随后进入扫码绑定。会话历史保留；此操作不会移出 QQ 群或删除平台侧关系。', footer: createElement('div', { className: 'imqb-row' }, createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setConfirmUnbind(false) }, '取消'), createElement(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: unbind }, '确认解绑')) }),
  );
}

/** 未绑定视图：扫码 / 手动填写切换 */
function UnboundView({ state, recheck }: { state: Extract<BindStateWire, { phase: 'waiting' }>; recheck: () => void }): ReactNode {
  const [mode, setMode] = useState<'qr' | 'manual'>('qr');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void fetchJson<{ ok?: boolean }>(BIND_REFRESH_PATH, { method: 'POST' })
      .then(() => { recheck(); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : '刷新失败，请重试'); })
      .finally(() => { setBusy(false); });
  }, [busy, recheck]);

  if (mode === 'manual') {
    return createElement('div', { className: 'imqb-panel' },
      createElement('p', { className: 'imqb-title' }, '手动填写凭据'),
      createElement(ManualForm, { recheck }),
      createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { setMode('qr'); } }, '改用扫码绑定'),
    );
  }

  return createElement('div', { className: 'imqb-panel' },
    state.qrSvg === undefined
      ? null
      : createElement('img', { src: state.qrSvg, alt: 'QQ 扫码二维码', width: 220, height: 220, className: 'imqb-qr' }),
    createElement('p', { className: 'imqb-title' }, '扫码绑定 QQ 机器人'),
    createElement('p', { className: 'imqb-hint' }, '使用手机 QQ 扫描二维码完成绑定'),
    createElement('a', { href: state.url, target: '_blank', rel: 'noreferrer noopener', className: 'imqb-link' }, '二维码显示异常？在浏览器中打开'),
    createElement('div', { className: 'imqb-row' },
      createElement(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: refresh }, busy ? '正在刷新…' : '刷新二维码'),
      createElement(Button, { variant: 'outline', size: 'sm', onClick: () => { setMode('manual'); } }, '手动填写'),
    ),
    error ? createElement('p', { className: 'imqb-error', role: 'alert' }, error) : null,
  );
}

function FailedView({ reason, recheck }: { reason: string; recheck: () => void }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void fetchJson(BIND_REFRESH_PATH, { method: 'POST' })
      .then(() => { recheck(); })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : '刷新失败，请重试'); })
      .finally(() => { setBusy(false); });
  };
  return createElement('div', { className: 'imqb-panel' },
    createElement('p', { className: 'imqb-title' }, '绑定失败'),
    createElement('p', { className: 'imqb-hint' }, reason),
    createElement(Button, { type: 'button', variant: 'primary', size: 'sm', disabled: busy, onClick: retry }, busy ? '正在刷新…' : '重新获取二维码'),
    error ? createElement('p', { className: 'imqb-error', role: 'alert' }, error) : null,
  );
}

/** 依据宿主相位渲染面板主体（可注入共享轮询结果避免双计时器） */
interface BindPanelBodyProps {
  state?: BindStateWire | null;
  gone?: boolean;
  recheck?: () => void;
  error?: string | null;
}

export function BindPanelBody(props: BindPanelBodyProps = {}): ReactNode {
  usePanelStyles();
  const injected = props.state !== undefined;
  const internal = useBindState(!injected);
  const state = injected ? (props.state ?? null) : internal.state;
  const gone = injected ? (props.gone ?? false) : internal.gone;
  const recheck = injected ? (props.recheck ?? (() => {})) : internal.recheck;
  const error = injected ? props.error : internal.error;
  // 扫码成功的连接过渡场景需要保留最后一帧二维码：waiting 相位持续记录，
  // bound 后清空（避免下次解绑重绑时旧码闪现）
  const [lastQr, setLastQr] = useState<string | null>(null);
  useEffect(() => {
    if (state === null) return;
    if (state.phase === 'waiting') {
      if (state.qrSvg !== undefined) setLastQr(state.qrSvg);
    } else if (state.phase === 'bound') {
      setLastQr(null);
    }
  }, [state]);

  if (gone) {
    return createElement('div', { className: 'imqb-panel' },
      createElement('div', { className: 'imqb-icon' }, '❔'),
      createElement('p', { className: 'imqb-hint' }, '插件未启用，或当前版本不支持端内配置'),
      createElement(Button, { variant: 'outline', size: 'sm', onClick: recheck }, '重新读取绑定状态'),
    );
  }

  if (state === null || state.phase === 'starting') {
    return createElement('div', { className: 'imqb-panel' },
      createElement('p', { className: error ? 'imqb-error' : 'imqb-hint', role: 'status' }, error ?? '正在获取绑定状态…'),
      error ? createElement(Button, { variant: 'outline', size: 'sm', onClick: recheck }, '重试读取绑定状态') : null,
    );
  }

  if (state.phase === 'saving') {
    // 扫码路径：保留二维码做模糊过渡（手动填写路径无二维码，用紧凑态）
    if (lastQr !== null) {
      return createElement('div', { className: 'imqb-panel' },
        createElement('div', { className: 'imqb-scanned' },
          createElement('img', { src: lastQr, alt: 'QQ 扫码二维码', width: 220, height: 220, className: 'imqb-scanned-qr' }),
          createElement('div', { className: 'imqb-scanned-veil' },
            createElement('p', { className: 'imqb-scanned-title' }, '✅ 扫码成功'),
            createElement('p', { className: 'imqb-scanned-sub' }, '正在保存凭据…'),
          ),
        ),
      );
    }
    return createElement('div', { className: 'imqb-status' },
      createElement('div', { className: 'imqb-status-row' },
        createElement('div', { className: 'imqb-status-icon' }, '🎉'),
        createElement('div', { className: 'imqb-status-meta' },
          createElement('p', { className: 'imqb-status-title' }, '扫码成功'),
          createElement('p', { className: 'imqb-status-sub' }, '凭据已保存，正在重新加载连接'),
        ),
      ),
    );
  }

  if (state.phase === 'failed') {
    return createElement(FailedView, { reason: state.reason, recheck });
  }

  if (state.phase === 'bound') {
    return createElement(BoundView, { key: state.appId, appId: state.appId, recheck });
  }

  return createElement(UnboundView, { state, recheck });
}

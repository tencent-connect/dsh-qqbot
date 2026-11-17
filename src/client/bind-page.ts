/**
 * 端内绑定面板 — 扫码 / 手动填写 / 已绑定编辑
 *
 * 宿主插件注册 /qqbot/im-qqbot/bind 路由（待绑定与已绑定 fiber 均常驻）：
 * - 未绑定：waiting（二维码）/ starting / saving / failed 相位 + manual 提交
 * - 已绑定：bound 相位（回显脱敏 appId，secret 不回传）+ manual 更换 + 解绑
 * 扫码成功或手动保存均写入 profile patch 并经 HMR 重载生效。
 *
 * 状态来自共享 store（store.ts，全插件单一轮询器）；样式为引用计数注入的
 * imqb-* 类（styles.ts）。同一组件复用于全部展示位（侧栏绑定页 / 设置页 /
 * 主面板）。运行时仅依赖 react（dsh 客户端平台种子表提供）；宿主通信走
 * 同源 fetch，Desktop 下由壳的 IPC 桥自动附加 Host 认证转发。
 */
import { createElement, useCallback, useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { BindStateWire } from '../shared/bind-protocol.ts';
import { BIND_METHODS, BIND_RPC_ENDPOINT } from '../shared/rpc-protocol.ts';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { rpcCall } from './rpc.ts';
import { getBindSnapshot, recheckBindState, subscribeBindStore, type BindSnapshot } from './store.ts';
import { useBindPanelStyles } from './styles.ts';

/**
 * 绑定状态订阅：全部展示位共享 store 的单一轮询器（引用计数，首个订阅
 * 启动、最后一个退订停止）。404 双语义 / recheck 快速收敛窗口等行为契约
 * 见 store.ts 与 store.test.ts。
 */
export function useBindState(): BindSnapshot {
  return useSyncExternalStore(subscribeBindStore, getBindSnapshot);
}

interface ManualResult { ok: boolean; message?: string; error?: string }

/** 手动提交凭据（填写 / 更换共用） */
export async function submitManualCredentials(appId: string, appSecret: string): Promise<ManualResult> {
  try {
    const body = await rpcCall<ManualResult>(BIND_RPC_ENDPOINT, BIND_METHODS.manual, { appId, appSecret });
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
    void rpcCall<{ ok?: boolean; message?: string; error?: string }>(BIND_RPC_ENDPOINT, BIND_METHODS.unbind)
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
    void rpcCall<{ ok?: boolean }>(BIND_RPC_ENDPOINT, BIND_METHODS.refresh)
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
    void rpcCall(BIND_RPC_ENDPOINT, BIND_METHODS.refresh)
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

/** 依据宿主相位渲染面板主体（状态来自共享 store，全插件单一轮询器） */
export function BindPanelBody(): ReactNode {
  useBindPanelStyles();
  const { state, gone, error } = useBindState();
  const recheck = recheckBindState;
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

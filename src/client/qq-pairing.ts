/**
 * 配对码认领 UI —— Web 侧生成一次性码、展示已认领成员、撤销。
 *
 * 流程：Web 生成码 → 用户在 QQ 直接发送该码 → 机器人识别并写名单。
 * 本组件只负责 Web 端的码展示与已认领列表；真正的 openid 绑定在服务端完成。
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import { fetchJson } from './http.ts';
import {
  PAIR_ISSUE_PATH, PAIR_MANUAL_PATH, PAIR_RENAME_PATH, PAIR_REVOKE_PATH, PAIR_STATUS_PATH,
  type ClaimedMember, type PairPurpose, type PairStatusWire,
} from '../shared/pairing-protocol.ts';

/** 配对状态轮询间隔（进行中的码需要实时反映"已认领"）。 */
const POLL_MS = 2000;

function usePairStatus(active: boolean): { status: PairStatusWire | null; error: string | null; reload: () => void } {
  const [status, setStatus] = useState<PairStatusWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const load = (): void => { void fetchJson<PairStatusWire>(PAIR_STATUS_PATH, { cache: 'no-store' }).then((s) => { if (!stopped) { setStatus(s); setError(null); } }).catch((c: unknown) => {
      if (stopped) return;
      const msg = c instanceof Error ? c.message : '';
      // 未绑定态该路由未注册（404）：当作"暂无"，不显示红色错误。
      if (/404|未绑定|not found/i.test(msg)) { setStatus({ challenges: [], owners: [], allowC2c: [], allowGroup: [] }); setError(null); return; }
      setError(msg || '读取认领状态失败');
    }); };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [active, tick]);
  return { status, error, reload };
}

/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
export function PairClaimPanel({ purpose, title, hint, enabled = true }: {
  purpose: PairPurpose; title: string; hint?: string; enabled?: boolean;
}): ReactNode {
  const { status, error, reload } = usePairStatus(enabled);
  const members: ClaimedMember[] = status === null ? [] : purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [manualOpenid, setManualOpenid] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<{ openid: string; nickname: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyPairCode = useCallback(async (value: string): Promise<void> => {
    try { await (globalThis.navigator?.clipboard?.writeText?.(value) ?? Promise.reject(new Error('no clipboard'))); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* 剪贴板不可用时静默：码本身可见可手抄 */ }
  }, []);

  // 该码"曾在轮询中出现过、之后又消失"才算认领成功（否则刚生成的瞬间会被误判）。
  const codeSeen = useRef(false);
  useEffect(() => {
    if (code === null || status === null) { codeSeen.current = false; return; }
    const present = status.challenges.some((c) => c.code === code.code);
    if (present) { codeSeen.current = true; return; }
    if (codeSeen.current) {
      codeSeen.current = false;
      const expired = Date.now() > code.expiresAt;
      setCode(null);
      if (expired) { setMsg('配对码已过期，请重新生成'); }
      else { setMsg('该配对码已被认领 ✔'); setAddOpen(false); }
    }
  }, [status, code]);

  // 所有 hooks 之后再按绑定态短路，避免 hook 数量不一致（React #310）。
  if (!enabled) return h('div', { className: 'imqc-pair' }, h('div', { className: 'imqc-inline' }, h('strong', null, title)),
    h('p', { className: 'imqc-hint' }, '先完成 QQ 机器人绑定，才能配置认领。'));

  const issue = (): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void fetchJson<{ code: string; expiresAt: number }>(PAIR_ISSUE_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose }) })
      .then((r) => { setCode({ code: r.code, expiresAt: r.expiresAt }); reload(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '生成配对码失败'))
      .finally(() => setBusy(false));
  };
  const revoke = (openid: string): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void fetchJson(PAIR_REVOKE_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose, openid }) })
      .then(() => reload())
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '移除失败'))
      .finally(() => setBusy(false));
  };

  const saveRename = (openid: string, nickname: string): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void fetchJson(PAIR_RENAME_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openid, nickname }) })
      .then(() => { setEditing(null); reload(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '修改失败'))
      .finally(() => setBusy(false));
  };
  const addManual = (): void => {
    if (busy || !manualOpenid.trim()) return;
    setBusy(true); setMsg(null);
    void fetchJson<{ message?: string; added?: number }>(PAIR_MANUAL_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose, openid: manualOpenid }) })
      .then((r) => { setManualOpenid(''); setMsg(r.message ?? '已添加 ✔'); reload(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '添加失败'))
      .finally(() => setBusy(false));
  };
  const secs = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)) : 0;
  const openAdd = (): void => { setAddOpen(true); setMsg(null); if (code === null) issue(); };
  return h('div', { className: 'imqc-pair' },
    h('div', { className: 'imqc-inline' }, h('strong', null, title), h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: openAdd }, '添加…')),
    hint ? h('p', { className: 'imqc-hint' }, hint) : null,
    msg ? h('p', { className: 'imqc-hint', role: 'status' }, msg) : null,
    error ? h('p', { className: 'imqc-error', role: 'alert' }, error) : null,
    members.length === 0
      ? h('p', { className: 'imqc-hint' }, '尚未添加任何成员。')
      : h('ul', { className: 'imqc-pairMembers' }, ...members.map((m) => {
          const isEditing = editing?.openid === m.openid;
          return h('li', { className: 'imqc-pairMember', key: `${m.openid}:${m.scene}` },
            h('div', { className: 'imqc-pairMemberMain' },
              h('span', { className: 'imqc-pairMemberName' }, m.nickname || '（未命名）'),
              h('span', { className: 'imqc-pairMemberMeta' },
                m.scene === 'group' ? '群' : `私聊${m.sceneName ? `「${m.sceneName}」` : ''}`)),
            isEditing
              ? h('div', { className: 'imqc-inline imqc-pairMemberEdit' },
                  h(Input, { value: editing.nickname, disabled: busy, placeholder: '昵称', 'aria-label': '修改昵称', onChange: (e: { currentTarget: { value: string } }) => setEditing({ openid: m.openid, nickname: e.currentTarget.value }) }),
                  h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => saveRename(m.openid, editing.nickname) }, '保存'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing(null) }, '取消'))
              : h('div', { className: 'imqc-inline imqc-pairMemberActions' },
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing({ openid: m.openid, nickname: m.nickname }) }, '改名'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => revoke(m.openid) }, '移除')));
        })),
    addOpen ? h(Modal, {
      open: true, title: `添加${title}`, closeLabel: '关闭', onClose: () => setAddOpen(false), className: 'imqc-pairModal',
      children: h('div', { className: 'imqc imqc-pairDialog' },
        h('h4', { className: 'imqc-pairSectionTitle' }, '方式一 · 让对方在 QQ 认领（推荐）'),
        h('ol', { className: 'imqc-pairSteps' },
          h('li', null, '下面生成一次性配对码；'),
          h('li', null, `让对方在${purpose === 'allow-group' ? '群里 @ 机器人后' : '私聊里'}直接发送这个码：`),
          h('li', null, '机器人会自动匹配 TA 的昵称与 openID，并弹出「确认/取消」，点「确认」后加入。')),
        code ? h('div', { className: 'imqc-pairCodeCard' },
          h('div', { className: 'imqc-pairCodeMain' },
            h('code', { className: 'imqc-pairCodeValue' }, code.code),
            h('span', { className: 'imqc-pairCodeMeta' }, `${secs}s 内有效`)),
          h('div', { className: 'imqc-pairCodeActions' },
            h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => { void copyPairCode(code.code); } }, copied ? '已复制' : '复制'),
            h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: issue }, busy ? '生成中…' : '重新生成')))
          : h('p', { className: 'imqc-hint' }, '正在生成配对码…'),
        h('h4', { className: 'imqc-pairSectionTitle' }, '方式二 · 直接按 openID 添加'),
        h('p', { className: 'imqc-hint' }, '每行一个（也支持用逗号分隔）。格式：openID 或 openID:昵称。例如：'),
        h('pre', { className: 'imqc-pairExample' }, 'ABCD1234EFGH\nWXYZ5678:小明\nIJKL0000:Alice Zhang'),
        h('textarea', { className: 'imqc-pairTextarea', rows: 4, value: manualOpenid, disabled: busy, 'aria-label': `${title} openID 列表`, placeholder: 'openID 或 openID:昵称，每行一个', onChange: (e: { currentTarget: { value: string } }) => setManualOpenid(e.currentTarget.value) }),
        h('div', { className: 'imqc-inline' }, h(Button, { variant: 'outline', size: 'sm', disabled: busy || manualOpenid.trim() === '', onClick: () => { addManual(); } }, '添加'),
          h('span', { className: 'imqc-hint' }, 'openID:昵称 的昵称会记入成员展示。')),
        msg ? h('p', { className: 'imqc-hint', role: 'status' }, msg) : null,
        error ? h('p', { className: 'imqc-error', role: 'alert' }, error) : null,
        h('div', { className: 'imqc-actions' }, h(Button, { variant: 'primary', size: 'sm', onClick: () => setAddOpen(false) }, '完成'))),
    }) : null);
}

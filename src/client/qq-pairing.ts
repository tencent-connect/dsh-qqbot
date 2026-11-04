/**
 * 配对码认领 UI —— Web 侧生成一次性码、展示已认领成员、撤销。
 *
 * 流程：Web 生成码 → 用户在 QQ 直接发送该码 → 机器人识别并写名单。
 * 本组件只负责 Web 端的码展示与已认领列表；真正的 openid 绑定在服务端完成。
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal, IconCopyOutlineRegular, IconDownloadOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { usePairingStyles } from './qq-pairing-styles.ts';
import { downloadWhitelist, whitelistEntries } from './whitelist-export.ts';
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
export function PairClaimPanel({ purpose, title, description, hint, enabled = true, onChange }: {
  purpose: PairPurpose; title: string; description?: string; hint?: string; enabled?: boolean; onChange?: () => void;
}): ReactNode {
  usePairingStyles();
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

  const copyOpenIds = async (value: string, message = 'OpenID 已复制。'): Promise<void> => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) throw new Error('剪贴板不可用，请选择 OpenID 手动复制。');
      await globalThis.navigator.clipboard.writeText(value);
      setMsg(message);
    } catch (error) {
      setMsg(error instanceof Error ? error.message : '复制失败，请选择 OpenID 手动复制。');
    }
  };

  // 配对码消失也可能是服务重载，不能据此认定已加入名单。
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
      else { setMsg('配对码已结束，请核对名单；未加入时请重新生成。'); onChange?.(); }
    }
  }, [status, code, onChange]);

  // 所有 hooks 之后再按绑定态短路，避免 hook 数量不一致（React #310）。
  if (!enabled) return h('div', { className: 'imqq-pair' }, h('div', { className: 'imqq-pairToolbar' }, h('strong', null, title)),
    h('p', { className: 'imqq-pairHint' }, '先完成 QQ 机器人绑定，才能配置认领。'));

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
      .then(() => { reload(); onChange?.(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '移除失败'))
      .finally(() => setBusy(false));
  };

  const saveRename = (openid: string, nickname: string): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void fetchJson(PAIR_RENAME_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openid, nickname }) })
      .then(() => { setEditing(null); reload(); onChange?.(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '修改失败'))
      .finally(() => setBusy(false));
  };
  const addManual = (): void => {
    if (busy || !manualOpenid.trim()) return;
    setBusy(true); setMsg(null);
    void fetchJson<{ message?: string; added?: number }>(PAIR_MANUAL_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ purpose, openid: manualOpenid }) })
      .then((r) => { setManualOpenid(''); setCode(null); codeSeen.current = false; setMsg(r.message ?? '已添加 ✔'); reload(); onChange?.(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '添加失败'))
      .finally(() => setBusy(false));
  };
  const secs = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)) : 0;
  const openAdd = (): void => { setAddOpen(true); setMsg(null); if (code === null) issue(); };
  return h('div', { className: 'imqq-pair' },
    h('div', { className: 'imqq-pairHeader' },
      h('div', { className: 'imqq-pairTitle' }, h('strong', null, title), status ? h('span', { className: 'imqq-pairCount' }, `(${members.length})`) : null),
      h('div', { className: 'imqq-pairToolbar' },
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconPlusOutlineRegular, { size: 14 }), disabled: busy, onClick: openAdd }, '添加'),
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconCopyOutlineRegular, { size: 14 }), 'aria-label': `复制${title}全部 OpenID 和昵称`, title: '每行一个 OpenID:昵称，可直接粘贴到批量添加', disabled: members.length === 0 || status === null || error !== null, onClick: () => { void copyOpenIds(whitelistEntries(members), '名单已复制（OpenID:昵称，每行一个）。'); } }, '复制全部'),
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconDownloadOutlineRegular, { size: 14 }), disabled: members.length === 0 || status === null || error !== null, onClick: () => {
        try { downloadWhitelist(members, purpose); }
        catch (error) { setMsg(error instanceof Error ? error.message : '导出失败'); }
      } }, '导出 CSV'))),
    description ? h('p', { className: 'imqq-pairHint' }, description) : null,
    hint ? h('p', { className: 'imqq-pairHint' }, hint) : null,
    msg ? h('p', { className: 'imqq-pairHint', role: 'status' }, msg) : null,
    error ? h('p', { className: 'imqq-pairError', role: 'alert' }, error) : null,
    members.length === 0
      ? h('p', { className: 'imqq-pairHint' }, '尚未添加任何成员。')
      : h('ul', { className: 'imqq-pairMembers' }, ...members.map((m) => {
          const isEditing = editing?.openid === m.openid;
          return h('li', { className: 'imqq-pairMember', key: `${m.openid}:${m.scene}` },
            h('div', { className: 'imqq-pairMemberMain' },
              h('span', { className: 'imqq-pairMemberName' }, m.nickname || '（未命名）'),
              purpose === 'owner' ? h('span', { className: 'imqq-pairMemberMeta' },
                m.scene === 'group' ? `群成员${m.sceneName ? ` · ${m.sceneName}` : ''}` : '私聊用户') : null,
              h('div', { className: 'imqq-pairIdentity' },
                h('code', { className: 'imqq-pairMemberOpenId' }, m.openid),
                h(Button, { variant: 'ghost', size: 'sm', className: 'imqq-pairCopy', disabled: busy, 'aria-label': `复制 ${m.nickname || m.openid} 的 OpenID`, title: '复制 OpenID', onClick: () => { void copyOpenIds(m.openid); } }, h(IconCopyOutlineRegular, { size: 14 })))),
            isEditing
              ? h('div', { className: 'imqq-pairMemberEdit' },
                  h(Input, { value: editing.nickname, disabled: busy, placeholder: '昵称', 'aria-label': '修改昵称', onChange: (e: { currentTarget: { value: string } }) => setEditing({ openid: m.openid, nickname: e.currentTarget.value }) }),
                  h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => saveRename(m.openid, editing.nickname) }, '保存'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing(null) }, '取消'))
              : h('div', { className: 'imqq-pairMemberActions' },
                  h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => setEditing({ openid: m.openid, nickname: m.nickname }) }, '改名'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => revoke(m.openid) }, '移除')));
        })),
    addOpen ? h(Modal, {
      open: true, title: `添加${title}`, closeLabel: '关闭', onClose: () => setAddOpen(false), className: 'imqq-pairModal',
      children: h('div', { className: 'imqq-pairDialog' },
        h('h4', { className: 'imqq-pairSectionTitle' }, '方式一 · 让对方在 QQ 认领（推荐）'),
        h('ol', { className: 'imqq-pairSteps' },
          h('li', null, '下面生成一次性配对码；'),
          h('li', null, `让对方在${purpose === 'allow-group' ? '群里 @ 机器人后' : '私聊里'}直接发送这个码：`),
          h('li', null, '机器人核对配对码后直接加入名单，并在 QQ 中回复结果。')),
        code ? h('div', { className: 'imqq-pairCodeCard' },
          h('div', { className: 'imqq-pairCodeMain' },
            h('code', { className: 'imqq-pairCodeValue' }, code.code),
            h('span', { className: 'imqq-pairCodeMeta' }, `${secs}s 内有效`)),
          h('div', { className: 'imqq-pairCodeActions' },
            h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => { void copyPairCode(code.code); } }, copied ? '已复制' : '复制'),
            h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: issue }, busy ? '生成中…' : '重新生成')))
          : h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: issue }, busy ? '生成中…' : '生成配对码'),
        h('h4', { className: 'imqq-pairSectionTitle' }, '方式二 · 直接按 openID 添加'),
        h('p', { className: 'imqq-pairHint' }, '每行一个（也支持用逗号分隔）。格式：openID 或 openID:昵称。例如：'),
        h('pre', { className: 'imqq-pairExample' }, 'ABCD1234EFGH\nWXYZ5678:小明\nIJKL0000:Alice Zhang'),
        h('textarea', { className: 'imqq-pairTextarea', rows: 4, value: manualOpenid, disabled: busy, 'aria-label': `${title} openID 列表`, placeholder: 'openID 或 openID:昵称，每行一个', onChange: (e: { currentTarget: { value: string } }) => setManualOpenid(e.currentTarget.value) }),
        h('div', { className: 'imqq-pairToolbar' }, h(Button, { variant: 'outline', size: 'sm', disabled: busy || manualOpenid.trim() === '', onClick: () => { addManual(); } }, '添加'),
          h('span', { className: 'imqq-pairHint' }, 'openID:昵称 的昵称会记入成员展示。')),
        msg ? h('p', { className: 'imqq-pairHint', role: 'status' }, msg) : null,
        error ? h('p', { className: 'imqq-pairError', role: 'alert' }, error) : null,
        h('div', { className: 'imqq-pairToolbar' }, h(Button, { variant: 'primary', size: 'sm', onClick: () => setAddOpen(false) }, '完成'))),
    }) : null);
}

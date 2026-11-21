/**
 * 配对码认领 UI —— 有效期内连续添加，在窗口内展示本次结果。
 *
 * 流程：Web 生成码 → 用户在 QQ 直接发送该码 → 机器人识别并写名单。
 * 本组件只负责 Web 端的码展示与已认领列表；真正的 openid 绑定在服务端完成。
 */
import { createElement as h, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, DisclosureRow, Input, Modal, IconCheckOutlineRegular, IconChevronDownOutlineRegular, IconCopyOutlineRegular, IconDownloadOutlineRegular, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { usePairingStyles } from './styles.ts';
import { downloadWhitelist, whitelistEntries } from './whitelist-export.ts';
import { rpcCall } from './rpc.ts';
import { mergePairResults } from './pairing-results.ts';
import {
  ACCOUNT_METHODS, ACCOUNT_RPC_ENDPOINT,
} from '../shared/rpc-protocol.ts';
import {
  type ClaimedMember, type ManualPairResult, type PairChallenge, type PairClaimResult, type PairPurpose, type PairStatusWire,
} from '../shared/pairing-protocol.ts';

/** 配对状态轮询间隔：进行中的配对码需要实时反映「已认领」。 */
const POLL_MS = 2000;

function usePairStatus(active: boolean, live: boolean): { status: PairStatusWire | null; error: string | null; reload: () => void } {
  const [status, setStatus] = useState<PairStatusWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const load = (): void => { void rpcCall<PairStatusWire>(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairStatus).then((s) => { if (!stopped) { setStatus(s); setError(null); } }).catch((c: unknown) => {
      if (stopped) return;
      const msg = c instanceof Error ? c.message : '';
      // The route may temporarily disappear during a reload. Keep the last successful snapshot.
      setError(msg || '读取认领状态失败');
    }); };
    load();
    // 无进行中的配对码不轮询：名单只在主动动作（生成/添加/移除/改名）后经 reload() 刷新；
    // 轮询仅服务「用户正盯着配对 Modal、码在等认领」这一窗口，页面隐藏时跳过
    if (!live) return () => { stopped = true; };
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load();
    }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [active, live, tick]);
  return { status, error, reload };
}

/** 单个用途的认领面板：生成码 / 展示进行中的码 / 已认领成员列表（可撤销）。 */
export function PairClaimPanel({ purpose, title, description, hint, enabled = true, onChange }: {
  purpose: PairPurpose; title: string; description?: string; hint?: string; enabled?: boolean; onChange?: () => void;
}): ReactNode {
  usePairingStyles();
  // hooks 依次声明后按需短路（见下），code/addOpen 供 usePairStatus 判定轮询窗口
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { status, error, reload } = usePairStatus(enabled, addOpen && code !== null);
  const members: ClaimedMember[] = status === null ? [] : purpose === 'owner' ? status.owners : purpose === 'allow-group' ? status.allowGroup : status.allowC2c;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [manualOpenid, setManualOpenid] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [results, setResults] = useState<PairClaimResult[]>([]);
  const [windowCodes, setWindowCodes] = useState<string[]>([]);
  const [codeEnded, setCodeEnded] = useState(false);
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
    const incoming = status.challenges.filter(challenge => windowCodes.includes(challenge.code)).flatMap(challenge => challenge.claims);
    if (incoming.length) setResults(previous => mergePairResults(previous, incoming));
    const present = status.challenges.some((c) => c.code === code.code);
    if (present) { codeSeen.current = true; return; }
    if (codeSeen.current) {
      codeSeen.current = false;
      const expired = Date.now() > code.expiresAt;
      setCodeEnded(true);
      if (expired) { setMsg('配对码已过期，请重新生成'); }
      else { setMsg('配对码已结束，请核对名单；未加入时请重新生成。'); onChange?.(); }
    }
  }, [status, code, windowCodes, onChange]);

  // 所有 hooks 之后再按绑定态短路，避免 hook 数量不一致（React #310）。
  if (!enabled) return h('div', { className: 'imqb-pair' },
    h('div', { className: 'imqb-pairHeader' }, h('div', { className: 'imqb-pairTitle' }, h('strong', null, title))),
    h('p', { className: 'imqb-pairHint' }, '先完成 QQ 机器人绑定，才能配置认领。'));

  const issue = (): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void rpcCall<PairChallenge & { previousClaims: PairClaimResult[] }>(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairIssue, { purpose, previousCode: code?.code })
      .then((r) => {
        setResults(previous => mergePairResults(previous, r.previousClaims));
        setCode({ code: r.code, expiresAt: r.expiresAt }); setCodeEnded(false); codeSeen.current = false;
        setWindowCodes(previous => [...previous, r.code]); reload();
      })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '生成配对码失败'))
      .finally(() => setBusy(false));
  };
  const revoke = (openid: string): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairRevoke, { purpose, openid })
      .then(() => { reload(); onChange?.(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '移除失败'))
      .finally(() => setBusy(false));
  };

  const saveRename = (openid: string, nickname: string): void => {
    if (busy) return;
    setBusy(true); setMsg(null);
    void rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairRename, { openid, nickname })
      .then(() => { setEditing(null); reload(); onChange?.(); })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '修改失败'))
      .finally(() => setBusy(false));
  };
  const addManual = (): void => {
    if (busy || !manualOpenid.trim()) return;
    setBusy(true); setMsg(null);
    void rpcCall<ManualPairResult>(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairManual, { purpose, openid: manualOpenid })
      .then((r) => {
        setManualOpenid(r.errors.map(error => error.input).join('\n'));
        setResults(previous => mergePairResults(previous, r.results));
        setMsg(r.errors.length ? r.errors.map(error => `${error.input}：${error.message}`).join('\n') : null);
        reload(); onChange?.();
      })
      .catch((c: unknown) => setMsg(c instanceof Error ? c.message : '添加失败'))
      .finally(() => setBusy(false));
  };
  const secs = code ? Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)) : 0;
  const openAdd = (): void => { setAddOpen(true); setMsg(null); setResults([]); setWindowCodes([]); setManualOpenid(''); setManualOpen(false); issue(); };
  const finish = (): void => {
    if (busy) return;
    if (code === null) { setAddOpen(false); return; }
    setBusy(true); setMsg(null);
    void rpcCall(ACCOUNT_RPC_ENDPOINT, ACCOUNT_METHODS.pairEnd, { purpose, code: code.code })
      .then(() => { setAddOpen(false); setCode(null); codeSeen.current = false; reload(); onChange?.(); })
      .catch((error: unknown) => setMsg(error instanceof Error ? error.message : '结束配对失败，请重试'))
      .finally(() => setBusy(false));
  };
  return h('div', { className: 'imqb-pair' },
    h('div', { className: 'imqb-pairHeader' },
      h('div', { className: 'imqb-pairTitle' }, h('strong', null, title), status ? h('span', { className: 'imqb-pairCount' }, `(${members.length})`) : null),
      h('div', { className: 'imqb-pairToolbar' },
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconPlusOutlineRegular, { size: 14 }), disabled: busy, onClick: openAdd }, '添加'),
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconCopyOutlineRegular, { size: 14 }), 'aria-label': `复制${title}全部 OpenID 和昵称`, title: '每行一个 OpenID:昵称，可直接粘贴到批量添加', disabled: members.length === 0 || status === null || error !== null, onClick: () => { void copyOpenIds(whitelistEntries(members), '名单已复制（OpenID:昵称，每行一个）。'); } }, '复制全部'),
      h(Button, { variant: 'outline', size: 'sm', icon: h(IconDownloadOutlineRegular, { size: 14 }), disabled: members.length === 0 || status === null || error !== null, onClick: () => {
        try { downloadWhitelist(members, purpose); }
        catch (error) { setMsg(error instanceof Error ? error.message : '导出失败'); }
      } }, '导出 CSV'))),
    description ? h('p', { className: 'imqb-pairHint' }, description) : null,
    hint ? h('p', { className: 'imqb-pairHint' }, hint) : null,
    msg ? h('p', { className: 'imqb-pairHint', role: 'status' }, msg) : null,
    error ? h('p', { className: 'imqb-pairError', role: 'alert' }, error) : null,
    members.length === 0
      ? h('p', { className: 'imqb-pairHint' }, '尚未添加任何成员。')
      : h('ul', { className: 'imqb-pairMembers' }, ...members.map((m) => {
          const isEditing = editing?.openid === m.openid;
          return h('li', { className: 'imqb-pairMember', key: `${m.openid}:${m.scene}` },
            h('div', { className: 'imqb-pairMemberMain' },
              h('span', { className: 'imqb-pairMemberName' }, m.nickname || '（未命名）'),
              purpose === 'owner' ? h('span', { className: 'imqb-pairMemberMeta' },
                m.scene === 'group' ? `群成员${m.sceneName ? ` · ${m.sceneName}` : ''}` : '私聊用户') : null,
              h('div', { className: 'imqb-pairIdentity' },
                h('code', { className: 'imqb-pairMemberOpenId' }, m.openid),
                h(Button, { variant: 'ghost', size: 'sm', className: 'imqb-pairCopy', disabled: busy, 'aria-label': `复制 ${m.nickname || m.openid} 的 OpenID`, title: '复制 OpenID', onClick: () => { void copyOpenIds(m.openid); } }, h(IconCopyOutlineRegular, { size: 14 })))),
            isEditing
              ? h('div', { className: 'imqb-pairMemberEdit' },
                  h(Input, { value: editing.nickname, disabled: busy, placeholder: '昵称', 'aria-label': '修改昵称', onChange: (e: { currentTarget: { value: string } }) => setEditing({ openid: m.openid, nickname: e.currentTarget.value }) }),
                  h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => saveRename(m.openid, editing.nickname) }, '保存'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => setEditing(null) }, '取消'))
              : h('div', { className: 'imqb-pairMemberActions' },
                  h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => setEditing({ openid: m.openid, nickname: m.nickname }) }, '改名'),
                  h(Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => revoke(m.openid) }, '移除')));
        })),
    addOpen ? h(Modal, {
      open: true, title: `添加${title}`, closeLabel: '关闭并停止配对', onClose: finish, className: 'imqb-pairModal',
      footer: h('div', { className: 'imqb-pairFooter' },
        h('span', { className: 'imqb-pairHint' }, '完成后配对码失效，已添加的成员保留。'),
        h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: finish }, '完成')),
      children: h('div', { className: 'imqb-pairDialog' },
        h('p', { className: 'imqb-pairHint' }, purpose === 'allow-group'
          ? '在需要添加的群里 @机器人后发送此码，有效期内可连续添加多个群。'
          : '让需要添加的用户在私聊里发送此码，有效期内可连续添加多人。'),
        code ? h('div', { className: 'imqb-pairCodeCard' },
          h('div', { className: 'imqb-pairCodeMain' },
            h('code', { className: 'imqb-pairCodeValue' }, code.code),
            h('span', { className: 'imqb-pairCodeMeta' }, codeEnded || secs === 0 ? '已结束，请重新生成' : `剩余 ${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`)),
          h('div', { className: 'imqb-pairCodeActions' },
            h(Button, { variant: 'outline', size: 'sm', disabled: busy || codeEnded || secs === 0, onClick: () => { void copyPairCode(code.code); } }, copied ? '已复制' : '复制配对码'),
            h(Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: issue }, busy ? '生成中…' : '重新生成')))
          : h(Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: issue }, busy ? '生成中…' : '生成配对码'),
        h(DisclosureRow, { title: `通过 OpenID 批量添加（非${purpose === 'allow-group' ? '群号' : ' QQ 号'}）`, icon: h(IconChevronDownOutlineRegular), open: manualOpen, expandable: true, expandOnRowClick: true, previewChevron: false, onToggle: () => setManualOpen(value => !value) },
        h('div', { className: 'imqb-pairManual' },
        h('p', { className: 'imqb-pairHint' }, '用户 OpenID 不是 QQ 号，群 OpenID 也不是群号，不能直接填写 QQ 号或群号。请使用当前机器人对应的 OpenID；没有 OpenID 时，请使用上方配对码添加。'),
        h('p', { className: 'imqb-pairHint' }, '每行一个 OpenID 或 OpenID:昵称。简单条目也可用逗号分隔；昵称含逗号时用双引号包住。'),
        h('pre', { className: 'imqb-pairExample' }, 'ABCD1234EFGH:小明\nWXYZ5678:Alice Zhang'),
        h('textarea', { className: 'imqb-pairTextarea', rows: 4, value: manualOpenid, disabled: busy, 'aria-label': `${title} openID 列表`, placeholder: 'OpenID 或 OpenID:昵称，每行一个；不能填写 QQ 号或群号', onChange: (e: { currentTarget: { value: string } }) => setManualOpenid(e.currentTarget.value) }),
        h('div', { className: 'imqb-pairToolbar' }, h(Button, { variant: 'outline', size: 'sm', disabled: busy || manualOpenid.trim() === '', onClick: () => { addManual(); } }, '添加'),
          h('span', { className: 'imqb-pairHint' }, '添加后可继续填写，配对码保持有效。')))),
        h('section', { className: 'imqb-pairResults', 'aria-label': '本次添加结果' },
          h('h4', { className: 'imqb-pairSectionTitle' }, `本次添加结果（${results.filter(result => result.state === 'added').length} 项新增）`),
          results.length === 0 ? h('p', { className: 'imqb-pairHint' }, '等待认领，成功结果会显示在这里。') : null,
          h('ul', { className: 'imqb-pairResultList', 'aria-live': 'polite' }, ...results.map(result => h('li', { className: 'imqb-pairResult', key: `${result.scene}:${result.openid}` },
            h('div', { className: 'imqb-pairResultTitle' },
              h('span', { className: 'imqb-pairMemberName' }, result.nickname || (result.scene === 'group' ? '未命名群聊' : '未命名用户')),
              h('span', { className: 'imqb-pairResultState' }, result.state !== 'revoked' ? h(IconCheckOutlineRegular, { size: 14 }) : null, result.state === 'added' ? '已添加' : result.state === 'existing' ? '已在名单中' : '已移除')),
            h('div', { className: 'imqb-pairIdentity' }, h('code', { className: 'imqb-pairMemberOpenId' }, result.openid),
              h(Button, { variant: 'ghost', size: 'sm', className: 'imqb-pairCopy', 'aria-label': `复制 ${result.nickname || result.openid} 的 OpenID`, onClick: () => { void copyOpenIds(result.openid); } }, h(IconCopyOutlineRegular, { size: 14 }))))))),
        msg ? h('p', { className: 'imqb-pairHint', role: 'status' }, msg) : null,
        error ? h('p', { className: 'imqb-pairError', role: 'alert' }, error) : null),
    }) : null);
}

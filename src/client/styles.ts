/**
 * 插件全部注入样式的唯一出口 —— 单一 imqb- 根命名空间 + 单一引用计数策略。
 *
 * 子命名空间按视图域划分（避免类名冲突，如 bind 的 .imqb-form 与配置表单
 * 的 .imqb-cfg-form 样式语义不同）：
 * - imqb-       绑定面板与页面容器
 * - imqb-cfg-   设置表单
 * - imqb-pair-  配对码面板
 * - imqb-cmd-   斜杠命令清单（设置表单的后代类）
 *
 * 安装策略统一为引用计数 <style> 节点：多个展示位共享同一节点，最后一个
 * 使用者移除；installBindPanelStyles 供 apply() 在面板外（插件详情按钮）
 * 渲染前安装。交互态（hover/active/focus）无法用 inline style 表达，统一
 * 收敛到类；颜色取 DSW 主题变量（--dsw-alias-*），缺省值兜底。
 */
import { useEffect } from 'react';

type Retain = () => void;

/** 安装（或复用）一个引用计数的 <style> 节点；Node 测试环境为 no-op。 */
function installStyles(id: string, css: string): Retain {
  if (typeof document === 'undefined') return () => undefined;
  const existing = document.getElementById(id);
  const style = existing ?? document.createElement('style');
  if (existing === null) {
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }
  style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
  return () => {
    const remaining = Number(style.dataset.users ?? 1) - 1;
    if (remaining <= 0) style.remove();
    else style.dataset.users = String(remaining);
  };
}

const BIND_PANEL_CSS = `
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
.imqb-danger { color: var(--dsw-alias-state-error-primary); }
.imqb-field > span { width: 100%; }
.imqb-cards { display: flex; flex-direction: column; gap: 20px; }
.imqb-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 16px 16px; background: var(--dsw-alias-bg-layer-1); }
.imqb-cardTitle { margin: 14px 0 4px; font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb-cardHint { margin: 0 0 8px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
`;

const CONFIG_PANEL_CSS = `
.imqb-cfg-form { display: flex; flex-direction: column; width: 100%; min-width: 0; color: var(--dsw-alias-label-primary); }
.imqb-cfg-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqb-cfg-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.imqb-cfg-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb-cfg-field + .imqb-cfg-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb-cfg-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb-cfg-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb-cfg-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-textarea { box-sizing: border-box; width: 100%; min-height: 68px; padding: 8px 12px; resize: vertical; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; }
.imqb-cfg-textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
/* Preserve the QQ settings draft and readback feedback in the sticky footer. */
.imqb-cfg-footer {
  position: sticky; bottom: 0; z-index: 1; display: flex; align-items: center;
  flex-wrap: wrap; gap: 8px; margin-top: 16px; padding: 12px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1);
}
.imqb-cfg-footer-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.imqb-cfg-feedback { display: flex; align-items: center; gap: 12px; padding: 12px 0; }
.imqb-cfg-feedback p { flex: 1; min-width: 0; }
.imqb-cfg-form .imqb-cmd-inline { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.imqb-cfg-form .imqb-cmd-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb-cfg-form .imqb-cmd-error { color: var(--dsw-alias-state-error-primary); }
.imqb-cfg-form .imqb-cmd-cmdList { margin: 12px 0; }
.imqb-cfg-form .imqb-cmd-cmdContent { padding: 4px 0 4px 22px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-form .imqb-cmd-cmdGroup + .imqb-cmd-cmdGroup { margin-top: 16px; }
.imqb-cfg-form .imqb-cmd-cmdGroup > strong { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.imqb-cfg-form .imqb-cmd-cmdRow { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 8px; overflow-wrap: anywhere; }
.imqb-cfg-form .imqb-cmd-cmdRow code { padding: 1px 6px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-size: 12px; }
.imqb-cfg-details { margin-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb-cfg-summary { padding: 16px 0; font-size: 13px; font-weight: 500; cursor: pointer; }
.imqb-cfg-summary::marker { color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-summary:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color); outline-offset: 2px; border-radius: var(--dsw-radius-sm); }
.imqb-cfg-directory-feedback { display: flex; align-items: flex-start; gap: 8px; }
.imqb-cfg-directory-feedback p { flex: 1; min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 480px) {
  .imqb-cfg-head:has([role=tablist]) { align-items: stretch; flex-direction: column; }
  .imqb-cfg-selector-head { align-items: stretch; flex-direction: column; }
  .imqb-cfg-note { flex-basis: 100%; }
}
.imqb-cfg-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb-cfg-note--error { color: var(--dsw-alias-state-error-primary); }
.imqb-cfg-note--ok { color: var(--dsw-alias-label-secondary); }
/* cwd 只读行 */
.imqb-cfg-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
/* 组合框：输入框 + 候选面板（模型 / 预设） */
.imqb-combo { position: relative; }
.imqb-combo-input { width: 100%; }
.imqb-combo-panel {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
  box-sizing: border-box; max-height: 320px; overflow-y: auto; padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .16);
}
.imqb-combo-option {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px;
  border-radius: var(--dsw-radius-sm); cursor: pointer; font-size: 13px;
  color: var(--dsw-alias-label-primary);
}
.imqb-combo-option--active { background: var(--dsw-alias-bg-layer-3); }
.imqb-combo-group {
  position: sticky; top: -4px; z-index: 1;
  margin: 4px 0 2px; padding: 4px 8px;
  font-size: 12px; line-height: 1.4; color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
}
.imqb-combo-group:first-child { margin-top: 0; }
.imqb-combo-option--disabled { opacity: .5; cursor: not-allowed; }
.imqb-combo-option-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1; }
.imqb-combo-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqb-combo-option-hint {
  flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}
.imqb-combo-option-check { flex: none; color: var(--dsw-alias-label-secondary); }
.imqb-combo-option-badge { flex: none; font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.imqb-combo-empty { padding: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
`;

const PAIRING_CSS = `
.imqb-pair { min-width: 0; container-type: inline-size; display: grid; gap: 10px; margin: 4px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-primary); }
.imqb-pairHeader, .imqb-pairToolbar, .imqb-pairMemberActions, .imqb-pairMemberEdit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.imqb-pairHeader { gap: 12px; }
.imqb-pairTitle { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 13px; }
.imqb-pairCount, .imqb-pairHint, .imqb-pairMemberMeta { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb-pairToolbar { margin-left: auto; }
.imqb-pairHint { margin: 0; overflow-wrap: anywhere; }
.imqb-pairHint[role="status"] { white-space: pre-line; }
.imqb-pairError { margin: 0; color: var(--dsw-alias-state-error-primary); }
.imqb-pairMembers { list-style: none; padding: 0; margin: 0; }
.imqb-pairMember { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0 2px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairMember + .imqb-pairMember { margin-top: 10px; }
.imqb-pairMemberMain { min-width: 0; display: grid; gap: 4px; }
.imqb-pairMemberName { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.imqb-pairIdentity { display: flex; align-items: center; gap: 6px; min-width: 0; }
.imqb-pairMemberOpenId { min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; user-select: text; }
.imqb-pairCopy { flex: none; }
.imqb-pairMemberEdit { justify-content: flex-end; max-width: 280px; }
.imqb-pairMemberEdit > :first-child { flex: 1 1 120px; min-width: 0; }
.imqb-pairDialog { display: grid; gap: 12px; color: var(--dsw-alias-label-primary); }
.imqb-pairSectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.imqb-pairSteps { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
.imqb-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); white-space: pre-wrap; font-size: 12px; }
.imqb-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqb-pairTextarea:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqb-pairModal { width: min(560px, calc(100vw - 32px)); max-height: 100%; overflow: auto; }
.imqb-pairManual { display: grid; gap: 10px; padding: 8px 0; }
.imqb-pairResults { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairResultList { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow-y: auto; }
.imqb-pairResult { display: grid; gap: 4px; padding: 10px 0; }
.imqb-pairResult + .imqb-pairResult { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqb-pairResultTitle, .imqb-pairFooter { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.imqb-pairResultState { display: inline-flex; flex: none; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqb-pairFooter { flex-wrap: wrap; }
.imqb-pairCodeCard { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqb-pairCodeMain, .imqb-pairCodeActions { display: flex; align-items: center; gap: 8px; }
.imqb-pairCodeValue { font-size: 24px; letter-spacing: 4px; font-weight: 600; }
.imqb-pairCodeMeta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .imqb-pairHeader { flex-direction: column; align-items: stretch; gap: 8px; }
  .imqb-pairToolbar { margin-left: 0; }
  .imqb-pairMember { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .imqb-pairMemberActions, .imqb-pairMemberEdit { justify-content: flex-end; margin-left: auto; }
}
`;

/**
 * 面板样式全局安装（apply 时调用一次）：插件详情按钮等面板外渲染的元素
 * 也需要可见；引用计数，插件卸载时随 effect 清理。
 */
export function installBindPanelStyles(): Retain {
  return installStyles('im-qqbot-bind-panel-styles', BIND_PANEL_CSS);
}

export function useBindPanelStyles(): void {
  useEffect(() => installBindPanelStyles(), []);
}

export function useConfigPanelStyles(): void {
  useEffect(() => installStyles('im-qqbot-config-panel-styles', CONFIG_PANEL_CSS), []);
}

export function usePairingStyles(): void {
  useEffect(() => installStyles('im-qqbot-pairing-styles', PAIRING_CSS), []);
}

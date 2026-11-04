import { useEffect } from 'react';

const STYLE_ID = 'im-qqbot-pairing-styles';

/** Keep pairing panels and portal dialogs independent of conversation-page styles. */
export function usePairingStyles(): void {
  useEffect(() => {
    const existing = document.getElementById(STYLE_ID);
    const style = existing ?? document.createElement('style');
    if (!existing) {
      style.id = STYLE_ID;
      style.textContent = `
.imqq-pair { min-width: 0; container-type: inline-size; display: grid; gap: 10px; margin: 4px 0 16px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-primary); }
.imqq-pairHeader, .imqq-pairToolbar, .imqq-pairMemberActions, .imqq-pairMemberEdit { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.imqq-pairHeader { gap: 12px; }
.imqq-pairTitle { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 13px; }
.imqq-pairCount, .imqq-pairHint, .imqq-pairMemberMeta { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqq-pairToolbar { margin-left: auto; }
.imqq-pairHint { margin: 0; overflow-wrap: anywhere; }
.imqq-pairError { margin: 0; color: var(--dsw-alias-state-error-primary); }
.imqq-pairMembers { list-style: none; padding: 0; margin: 0; }
.imqq-pairMember { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 0 2px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqq-pairMember + .imqq-pairMember { margin-top: 10px; }
.imqq-pairMemberMain { min-width: 0; display: grid; gap: 4px; }
.imqq-pairMemberName { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.imqq-pairIdentity { display: flex; align-items: center; gap: 6px; min-width: 0; }
.imqq-pairMemberOpenId { min-width: 0; font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; user-select: text; }
.imqq-pairCopy { flex: none; }
.imqq-pairMemberEdit { justify-content: flex-end; max-width: 280px; }
.imqq-pairMemberEdit > :first-child { flex: 1 1 120px; min-width: 0; }
.imqq-pairDialog { display: grid; gap: 12px; color: var(--dsw-alias-label-primary); }
.imqq-pairSectionTitle { margin: 0; font-size: 13px; font-weight: 600; }
.imqq-pairSteps { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.8; color: var(--dsw-alias-label-secondary); }
.imqq-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); white-space: pre-wrap; font-size: 12px; }
.imqq-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqq-pairTextarea:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqq-pairModal { width: min(560px, calc(100vw - 32px)); }
.imqq-pairCodeCard { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqq-pairCodeMain, .imqq-pairCodeActions { display: flex; align-items: center; gap: 8px; }
.imqq-pairCodeValue { font-size: 24px; letter-spacing: 4px; font-weight: 600; }
.imqq-pairCodeMeta { font-size: 12px; color: var(--dsw-alias-label-secondary); }
@container (max-width: 480px) {
  .imqq-pairHeader { flex-direction: column; align-items: stretch; gap: 8px; }
  .imqq-pairToolbar { margin-left: 0; }
  .imqq-pairMember { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .imqq-pairMemberActions, .imqq-pairMemberEdit { justify-content: flex-end; margin-left: auto; }
}
`;
      document.head.appendChild(style);
    }
    style.dataset.users = String(Number(style.dataset.users ?? 0) + 1);
    return () => {
      const remaining = Number(style.dataset.users) - 1;
      if (remaining === 0) style.remove();
      else style.dataset.users = String(remaining);
    };
  }, []);
}

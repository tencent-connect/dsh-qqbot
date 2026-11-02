/** QQ surfaces share the host's aliases, typography and compact control geometry. */
export function installConversationStyles(): void {
  const previous = document.getElementById('imqc-styles');
  const style = previous instanceof HTMLStyleElement ? previous : document.createElement('style');
  style.id = 'imqc-styles';
  style.textContent = `
.imqc { font: 13px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-primary); min-width: 0; box-sizing: border-box; padding: 16px; width: 100%; }
.imqc *, .imqc-readonly * { box-sizing: border-box; }
.imqc h3, .imqc h4 { margin: 0; font-size: 14px; font-weight: 600; }
.imqc p { margin: 6px 0; overflow-wrap: anywhere; }
.imqc textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; line-height: 1.5; font: inherit; color: inherit; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 7px 9px; background: var(--dsw-alias-bg-layer-3); }
.imqc textarea:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 2px; }
.imqc-header { display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.imqc-header > svg { flex: none; width: 24px; height: 24px; }
.imqc-headerTitle { flex: 1; min-width: 0; }
.imqc-hint { display: block; color: var(--dsw-alias-label-tertiary); font-size: 12px; overflow-wrap: anywhere; }
.imqc-state { display: flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.imqc-dot[data-ready=true] { background: var(--dsw-alias-state-success-primary); }
.imqc-error { color: var(--dsw-alias-state-error-primary); padding: 8px 0; overflow-wrap: anywhere; }
.imqc-tabs { margin: 10px 0 14px; max-width: 100%; }
.imqc-list { display: flex; flex-direction: column; gap: 3px; margin: 8px -5px; }
.imqc-row { width: 100%; padding: 11px 8px; text-align: left; border: 0; border-radius: var(--dsw-radius-md); background: transparent; cursor: pointer; }
.imqc-row:hover { background: var(--dsw-alias-bg-layer-1); }
.imqc-row[aria-pressed=true] { background: var(--dsw-alias-bg-layer-2); }
.imqc-rowTop { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
.imqc-rowName { font-weight: 500; overflow-wrap: anywhere; min-width: 0; }
.imqc-rowMeta { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqc-rowText { display: block; color: var(--dsw-alias-label-secondary); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
.imqc-section { border-top: 1px solid var(--dsw-alias-border-l2); padding: 14px 0; }
.imqc-section:first-child { border-top: 0; }
.imqc-actions, .imqc-inline { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.imqc-actions { padding: 10px 0; }
.imqc-selectorRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 7px 0; }
.imqc-selectorRow > :last-child { min-width: 0; width: min(72%, 300px); }
.imqc-field { display: grid; gap: 5px; margin: 11px 0; }
.imqc-field > span:first-child { color: var(--dsw-alias-label-secondary); }
.imqc-check { display: flex; align-items: flex-start; gap: 7px; margin: 7px 0; overflow-wrap: anywhere; }
.imqc-toolChoices { max-height: min(56vh, 540px); overflow-y: auto; overscroll-behavior: contain; padding-right: 8px; }
.imqc-toolPickerBar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.imqc-toolPickerBar > :first-child { flex: 1; min-width: 200px; }
.imqc-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 6px; }
.imqc-chip { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); border-radius: 999px; padding: 3px 10px; cursor: pointer; }
.imqc-chip[data-active] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-label-secondary); }
.imqc-onlySelected { display: inline-flex; align-items: center; gap: 5px; margin-left: auto; font-size: 12px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.imqc-toolGroupHead { display: flex; align-items: center; gap: 8px; }
.imqc-toolGroupToggle { display: inline-flex; align-items: center; gap: 6px; flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; padding: 2px 0; text-align: left; }
.imqc-toolGroupAll { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); cursor: pointer; }
.imqc-toolGroupAll:disabled { opacity: .5; cursor: default; }
.imqc-toolGrid { display: grid; grid-template-columns: minmax(0,1fr); gap: 4px; margin: 6px 0 2px; }
.imqc-toolRow { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: var(--dsw-radius-md); cursor: pointer; border: 1px solid transparent; }
.imqc-toolRow:hover { background: var(--dsw-alias-bg-layer-1); }
.imqc-toolRow[data-on] { border-color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.imqc-toolRow[data-off] { opacity: .5; cursor: default; }
.imqc-toolRowStatic { cursor: default; align-items: center; border-color: var(--dsw-alias-border-l2); }
.imqc-toolRowStatic:hover { background: transparent; }
.imqc-toolRowStatic .imqc-toolRowBody { flex: 1; }
.imqc-toolRemove { flex: none; }
.imqc-toolRowInput { margin-top: 2px; width: 15px; height: 15px; flex: none; }
.imqc-toolRowBody { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.imqc-toolRowName { display: flex; align-items: baseline; gap: 8px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.imqc-toolRowDesc { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.imqc-toolPickerFoot { margin-top: 12px; }
/* 工具选择弹窗：默认 Modal 只有 380px，这里放宽以便两列排布 */
.imqc-toolModal { width: min(760px, calc(100vw - 32px)); max-width: min(760px, calc(100vw - 32px)); }
.imqc-toolModal > * { min-width: 0; }
@media (min-width: 560px) { .imqc-toolGrid { grid-template-columns: repeat(2, minmax(0,1fr)); } }
.imqc-toolGroup { padding: 13px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.imqc-fieldset { margin: 12px 0; padding: 10px 14px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }
.imqc-fieldsetTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin: 2px 0 6px; }
.imqc-fieldset > .imqc-hint { margin-bottom: 8px; }
.imqc-fieldset .imqc-field { margin: 8px 0; }
.imqc-cmdList { margin: 6px 0 2px; }
.imqc-cmdList > summary { cursor: pointer; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.imqc-cmdGroup { margin: 8px 0 4px; }
.imqc-cmdGroup > strong { display: block; font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 4px; }
.imqc-cmdRow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; padding: 2px 0; }
.imqc-cmdRow code { font-size: 12px; color: var(--dsw-alias-label-primary); }
.imqc-toolGuide { display: flex; align-items: flex-start; gap: 8px; margin: 4px 0 8px; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); }
.imqc-toolGuide > p { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.imqc-presets { margin: 2px 0 8px; display: flex; flex-direction: column; gap: 6px; }
.imqc-presets > .imqc-hint { flex: none; }
.imqc-presetUser { display: inline-flex; align-items: center; gap: 2px; }
.imqc-presetDel { border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px; }
.imqc-presetDel:disabled { opacity: .4; cursor: default; }
.imqc-presetSave { flex-wrap: nowrap; }
.imqc-presetSave > :first-child { flex: 1; min-width: 120px; }
.imqc-tool { display: grid; grid-template-columns: minmax(0,1fr) 90px; gap: 10px; align-items: start; padding-top: 12px; }
.imqc-toolCheckbox > span { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.imqc-tool small { margin-top: 2px; }
.imqc-preview { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 12px; margin-top: 10px; background: var(--dsw-alias-bg-layer-1); }
.imqc-pair { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }
.imqc-pair > .imqc-inline { justify-content: space-between; }
.imqc-pairCode { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqc-pairDialog { display: flex; flex-direction: column; gap: 8px; }
.imqc-pairSectionTitle { margin: 10px 0 2px; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqc-pairSteps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.imqc-pairExample { margin: 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-2); font-size: 12px; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); }
.imqc-pairTextarea { box-sizing: border-box; width: 100%; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; color: var(--dsw-alias-label-primary); line-height: 1.5; resize: vertical; }
.imqc-pairModal { width: min(560px, calc(100vw - 32px)); }
.imqc-cmdList { margin: 6px 0; font-size: 12px; }
.imqc-cmdList > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); }
.imqc-cmdGroup { margin: 8px 0 4px; display: flex; flex-direction: column; gap: 3px; }
.imqc-cmdGroup > strong { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-cmdRow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.imqc-cmdRow > code { font-size: 12px; padding: 0 5px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.imqc-pairManual { flex-wrap: nowrap; }
.imqc-pairManual > :first-child { flex: 1; min-width: 120px; }
.imqc-pairCodeCard { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.imqc-pairCodeMain { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.imqc-pairCodeValue { font-size: 24px; font-weight: 700; letter-spacing: 4px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.imqc-pairCodeMeta { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.imqc-pairCodeActions { display: flex; align-items: center; gap: 8px; flex: none; }
.imqc-pairMembers { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.imqc-pairMember { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.imqc-pairMemberMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.imqc-pairMemberName { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqc-pairMemberMeta { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqc-pairMemberActions, .imqc-pairMemberEdit { flex: none; }
.imqc-pairMemberEdit > :first-child { width: 140px; }
.imqc-preview pre, .imqc-messageText { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 7px 0; }
.imqc-history { display: grid; gap: 5px; }
.imqc-history button { text-align: left; overflow-wrap: anywhere; }
.imqc-message { border-bottom: 1px solid var(--dsw-alias-border-l2); padding: 10px 0; }
.imqc-messageMeta { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqc-readonly { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 15px; margin: 8px 0; color: var(--dsw-alias-label-secondary); font: 13px/1.5 var(--dsw-font-family); background: var(--dsw-alias-bg-base); }
.imqc-readonly strong { display: block; color: var(--dsw-alias-label-primary); margin-bottom: 4px; }
.imqc-readonly .imqc-actions { padding-bottom: 0; }
.imqc-readonly .imqc-error { margin-top: 7px; }
.imqc-source { font-size: 12px; color: var(--dsw-alias-label-tertiary); margin-bottom: 4px; }
.imqc-full { max-width: 900px; margin: 0 auto; padding: 24px; }
@media(max-width:420px) { .imqc { padding: 12px; } .imqc-tool { grid-template-columns: minmax(0,1fr) 82px; gap: 7px; } }

.imqc-directory { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; padding: 16px; background: var(--dsw-alias-bg-base); }
.imqc-directory .imqc-list { margin: 8px 0; }
.imqc-directoryRow { display: flex; align-items: center; gap: 4px; }
.imqc-directoryRow > .imqc-row { flex: 1; min-width: 0; }
.imqc-listScroll { flex: 1; overflow-y: auto; min-height: 80px; }
.imqc-listFooter { display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l2); }
.imqc-row { display: flex; align-items: center; gap: 10px; }
.imqc-avatar { display: flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-weight: 600; }
.imqc-rowBody { flex: 1; min-width: 0; }
.imqc-rowName, .imqc-rowText { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imqc-status { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqc-sessionBadge { color: var(--dsw-alias-label-tertiary); font: 10px/1.2 var(--dsw-font-family); white-space: nowrap; }
.imqc-sessionSource { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.imqc-sessionUtilities { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font: 12px/1.5 var(--dsw-font-family); }
.imqc-answerAction { font: 12px/1.5 var(--dsw-font-family); }
.imqc-answerModal { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 20px; }
.imqc-answerPreview { position: relative; background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); width: min(580px, 100%); max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgb(0 0 0 / 12%); }
.imqq-sidebar { display: flex; flex-direction: column; flex: 1; width: 100%; min-width: 0; min-height: 0; overflow: hidden; padding: 0 var(--dsh-sidebar-inline-padding, 8px); font: 13px/1.4 var(--dsw-font-family); color: var(--dsw-alias-label-primary); box-sizing: border-box; }
.imqq-sidebar *, .imqq-editForm * { box-sizing: border-box; }
.imqq-heading { display: flex; align-items: center; gap: 3px; min-height: 40px; flex: none; }
.imqq-headingTitle { flex: 1; min-width: 0; font-weight: 500; padding-left: 5px; }
.imqq-heading .imqq-back { font-size: 11px; padding-inline: 5px; gap: 2px; color: var(--dsw-alias-label-secondary); }
.imqq-search { margin: 3px 3px 9px; flex: none; }
.imqq-search > span { display: flex; width: 100%; }
.imqq-tree { flex: 1; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
.imqq-scope { margin-bottom: 10px; }
/* 一级：分组标题（群聊/私聊）——更醒目、不缩进，chevron 属这一级 */
.imqq-scopeToggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px var(--dsh-sidebar-row-padding, 12px) 4px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 600 12px/1.3 var(--dsw-font-family); cursor: pointer; text-align: left; }
.imqq-count { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
/* 二级：具体对话——向右缩进，表达从属于上面的分组 */
.imqq-peerRow { display: flex; align-items: center; min-width: 0; min-height: 34px; border-radius: var(--dsw-radius-md); padding-left: 20px; padding-right: 2px; }
.imqq-peerRow:hover, .imqq-sessionRow:hover { background: var(--dsw-alias-bg-layer-1); }
.imqq-peerRow[data-selected=true] { background: var(--dsw-alias-bg-layer-2); }
.imqq-peerRow[data-selected=true] .imqq-peerName { font-weight: 500; }
.imqq-toggle, .imqq-toggleSpace { width: 21px; flex: none; }
.imqq-toggle { min-height: 30px; display: flex; justify-content: center; align-items: center; padding: 0; border: 0; color: var(--dsw-alias-label-tertiary); background: transparent; cursor: pointer; }
.imqq-peerOpen { display: flex; align-items: center; gap: var(--dsh-sidebar-label-gap, 6px); flex: 1; min-width: 0; min-height: 38px; padding: 6px 0; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; text-align: left; }
.imqq-peerOpen > svg { flex: none; color: var(--dsw-alias-label-secondary); }
.imqq-peerText { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.imqq-peerName, .imqq-peerSummary { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.imqq-peerSummary { color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 1.4; }
.imqq-tag { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.imqq-running { flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
.imqq-currentTags { flex: none; display: inline-flex; align-items: center; gap: 4px; }
.imqq-current { flex: none; font-size: 10px; line-height: 1.3; padding: 0 5px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-secondary, transparent); }
.imqq-sessionRow[data-current=true] .imqq-sessionTitle { color: var(--dsw-alias-label-primary); font-weight: 500; }
.imqq-sessionCurrent { flex: none; font-size: 9px; line-height: 1.3; padding: 0 5px; border-radius: 999px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.imqq-sidebar .imqq-menuTrigger { padding-inline: 4px; min-width: 24px; width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); letter-spacing: 1px; }
.imqq-sidebar .imqq-quickAdd { flex: none; padding-inline: 4px; min-width: 24px; width: 24px; height: 24px; color: var(--dsw-alias-label-secondary); }
.imqq-sidebar .imqq-quickAdd:disabled { opacity: .35; cursor: default; }
.imqq-sessions { margin-left: 52px; padding-left: 8px; }
.imqq-sessionRow { display: flex; align-items: center; min-width: 0; border-radius: var(--dsw-radius-md); padding-right: 2px; margin: 2px 0; }
.imqq-sessionRow[data-selected=true] { background: var(--dsw-alias-bg-layer-2); }
.imqq-sessionOpen { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; border: 0; background: transparent; text-align: left; color: var(--dsw-alias-label-secondary); font: 12px/1.4 var(--dsw-font-family); padding: 6px; cursor: pointer; }
.imqq-sessionTitle { display: flex; align-items: center; gap: 5px; width: 100%; min-width: 0; }
.imqq-sessionTitleText, .imqq-workspace { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
.imqq-workspace { width: 100%; }
.imqq-copied { flex: none; font-size: 10px; color: var(--dsw-alias-state-success-primary); }
.imqq-sessionMeta { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.imqq-workspace { flex: 1; min-width: 0; }
.imqq-more { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: 11px/1.4 var(--dsw-font-family); padding: 8px 6px; cursor: pointer; text-align: left; }
.imqq-more:hover { color: var(--dsw-alias-label-primary); }
.imqq-empty { margin: 5px 12px 10px 25px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.imqq-footer { display: flex; flex: none; justify-content: space-between; align-items: center; padding: 8px 6px; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.imqq-error { color: var(--dsw-alias-state-error-primary); font: 12px/1.5 var(--dsw-font-family); overflow-wrap: anywhere; margin: 8px; }
.imqq-rail { align-items: center; padding-inline: 0; gap: 6px; padding-top: 6px; }
.imqq-editModal { width: min(440px, calc(100vw - 32px)); }
.imqq-editForm { display: grid; gap: 14px; font: 13px/1.5 var(--dsw-font-family); color: var(--dsw-alias-label-primary); }
.imqq-editForm .imqc-field { margin: 0; }
.imqq-dialogHint { margin: 0 0 10px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.imqq-dialogActions { display: flex; justify-content: flex-end; gap: 8px; }
.imqq-welcome { margin: auto; max-width: 560px; padding: 32px; text-align: center; }
.imqq-welcome > svg { width: 36px; height: 36px; margin-bottom: 12px; color: var(--dsw-alias-label-secondary); }
.imqq-welcomeActions { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.imqq-welcomeTitle { display: flex; align-items: center; justify-content: center; gap: 8px; }
.imqq-welcomeTitle > h3 { margin: 0; }
.imqq-welcomeState { font-size: 11px; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.imqq-welcomeState::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); display: inline-block; }
.imqc fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.imqc-field > span, .imqc-inline > span { min-width: 0; width: 100%; }
.imqc-inline > span { flex: 1; }
.imqq-selectAnchor { display: flex; width: 100%; max-width: 100%; min-width: 0; }
.imqq-select { width: 100%; min-width: 0; justify-content: space-between; text-align: left; }
.imqq-selectValue { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqq-select svg { flex: none; }
.imqq-selectMenu { max-width: min(520px, calc(100vw - 24px)); }
.imqq-selectChoice { display: flex; flex-direction: column; gap: 2px; white-space: normal; overflow-wrap: anywhere; }
.imqq-selectDescription { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
.imqb2-selector-head > .imqq-selectAnchor { width: min(65%, 360px); }
.imqq-answerPreview { width: min(580px, calc(100vw - 32px)); }
@media(max-width:480px) { .imqb2-selector-head > .imqq-selectAnchor { width: 100%; } .imqc-tabs { overflow-x: auto; } }

.imqc-settingsView { padding: 20px max(16px, calc((100% - 920px) / 2)); padding-bottom: calc(var(--dsh-composer-height, 0px) + 24px); }
.imqc-viewHeading { display: flex; align-items: baseline; gap: 10px; }
.imqc-summary { padding: 12px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); }
.imqc-banner { margin: 12px 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2); }
.imqc-advanced { border-top: 1px solid var(--dsw-alias-border-l2); padding-block: 14px; }
.imqc-advanced > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-weight: 500; }
.imqc-advanced > summary:focus-visible { outline: 2px solid var(--dsw-alias-label-secondary); outline-offset: 3px; }
.imqc-saveBar { position: sticky; bottom: var(--dsh-composer-height, 0px); z-index: 1; background: var(--dsw-alias-bg-base); border-top: 1px solid var(--dsw-alias-border-l2); padding: 12px 0; }
.imqc-saveBar > .imqc-hint { width: 100%; }
.imqc-historyRow { display: grid; gap: 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); padding: 12px; color: inherit; background: var(--dsw-alias-bg-layer-1); font: inherit; cursor: pointer; }
.imqc-historyRow:hover { background: var(--dsw-alias-bg-layer-2); }
.imqc-currentBadge { font-size: 11px; color: var(--dsw-alias-state-success-primary); }
.imqc-partDetails { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.imqc-partDetails > summary { cursor: pointer; }
.imqc-receiptId { display: block; overflow-wrap: anywhere; font-size: 11px; }
.imqc-timelineRows { display: flex; flex-direction: column; gap: 12px; margin: 14px 0; }
.imqc-timelineMessage { max-width: 85%; width: fit-content; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); display: flex; align-items: flex-start; gap: 8px; }
.imqc-timelineMessage[data-failed] { border-color: var(--dsw-alias-state-error-primary); }
.imqc-attachRow { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 2px; }
.imqc-attachChip { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.imqc-attachImage { max-width: 260px; max-height: 260px; border-radius: var(--dsw-radius-md); display: block; }
.imqc-attachVideo { max-width: 320px; border-radius: var(--dsw-radius-md); display: block; }
.imqc-attachAudio { width: 260px; }
.imqc-attachFile { font-size: 12px; color: var(--dsw-alias-label-link, var(--dsw-alias-label-secondary)); word-break: break-all; }
.imqc-timelineMessage[data-direction=outbound] { align-self: flex-end; background: var(--dsw-alias-bg-layer-2); }
.imqq-settingsModal { width: min(1000px, calc(100vw - 32px)); height: min(900px, calc(100dvh - 32px)); }
/* 弹窗内容列限高，让 body 成为滚动容器（flex 滚动经典解法 min-height:0） */
.imqq-settingsContent { min-height: 0; }
.imqq-settingsContent > :last-child { min-height: 0; overflow-y: auto; overflow-x: hidden; }
.imqq-settingsModal .imqc-settingsView { height: auto; overflow: visible; padding: 0; }
.imqq-settingsModal .imqc-saveBar { bottom: 0; }
.imqq-settingsModal .imqc-peerSettings { padding-bottom: 8px; }
@media(max-width:600px) { .imqc-timelineMessage { max-width: 96%; } .imqc-settingsView { padding: 12px; padding-bottom: calc(var(--dsh-composer-height, 0px) + 16px); } .imqc-tool { grid-template-columns: minmax(0, 1fr) 76px; } }
`;
  if (!style.isConnected) document.head.appendChild(style);
}

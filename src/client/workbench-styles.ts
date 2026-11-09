export const WORKBENCH_STYLES = `
.imqw-root {
  container: imqq-workbench / inline-size;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
}
.imqw-layout {
  display: grid;
  grid-template-columns: var(--imqw-rail) 6px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.imqw-layout[data-collapsed='true'] { grid-template-columns: var(--imqw-rail) minmax(0, 1fr); }
.imqw-content, .imqw-conversation-grid {
  height: 100%;
  min-width: 0;
  min-height: 0;
}
.imqw-content { overflow: hidden; }
.imqw-conversation-grid {
  display: grid;
  grid-template-columns: var(--imqw-tree) 6px minmax(0, 1fr);
}
.imqw-conversation-grid[data-settings='true'] {
  grid-template-columns: var(--imqw-tree) 6px minmax(0, 1fr) 6px var(--imqw-settings);
}
.imqw-conversation-grid[hidden] { display: none; }
.imqw-robots, .imqw-conversation-grid > :is(aside, section), .imqw-empty, .imqw-robot-settings {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}
.imqw-robots, .imqw-settings { background: var(--dsw-alias-bg-layer-2); }
.imqw-layout[data-collapsed='true'] .imqw-robots { border-right: 1px solid var(--dsw-alias-border-l2); }
.imqw-divider {
  position: relative;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  z-index: 1;
}
.imqw-divider::before {
  content: '';
  position: absolute;
  inset: 0 2px;
  border-left: 1px solid var(--dsw-alias-border-l2);
}
.imqw-divider::after {
  content: '';
  position: absolute;
  inset: 0 -3px;
}
.imqw-divider:hover::before, .imqw-divider:active::before, .imqw-divider:focus-visible::before {
  border-left: 2px solid var(--dsw-focus-ring-color);
}
.imqw-divider:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}
.imqw-robot-settings { height: 100%; box-sizing: border-box; padding: 24px clamp(16px, 4%, 48px); }
.imqw-robot-settings-inner { width: 100%; max-width: 740px; margin-inline: auto; }
.imqw-robot-settings-head { margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.imqw-robot-settings-head button { flex: none; }
.imqw-layout .imqw-robot-settings-head h2 { font-size: 20px; margin-bottom: 4px; }
.imqw-robot-settings .imqr-inline {
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  padding: 16px;
}
.imqw-primary-settings { margin-top: 20px; }
.imqw-primary-settings .imqb2-group-title { padding-top: 20px; font-size: 13px; }
.imqw-robots .imqr-row[data-selected], .imqw-peer[data-selected] > .imqw-peer-row {
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-robots .imqr-actions { flex-wrap: wrap; gap: 4px; }
.imqw-robots .imqr-rail .imqr-row { display: grid; grid-template-columns: minmax(0, 1fr); padding: 6px; }
.imqw-robots .imqr-row > .imqr-actions { justify-content: flex-end; }
.imqw-robots .imqb-status-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imqw-robots .imqr-rail > .imqr-header { margin-bottom: 6px; }
.imqw-layout[data-collapsed='true'] .imqw-robots { padding-inline: 7px; }
.imqw-layout[data-collapsed='true'] .imqr-header .imqr-actions { flex-direction: column; margin-inline: auto; }
.imqw-layout[data-collapsed='true'] .imqr-select { justify-content: center; }
.imqw-layout h2, .imqw-layout h3, .imqw-layout p { margin: 0; }
.imqw-layout h2 { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.imqw-layout h3 { font-size: 13px; line-height: 1.5; }
.imqw-column-head, .imqw-receiving {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.imqw-column-head > *, .imqw-receiving > * { min-width: 0; }
.imqw-main-head { flex-wrap: wrap; align-items: flex-start; }
.imqw-conversation-grid > .imqw-conversation { display: flex; flex-direction: column; overflow: hidden; }
.imqw-settings > .imqw-column-head { margin-bottom: 3px; }
.imqw-layout .imqw-session-caption { margin-top: 4px; }
.imqw-timeline { min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.imqw-timeline-header { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 6px; }
.imqw-timeline-scroll { min-height: 0; flex: 1; overflow: auto; overflow-anchor: none; padding-inline: 2px; }
.imqw-timeline-list { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0 0 8px; list-style: none; }
.imqw-timeline-row { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 88%; }
.imqw-timeline-row[data-direction='outbound'] { align-self: flex-end; align-items: flex-end; }
.imqw-timeline-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqw-timeline-meta:empty { display: none; }
.imqw-timeline-meta [data-status='rejected'] { color: var(--dsw-alias-text-red, #ce5260); }
.imqw-timeline-bubble { padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); min-width: 0; max-width: 100%; }
.imqw-timeline-row[data-direction='outbound'] .imqw-timeline-bubble { background: var(--dsw-alias-bg-layer-3); }
.imqw-timeline-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.imqw-timeline-older { display: flex; justify-content: center; padding-bottom: 10px; }
.imqw-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.imqw-muted {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.imqw-layout .imqw-tree-caption { margin-bottom: 10px; }
.imqw-tree input[type='search'], .imqw-tree > :has(> input[type='search']) {
  box-sizing: border-box;
  width: 100%;
}
.imqw-tree > * + * { margin-top: 8px; }
.imqw-group { margin-top: 16px; }
.imqw-group > h3 {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  padding-inline: 6px;
  font-size: 12px;
}
.imqw-peer-row {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-block: 3px;
  border-radius: 8px;
}
.imqw-peer-row > .imqw-chevron { flex: none; width: 26px; padding-inline: 0; justify-content: center; }
.imqw-chevron[aria-expanded='false'] svg { transform: rotate(-90deg); }
.imqw-peer-select, .imqw-session {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 6px 5px;
  border: 0;
  border-radius: 7px;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: transparent;
}
.imqw-peer-select { flex: 1; }
.imqw-peer-select strong, .imqw-session-title {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.imqw-session:hover, .imqw-peer-select:hover, .imqw-robots .imqr-select:hover {
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-session:disabled { cursor: default; opacity: .65; }
.imqw-session:focus-visible, .imqw-peer-select:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: -2px;
}
.imqw-sessions {
  margin: 0 0 8px 15px;
  padding-left: 11px;
  border-left: 1px solid var(--dsw-alias-border-l2);
  list-style: none;
}
.imqw-session { width: 100%; }
.imqw-form, .imqw-session-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.imqw-details {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  margin: 0;
  font-size: 12px;
}
.imqw-details dt { color: var(--dsw-alias-label-tertiary); }
.imqw-details dd { margin: 0; overflow-wrap: anywhere; }
.imqw-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
.imqw-field input { width: 100%; min-width: 0; }
.imqw-receiving { font-size: 13px; }
.imqw-form > footer { justify-content: flex-end; }
.imqw-session-settings {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
.imqw-conflict { display: flex; flex-wrap: wrap; gap: 8px; }
.imqw-small-nav { display: none; }
@container imqq-workbench (max-width: 920px) {
  .imqw-conversation-grid > :is(aside, section) { padding: 12px; }
  .imqw-layout .imqr-rail > .imqr-header { justify-content: center; }
  .imqw-layout .imqr-rail > .imqr-header h2, .imqw-layout .imqr-rail .imqb-status-meta { display: none; }
  .imqw-layout .imqr-header .imqr-actions { justify-content: center; }
  .imqw-layout .imqr-select { justify-content: center; }
  .imqw-layout .imqr-row > .imqr-actions { justify-content: center; width: 100%; }
}
.imqw-layout[data-single-page='true'] .imqw-conversation-grid {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
}
.imqw-layout[data-single-page='true'] .imqw-conversation-grid > :is(.imqw-tree, .imqw-conversation, .imqw-settings) {
  display: none;
  grid-area: 1 / 1;
}
.imqw-layout[data-single-page='true'] [data-page='list'] > .imqw-tree,
.imqw-layout[data-single-page='true'] [data-page='settings'] > .imqw-settings { display: block; }
.imqw-layout[data-single-page='true'] [data-page='conversation'] > .imqw-conversation { display: flex; }
.imqw-layout[data-single-page='true'] .imqw-small-nav {
  display: flex;
  grid-row: 2;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
@container imqq-workbench (max-width: 540px) {
  .imqw-robot-settings { padding: 16px 12px; }
  .imqw-robot-settings .imqb2-head:has([role='tablist']), .imqw-robot-settings .imqb2-selector-head {
    align-items: stretch;
    flex-direction: column;
  }
}
`;

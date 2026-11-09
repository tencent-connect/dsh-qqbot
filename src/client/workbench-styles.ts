export const WORKBENCH_STYLES = `
.imqw-root {
  container: imqq-workbench / inline-size;
  min-width: 0;
  height: 100%;
  min-height: 0;
  color: var(--dsw-alias-label-primary);
}
.imqw-layout {
  --imqw-rail: 188px;
  --imqw-tree: clamp(208px, 22%, 286px);
  --imqw-settings: clamp(256px, 27%, 336px);
  display: grid;
  grid-template-columns: var(--imqw-rail) var(--imqw-tree) minmax(0, 1fr) var(--imqw-settings);
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2);
}
.imqw-layout[data-collapsed='true'] { --imqw-rail: 60px; }
.imqw-layout[data-settings='false'] { grid-template-columns: var(--imqw-rail) var(--imqw-tree) minmax(0, 1fr); }
.imqw-layout[data-empty='true'] { grid-template-columns: var(--imqw-rail) minmax(0, 1fr); }
.imqw-layout > :is(aside, section) {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.imqw-robots, .imqw-tree { border-right: 1px solid var(--dsw-alias-border-l2); }
.imqw-settings { border-left: 1px solid var(--dsw-alias-border-l2); }
.imqw-robots, .imqw-settings { background: var(--dsw-alias-bg-layer-2); }
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
.imqw-summary, .imqw-form, .imqw-session-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.imqw-summary {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
}
.imqw-note {
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
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
.imqw-session-settings, .imqw-legacy {
  border-top: 1px solid var(--dsw-alias-border-l2);
  padding-top: 12px;
}
.imqw-legacy { margin-top: 18px; }
.imqw-conflict { display: flex; flex-wrap: wrap; gap: 8px; }
.imqw-small-nav { display: none; }
@container imqq-workbench (max-width: 920px) {
  .imqw-layout { --imqw-rail: 60px; --imqw-tree: clamp(164px, 26%, 232px); --imqw-settings: 234px; }
  .imqw-layout > :is(aside, section) { padding: 10px; }
  .imqw-layout .imqw-robots { padding-inline: 7px; }
  .imqw-layout .imqr-rail > .imqr-header { justify-content: center; }
  .imqw-layout .imqr-rail > .imqr-header h2, .imqw-layout .imqr-rail .imqb-status-meta { display: none; }
  .imqw-layout .imqr-header .imqr-actions { justify-content: center; }
  .imqw-layout .imqr-select { justify-content: center; }
  .imqw-layout .imqr-row > .imqr-actions { justify-content: center; width: 100%; }
}
@container imqq-workbench (max-width: 680px) {
  .imqw-layout, .imqw-layout[data-settings='false'] {
    grid-template-columns: 60px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
  }
  .imqw-robots { grid-row: 1 / -1; }
  .imqw-layout > :is(.imqw-tree, .imqw-conversation, .imqw-settings) { display: none; grid-column: 2; grid-row: 1; }
  .imqw-layout[data-page='list'] > .imqw-tree,
  .imqw-layout[data-page='conversation'] > .imqw-conversation,
  .imqw-layout[data-page='settings'] > .imqw-settings { display: block; }
  .imqw-settings { border-left: 0; }
  .imqw-small-nav {
    display: flex;
    grid-column: 2;
    grid-row: 2;
    flex-wrap: wrap;
    gap: 4px;
    padding: 5px;
    border-top: 1px solid var(--dsw-alias-border-l2);
  }
}
`;

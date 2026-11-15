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
.imqw-primary-settings {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.imqw-robot-tab { margin-top: 16px; }
.imqw-primary-settings .imqb2-group-title { padding-top: 20px; font-size: 13px; }
.imqw-peer[data-selected] > .imqw-peer-row {
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-robots .imqr-actions { flex-wrap: wrap; gap: 4px; }
.imqw-robots .imqb-status-meta > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.imqw-robots .imqr-rail > .imqr-header { margin-bottom: 6px; }
.imqw-layout[data-collapsed='true'] .imqw-robots { padding-inline: 7px; }
.imqw-layout[data-collapsed='true'] .imqr-header .imqr-actions { flex-direction: column; margin-inline: auto; }
.imqw-layout[data-collapsed='true'] .imqr-select { justify-content: center; }
.imqw-layout[data-collapsed='true'] .imqr-row { padding: 3px; }
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
.imqw-main-head {
  flex-wrap: wrap; flex: none; padding-bottom: 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.imqw-main-head .imqw-actions { margin-inline-start: auto; align-items: center; max-width: 100%; }
.imqw-column-head .imqw-icon-action { flex: none; width: 28px; padding-inline: 0; }
.imqw-main-title { flex: 1 1 10ch; }
.imqw-main-title h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-conversation-grid > .imqw-conversation {
  container: imqq-messages / inline-size;
  display: flex; flex-direction: column; overflow: hidden;
}
@container imqq-messages (max-width: 360px) {
  .imqw-main-title { flex-basis: 100%; }
  .imqw-main-head .imqw-actions { margin-inline-start: 0; }
}
.imqw-settings > .imqw-column-head { margin-bottom: 3px; }
.imqw-settings .imqw-column-head { align-items: flex-start; padding-bottom: 12px; }
.imqw-settings .imqw-column-head p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-settings .imqw-column-head .imqw-actions { flex: none; }
.imqw-settings-trigger[aria-expanded='true'] { background: var(--dsw-alias-bg-layer-3); }
.imqw-timeline { position: relative; min-height: 0; flex: 1; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.imqw-timeline-notice { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.imqw-timeline-notice button { margin-inline-start: auto; flex: none; }
.imqw-timeline-scroll { min-height: 0; flex: 1; overflow: auto; overflow-anchor: none; padding: 2px 4px 8px; }
.imqw-timeline-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
.imqw-message-day, .imqw-timeline-empty { align-self: center; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 11px; padding: 6px; }
.imqw-timeline-row { display: flex; align-items: flex-start; gap: 8px; align-self: flex-start; max-width: min(88%, 700px); min-width: 0; }
.imqw-timeline-row[data-direction='outbound'] { align-self: flex-end; flex-direction: row-reverse; }
.imqw-timeline-row[data-compact='true'] { margin-top: -6px; }
.imqw-message-avatar { display: grid; place-items: center; flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.imqw-timeline-row[data-compact='true'] .imqw-message-avatar { visibility: hidden; }
.imqw-message-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; align-items: flex-start; }
.imqw-timeline-row[data-direction='outbound'] .imqw-message-body { align-items: flex-end; }
.imqw-message-line { display: flex; align-items: center; gap: 3px; min-width: 0; max-width: 100%; }
.imqw-message-line > span { flex: none; }
.imqw-timeline-row[data-direction='outbound'] .imqw-message-line { flex-direction: row-reverse; }
.imqw-timeline-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 11px; min-width: 0; }
.imqw-timeline-meta strong { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-timeline-meta:empty { display: none; }
.imqw-timeline-meta [data-status='rejected'] { color: var(--dsw-alias-text-red, #ce5260); }
.imqw-response-detail { max-width: 100%; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
.imqw-response-detail p { margin: 4px 0; }
.imqw-timeline-bubble { padding: 7px 10px; border-radius: 4px 12px 12px; background: var(--dsw-alias-bg-module-platform); box-sizing: border-box; min-width: 0; max-width: 100%; }
.imqw-timeline-row[data-direction='outbound'] .imqw-timeline-bubble { border-radius: 12px 4px 12px 12px; background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 15%, var(--dsw-alias-bg-layer-2)); }
.imqw-timeline-bubble blockquote { border-inline-start: 2px solid var(--dsw-alias-border-l2); margin: 0 0 5px; padding: 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
.imqw-timeline-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.5; }
.imqw-message-images { display: flex; flex-wrap: wrap; gap: 6px; margin-block: 4px; }
.imqw-message-image { display: block; width: min(200px, 100%); aspect-ratio: 4 / 3; overflow: hidden; border-radius: 8px; }
.imqw-message-image img { display: block; width: 100%; height: 100%; object-fit: contain; background: var(--dsw-alias-bg-layer-2); }
.imqw-timeline-older { display: flex; justify-content: center; padding-bottom: 8px; }
.imqw-message-line button.imqw-message-action { padding: 0; width: 26px; color: var(--dsw-alias-label-secondary); }
@media (hover: hover) {
  .imqw-message-line button.imqw-message-action { opacity: .6; }
  .imqw-message-line:is(:hover, :focus-within) button.imqw-message-action,
  .imqw-message-line button.imqw-message-action[aria-expanded='true'] { opacity: 1; }
}
.imqw-message-jump { display: flex; justify-content: center; }
.imqw-composer {
  flex: none; display: grid; gap: 5px; padding: 7px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
}
.imqw-composer:has(textarea:focus) { border-color: var(--dsw-focus-ring-color); }
.imqw-composer > textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  max-height: 160px;
  field-sizing: content;
  resize: none;
  background: transparent;
  color: inherit;
  border: 0;
  outline: none;
  padding: 3px 5px;
  font: inherit;
  line-height: 20px;
}
.imqw-composer-toolbar, .imqw-composer-feedback:not([hidden]) {
  display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px;
}
.imqw-composer-toolbar button { flex: none; white-space: nowrap; }
.imqw-compose-as { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-compose-shortcut { white-space: nowrap; }
.imqw-composer-toolbar button.imqw-send {
  min-height: 32px;
  background: var(--dsw-alias-button-info-fill);
  color: light-dark(#fff, #15171a);
}
@media (hover: hover) {
  .imqw-composer-toolbar button.imqw-send:hover:not(:disabled) {
    background: color-mix(in srgb, var(--dsw-alias-button-info-fill) 93%, black);
  }
}
.imqw-composer-attachment {
  display: flex; align-items: center; gap: 6px; min-width: 0; padding-inline: 7px 2px;
  border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-secondary); font-size: 12px;
}
.imqw-composer-quote { border-inline-start: 2px solid var(--dsw-alias-button-info-fill); }
.imqw-composer-attachment button { margin-inline-start: auto; flex: none; }
.imqw-composer-attachment span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.imqw-composer-feedback { flex-wrap: wrap; }
@container imqq-messages (max-width: 420px) {
  .imqw-compose-shortcut { display: none; }
}
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
.imqw-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.imqw-settings .imqw-form { min-height: 100%; gap: 0; }
.imqw-settings:has(> .imqw-extension-settings) .imqw-form { min-height: 0; }
.imqw-settings-group { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqw-settings-group > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-block: 12px;
  font-size: 13px;
  cursor: pointer;
  list-style: none;
}
.imqw-settings-group > summary::-webkit-details-marker { display: none; }
.imqw-settings-group > summary > svg { flex: none; }
.imqw-settings-group:not([open]) > summary > svg { transform: rotate(-90deg); }
.imqw-settings-group > summary > .imqw-muted { margin-inline-start: auto; text-align: end; }
.imqw-settings-group-body { display: grid; gap: 12px; min-width: 0; padding-bottom: 12px; }
.imqw-group-guide-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.imqw-group-guide-heading button { flex: none; }
.imqw-group-guide-dialog { max-height: 100%; }
.imqw-group-guide-scroll { min-height: 0; overflow-y: auto; }
.imqw-group-guide-image { display: block; width: 100%; height: auto; border-radius: 6px; }
.imqw-settings-meta > summary { color: var(--dsw-alias-label-tertiary); font-size: 12px; cursor: pointer; }
.imqw-settings-meta[open] > summary { margin-bottom: 8px; }
.imqw-settings summary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.imqw-defaults-form { max-width: 620px; }
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
.imqw-savebar {
  position: sticky;
  bottom: 0;
  padding-block: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.imqw-settings .imqw-savebar { margin-top: auto; background: var(--dsw-alias-bg-layer-2); }
.imqw-agent-fields, .imqw-model-fields { display: grid; gap: 12px; min-width: 0; }
.imqw-prompt-editor {
  display: grid; gap: 8px; min-width: 0; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
  font-size: 13px;
}
.imqw-prompt-fields { display: grid; gap: 8px; min-width: 0; }
.imqw-prompt-toolbar, .imqw-prompt-status {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
}
.imqw-prompt-path { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqw-prompt-path input { flex: 1 1 180px; min-width: 0; }
.imqw-prompt-path button { flex: none; }
.imqw-prompt-surface {
  box-sizing: border-box; height: 128px; min-height: 106px; max-height: 340px;
  overflow: hidden; resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-3);
}
.imqw-prompt-surface > [role='tabpanel'] { height: 100%; }
.imqw-prompt-surface :is(textarea, .imqw-prompt-preview) {
  display: block; box-sizing: border-box; width: 100%; height: 100%; margin: 0;
  padding: 9px 10px; overflow: auto; border: 0; background: transparent; color: inherit;
  font: inherit; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; resize: none;
}
.imqw-prompt-surface:has(:focus-visible) {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color);
  outline-offset: 1px;
}
.imqw-prompt-surface :is(textarea, .imqw-prompt-preview):focus-visible { outline: none; }
.imqw-prompt-editor p { margin: 0; }
.imqw-current-session {
  display: grid; justify-items: start; gap: 6px; min-width: 0;
  padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md); font-size: 13px;
}
.imqw-agent-default-heading { font-size: 13px; }
.imqw-current-session p, .imqw-agent-default-heading p, .imqw-receiving p { margin: 0; }
.imqw-tools-modal { width: min(720px, 100%); max-height: 100%; }
.imqw-tools-content { min-height: 0; overflow: auto; }
.imqw-tools-editor, .imqw-tools-templates { display: grid; gap: 8px; min-width: 0; }
.imqw-tools-editor { gap: 10px; }
.imqw-tools-editor p { margin: 0; }
.imqw-tools-templates { padding-block: 10px; border-block: 1px solid var(--dsw-alias-border-l2); }
.imqw-tools-templates .imqw-actions { align-items: center; }
.imqw-tools-combinations { display: grid; gap: 6px; }
.imqw-tools-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; }
.imqw-combination-list { max-height: 106px; overflow: auto; }
.imqw-tools-templates button[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-3); }
.imqw-tools-combination {
  display: flex; min-width: 0; max-width: 100%;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
}
.imqw-tools-combination > button:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.imqw-tools-combination-input, .imqw-tools-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.imqw-tools-combination-input input, .imqw-tools-filters input[type='search'] { min-width: 120px; flex: 1; }
.imqw-tools-combination-hint { flex-basis: 100%; }
.imqw-tools-selected {
  display: grid; gap: 6px; min-width: 0; padding: 6px 10px 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
}
.imqw-selected-list {
  display: flex; flex-wrap: wrap; gap: 6px; max-height: 104px; overflow: auto; margin: 0; padding: 0; list-style: none;
}
.imqw-selected-list li {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 100%;
  padding-inline-start: 7px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-3); font-size: 12px;
}
.imqw-selected-list code, .imqw-tool-changes code { overflow-wrap: anywhere; }
.imqw-selected-list button { flex: none; padding-inline: 6px; height: 24px; }
.imqw-tool-changes {
  display: grid; gap: 3px; max-height: 100px; overflow: auto; padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l2); font-size: 12px;
}
.imqw-tools-categories, .imqw-tools-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.imqw-tool-list {
  max-height: min(36vh, 320px); overflow: auto;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
}
.imqw-tool-group + .imqw-tool-group { border-top: 1px solid var(--dsw-alias-border-l2); }
.imqw-tool-group-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 8px 2px 12px;
  position: sticky; z-index: 1; top: 0; background: var(--dsw-alias-bg-layer-3); font-size: 12px;
}
.imqw-tool-check { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; font-size: 13px; }
.imqw-tool-check input { flex: none; margin: 2px 0 0; accent-color: var(--dsw-focus-ring-color); }
.imqw-tool-list .imqw-tool-check { padding: 8px 12px; overflow-wrap: anywhere; }
.imqw-tool-list .imqw-tool-check:is(:hover, :focus-within) { background: var(--dsw-alias-bg-layer-3); }
.imqw-tool-list .imqw-tool-check span { min-width: 0; }
.imqw-tool-list small { display: block; color: var(--dsw-alias-label-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.imqw-tools-footer { width: 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-selectAnchor { min-width: 0; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-select {
  width: 100%;
  min-height: 30px;
  height: auto;
  justify-content: space-between;
  padding-block: 5px;
  text-align: left;
}
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-selectValue { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
:is(.imqw-agent-fields, .imqw-tools-editor) .imqq-select svg { flex: none; }
.imqq-selectChoice { display: grid; gap: 2px; overflow-wrap: anywhere; }
.imqq-selectDescription { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.imqw-conflict { display: flex; flex-wrap: wrap; gap: 8px; }
.imqw-small-nav { display: none; }
@container imqq-workbench (max-width: 920px) {
  .imqw-conversation-grid > :is(aside, section) { padding: 12px; }
  .imqw-layout .imqr-rail > .imqr-header { justify-content: center; }
  .imqw-layout .imqr-rail > .imqr-header h2, .imqw-layout .imqr-rail .imqb-status-meta { display: none; }
  .imqw-layout .imqr-header .imqr-actions { justify-content: center; }
  .imqw-layout .imqr-select { justify-content: center; }
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
.imqw-layout .imqw-conversation-grid > .imqw-settings[hidden] { display: none; }
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
  .imqw-robot-settings .imqb2-head:has([role='tablist']) {
    align-items: stretch;
    flex-direction: column;
  }
}
`;

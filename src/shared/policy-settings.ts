import type { ConversationSandboxMode } from './conversation-protocol.ts';

export const CONVERSATION_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export const CONTEXT_LIMITS = {
  maxMessages: { min: 0, max: 100 },
  maxAgeMinutes: { min: 1, max: 1440 },
  maxChars: { min: 0, max: 32000 },
  retentionDays: { min: 1, max: 365 },
} as const;

/** Only these Host preset ids declare the matching sandbox; custom ids remain opaque. */
export function permissionSandbox(permission: string): ConversationSandboxMode | undefined {
  return CONVERSATION_SANDBOX_MODES.find(mode => mode === permission);
}

import type { WorkbenchConversation } from '../shared/workbench-conversation-protocol.ts';
import { agentSettingsPatch } from './agent-settings-draft.ts';
import type { RobotAccountDrafts } from './robot-accounts.ts';

export type SmallPage = 'list' | 'conversation' | 'settings';
type EditableSettings = Pick<WorkbenchConversation, 'alias' | 'receiving' | 'retention' | 'agent'>;

export interface Draft extends EditableSettings {
  baseline: EditableSettings & Pick<WorkbenchConversation, 'revision' | 'defaultsRevision'>;
}

export interface Navigation {
  appId?: string;
  collapsed: boolean;
  peerSettingsOpen: boolean;
  smallPage: SmallPage;
}

export function conversationKey({ scope, openId }: WorkbenchConversation): string {
  return scope + ':' + openId;
}

export function scopedKey(appId: string, peer: WorkbenchConversation): string {
  return JSON.stringify([appId, peer.scope, peer.openId]);
}

export function selectDraft(peer: WorkbenchConversation): Draft {
  const { alias, receiving, retention, agent, revision, defaultsRevision } = peer;
  return { alias, receiving, retention, agent, baseline: { alias, receiving, retention, agent, revision, defaultsRevision } };
}

export function changes(draft: Draft): Partial<EditableSettings> {
  const agentChanged = draft.agent && draft.baseline.agent
    ? Object.keys(agentSettingsPatch(draft.baseline.agent, draft.agent)).length > 0
    : draft.agent !== draft.baseline.agent;
  return {
    ...(draft.alias !== draft.baseline.alias ? { alias: draft.alias } : {}),
    ...(draft.receiving !== draft.baseline.receiving ? { receiving: draft.receiving } : {}),
    ...(draft.retention !== draft.baseline.retention ? { retention: draft.retention } : {}),
    ...(agentChanged ? { agent: draft.agent } : {}),
  };
}

export function mergeDraft(peer: WorkbenchConversation, draft: Draft, edited: Partial<EditableSettings>): Draft {
  const latest = selectDraft(peer);
  const next = { ...latest, ...edited };
  const { agent } = edited;
  const baseline = draft.baseline.agent;
  if (latest.agent && agent && baseline) {
    next.agent = { ...latest.agent, ...agentSettingsPatch(baseline, agent) };
  }
  return next;
}

export interface SessionNavigation {
  openSession?: (id: string) => void;
  prepareSession?: (id: string) => Promise<void> | undefined;
  restoreSession?: (id: string) => Promise<void>;
  archivedSessionIds?: readonly string[];
  sessionTitle?: (id: string) => string | undefined;
  workspaceTitle?: (id: string, cwd?: string) => string | undefined;
}


export class WorkbenchState {
  readonly navigation: Navigation = { collapsed: false, peerSettingsOpen: true, smallPage: 'list' };
  readonly peerSelections = new Map<string, string>();
  readonly expandedPeers = new Set<string>();
  readonly showAllSessions = new Set<string>();
  readonly peerDrafts = new Map<string, Draft>();
  readonly sessionOrigins = new Map<string, { appId: string; peerKey: string }>();
  readonly accountDrafts: RobotAccountDrafts = new Map();

  restoreQqSessionOrigin(sessionId: string): boolean {
    const origin = this.sessionOrigins.get(sessionId);
    if (!origin) return false;
    this.navigation.appId = origin.appId;
    this.navigation.smallPage = 'conversation';
    this.peerSelections.set(origin.appId, origin.peerKey);
    return true;
  }
}

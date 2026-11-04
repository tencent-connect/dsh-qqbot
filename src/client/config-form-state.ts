/** Editable QQ settings and field-level draft reconciliation. */
export interface AccessControlWire {
  c2cMode: 'open' | 'allowlist' | 'disabled';
  c2cAllow: string[];
  commandMode?: 'open' | 'allowlist' | 'disabled';
  groupMode: 'open' | 'allowlist' | 'disabled';
  groupAllow: string[];
}

/** Credential secrets are never included in the browser settings response. */
export interface ConfigWire {
  appId?: string;
  requireMention?: boolean;
  streaming?: boolean;
  showToolResults?: boolean;
  debug?: boolean;
  provider?: string;
  model?: string;
  preset?: string;
  groupPrompt?: string;
  directPrompt?: string;
  access?: AccessControlWire;
  cwd?: string;
}

const EDITABLE_KEYS = ['access'] as const;
const ACCESS_KEYS = ['c2cMode', 'c2cAllow', 'groupMode', 'groupAllow', 'commandMode'] as const;

export const DEFAULT_ACCESS: AccessControlWire = {
  c2cMode: 'allowlist', c2cAllow: [], groupMode: 'open', groupAllow: [], commandMode: 'allowlist',
};

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Preserve raw textarea lines while editing; normalize only the submitted snapshot. */
export function normalizeConfig(form: ConfigWire): ConfigWire {
  if (form.access === undefined) return { ...form };
  const lines = (values: string[]): string[] => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return {
    ...form,
    access: { ...form.access, c2cAllow: lines(form.access.c2cAllow), groupAllow: lines(form.access.groupAllow) },
  };
}

/** Build the writable difference without submitting account or working-directory fields. */
export function configPatch(baseline: ConfigWire, form: ConfigWire): Partial<ConfigWire> {
  const changed: Partial<ConfigWire> = {};
  for (const key of EDITABLE_KEYS) {
    if (!equal(form[key], baseline[key])) Object.assign(changed, { [key]: form[key] });
  }
  return changed;
}

export function isConfigDirty(baseline: ConfigWire, form: ConfigWire): boolean {
  return Object.keys(configPatch(baseline, form)).length > 0;
}

/** Refresh untouched fields while preserving local edits, including individual access fields. */
export function rebaseConfig(baseline: ConfigWire, form: ConfigWire, incoming: ConfigWire): ConfigWire {
  const rebased = { ...incoming };
  for (const key of EDITABLE_KEYS) {
    if (key !== 'access' && !equal(form[key], baseline[key])) Object.assign(rebased, { [key]: form[key] });
  }
  if (form.access !== undefined && !equal(form.access, baseline.access)) {
    const access = { ...(incoming.access ?? DEFAULT_ACCESS) };
    for (const key of ACCESS_KEYS) {
      if (!equal(form.access[key], baseline.access?.[key])) Object.assign(access, { [key]: form.access[key] });
    }
    rebased.access = access;
  }
  return rebased;
}

/** A saved draft contains only the settings edited by this tab, never credentials. */
export interface ConfigDraft {
  baseline: ConfigWire;
  form: ConfigWire;
}

/** Pick the supported fields so stored browser drafts cannot retain a future secret response field. */
export function configDraft(baseline: ConfigWire, form: ConfigWire): ConfigDraft {
  const pick = (source: ConfigWire): ConfigWire => {
    const value: ConfigWire = {};
    if (source.appId !== undefined) value.appId = source.appId;
    for (const key of EDITABLE_KEYS) {
      if (source[key] !== undefined) Object.assign(value, { [key]: source[key] });
    }
    return value;
  };
  return { baseline: pick(baseline), form: pick(form) };
}

/** Ignore malformed tab storage instead of rendering unchecked field values. */
export function parseConfigDraft(value: unknown): ConfigDraft | undefined {
  const validConfig = (candidate: unknown): candidate is ConfigWire => {
    if (candidate === null || typeof candidate !== 'object') return false;
    const fields = candidate as Record<string, unknown>;
    for (const key of ['appId', 'provider', 'model', 'preset', 'groupPrompt', 'directPrompt']) {
      if (fields[key] !== undefined && typeof fields[key] !== 'string') return false;
    }
    for (const key of ['requireMention', 'streaming', 'showToolResults', 'debug']) {
      if (fields[key] !== undefined && typeof fields[key] !== 'boolean') return false;
    }
    if (fields.access !== undefined) {
      if (fields.access === null || typeof fields.access !== 'object') return false;
      const access = fields.access as Record<string, unknown>;
      for (const key of ['c2cMode', 'groupMode']) {
        if (!['open', 'allowlist', 'disabled'].includes(String(access[key]))) return false;
      }
      if (access.commandMode !== undefined && (typeof access.commandMode !== 'string' || !['open', 'allowlist', 'disabled'].includes(access.commandMode))) return false;
      for (const key of ['c2cAllow', 'groupAllow']) {
        if (!Array.isArray(access[key]) || !access[key].every((entry: unknown) => typeof entry === 'string')) return false;
      }
    }
    return true;
  };
  if (value === null || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  return validConfig(stored.baseline) && validConfig(stored.form)
    ? configDraft(stored.baseline, stored.form)
    : undefined;
}

import { readFileSync } from 'node:fs';
import type { Context } from '@deepseek-ai/cordis';
import { atomicWrite } from '../shared/atomic-file.ts';
import {
  WORKBENCH_EXTENSION_SETTINGS_PATH,
  type QqExtensionScope,
  type QqExtensionSettingsDefinition,
  type QqExtensionSettingsSnapshot,
  type QqExtensionValues,
} from '../shared/workbench-extension.ts';
import { robotAppId, robotObject, robotRevision } from './robot-config.ts';
import { validOpenId } from './workbench-conversations.ts';
import { registerWorkbenchFetch, workbenchJson, WorkbenchRequestError } from './workbench-routes.ts';

interface SavedSettings {
  revision: number;
  overrides: unknown;
}

const globalScope = { kind: 'global' } as const;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('扩展配置格式无效。');
  return value as Record<string, unknown>;
}

function extensionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) throw new Error('扩展 ID 无效。');
  return value;
}

function parseScope(input: unknown): QqExtensionScope {
  const { kind, appId, scope, openId } = robotObject(input, ['kind', 'appId', 'scope', 'openId']);
  if (kind === 'global' && appId === undefined && scope === undefined && openId === undefined) return globalScope;
  if (kind === 'robot' && scope === undefined && openId === undefined) return { kind, appId: robotAppId(appId) };
  if (kind === 'conversation' && (scope === 'group' || scope === 'c2c') && validOpenId(openId)) {
    return { kind, appId: robotAppId(appId), scope, openId };
  }
  throw new Error('扩展配置范围无效。');
}

function scopeKey(id: string, scope: QqExtensionScope): string {
  switch (scope.kind) {
    case 'global': return JSON.stringify([id]);
    case 'robot': return JSON.stringify([id, scope.appId]);
    case 'conversation': return JSON.stringify([id, scope.appId, scope.scope, scope.openId]);
  }
}

function inheritance(scope: QqExtensionScope): QqExtensionScope[] {
  switch (scope.kind) {
    case 'global': return [globalScope];
    case 'robot': return [globalScope, scope];
    case 'conversation': return [globalScope, { kind: 'robot', appId: scope.appId }, scope];
  }
}

function validateOverrides(definition: QqExtensionSettingsDefinition, input: unknown): QqExtensionValues {
  const parsed = definition.parseOverrides(robotObject(input, Object.keys(definition.defaults)));
  robotObject(parsed, Object.keys(definition.defaults));
  return parsed;
}

export class WorkbenchExtensionSettings {
  private readonly definitions = new Map<string, QqExtensionSettingsDefinition>();

  constructor(private readonly path: string) {}

  registerSettings(definition: QqExtensionSettingsDefinition): () => void {
    const id = extensionId(definition.id);
    if (this.definitions.has(id)) throw new Error(`Duplicate QQ extension settings: ${id}`);
    const registered = { ...definition, defaults: structuredClone(definition.defaults) };
    validateOverrides(registered, registered.defaults);
    this.definitions.set(id, registered);
    return () => {
      if (this.definitions.get(id) === registered) this.definitions.delete(id);
    };
  }

  getSettings(id: string, scope: QqExtensionScope): QqExtensionSettingsSnapshot {
    const definition = this.definition(id);
    return this.resolve(definition, parseScope(scope), this.read());
  }

  saveSettings(id: string, scope: QqExtensionScope, revision: number, input: unknown): QqExtensionSettingsSnapshot {
    const definition = this.definition(id);
    const key = scopeKey(id, scope);
    const rows = this.read();
    if (revision !== (rows.get(key)?.revision ?? 0)) {
      throw new WorkbenchRequestError(409, '扩展设置已变更，请重新读取后再保存。');
    }
    const overrides = clientInput(() => validateOverrides(definition, input));
    rows.set(key, { revision: revision + 1, overrides });
    const snapshot = this.resolve(definition, scope, rows);
    atomicWrite(this.path, [JSON.stringify({ version: 1, rows: Object.fromEntries(rows) }), '\n']);
    return snapshot;
  }

  private definition(id: string): QqExtensionSettingsDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new WorkbenchRequestError(404, '此 QQ 扩展未安装或尚未注册设置。');
    return definition;
  }

  private read(): Map<string, SavedSettings> {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return new Map();
      throw error;
    }
    const { version, rows } = record(JSON.parse(text));
    if (version !== 1) throw new Error('扩展配置存储版本无效。');
    return new Map(Object.entries(record(rows)).map(([key, value]) => {
      const { revision, overrides } = record(value);
      return [key, { revision: robotRevision(revision), overrides: record(overrides) }];
    }));
  }

  private resolve(
    definition: QqExtensionSettingsDefinition,
    scope: QqExtensionScope,
    rows: ReadonlyMap<string, SavedSettings>,
  ): QqExtensionSettingsSnapshot {
    const effective = new Map(Object.entries(definition.defaults));
    const sources = new Map<string, 'default' | QqExtensionScope['kind']>(
      Array.from(effective.keys(), key => [key, 'default']),
    );
    let revision = 0;
    let overrides: QqExtensionValues = {};
    for (const layer of inheritance(scope)) {
      const saved = rows.get(scopeKey(definition.id, layer));
      if (saved) {
        const parsed = validateOverrides(definition, saved.overrides);
        for (const [key, value] of Object.entries(parsed)) {
          effective.set(key, value);
          sources.set(key, layer.kind);
        }
        if (layer.kind === scope.kind) {
          revision = saved.revision;
          overrides = parsed;
        }
      }
    }
    return structuredClone({ revision, overrides, effective: Object.fromEntries(effective), sources: Object.fromEntries(sources) });
  }
}

function clientInput<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new WorkbenchRequestError(400, error instanceof Error ? error.message : '扩展配置格式无效。');
  }
}

export function registerWorkbenchExtensionSettings(
  ctx: Context,
  settings: WorkbenchExtensionSettings,
  hasRobot: (appId: string) => boolean,
): void {
  registerWorkbenchFetch(ctx, WORKBENCH_EXTENSION_SETTINGS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    const text = request.method === 'POST' ? await request.text() : undefined;
    const { id, scope, revision, overrides } = clientInput(() => {
      if (text !== undefined) {
        if (Buffer.byteLength(text) > 64 * 1024) throw new Error('扩展设置请求过大。');
        const body = robotObject(JSON.parse(text), ['id', 'scope', 'revision', 'overrides']);
        return { id: extensionId(body.id), scope: parseScope(body.scope), revision: robotRevision(body.revision), overrides: body.overrides };
      }
      const entries = [...new URL(request.url).searchParams];
      const params = Object.fromEntries(entries);
      if (entries.length !== Object.keys(params).length) throw new Error('扩展设置请求包含重复参数。');
      const { id: rawId, ...rawScope } = params;
      return { id: extensionId(rawId), scope: parseScope(rawScope) };
    });
    if (scope.kind !== 'global' && !hasRobot(scope.appId)) throw new WorkbenchRequestError(404, '找不到对应机器人。');
    if (revision === undefined) return workbenchJson(settings.getSettings(id, scope));
    assertWritable();
    return workbenchJson(settings.saveSettings(id, scope, revision, overrides));
  });
}

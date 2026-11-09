import type { Context } from '@deepseek-ai/cordis';
import { WORKBENCH_ROBOTS_PATH, type WorkbenchRobot, type WorkbenchRobotPatch, type WorkbenchRobotsResponse } from '../shared/workbench-protocol.ts';
import { RobotConfigConflictError, robotAccessPatch, robotAlias, robotAppId, robotEnabled, robotObject, robotRevision, robotSecret } from './robot-config.ts';
import { WORKBENCH_DEFAULTS_PATH, WORKBENCH_TOOLS_PATH, type WorkbenchDefaults } from '../shared/workbench-agent-settings.ts';
import { parseAgentSettings } from './workbench-agent-settings.ts';
import { workbenchToolChoices } from './workbench-tools.ts';

export function registerWorkbenchTools(ctx: Context): void {
  registerWorkbenchFetch(ctx, WORKBENCH_TOOLS_PATH, ['GET'], async request => {
    const preset = new URL(request.url).searchParams.get('preset') ?? '';
    if (preset.length > 256 || preset.includes('\0')) return workbenchJson({ error: 'Agent 预设无效。' }, 400);
    try {
      return workbenchJson({ tools: await workbenchToolChoices(ctx, preset) });
    } catch (error) {
      return workbenchJson({ error: error instanceof Error ? error.message : '无法读取工具目录。' }, 503);
    }
  });
}

interface ConnectionFetchRegistry {
  register(route: {
    path: string;
    methods: readonly ('GET' | 'POST')[];
    requestBody: 'buffered';
    fetch: (request: Request) => Promise<Response>;
  }): () => Promise<void>;
}

export class WorkbenchRequestError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 503, message: string) {
    super(message);
  }
}

function publicRobot({ appId, state, primary, enabled, alias, revision, access }: WorkbenchRobot): WorkbenchRobot {
  const { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } = access;
  return { appId, state, primary, enabled, alias, revision, access: { c2cMode, groupMode, commandMode, c2cAllow, groupAllow } };
}

async function readPatch(request: Request): Promise<WorkbenchRobotPatch> {
  const text = await request.text();
  if (Buffer.byteLength(text) > 512 * 1024) throw new Error('机器人配置请求过大。');
  const { appId, revision, enabled, alias, appSecret, access } = robotObject(
    JSON.parse(text),
    ['appId', 'revision', 'enabled', 'alias', 'appSecret', 'access'],
  );
  const patch: WorkbenchRobotPatch = {
    appId: robotAppId(appId),
    revision: revision === null ? null : robotRevision(revision),
    ...(enabled === undefined ? {} : { enabled: robotEnabled(enabled) }),
    ...(alias === undefined ? {} : { alias: robotAlias(alias) }),
    ...(appSecret === undefined ? {} : { appSecret: robotSecret(appSecret) }),
    ...(access === undefined ? {} : { access: robotAccessPatch(access) }),
  };
  if (patch.revision === null && patch.appSecret === undefined) throw new Error('添加机器人时需要填写 AppSecret。');
  return patch;
}

export function workbenchJson(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function registerWorkbenchFetch(
  ctx: Context,
  path: string,
  methods: readonly ('GET' | 'POST')[],
  handle: (request: Request, assertWritable: () => void) => Promise<Response>,
): void {
  ctx.inject(['connection'], scope => {
    const connection = scope.get('connection') as { fetch?: ConnectionFetchRegistry } | undefined;
    const registry = connection?.fetch;
    // The exact Fetch registry admits only owners. Older hosts leave the endpoint unavailable.
    if (typeof registry?.register !== 'function') return;

    scope.effect(() => {
      let active = true;
      const unregister = registry.register({
        path,
        methods,
        requestBody: 'buffered',
        fetch: async request => {
          const assertActive = () => {
            if (!active) throw new WorkbenchRequestError(503, 'QQ 插件已重载，请刷新后重试。');
            if (request.signal.aborted) throw new WorkbenchRequestError(400, '请求已取消。');
          };
          try {
            assertActive();
            return await handle(request, assertActive);
          } catch (error) {
            if (error instanceof WorkbenchRequestError) return workbenchJson({ error: error.message }, error.status);
            if (error instanceof RobotConfigConflictError) return workbenchJson({ error: error.message }, 409);
            return workbenchJson({ error: 'QQ 工作台数据暂时不可用，请检查运行状态。' }, 503);
          }
        },
      });
      return () => {
        active = false;
        return unregister();
      };
    }, `im-qqbot.workbench:${path}`);
  });
}

export function registerWorkbenchRoutes(
  ctx: Context,
  listRobots: () => readonly WorkbenchRobot[],
  saveRobot?: (patch: WorkbenchRobotPatch) => WorkbenchRobot | Promise<WorkbenchRobot>,
): void {
  registerWorkbenchFetch(ctx, WORKBENCH_ROBOTS_PATH, saveRobot ? ['GET', 'POST'] : ['GET'], async (request, assertWritable) => {
    if (request.method === 'GET') {
      const response: WorkbenchRobotsResponse = { robots: listRobots().map(publicRobot) };
      return workbenchJson(response);
    }
    if (request.method !== 'POST' || !saveRobot) return workbenchJson({ error: '不支持的请求方法。' }, 405);
    let patch: WorkbenchRobotPatch;
    try {
      patch = await readPatch(request);
    } catch (error) {
      return workbenchJson({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : '机器人配置格式无效。' }, 400);
    }
    assertWritable();
    return workbenchJson({ robot: publicRobot(await saveRobot(patch)) });
  });
}

export function registerWorkbenchDefaults(ctx: Context, robots: {
  defaults(appId: string): WorkbenchDefaults;
  saveDefaults(appId: string, next: WorkbenchDefaults, assertWritable: () => void): Promise<WorkbenchDefaults>;
}): void {
  registerWorkbenchFetch(ctx, WORKBENCH_DEFAULTS_PATH, ['GET', 'POST'], async (request, assertWritable) => {
    if (request.method === 'GET') {
      let appId: string;
      try { appId = robotAppId(new URL(request.url).searchParams.get('appId')); }
      catch { throw new WorkbenchRequestError(400, '请指定一个有效的 AppID。'); }
      return workbenchJson(robots.defaults(appId));
    }
    let appId: string;
    let next: WorkbenchDefaults;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text) > 512 * 1024) throw new Error('默认设置请求过大。');
      const row = robotObject(JSON.parse(text), ['appId', 'revision', 'settings']);
      appId = robotAppId(row.appId);
      next = { revision: robotRevision(row.revision), settings: parseAgentSettings(row.settings) };
    } catch (error) {
      throw new WorkbenchRequestError(400, error instanceof Error && !(error instanceof SyntaxError) ? error.message : '默认设置格式无效。');
    }
    return workbenchJson(await robots.saveDefaults(appId, next, assertWritable));
  });
}

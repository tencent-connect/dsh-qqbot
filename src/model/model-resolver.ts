/**
 * ModelResolver — 统一的模型发现与路由解析
 *
 * 职责：
 *   1. 解析当前生效的默认模型路由
 *   2. 列出可用 providers 和模型
 *   3. 管理 per-peer 的模型偏好（委托 PrefsStore）
 *
 * 优先级（从高到低）：
 *   per-peer 偏好（~/.dsh-qqbot/model-prefs.json）
 *   > config 显式指定（cordis.yml 的 provider/model）
 *   > settings.yaml 的 agent-default-model（只读，作为默认兜底）
 *   > 宿主 agentDefaultModel 服务
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { ModelRoute, ModelEntry } from './types.ts';
import { PrefsStore } from './prefs-store.ts';
import { SettingsReader } from './settings-reader.ts';

/** ctx.llm 服务的最小接口（listProviders 同步，listModels 异步） */
interface LlmServiceLike {
  listProviders(): Array<{ id: string; name: string }> | string[];
  listModels(providerId: string): Promise<readonly { id: string; name?: string }[]>;
}

export class ModelResolver {
  private readonly prefs: PrefsStore;
  private readonly settings: SettingsReader;
  private readonly ctx: Context;
  private readonly config: ImQQBotConfig;
  private readonly logger?: Logger;

  constructor(
    ctx: Context,
    config: ImQQBotConfig,
    logger?: Logger,
    stateDir?: string,
  ) {
    this.ctx = ctx;
    this.config = config;
    this.logger = logger;
    this.prefs = new PrefsStore(
      config.debug ? (msg) => this.logger?.debug(msg) : undefined,
      stateDir,
    );
    this.settings = new SettingsReader();
  }

  /**
   * 获取指定 sessionKey 的有效模型路由（create 用）
   *
   * 优先级：per-peer 偏好 > config 显式指定 > settings.yaml > 宿主服务
   */
  getEffectiveRoute(sessionKey: string): ModelRoute | undefined {
    return this.prefs.getOverride(sessionKey) ?? this.resolveDefault();
  }

  /**
   * 获取 resume 时覆盖 session 的模型路由
   *
   * 优先级：per-peer 偏好 > cordis.yml 显式配置 > 默认链（settings.yaml > host）
   *
   * 这里不返回 undefined，因为未装 installModelSelection，system-prompt 的
   * {{model}} 变量直接读 agent.options.model——若无值会抛
   * "prompt variable {{model}} has no value for this assembly"。
   * 因此兜底到默认链，确保 agent.options.model 始终有值。
   */
  getResumeRoute(sessionKey: string): ModelRoute | undefined {
    const override = this.prefs.getOverride(sessionKey);
    if (override) return override;

    if (this.config.provider && this.config.model) {
      return { provider: this.config.provider, model: this.config.model };
    }

    return this.resolveDefault();
  }

  /**
   * 设置 per-peer 模型偏好并持久化到隔离文件
   */
  setOverride(sessionKey: string, route: ModelRoute): void {
    this.prefs.setOverride(sessionKey, route);
  }

  /**
   * 清除 per-peer 模型偏好并持久化
   */
  clearOverride(sessionKey: string): void {
    this.prefs.clearOverride(sessionKey);
  }

  /**
   * 是否存在指定 session 的模型偏好
   */
  hasOverride(sessionKey: string): boolean {
    return this.prefs.hasOverride(sessionKey);
  }

  /**
   * 获取指定 sessionKey 的最新 sessionId（fork 后记录，重启恢复用）
   */
  getSessionId(sessionKey: string): string | undefined {
    return this.prefs.getSessionId(sessionKey);
  }

  /**
   * 记录指定 sessionKey 的最新 sessionId（fork 后调用）并持久化
   */
  setSessionId(sessionKey: string, sessionId: string): void {
    this.prefs.setSessionId(sessionKey, sessionId);
  }

  /**
   * 清除指定 sessionKey 的 sessionId 记录
   */
  clearSessionId(sessionKey: string): void {
    this.prefs.clearSessionId(sessionKey);
  }

  /**
   * 获取指定 sessionKey 的 per-peer preset 覆盖
   */
  getPreset(sessionKey: string): string | undefined {
    return this.prefs.getPreset(sessionKey);
  }

  /**
   * 设置 per-peer preset 覆盖并持久化
   */
  setPreset(sessionKey: string, presetId: string): void {
    this.prefs.setPreset(sessionKey, presetId);
  }

  /**
   * 清除 per-peer preset 覆盖并持久化
   */
  clearPreset(sessionKey: string): boolean {
    return this.prefs.clearPreset(sessionKey);
  }

  /**
   * 解析默认模型路由（不含 per-peer 偏好）
   *
   * 优先级：config 显式指定 > settings.yaml（只读） > 宿主 agentDefaultModel
   * 最终兜底 deepseek-official/deepseek-v4-flash，确保 {{model}} 变量始终有值。
   */
  resolveDefault(): ModelRoute {
    if (this.config.provider && this.config.model) {
      return { provider: this.config.provider, model: this.config.model };
    }

    const fromSettings = this.settings.readDefaultRoute();
    if (fromSettings) return fromSettings;

    const fromHost = this.readFromHost();
    if (fromHost) return fromHost;

    return { provider: 'deepseek-official', model: 'deepseek-v4-flash' };
  }

  /**
   * 列出所有可用模型
   *
   * 优先走 ctx.llm 服务动态发现，服务不可用或失败时回退 settings.yaml 静态配置。
   */
  async listModels(): Promise<ModelEntry[]> {
    const llm = this.getLlmService();
    if (!llm) return this.settings.readModels();

    try {
      const providers = llm.listProviders();
      const entries: ModelEntry[] = [];
      for (const provider of providers) {
        const providerId = typeof provider === 'string' ? provider : provider.id;
        try {
          const models = await llm.listModels(providerId);
          for (const model of models) {
            entries.push({ provider: providerId, id: model.id, name: model.name });
          }
        } catch (err) {
          // 单个 provider 失败，跳过
          this.logger?.debug(
            `ModelResolver: provider ${providerId} 模型列表获取失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      if (entries.length > 0) return entries;
    } catch (err) {
      this.logger?.warn(
        `ModelResolver: 动态发现模型失败，回退 settings.yaml: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.settings.readModels();
  }

  /**
   * 列出可用 provider 名称
   */
  listProviders(): string[] {
    const llm = this.getLlmService();
    if (llm) {
      const providers = llm.listProviders();
      if (providers.length > 0) {
        const first = providers[0];
        if (typeof first === 'string') return providers as string[];
        return (providers as Array<{ id: string; name: string }>).map((p) => p.id);
      }
    }

    return this.settings.readProviders();
  }

  // ── 私有方法 ──

  private readFromHost(): ModelRoute | undefined {
    try {
      const agentDefaultModel = this.getService('agentDefaultModel') as
        | { currentSelection(): { provider: string; model: string } }
        | undefined;

      if (agentDefaultModel && typeof agentDefaultModel.currentSelection === 'function') {
        const selection = agentDefaultModel.currentSelection();
        if (selection?.provider && selection?.model) {
          return { provider: selection.provider, model: selection.model };
        }
      }
    } catch (err) {
      if (this.config.debug) {
        this.logger?.debug(`ModelResolver: host service failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return undefined;
  }

  /** 统一的 Cordis 服务访问（可选获取：服务未注入时静默返回 undefined，避免 Proxy 抛错） */
  private getService(name: string): unknown {
    try {
      const ctxAny = this.ctx as unknown as { get?: (key: string) => unknown };
      return typeof ctxAny.get === 'function' ? ctxAny.get(name) : undefined;
    } catch {
      return undefined;
    }
  }

  /** 获取 ctx.llm 服务（最小接口收窄，不可用时返回 undefined） */
  private getLlmService(): LlmServiceLike | undefined {
    try {
      const llm = this.getService('llm') as LlmServiceLike | undefined;
      if (llm && typeof llm.listProviders === 'function' && typeof llm.listModels === 'function') {
        return llm;
      }
    } catch (err) {
      this.logger?.warn(
        `ModelResolver: ctx.llm 服务访问失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return undefined;
  }
}

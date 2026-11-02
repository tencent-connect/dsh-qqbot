/**
 * 把 QQ 的 prompt section/context 注册到某个 agent 的 ctx（per-agent scope）。
 *
 * 与 installPolicy 同生命周期：agent 挂载时安装，agent 销毁时 dispose。
 * 使用 DSH 正规扩展点 ctx.systemPrompt.section()/context()，不再走 system-prompt/assemble waterfall。
 * 所有 section.text 都是惰性函数，每步组装时现读 entry —— 改补充词/人设即时生效，无需重注册。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { QQScope } from './scope.ts';
import { RULES_SECTION_NAME, RULES_ORDER, RULES_TEXT } from './rules.ts';
import { SCOPE_SECTION_NAME, SCOPE_ORDER, scopeText } from './scope.ts';
import { PERSONA_SECTION_NAME, PERSONA_ORDER, selectPersonaText } from './persona.ts';
import { EXTRA_SECTION_NAME, EXTRA_ORDER, selectExtraPrompt } from './extra.ts';
import { TURN_META_CONTEXT_NAME, TURN_META_ORDER, turnMetaText, type TurnMeta } from './turn-meta.ts';

/** 当前会话 prompt 需要的数据（惰性读取，保证热更新）。 */
export interface QQPromptEntry {
  readonly scope: QQScope;
  /** 人设 role-card markdown（可为空）。 */
  personaCard(): string;
  /** 补充提示词（群/私分字段）。 */
  extraPrompts(): { group?: string; direct?: string };
}

/** 已安装的 QQ prompt 句柄：按轮次顺序写入/消费元信息。 */
export interface QQPromptHandle {
  /** 追加一条本轮元信息（每条 QQ 入站消息一次；FIFO，组装时按轮次顺序消费）。 */
  setTurnMeta(meta: TurnMeta | undefined): void;
  /** 丢弃全部未消费的元信息（轮次取消/会话释放时防错位）。 */
  clearTurnMeta(): void;
  dispose(): void;
}

interface SystemPromptLike {
  section(section: { name: string; order: number; text: string | ((context: unknown) => string); interpolate?: boolean }): () => void;
  context(context: { name: string; order: number; text: string | ((context: unknown) => string); interpolate?: boolean }): () => void;
}

/** 在 agent.ctx 上安装 QQ prompt sections/contexts；返回可更新的句柄。 */
export function installQQPrompt(agentCtx: Context, entry: QQPromptEntry): QQPromptHandle {
  const service = agentCtx.get('systemPrompt') as SystemPromptLike | undefined;
  if (service === undefined) throw new Error('当前宿主缺少 systemPrompt 服务，无法注入 QQ prompt');

  // turn-meta 单槽在 turn/start 观测点写入（conversation-service）：同一会话轮次串行，
  // 下一轮 turn/start 必然晚于上一轮全部 prompt 组装，因此不存在入站即写导致的覆盖竞态；
  // 同轮多次模型调用（工具循环）重复组装读取同一槽，元信息保持稳定。
  const holder: { current?: TurnMeta } = {};
  const disposers: Array<() => void> = [];
  disposers.push(service.section({ name: RULES_SECTION_NAME, order: RULES_ORDER, text: RULES_TEXT }));
  disposers.push(service.section({ name: SCOPE_SECTION_NAME, order: SCOPE_ORDER, text: () => scopeText(entry.scope) }));
  disposers.push(service.section({ name: PERSONA_SECTION_NAME, order: PERSONA_ORDER, text: () => selectPersonaText(entry.personaCard(), entry.scope) }));
  disposers.push(service.section({ name: EXTRA_SECTION_NAME, order: EXTRA_ORDER, text: () => selectExtraPrompt(entry.extraPrompts(), entry.scope) }));
  disposers.push(service.context({ name: TURN_META_CONTEXT_NAME, order: TURN_META_ORDER, text: () => (holder.current ? turnMetaText(holder.current) : '') }));

  return {
    setTurnMeta(meta) { holder.current = meta; },
    clearTurnMeta() { delete holder.current; },
    dispose() { for (const dispose of disposers.reverse()) dispose(); },
  };
}

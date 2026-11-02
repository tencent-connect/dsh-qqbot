import { RULES_SECTION_NAME, RULES_ORDER, RULES_TEXT } from "./rules.js";
import { SCOPE_SECTION_NAME, SCOPE_ORDER, scopeText } from "./scope.js";
import { PERSONA_SECTION_NAME, PERSONA_ORDER, selectPersonaText } from "./persona.js";
import { EXTRA_SECTION_NAME, EXTRA_ORDER, selectExtraPrompt } from "./extra.js";
import { TURN_META_CONTEXT_NAME, TURN_META_ORDER, turnMetaText } from "./turn-meta.js";
/** 在 agent.ctx 上安装 QQ prompt sections/contexts；返回可更新的句柄。 */
export function installQQPrompt(agentCtx, entry) {
    const service = agentCtx.get('systemPrompt');
    if (service === undefined)
        throw new Error('当前宿主缺少 systemPrompt 服务，无法注入 QQ prompt');
    // turn-meta 单槽在 turn/start 观测点写入（conversation-service）：同一会话轮次串行，
    // 下一轮 turn/start 必然晚于上一轮全部 prompt 组装，因此不存在入站即写导致的覆盖竞态；
    // 同轮多次模型调用（工具循环）重复组装读取同一槽，元信息保持稳定。
    const holder = {};
    const disposers = [];
    disposers.push(service.section({ name: RULES_SECTION_NAME, order: RULES_ORDER, text: RULES_TEXT }));
    disposers.push(service.section({ name: SCOPE_SECTION_NAME, order: SCOPE_ORDER, text: () => scopeText(entry.scope) }));
    disposers.push(service.section({ name: PERSONA_SECTION_NAME, order: PERSONA_ORDER, text: () => selectPersonaText(entry.personaCard(), entry.scope) }));
    disposers.push(service.section({ name: EXTRA_SECTION_NAME, order: EXTRA_ORDER, text: () => selectExtraPrompt(entry.extraPrompts(), entry.scope) }));
    disposers.push(service.context({ name: TURN_META_CONTEXT_NAME, order: TURN_META_ORDER, text: () => (holder.current ? turnMetaText(holder.current) : '') }));
    return {
        setTurnMeta(meta) { holder.current = meta; },
        clearTurnMeta() { delete holder.current; },
        dispose() { for (const dispose of disposers.reverse())
            dispose(); },
    };
}
//# sourceMappingURL=install.js.map
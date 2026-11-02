import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc';
const selections = new WeakMap();
/** Own the Agent selection so a forbidden reserved PTC schema never reaches the model. */
export class ConversationToolExecutor {
    ctx;
    getPolicy;
    getCatalog;
    native;
    ptc;
    sections;
    constructor(ctx, getPolicy, getCatalog) {
        this.ctx = ctx;
        this.getPolicy = getPolicy;
        this.getCatalog = getCatalog;
        this.native = new NativeToolExecutor(ctx);
        this.ptc = new PtcExecutor(ctx);
        this.sections = this.ptc.sections.map(section => ({ ...section, text: (tools) => this.usePtc()
                ? typeof section.text === 'function' ? section.text(this.admitted(tools)) : section.text
                : '' }));
    }
    admitted(tools) {
        const policy = this.getPolicy();
        if (!policy || policy.receiveEnabled === false)
            return [];
        return tools.filter(tool => {
            const entry = this.getCatalog?.().find(item => item.name === tool.name);
            return entry?.available !== false && (policy.tools[entry?.id ?? tool.name] ?? 'deny') !== 'deny';
        });
    }
    usePtc() {
        const policy = this.getPolicy();
        if (!policy || policy.receiveEnabled === false || !policy.resources.executionEnabled || (policy.tools.run_code ?? 'deny') === 'deny')
            return false;
        try {
            const runtime = this.ctx.get('ptcRuntime');
            return typeof runtime === 'object' && runtime !== null && 'sandboxMode' in runtime && runtime.sandboxMode !== undefined;
        }
        catch {
            return false;
        }
    }
    describe(tools) {
        return this.usePtc() ? this.ptc.describe(this.admitted(tools)) : this.native.describe(this.admitted(tools));
    }
    execute(input) {
        return this.usePtc() ? this.ptc.execute(input) : this.native.execute(input);
    }
}
export function installConversationExecutor(ctx, tools, getPolicy, getCatalog) {
    // A scope may only own one executor. Retire our previous selection before
    // replacement; its later disposer only touches its captured old generation.
    selections.get(ctx)?.dispose();
    const disposeExecutor = tools.setExecutor(new ConversationToolExecutor(ctx, getPolicy, getCatalog));
    const selection = { dispose: disposeExecutor };
    selections.set(ctx, selection);
    return () => {
        disposeExecutor();
        if (selections.get(ctx) === selection)
            selections.delete(ctx);
    };
}
//# sourceMappingURL=executor.js.map
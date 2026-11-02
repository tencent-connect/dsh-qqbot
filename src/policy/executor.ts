import type { Context } from '@deepseek-ai/cordis';
import { NativeToolExecutor } from '@deepseek-ai/dsh-tool-executor-native';
import { PtcExecutor } from '@deepseek-ai/dsh-tool-executor-ptc';
import type { ConversationPolicy, ToolCatalogEntry } from '../shared/conversation-protocol.ts';

type NativeDefinitions = Parameters<NativeToolExecutor['describe']>[0];
type BatchInput = Parameters<NativeToolExecutor['execute']>[0];
const selections = new WeakMap<object, { dispose(): void }>();

/** Own the Agent selection so a forbidden reserved PTC schema never reaches the model. */
export class ConversationToolExecutor {
  private readonly native: NativeToolExecutor;
  private readonly ptc: PtcExecutor;
  readonly sections: PtcExecutor['sections'];

  constructor(private readonly ctx: Context, private readonly getPolicy: () => ConversationPolicy | undefined, private readonly getCatalog?: () => readonly ToolCatalogEntry[]) {
    this.native = new NativeToolExecutor(ctx);
    this.ptc = new PtcExecutor(ctx);
    this.sections = this.ptc.sections.map(section => ({ ...section, text: (tools: NativeDefinitions) => this.usePtc()
      ? typeof section.text === 'function' ? section.text(this.admitted(tools)) : section.text
      : '' }));
  }
  private admitted(tools: NativeDefinitions): NativeDefinitions {
    const policy = this.getPolicy();
    if (!policy || policy.receiveEnabled === false) return [];
    return tools.filter(tool => {
      const entry = this.getCatalog?.().find(item => item.name === tool.name);
      return entry?.available !== false && (policy.tools[entry?.id ?? tool.name] ?? 'deny') !== 'deny';
    });
  }
  private usePtc(): boolean {
    const policy = this.getPolicy();
    if (!policy || policy.receiveEnabled === false || !policy.resources.executionEnabled || (policy.tools.run_code ?? 'deny') === 'deny') return false;
    try {
      const runtime: unknown = this.ctx.get('ptcRuntime');
      return typeof runtime === 'object' && runtime !== null && 'sandboxMode' in runtime && runtime.sandboxMode !== undefined;
    } catch { return false; }
  }
  describe(tools: NativeDefinitions): ReturnType<NativeToolExecutor['describe']> {
    return this.usePtc() ? this.ptc.describe(this.admitted(tools)) : this.native.describe(this.admitted(tools));
  }
  execute(input: BatchInput): ReturnType<NativeToolExecutor['execute']> {
    return this.usePtc() ? this.ptc.execute(input) : this.native.execute(input);
  }
}

export function installConversationExecutor(ctx: Context, tools: { setExecutor(executor: ConversationToolExecutor): () => void }, getPolicy: () => ConversationPolicy | undefined, getCatalog?: () => readonly ToolCatalogEntry[]): () => void {
  // A scope may only own one executor. Retire our previous selection before
  // replacement; its later disposer only touches its captured old generation.
  selections.get(ctx)?.dispose();
  const disposeExecutor = tools.setExecutor(new ConversationToolExecutor(ctx, getPolicy, getCatalog));
  const selection = { dispose: disposeExecutor };
  selections.set(ctx, selection);
  return () => {
    disposeExecutor();
    if (selections.get(ctx) === selection) selections.delete(ctx);
  };
}

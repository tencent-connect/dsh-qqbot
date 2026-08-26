/**
 * 杂项命令
 *
 * - /bot-ping /bot-version：QQBot 插件特有（连通性测试、版本信息）
 * - /stop：中止当前生成（对应底层 agent cancel，通用能力）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, PLUGIN_VERSION } from '../shared/index.ts';

/** /bot-ping — 连通性测试 */
export function pingCommand(): CategorizedCommand {
  return {
    name: 'bot-ping',
    category: 'qqbot',
    description: '连通性测试',
    handler: () => 'pong 🏓',
  };
}

/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'bot-version',
    category: 'qqbot',
    description: '查看版本信息',
    handler: () => {
      const current = manager.getEffectiveModel('c2c', '');
      const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
      return `dsh-qqbot v${PLUGIN_VERSION} | model: ${modelInfo}`;
    },
  };
}

/** /stop — 中止当前生成（隐藏） */
export function stopCommand({ manager }: CommandDeps): CategorizedCommand {
  return {
    name: 'stop',
    category: 'agent',
    description: '中止当前生成',
    hidden: true,
    handler: (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const record = manager.getSessionRecord(scope, peerId);
      // 会话存在不等于正在生成：只有 agent 处于 running 才算有进行中的回复
      if (record === undefined || record.agent.status !== 'running') {
        return '当前没有进行中的生成';
      }

      // cancel 会让当前轮以 turn/end (kind=interrupted) 收尾，
      // 出站侧据此 flush 已生成的文本并关闭流式会话。
      record.agent.cancel({ kind: 'user' });
      return '已中止 ⛔';
    },
  };
}

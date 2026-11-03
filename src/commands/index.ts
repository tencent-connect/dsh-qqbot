/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。工厂函数注入依赖，统一导出命令列表。
 *
 * 命令按 category 分两类：
 *   - agent：底层 dsh agent 通用能力（new/compact/model/stop）
 *   - qqbot：插件自身特有（ping/version/status/help）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import type { SlashCommandDescriptor } from '../shared/conversation-protocol.ts';
import { newCommand, compactCommand } from './session.ts';
import { modelCommand } from './model.ts';
import { presetCommand } from './preset.ts';
import { statusCommand } from './status.ts';
import { helpCommand } from './help.ts';
import { pingCommand, versionCommand, stopCommand, meCommand } from './misc.ts';
import { selectionCommandAuthority } from './auth.ts';
import { getScopePeer } from '../shared/index.ts';
import { encodeButtonData } from '../features/button-utils.ts';
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';

/** 构造"确认/取消认领"内联键盘（button_data 带 t=claim + nonce）。 */
export function buildClaimKeyboard(nonce: string): InlineKeyboard {
  const mk = (d: 'confirm' | 'cancel', label: string, style: number) => ({
    id: `claim-${d}`, render_data: { label, visited_label: label, style },
    action: { type: 1, permission: { type: 2 }, click_limit: 1, data: encodeButtonData({ t: 'claim', d, n: nonce }) },
    group_id: 'claim',
  });
  return { content: { rows: [{ buttons: [mk('confirm', '✅ 确认', 1), mk('cancel', '❌ 取消', 0)] }] } };
}

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): CategorizedCommand[] {
  const commands: CategorizedCommand[] = [
    // 通用能力（底层 agent）
    newCommand(deps),
    compactCommand(deps),
    modelCommand(deps),
    presetCommand(deps),
    stopCommand(deps),
    // QQBot 特有
    pingCommand(),
    versionCommand(deps),
    meCommand(deps),
    statusCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  if (deps.manager.conversations) {
    // permission 命令仅在可访问 conversations 服务时注册（与下方闭包条件一致）。
    commands.push({ name: 'permission', category: 'agent', authority: selectionCommandAuthority, scope: 'all', description: '查看此对话权限或切换已授权的权限模式',
      handler: async (ctx) => {
        const { scope, peerId } = getScopePeer(ctx);
        const service = deps.manager.conversations!;
        const entry = service.entry(scope, peerId);
        const value = (ctx.command?.raw ?? '').trim();
        if (!value) {
          const record = await deps.manager.restoreExisting(scope, peerId);
          const editable = deps.origin === 'web-owner' || service.isOwner(ctx.message.senderId);
          const modes = service.ctx.get('permissionPresets')?.catalog().options.filter(option => entry.policy.allowedPermissions.includes(option.value)).map(option => option.value) ?? [];
          return `权限：${entry.policy.name}\n模式：${record ? service.currentPermission(record) : entry.policy.permission}\n本对话可用模式${editable ? '' : '（只读）'}：${modes.join('、') || '无'}\n已授权工具：${Object.entries(entry.policy.tools).filter(([, decision]) => decision !== 'deny').map(([name, decision]) => `${name} (${decision})`).join('、') || '无'}\n${editable ? '用 /permission 模式名 切换；' : '仅机器人超管可切换；'}授权范围只能由所有者在 DSH 网页修改。`;
        }
        await service.selectPermission(entry.key, value);
        return `权限模式已切换：${value}`;
      },
    });
  }

  for (const command of commands) {
    const original = command.handler;
    delete command.authorized;
    command.handler = async (ctx) => {
      const { scope, peerId } = getScopePeer(ctx);
      const service = deps.manager.conversations;
      if (!service) return deps.origin === 'web-owner' ? original(ctx) : '斜杠命令仅机器人超管可用。';
      if (deps.origin !== 'web-owner' && !service.admitted(scope, peerId)) return '此 QQ 对话尚未获准使用机器人，请联系机器人超级管理员。';
      if (deps.origin !== 'web-owner' && !service.isOwner(ctx.message.senderId)) return '斜杠命令仅机器人超管可用。';
      const authority = typeof command.authority === 'function' ? command.authority(ctx) : command.authority;
      if (authority === 'manage' && service.busy(service.entry(scope, peerId).key)) return '当前会话正在生成，请等待结束或发送 /stop。';
      try {
        return authority === 'query'
          ? await original(ctx)
          : await service.withCommandAuthority(scope, peerId, ctx.message.senderId, deps.origin === 'web-owner', () => original(ctx));
      } catch (error) { return `操作失败：${error instanceof Error ? error.message : '请稍后重试'}`; }
    };
  }

  return commands;
}

/**
 * 把命令注册表投影为 UI 用的元数据（去 handler）。
 *
 * 与 buildCommandList 共用同一份清单，避免 UI 维护第二套命令定义：
 * 名称/别名/描述/分类均来自注册表本身；handler 依赖运行时 manager，不对外暴露。
 */
export function describeCommands(deps: CommandDeps): SlashCommandDescriptor[] {
  return buildCommandList(deps).map((command): SlashCommandDescriptor => {
    const names = Array.isArray(command.name) ? command.name : [command.name];
    return {
      name: names[0] ?? '',
      aliases: names.slice(1),
      description: command.description ?? '',
      category: command.category,
      scope: 'owner',
      ...(command.hidden === true ? { hidden: true } : {}),
    };
  }).filter((descriptor) => descriptor.name !== '');
}

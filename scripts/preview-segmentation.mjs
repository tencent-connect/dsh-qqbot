#!/usr/bin/env node
/**
 * 分条发送离线预演
 *
 * 读 profile 的 cordis.patch.yml → 用真实 ConfigSchema 补全默认值 → 打印
 * 每个气泡的内容与间隔。不连 QQ、不重启 DSH，用来在改配置后先看效果。
 *
 * 用法：
 *   node scripts/preview-segmentation.mjs --config <profile>/cordis.patch.yml
 *   node scripts/preview-segmentation.mjs --config ... --text "在呢。吃了吗？睡吧"
 *   node scripts/preview-segmentation.mjs --config ... --text-file reply.txt --seed 0.5
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from '../lib/config.js';
import { nextIntervalMs, planSegmentedReply } from '../lib/transport/segmented-reply.js';

function parseArgs(argv) {
  const args = { id: 'im-qqbot', text: '在呢\n吃了吗？\n睡吧', seed: 0.5 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--config') { args.config = value; i += 1; }
    else if (key === '--id') { args.id = value; i += 1; }
    else if (key === '--text') { args.text = value; i += 1; }
    else if (key === '--text-file') { args.text = readFileSync(value, 'utf8'); i += 1; }
    else if (key === '--seed') { args.seed = Number(value); i += 1; }
    else if (key === '--help' || key === '-h') { args.help = true; }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.config === undefined) {
  console.log('用法: node scripts/preview-segmentation.mjs --config <cordis.patch.yml> [--text "..."] [--id im-qqbot] [--seed 0.5]');
  process.exit(args.help ? 0 : 1);
}

let entries;
try {
  // profile patch 里含 !!js 自定义标签，只关心结构，不因未知标签刷警告
  entries = parseYaml(readFileSync(args.config, 'utf8'), { logLevel: 'error' });
} catch (err) {
  console.error('读取 patch 失败:', err instanceof Error ? err.message : String(err));
  process.exit(2);
}
if (!Array.isArray(entries)) {
  console.error('patch 不是 YAML 数组，无法定位插件条目');
  process.exit(2);
}
const entry = entries.find((item) => item !== null && typeof item === 'object' && item.id === args.id);
if (entry === undefined) {
  console.error('patch 中没有 id=' + args.id + ' 的条目');
  process.exit(2);
}

let config;
try {
  config = ConfigSchema(entry.config ?? {});
} catch (err) {
  console.error('配置未通过 Schema 校验:', err instanceof Error ? err.message : String(err));
  process.exit(2);
}

const { segmentedReply } = config;
console.log('条目:', args.id);
console.log('分条开关:', segmentedReply.enable, '| 仅模型回复:', segmentedReply.onlyLlmResult);
console.log(
  '参数: mode=' + segmentedReply.splitMode +
  ' 阈值=' + segmentedReply.wordsCountThreshold + '/' + segmentedReply.forwardThreshold +
  ' 上限=' + segmentedReply.maxBubbles + '条' +
  ' 间隔=' + (segmentedReply.intervalMethod === 'log'
    ? 'log(base=' + segmentedReply.logBase + ', jitter=' + segmentedReply.logJitter + 's)'
    : '[' + segmentedReply.intervalMin + ', ' + segmentedReply.intervalMax + ']s'),
);

if (!segmentedReply.enable) {
  console.log('\n分条当前未启用：下面按「整条发送 + 平台切块」预演。');
}

const text = args.text;
const plan = planSegmentedReply(text, segmentedReply, { limit: config.textChunkLimit });
console.log('\n原文', Array.from(text.trim()).length, '字 →', plan.bubbles.length, '条', plan.reason ? '(reason=' + plan.reason + ')' : '(已分条)');

const rng = () => args.seed;
let elapsed = 0;
plan.bubbles.forEach((bubble, index) => {
  if (index > 0) {
    const ms = nextIntervalMs(segmentedReply, Array.from(plan.bubbles[index - 1].trim()).length, rng);
    elapsed += ms;
    console.log('  ↓ ' + (ms / 1000).toFixed(1) + 's');
  }
  console.log('[' + (index + 1) + '] (' + Array.from(bubble).length + '字) ' + JSON.stringify(bubble));
});
console.log('\n首条到末条约 ' + (elapsed / 1000).toFixed(1) + 's');

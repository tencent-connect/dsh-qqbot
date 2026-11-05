/**
 * 浏览器客户端 bundle 构建配置
 *
 * 产出 lib/client.js，遵循 dsh 客户端模块系统的加载契约：
 * - CJS 闭包工厂：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`
 * - externals 经注入 require 解析（客户端平台种子表）
 * - 单文件入口（无动态 chunk），sourcemap 供浏览器诊断
 *
 * 与 deepseek-harness 仓库 packages/client/tsdown.client.ts 的契约保持一致，
 * 仅保留外部插件所需的最小集。
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

/** 浏览器模块 id：从 package.json 的 name 动态读取。
 *
 * 宿主 client-modules 按包名（最近归属的 package manifest）注册 boot 图行，
 * bundle 的 __ModuleLoader__.load({ id }) 必须与其一致——改名发布
 * （fork/scope 迁移）时硬编码会导致「loaded without registering」。
 */
const ID = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string }).name;

/** 客户端平台种子表（baseline externals；react/cordis 之外的依赖须整体内联） */
const BASELINE_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
];

const isBaseline = (specifier: string): boolean =>
  BASELINE_EXTERNALS.some((name) => specifier === name || specifier.startsWith(`${name}/`));

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    // 平台种子表内的说明符保持外部引用（经注入 require 解析）
    neverBundle: isBaseline,
    // 其余依赖整体内联（本客户端无第三方依赖，此为兜底保护）
    alwaysBundle: (specifier: string) => !isBaseline(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: (chunk) =>
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)},${chunk.isEntry ? '' : ` chunk: ${JSON.stringify(chunk.fileName)},`} factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
});

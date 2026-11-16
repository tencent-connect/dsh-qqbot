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
import { dirname, resolve } from 'node:path';
import { transform } from 'lightningcss';
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

const cssModulePrefix = '\\0qqbot-css:';

const cssModules = {
  name: 'qqbot-css-modules',
  resolveId: {
    order: 'pre' as const,
    handler(source: string, importer?: string) {
      if (importer && source.endsWith('.module.css')) return cssModulePrefix + resolve(dirname(importer), source) + '.js';
    },
  },
  load(id: string) {
    if (!id.startsWith(cssModulePrefix)) return undefined;
    const path = id.slice(cssModulePrefix.length, -3);
    const result = transform({ filename: path, code: readFileSync(path), cssModules: true, minify: true });
    const classes = Object.fromEntries(Object.entries(result.exports ?? {}).map(([key, value]) => [key, value.name]));
    return 'export const sheet = ' + JSON.stringify(result.code.toString()) + '; export default ' + JSON.stringify(classes);
  },
};

function clientConfig(id: string, entry: string, outDir: string) {
  return defineConfig({
    name: `${id}/client`,
    entry: { client: entry },
    outDir,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
    sourcemap: true,
    plugins: [cssModules],
    deps: {
      // 平台种子表内的说明符保持外部引用（经注入 require 解析）
      neverBundle: isBaseline,
      // 其他依赖内联，浏览器加载器只需提供上面的宿主模块。
      alwaysBundle: (specifier: string) => !isBaseline(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: (chunk) =>
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)},${chunk.isEntry ? '' : ` chunk: ${JSON.stringify(chunk.fileName)},`} factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  });
}

const historyId = (JSON.parse(readFileSync(new URL('./plugins/workbench-history/package.json', import.meta.url), 'utf8')) as { name: string }).name;

export default [
  clientConfig(ID, 'src/client/index.ts', 'lib'),
  clientConfig(historyId, 'src/client/history-extension.ts', 'plugins/workbench-history/lib'),
];

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

/**
 * 平台种子表：宿主 PLATFORM_MODULES 在全部已声明 dshReleases 上的交集
 * （platform.ts @ 0.2.0-rc.2 / 0.2.2-rc.1；下限 0.2.0-rc.2）。
 * 表内模块经注入 require 解析，属宿主隐式契约，勿在 dsh.client.external 重复声明。
 */
const SEED_TABLE = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

const isSeedModule = (specifier: string): boolean =>
  SEED_TABLE.some((name) => specifier === name || specifier.startsWith(`${name}/`));

/**
 * 现代层：较新宿主才进平台表的模块（模块 → 进表版本）。
 * 引用它们会在老宿主运行时抛「missed the module table」，gate 据此构建期拦截；
 * 抬升 dshReleases 下限并全版本重验后，可升入 SEED_TABLE。
 */
const MODERN_SEED_MINIMUM = new Map<string, string>([
  ['zod', '0.2.2-rc.1'],
  ['@tanstack/react-virtual', '0.2.2-rc.1'],
]);

const modernSeedMinimumOf = (specifier: string): string | undefined => {
  for (const [name, minimum] of MODERN_SEED_MINIMUM) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return minimum;
  }
  return undefined;
};

/** 以下三个白名单逐字复制自宿主官方构建预设（tsdown.client.ts @ 0.2.2-rc.3），
 * 宿主升级时对照源文件同步。 */
const VENDORED_LIBRARY = /^@deepseek-ai\/(?:(?:cosmokit|schemastery)(?:\/|$)|cordis-plugin-timer$)/;

const INLINE_SAFE = /^(?:@deepseek-ai\/dsh-(?:file-reference|fs-patch|session|llm|tools|brand|error|official-bundles|deque|output-retention|typert-protocol|util-crypto|util-text-search|util-time|util-values|util-workspace-path)(?:\/|$)|@deepseek-ai\/dsh-util-file-drag$|@deepseek-ai\/dsh-token-meter\/client$|@deepseek-ai\/dsh-commands\/builtin$|@deepseek-ai\/dsh-native-command\/types$|@deepseek-ai\/dsh-host-open-in-app\/shared$|@deepseek-ai\/dsh-plugin-manager\/registry$|@deepseek-ai\/dsh-agent-preset-registry\/display$|@deepseek-ai\/dsh-api-workspace-controller\/default-workspace$|@deepseek-ai\/dsh-spill-policy\/notice$)/;

const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/;

const bundlePurity = {
  // purity gate：宿主运行时「require 未命中模块表即抛」的构建期镜像。
  // 只允许种子表 / vendored / inline-safe / 生成 remote；跨插件协作走 cordis 服务。
  // type-only import 编译期已擦除，不会到达此门。
  name: 'dsh-client-bundle-purity',
  resolveId(source: string) {
    if (isSeedModule(source)) return null;
    // 现代层先于第三方分支检查（zod 等不带 @deepseek-ai 前缀）
    const modernMinimum = modernSeedMinimumOf(source);
    if (modernMinimum !== undefined) {
      throw new Error(
        `client bundle purity: "${source}" 自宿主 ${modernMinimum} 起才进入平台表——`
        + `本插件产物横跨 dshReleases 声明的全部版本（含更老宿主），引用会在其上运行时抛`
        + '「missed the module table」。放弃该导入，或抬升声明下限并在全部版本重新验收后，'
        + '把条目升入 tsdown.client.config.ts 的 SEED_TABLE',
      );
    }
    if (!source.startsWith('@deepseek-ai/')) return null;
    if (VENDORED_LIBRARY.test(source)) return null;
    if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null;
    throw new Error(
      `client bundle purity: "${source}" 不在平台种子表（PLATFORM_MODULES 交集）也不在 inline-safe 白名单——`
      + '跨插件值导入被禁止：改走 cordis 服务协作，或确认该层属 inline-safe 后同步白名单；'
      + '依赖其他插件的客户端模块时在 package.json 的 dsh.client.external 声明请求',
    );
  },
};

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
    plugins: [cssModules, bundlePurity],
    deps: {
      // 平台种子表内的说明符保持外部引用（经注入 require 解析）
      neverBundle: isSeedModule,
      // 其他依赖内联，浏览器加载器只需提供上面的宿主模块。
      alwaysBundle: (specifier: string) => !isSeedModule(specifier),
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

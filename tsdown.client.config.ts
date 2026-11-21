/**
 * 浏览器客户端 bundle 构建配置。
 *
 * 产出 lib/client.js：CJS 闭包工厂 `window.__ModuleLoader__.load({ id, factory })`，
 * externals 经注入 require 解析，单文件入口。
 *
 * 契约对齐 deepseek-harness 的 packages/client/tsdown.client.ts（0.2.2-rc.3），
 * 并叠加跨版本不变量：单一产物横跨 dshReleases 声明的全部宿主版本。
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

/** 包清单：模块 id 与展示版本都取这里，保证与发布包一致。 */
const MANIFEST = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { name: string; version: string };

/** 浏览器模块 id：与包名一致（宿主按包名注册 boot 图行），改名发布时须同步。 */
const ID = MANIFEST.name;

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
  // 版本号构建期固定进 bundle（与宿主 DSH_CLIENT_VERSION 的做法一致）：
  // client.js 与包同版本发布，设置页无需在运行时向服务端请求版本。
  define: { __DSH_QQBOT_VERSION__: JSON.stringify(MANIFEST.version) },
  deps: {
    // 种子表保持外部引用，其余整体内联
    neverBundle: isSeedModule,
    alwaysBundle: (specifier: string) => !isSeedModule(specifier),
  },
  plugins: [
    {
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
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: (chunk) =>
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)},${chunk.isEntry ? '' : ` chunk: ${JSON.stringify(chunk.fileName)},`} factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
});

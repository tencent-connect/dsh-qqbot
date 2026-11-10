import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * dsh 宿主的浏览器 UI 组件库是 bundle external（由宿主 ModuleLoader 注入 require
 * 解析），不在本仓库安装。Node 测试通过 alias 指向本地 stub，见
 * src/client/ui-primitives-stub.ts。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./src/client/ui-primitives-stub.ts', import.meta.url)),
    },
  },
});

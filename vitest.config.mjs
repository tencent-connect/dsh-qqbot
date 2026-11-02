import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    // .audit/ 存放本地过程性检查点副本，不属测试集
    exclude: ['**/node_modules/**', '**/.audit/**', '**/dist/**'],
  },
});

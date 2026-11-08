/**
 * 测试替身：@deepseek-ai/dsh-client-ui-primitives 是浏览器端 baseline external，
 * 由宿主 client-modules 在运行时注入 require 解析，本仓库不安装该包（见
 * tsdown.client.config.ts 的 BASELINE_EXTERNALS）。
 *
 * Node 测试套件通过 vitest.config.ts 的 alias 指向本 stub，使 src/client 模块
 * 可被加载。组件测试只关心 handler/effect 逻辑，stub 组件仅返回 null。
 * 类型由 ui-primitives.d.ts 声明；若需要验证真实渲染，应改用 jsdom + 宿主真实组件
 * 的集成测试，而不是扩展本 stub。
 */

type StubComponent = (props?: Record<string, unknown>) => null;
const stub = (): StubComponent => () => null;

export const Button = stub();
export const Input = stub();
export const Modal = stub();
export const Switch = stub();
export const SegmentedControl = stub();
export const DisclosureRow = stub();
export const IconCheckOutlineRegular = stub();
export const IconChevronDownOutlineRegular = stub();
export const IconCopyOutlineRegular = stub();
export const IconDownloadOutlineRegular = stub();
export const IconPlusOutlineRegular = stub();

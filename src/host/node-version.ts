export function assertSupportedNode(version = process.versions.node): void {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match && (Number(match[1]) >= 24 || Number(match[1]) === 22 && Number(match[2]) >= 19)) return;
  throw new Error(`dsh-qqbot 需要 Node 22.19+（22.x）或 Node 24+，当前为 ${version}。请升级运行 DSH 的 Node，再启用插件；插件数据未迁移。`);
}

# Editor 加载性能修订（2026-09-22）

## 范围

只优化 BGS 编辑器与资源读取代码。不改项目产物、Scene/UI 格式、Agent 流程、鉴权或资源验收标准；不重新生成项目。

## 已确认问题与修复

| 问题 | 本轮处理 |
| --- | --- |
| UI 先取文档、再取 Manifest；图片结束后才加载字体 | 两组互不依赖的工作分别并行 |
| UI Atlas 在主线程连续 `toDataURL`，产生额外 base64 字符串，编码期间不能响应取消 | 异步 `toBlob` + 临时 URL；取消后不创建晚到 URL，关闭时统一释放 |
| Scene 使用资源队列嵌套文件队列，小资源和元数据会被前面的整个资源包阻挡 | 单个文件级队列，保留原最大并发上限 16，不靠降低并发换取表面平稳 |
| 取消后队列仍会启动尚未开始的回调 | 出队前检查 AbortSignal |
| 两个编辑器在数据就绪后仍固定等待 180ms | 删除人为等待，保留真正加载时的进度与取消入口 |
| 同级节点追加时反复复制数组，UI 层级逐节点扫描全文档 | 线性构建 children 表，UI 层级使用节点 ID 索引 |
| Scene 首次打开转换全部场景 | 按打开的场景转换，同次编辑器会话内复用；保存后更新对应快照 |
| 后端名为 async 的 Manifest 读取实际使用同步磁盘读取 | 改为异步 I/O、并行读取已登记模块，共用原校验逻辑；不引入可能过期的长期缓存 |

## 验证与测量

- 前端覆盖：UI/Scene 加载、资源选择、精确 Atlas 路径、九宫格、TileSet 传递依赖、转换往返、取消、晚到 Blob URL、多场景懒转换与切换复用。
- 后端覆盖：异步/同步返回一致、编辑后不会读到旧模块、无效模块仍拒绝、缺失索引与缺失模块分别处理。
- 前端 TypeScript 检查通过。
- 只读样本 `flag-pole-platformer--b28215fb9287`：18 个资源记录、32 个 Scene 预览/JSON 文件，合计约 0.30MiB。
- 在同一进程、同一实际 Manifest 上，模拟 32 次读取，预热一次后交替测量五轮：同步入口中位数 **24.40ms**，异步入口 **15.98ms**。这是文件读取和解析的局部基准，不含 HTTP、鉴权、图片解码、React、GPU，不能用于宣称整体提速比例。

回归命令（对应 package 目录）：

```sh
# apps/frontend
./node_modules/.bin/vitest run src/components/Workspace/UiEditorOverlay.test.tsx src/components/Workspace/SceneEditorOverlay.test.tsx src/components/Workspace/uiAtlas.test.ts src/components/Workspace/editorAssetLoading.test.ts src/components/Workspace/sceneContentAdapter.test.ts
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json

# packages/agent-workflow-server
bun test src/__tests__/asset-manifest-async-read.test.ts src/__tests__/asset-contracts-resource-binding.test.ts src/beegame/asset-contract-audit.test.ts
```

## 实机验收边界

本轮未重启服务。发现前端 `127.0.0.1:62173` 不再监听，浏览器保留的是旧页面，不能据此确认新代码的加载耗时；runtime 仍有 Agent 运行，等待重启许可。

恢复服务后，在同一个项目分别记录首次打开、关闭再打开、切换场景/Screen 的耗时，确认图片/字体完整且取消不残留请求。不能把“进度到 100%”等同于 GPU 首帧已经完成。

本轮没有声称解决所有加载成本：Scene 为保持现有资源选择器完整，仍加载全部 verified 预览资源；UI 仍准备被各 Screen 引用的资源及 Atlas 帧。GPU 首帧和完整请求链耗时尚未实测，不据此预建缓存系统或重写渲染器。

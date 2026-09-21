# Chat 消息身份修复

样本：mushroom-platform-quest--9b076afc632c。项目产物及日志仅只读检查。

## 根因

- bootstrap 接口已持久化用户发言，projectStore 在成功返回后又插入没有服务端身份的本地用户消息；历史合并正确保留不同身份，因而显示两条。移除多余插入，不按文本去重。
- 同一个原生 thinking 内容块经过实时镜像和磁盘恢复，transport sessionId 分别是主会话和 workflow-stage:author。历史压缩与前端 thinking ID 使用了传输身份，导致开始/内容/结束分裂。现在优先使用原生 workflowStageStreamId，加上内容块 ID、开始时间及子任务身份；不同子任务、不同原生请求仍隔离。
- 无正文的 thinking 生命周期标记不能覆盖已有 snapshot 正文；结束后的迟到 checkpoint 不能重新打开历史思考或改变结束时间。
- 历史投影遗漏 client_message_id / supersedes_message_id，现保留原始确认身份。

## TUI 对照

参考 src/utils/messages.ts 的 handleStreamEvent：内容块类型决定当前状态，完整 assistant thinking 收据将 isStreaming 设为 false；src/components/messages/AssistantThinkingMessage.tsx 展示历史正文，不把整个 Agent 的运行状态当作该块仍在思考。Web 沿用这一生命周期原则，未复制终端渲染组件，也未增加超时猜测或修改 Agent。

## 验收

- 真实项目原始事件流与压缩历史均恢复 10 段已结束 thinking，时长一致，用户消息为 1 条。
- 分批 SSE 测试验证 started/thought/ended 的消息 ID 一致；并行子任务不合并。
- 前端相关测试 87 项、后端相关测试 12 项通过；前后端 TypeScript 检查通过。
- 用户授权重启后，沿用根目录 bee-game-studio/.env.local 恢复五服务（现有启动器不支持独立子服务退出）；runtime /health 为 ok。
- 独立 Chrome 验收页：用户消息 1，正在思考按钮 0，已思考按钮 10；最长两段显示 86 秒和 71 秒。
- workflow 保持 stopped，没有继续工作流或产生新的模型请求。

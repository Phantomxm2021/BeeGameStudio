# Native task 工作目录与重复文件失败

## 事实与根因

只读样本：`mushroom-platform-quest--9b076afc632c` 的 foundation author 任务
`autonomous-e9ed6f8a-e5b7-4769-ad8d-e7f938e9fb86`。

- `runNativeFileAgent` 已使用 `spawn({ cwd: realpath(workspacePath) })`；原生 CLI 的系统上下文也包含该 cwd。不是没有指定 session 工作目录。
- 03:39:26 的 Read 使用了正确的私有 workspace 下 `requirements.md` 路径并获准。
- 03:42:33、03:43:21、03:48:06 的 Write 使用错误绝对路径：把 owner UUID 与任务 UUID 的后缀混合，并省去了 project 和 `.beegame/workflow/foundation-authoring/state/<task>` 部分，落到另一条 `Projects/users/.../workspace/docs/...`。拒绝越界是正确的，不能自动猜测并改写成目标文件。
- BGS 对所有拒绝统一返回 “additional authorization is required”，却没有发起授权流程，也不指出 cwd 或失败路径。模型反复尝试同一错误路径，且认为 Write 工具不可用。拒绝日志也丢失了请求路径。
- Read/Write/Edit 实现本来支持 cwd 相对路径，工具说明却要求绝对路径。深层 UUID 路径因此必须由模型重复拼写，这是不必要的接口限制。
- 独立的 macOS 问题：日志里的 `printf ... > docs/.write_test` 成功，`rm docs/.write_test` 返回 `Operation not permitted`。`sandbox-runtime@0.0.44` 将 `denyRead: ['/']` 转成全局 `deny file-write-unlink`，没有减去 `allowRead` 例外。工作区允许写入但正常 rename/delete 被误禁；本地临时任务可稳定复现。

## 最小修复

1. 保持真实 cwd 和原有权限边界；Read/Write/Edit 的说明与已有相对路径解析能力一致。不新增路径猜测、重试、工具选择或 Agent 规划策略。
2. 权限响应直接返回具体失败原因：越界、只读输出、无效参数或不可用路径，并提供真实 task cwd。移除并不存在的授权承诺。日志记录 cwd、失败路径和原因，不记录文件内容。
3. Bun 持久补丁仅从**读取限制引起的 unlink 禁令**中排除显式可读路径；独立的写入禁令和祖先目录移动保护仍保留。不增加任何可读／可写根，不关闭沙箱。

## 验证

- 修复前真实 macOS sandbox 复现工作目录内 `mv docs/draft.tmp docs/draft.md` 失败；修复后 create/read/rename/delete 全部通过。
- 外部文件读写、移动外部文件进来、只读文件写入/删除/移动、软链接访问、受保护配置文件修改、移动工作根目录均被拒绝。
- 使用真实原生 CLI + 本地模拟模型响应，核对模型系统上下文包含 task cwd，Read/Edit/Write 相对路径正确解析，失败反馈到达模型，Bash 临时文件创建/移动/删除成功。
- 9 项测试、88 条断言通过；agent-workflow 与 agent-workflow-server 类型检查通过；原生 CLI 构建通过。
- 测试未调用付费模型。未修改样本项目源码、文档、Scene/UI/HUD，也未自动恢复 workflow。

# Author 收尾重复核验修复

## 已证实原因

Author 原生进程未声明工作流已经拥有独立 Reviewer，因此继承了 CLI 的通用 verification 契约：一次任务修改三个以上文件后，主 Agent 必须启动 verification agent，并在修订后继续复核。八文档任务必然满足该条件，于是正式 Reviewer 尚未开始，Author 内部已经执行了额外审计闭环。

直接 CLI 对照使用了一条只要求编写八文档的自然 Prompt。它仍在约 15 分钟写完后启动 verification agent，修订并复核，约 26 分钟收敛；运行时记录确认通用 verification 契约处于启用状态。因此该对照不能证明审计完全是模型的自然选择，却证明 Author 的额外耗时来自 CLI 会话内部，而不是后续 Workflow Reviewer/Revision 的调度。早期 TodoWrite 对非英文验证待办识别不足是同一通用契约的另一个触发点，不是本次 40 分钟运行的完整根因。

## 修复

由 Author 宿主为普通编写和显式收尾的原生进程设置 `BEEGAME_EXTERNAL_REVIEW=1`，表示独立审查由工作流拥有。该会话不再注入通用 verification 系统提示、TodoWrite/TaskUpdate 完成提示，也不注册内置 verification agent。普通未标记会话保持原行为，正式 Author → Reviewer/Revision 工作流未修改。

Author Prompt 同时缩减为接近人工对话的一条自然编写任务：只给出已确认需求、八个交付文件、写入位置和结构化结束契约。不再规定文档顺序、职责结构、审计次数，也不再反向命令 Agent 禁止审计或立即结束。Agent 仍自行决定如何阅读、编写和修正内容。

不添加中文关键词匹配，不新增审查阶段、自动重试或超时机制。任务完成仍需 Author 的结构化完成结果及现有交付检查；文件存在本身不视作正式验收通过。此前单独发现的当前目录路径问题未在本次修改。

## 验证与暂停

- Author 模块 68 项回归通过；`agent-workflow-server` TypeScript 检查通过。
- 直接 CLI 修复前对照完成，用于定位通用 verification 注入；修复后的真实付费验收尚未运行。

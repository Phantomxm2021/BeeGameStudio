# Reviewer 原生协议修复

## 补充修复：成功动作立即交接

后续真实调用在约 4 分 18 秒后报 structured_output_retry_limit；新诊断显示 5 次 StructuredOutput 中 3 成功、2 失败。不是没有 JSON 返回，而是原生 CLI 成功后仍继续请求模型，且把成功调用计入重试上限。

现已修正：

- 在 JSON schema 且只有 StructuredOutput 工具的原生模式中，成功动作完成后返回宿主。先排空本次模型流（包括尾部用量）与工具批次，并执行 Stop 检查，再产生正常最终结果；不在工具流的中途杀进程，也不追加用于“收尾”的模型调用。
- 重试限制仅统计本次查询中去重后的失败工具结果，成功调用不计为失败。四次失败后第五次成功可以正常交付。
- 同一响应批次包含多个成功结构化输出时失败关闭，避免在相互冲突的动作中任意挑选一个。
- 读取动作和草稿均只交付给宿主一次；宿主仍执行原有严格校验和同一 transcript 延续。普通多工具模式保留既有行为。

最终回归：79 项通过、0 失败（16 文件、507 断言），其中真实编译 CLI＋本机假模型覆盖 11 种场景。新增验证成功后无第二次请求、第五次成功、宿主读取动作、歧义多输出拒绝、延迟尾部用量完整。仓库与服务端类型检查通过，实际 CLI 产物已重建。

没有恢复真实审计，也没有新增付费调用。当前审查副本仍保留之前的失败状态，下一次显式恢复才会使用此次修复。

## 已修正

1. 保持 `disableAllHooks: true`。仅放行带固定内置身份的 StructuredOutput session function 检查，不放行其他 function、command、prompt、agent、plugin 或 frontmatter hook。托管的全局禁用仍优先。
2. Reviewer 每次原生调用传入 `--max-turns 6`；SDK structured-output 路径同时将该上限用于模型循环迭代，覆盖不调用工具的 Stop 重试与输出恢复。非结构化调用不改变既有回合语义。外层 24 回合及单次 15 分钟上限保留。
3. 用量在同一消息 ID 内取累计快照，在不同消息 ID 之间求和；重复 assistant/stream 快照不重复计数。最终累计用量覆盖此前流记录。超时后继续处理已收到的计量帧，但绝不因此接受过期结果。
4. 关闭记录新增可选安全摘要：消息数、StructuredOutput 调用/成功/失败数、停止原因分类、最终结果分类、用量来源。没有原始模型文本、引文、密钥或 provider 异常字符串。
5. 区分 timeout、stopped、turn_limit、structured_output_retry_limit。对外 needs_action 显示具体关闭分类，不再把超时仅显示成 execution_failed。计费 metadata 携带用量来源；旧日志无需改写。

## 验证

74 项相关测试通过、0 失败（16 个文件、475 个断言），包含：

- 真实编译 CLI + 本机 HTTP 假模型：先输出文本后被要求提交、错误结构后修正、重复工具触发限制、始终纯文本六轮停止、工具成功后超时、真实 Reviewer action schema 的草稿提交。
- 消息内去重、跨消息累计、终态覆盖、超时后排空已收计量帧、错误分类及摘要隐私约束。
- Reviewer 持久化和结算恢复、Reviewer → Revision → Reviewer 交接、公开依赖隔离与既有原生查询边界。

仓库与 agent-workflow-server 类型检查通过。原生 CLI 已重新构建；旧构建备份在 `/tmp/bgs-native-before-protocol-fix.GqCTn0/dist`。

真实 CLI 集成测试需要先执行 `bun run build`，随后运行 `bun test packages/agent-workflow-server/src/beegame/stage-modules/foundation-reviewer/private/tests/native-cli.integration.test.ts`。测试仅使用本机模拟模型、假密钥和临时隔离配置，不需要付费模型。

## 未改变与限制

- 不修改八份被审文档，不改变严格引文校验，不引入其他审计 Agent，不自动恢复旧审计。
- 没有新增付费模型调用，没有修改或补扣历史账单。
- 历史超时记录中的 153801 是旧算法的跨消息最大值组合，不能当作完整实际消耗；已生成账务凭证不等于该计量值准确。丢失的消息级历史不能靠猜测补算。
- 本次是执行协议的离线验收，不代表真实模型的审计内容质量已通过。模型从未返回、或者已成功调用工具后仍在运行，现在能被区分；网络等待仍受十五分钟超时保护。

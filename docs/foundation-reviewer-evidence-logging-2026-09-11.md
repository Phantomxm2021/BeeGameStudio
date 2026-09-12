# Reviewer 输入输出诊断证据

本次只增加诊断采集，不改变审查提示词、语义规则、模型配置、计费或停止策略；不触发真实付费审查。

## 启用与位置

默认关闭。在运行 Reviewer 宿主服务的进程环境中设置 `BEEGAME_REVIEW_EVIDENCE=1`，并使用包含本次修改的宿主代码和 CLI 构建。只设置在前端或只更新宿主、沿用旧 CLI，都不能获得完整 API 证据。本次验证使用独立临时 CLI 构建，没有替换正在使用的 CLI、修改根环境文件或重启服务。

宿主仅向自己创建的 Reviewer 子进程传递内部目录和身份信息，不通过模型配置或工具参数接收日志目的地。关闭该开关后，新执行不再采集正文；已有文件不自动删除。关闭正在运行的采集需要停止该诊断执行，不会通过修改环境变量中途干预现有子进程。

- `<reviewer-root>/native/<首个 attemptId>/evidence/`：宿主会话与 CLI 的独立事件流。连续多轮复用该目录，但事件中的 attemptId/turnId 更新；resume 创建的新会话使用自己的目录。
- `<reviewer-root>/evidence/`：最终发布映射。
- 原有 `diagnostics-*.jsonl` 仍为元数据日志，不写正文。

每个写入器生成独立的 `<captureId>.jsonl`；事件引用同目录的 JSON 正文，含 SHA-256 和字节数。同一写入器内相同正文去重。哈希针对**脱敏后的 JSON**，不是供应商接收证明，也不是原始 HTTP 字节哈希。原始输入仍以已有不可变 request/source 档案为准。

目录为 0700，文件为 0600。每个写入器正文和索引合计默认最多 64 MiB；上限只停止日志写入，不限制模型 token、轮数或执行时间。上限产生 `capture_incomplete`；写入失败产生无正文的 `evidence_incomplete`/stderr 告警。不存在自动上传或自动清理。排查完成后按实际运行选择性清理独立 evidence 目录，不要删除 request、journal、工具账本、收据或正式结果。

## 证据点

| 事件 | 内容与用途 |
| --- | --- |
| `host_turn_input` | 真正写入 stdin 的提示词、原始/传输 schema、输入摘要、命令文件摘要、继续轮标记。 |
| `sdk_request` | 每次实际尝试的完整 SDK 参数，包括 system、messages、tools、输出约束、模型和采样参数；含 CLI 版本/构建时间。非流式回退单独记录。 |
| `transport_request` / `transport_result` / `transport_failed` | SDK fetch 边界的 JSON 请求体、HTTP 状态或网络失败标记；与 SDK 请求关联，包含重试。不会保存 URL、请求头或鉴权。非字符串/非 JSON 请求明确记 `transport_unavailable`，不读取活的请求流。 |
| `api_response_event` / `api_response_block` / `api_stream_end` | API 返回的消息标识、模型、用量、结束原因、普通文本、完整工具参数。先合并片段再脱敏；异常结束时尽可能保存未完成块并标记 complete=false。 |
| `context_change` | 裁剪边界、工具结果预算、microcompact、自动/预测/响应式压缩、历史 snip、context collapse、签名清理重试和 API 消息整理的前后快照与阶段名。功能未触发不伪造变更事件。 |
| `native_assistant` / `native_tool_or_user_delivery` | CLI 传回宿主的普通模型消息及工具结果/用户消息。工具 ID 可与下一次请求中的 tool_result 对照。 |
| `tool_execution_records` | 既有不可变工具执行记录的绑定副本，包括实际参数、结果、调用 ID、顺序和送达集合；这是宿主汇集时刻，不冒充工具发生时刻。 |
| `report_submitted` / `report_admission` / `host_turn_end` | 提交原件、校验/标准化结果或拒绝诊断，以及封存结果。下一轮修复反馈在 host_turn_input/SDK 请求中。 |
| `report_published` | 被接受报告与实际发布结果并列保留，供逐字段比对；包含结果摘要，不替代正式发布和结算证据。 |

所有事件带 runId、attemptId 和 captureId/sequence。工作流调用还带 reviewerHandleId、hostRequestId；runId 从既有 `foundation:<runId>:<sequence>` 标识解析，独立调用退回 Reviewer handle。原生每轮 stdin UUID 等于该轮 attemptId，CLI 以它记录 turnId。API 调用再带进程内递增 requestId；重试各有独立 requestId，不能跨会话仅凭 requestId 关联。工具以 tool_use_id/工具账本 toolUseId 对照。上下文变更可能发生在 API 请求开始之前，此时通过 turnId 与顺序关联。

## 诊断顺序与边界

1. 找到目标 run 的 SDK/transport 请求，核对 GDD 第85行、ASSET 第72行等目标原文在哪几次请求内存在；对照 system 与工具/报告 schema。
2. 查每次响应的普通文本和工具参数，观察是否提出过该问题，再核对工具账本、CLI 回传和下一次请求里的结果。
3. 对照上下文变更、提交原件、admission 与 publication，定位遗漏发生在模型输出、上下文处理还是报告处理层。

不保存隐藏 thinking/reasoning 块、签名、完整环境或鉴权头；正常报告的 reasoning 字段保留，thinking 配置参数也保留。已知环境凭据、常见密钥字段、Bearer 文本及 URL 凭据/查询串会脱敏。正文仍可能含项目机密和未识别的自由文本敏感信息，不能当成可公开日志。

记录的是客户端可观察内容，不能证明供应商内部如何处理上下文，也不能证明模型注意到了哪些行。硬杀进程/崩溃可能留下没有结束事件的片段；应视作不完整证据。SDK fetch 没有经过该采集边界的特殊传输也不能凭 SDK 快照推断实际线上请求。非流式响应不包含伪造的流事件。

## 验证

新增离线测试覆盖默认关闭、权限/摘要、凭据及分片脱敏、隐藏思考排除、日志容量上限、符号链接拒绝、并发请求 ID、429 重试、格式失败反馈、最终 admission、多轮 attempt/turn 关联、发布结果一致性。全部使用本地模拟接口和假凭据，测试构建与当前服务分离。Reviewer 原有源码边界及独立打包约束保持不变。

本次结果：Reviewer 与新增证据单元测试共 209 项通过、0 失败；额外在日志开启状态运行原生工具及元数据诊断测试，14 项通过、0 失败（与前一组存在重叠，不相加作为独立测试数量）。仓库根目录、agent-workflow-server、agent-workflow 三处 TypeScript 检查通过。CLI 独立构建成功，未安装到当前服务。

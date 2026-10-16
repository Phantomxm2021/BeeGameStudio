# OpenAI 兼容流诊断

Chat Completions 每次请求结束时写一条 `openai_stream_summary`，复用
`native_diagnostic` 通道，保存在项目 `.beegame/logs/native-runtime.jsonl`。
日志随现有诊断文件轮转，不建立额外的正文记录。

失败时查看 `diagnostic.streamFailure`：

| 值 | 已观察到的事实 |
| --- | --- |
| `transport` | fetch 或响应体读取抛出异常；`category` / `errorCode` 仅含白名单分类。 |
| `upstream_incomplete` | SSE 到达 EOF，但没有 `finish_reason`。`doneSeen` 表示是否收到 `[DONE]`；`pendingFrame` 表示是否还有未结束的帧。不能仅凭此区分服务商和中间代理。 |
| `invalid_sse` | 完整 SSE data 帧无法解析为 JSON。 |
| `sdk_parse` | 原始 SSE 中观察到 `finish_reason`，SDK 迭代已结束或抛错，但产出的 chunk 中未观察到。 |
| `adapter` | SDK chunk 已含 `finish_reason`，或下游提前结束 SDK 迭代；转换或处理仍失败。 |
| `upstream_error` / `http` | 上游显式返回错误事件或 HTTP 错误状态。 |
| `unknown` | 现有证据不足，不能归因。 |

汇总还包含字节数、SSE 事件数、SDK chunk 数、总耗时、最大读取间隔、
HTTP 状态和结束标记布尔值。读取间隔包含客户端处理时间，并非服务商延迟的精确测量。
`terminalWithoutDelta` 用于确认兼容“结束帧没有 delta”的响应。
取消单独标记 `outcome: cancelled`，不算作上游失败。

观察器只在内存中短暂解析帧，每帧最多 64 Ki 字符；超过上限计入
`skippedFrames`，缺少结束标记时保守归为 `unknown`。
不持久化 URL、请求头、Key、提示词、回复、推理、工具参数或原始错误。
关闭 SDK 的请求/原始 SSE 日志，JSON 解析错误对外使用固定错误信息。
观察器不复制响应流、不创建额外请求、不重试、不补造成功结束事件。

验证使用本地伪造 SSE 和真实 SDK/适配器/查询入口，网络出口被阻断；
涵盖正常结束、缺少结束帧、无效 JSON、读取异常、取消、超大帧和诊断落盘。

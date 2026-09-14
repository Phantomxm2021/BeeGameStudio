# Foundation 模型响应观测

Reviewer 与 Revision 复用现有脱敏 response trace。每次模型请求记录请求开始、响应头、首个流事件、流结束、重试等待与错误分类；记录根 Agent 和 detached subagent 的 agent/query 关系，但不保存隐藏推理、密钥、签名或完整 Prompt。

原生执行器在 `stream_request_start` 后进入上游等待态，首个 `message_start` 到达时记录首流延迟。超过 30 秒仍无真实响应时，每 30 秒追加一次 `upstream_waiting`，包含请求序号、静默毫秒数、最后真实活动时间和已观察模型响应数；同一信息进入工作流进度。它只用于观测，不终止、不重试、不改变审修策略。

根 Agent 的响应仍由 stdout 作为用量权威来源；trace 只向用量观察者补充 detached subagent 消息，避免同一根响应重复计费或触发持久化冲突。

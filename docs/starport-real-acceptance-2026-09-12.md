# 新 GDD-first 方案真实验收：星港分拣员

## 结果

**验收受阻，尚未触达 Author，不能判定新 Author 方案通过或失败。**

通过 Chrome 首页提交一个全新案例《星港分拣员：12件货物验收》，并确认一次真实 Credit 生成。未复用旧项目；没有手工补文档、跳过证书校验、再次提交生成或追加执行预算。

## 案例

React 2D Web 单关分类游戏：固定 12 件货物，能源/饮水/食品三类；点击、触摸或按 1/2/3 投放。投对加 1 分，投错加 0 分，两者都处理当前件；第 12 件后得分至少 10 分胜利，否则失败。支持重开，不含随机顺序、计时、生命值、撤销、跳过、联网或付费。范围仅八文档及独立审修，不进入素材、实现或发布。

## 真实证据

- 首页任务：`intake_b26e8983f7ec40f480dd50bde5b38885`。
- 开始：2026-09-12 15:19:14.161 UTC。
- 失败：2026-09-12 15:19:56.128 UTC，约 42 秒。
- 持久状态：`failed`，`errorStatus: 400`，`error: unknown certificate verification error`，无 `result`。
- 页面显示同一证书错误，没有进入三选一方案选择或创建 Author 运行。
- 计费服务记录 `POST /api/internal/usage/events` 失败，traceId 为 `51375a75-c7a3-4cb7-a443-c08ad67677c3`；下游连接为配置的计费数据库 `/rest/v1/rpc/beegame_record_usage`，错误码 `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`。
- 随后的两次不带认证、只读 HTTPS 探测均通过证书验证并收到预期 401：curl 的 `TLS_VERIFY=0`；同环境 Bun 的 `createTLSAwareFetch()` 也返回 401。此结果只证明探测时 TLS 连接可用，不能追认之前的用量登记或扣费结果。

## 实现上的失败传播

`app.ts` 的 `generateBeeGameModelWithUsage()` 先取得模型返回，再等待 `recordModelUsage()`，之后才返回内容。`createUsageRecorder()` 的 `input.record()` 在 debit 的容错分支之外；本次登记失败向上传播。首页任务只有在整个 `runBeeGameIntake()` 成功后才保存 `result`，因此最终只保留了失败状态，未形成可恢复的方案结果。

这意味着此次失败在首页生成/用量登记链路，而非 GDD-first 委派链路。不能声称“没有模型消耗”，也不能仅凭客户端 TLS 错误断言最终是否扣费。

## 后续边界

未进行产品代码修复或计费补记；旧项目保持原状态，本地服务继续运行。重新生成可能再次产生模型用量。建议先处理首页生成结果与用量登记的可恢复交付，核对本次结算状态，再经明确授权重新验收；不要关闭证书验证或直接重复生成。

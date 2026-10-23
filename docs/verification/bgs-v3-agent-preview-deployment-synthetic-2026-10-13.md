# V3 Agent 模式 Preview／发布合成验收（2026-10-13）

本轮不调用付费模型，不修改真实游戏、正式前端或 Claude Code 源码；保留现有 Bun 1.3.14。使用独立合成工程验证已测构建的产品通路，不能据此认定游戏品质合格。

## 结果

- 五个现有服务在最终 runtime 重启后，`/health` 均返回 200（端口 62173–62177）；未重启其余四项服务。
- 合成 Agent Run `78048788-1d50-4609-b29d-487a3bcbe964` 的测量 `1ca6db09-4582-4be4-b178-c37dc0c96378`：`build`、`runtime-smoke` 通过；`dist` SHA-256 为 `70ce4805d694387ef78e7ed36876a8ef913d2a74a3699b5f708edb6844c0896d`。没有模型调用；Run 的 `deliveryEligible=false`，品质未验证。
- 独立 debug 通过正常登录态读取该 Run 并打开已测 Preview，页面显示 `V3 Agent Synthetic`、`Ready`，可点击成为 `Clicked`。
- 正式页面最初能打开 V3 Preview，但仍显示“候命”：`runtime-state.build_report` 只读取旧 Preview 管理器。服务端现将当前有效的 V3 已测 Preview 映射到同一运行状态；关闭后不保留该映射。不增加数据库轮询，也不改正式前端。
- 最终修复的定向回归通过：`measured-preview.test.ts` 中完整 BGS app 用例 1/1；正式页面实测显示并能操作同一合成 Preview，停止后返回候命。
- 正式部署弹窗识别已测构建、发布成功，历史版本显示“版本 1”；[线上合成页面](https://game.beegame.studio/deployments/deploy_cc790ea45240400d9df6c08cd009620f/files/index.html)实际加载并可将 `Ready` 点击为 `Clicked`。该公开测试产物暂保留作验收证据，未触碰真实游戏。

## 限制与后续

- 全量 `measured-preview.test.ts` 为 16 通过、1 项因当前沙箱无法监听端口 0 而失败；该失败不是断言回归。定向集成用例通过。
- 包级 `typecheck` 当前有大量既存跨包别名／依赖解析错误；本轮涉及的 `app.ts` 与测试文件未出现错误，但不能宣称整包类型检查通过。
- 正式页面在 iframe 已呈现时仍可能短暂显示“正在加载预览页面…”；未改正式前端，本轮不把它视为游戏交付通过。
- 仍需独立授权真实游戏的八领域、Skills、Scene/UI 消费、资源及完整玩家流程品质验收；本合成测试不代替该验收，也不自动启动付费任务。

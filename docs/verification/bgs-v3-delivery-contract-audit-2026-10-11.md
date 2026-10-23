# V3 1.41：交付要求纠偏与实施审计

日期：2026-10-11（Asia/Shanghai）。用户要求先把四项结论修订进正式规范，再依文档推进；本轮不恢复付费执行。

## 依据与保留

- 正式规范：`bee-game-studio/docs/BGS_V3_Agent_Driven_Workflow_Implementation.md`，版本 1.41，主要变更在 §3、§7.1、§8.3、§9.11。
- 1.40 在相邻 verification 目录按字节归档；已与修订前完整内容比较一致。历史实施记录不删除，当前要求明确覆盖历史可选 JSON 表述。
- 上轮原始归因与「磁轨调度」暂停证据保留在 `bgs-v3-native-measurement-audit-2026-10-11.md` 文末。原工程和 transcript 未改，4,358,327 Token 为中途已报告下限，不是成功交付成本。
- 付费验收服务仍保持暂停/原配置，本轮没有模型/图片付费调用、服务重启或数据库迁移；源码修改不会热修已加载服务。

## 已落地与不宣称解决的内容

| 原因 | 实施 | 验证及限制 |
|---|---|---|
| 接单把领域名混写成路径 | agent-goal 共享职责将领域清单和目录分开；新文档统一 docs/，既有来源不强迁；目标、变更、续作共用，讨论不带制作职责 | 断言路径及原始 brief 保留，正常会话/恢复回归；没有手工搬动真实游戏 |
| 通用职责压缩后没有实际使用专业方法 | 明确在相关专业工作/审查前调用现有 native Skill，复用已加载方法；具体决定、理由、来源与假设，以及真实代表画面/交互要求进入交付职责 | 不修改 Skills 或 Claude Code；固定模型调用只能证明传递/执行，不证明真实模型会正确运用，不以调用数保证品味 |
| React/Canvas 选择被误当作免交 JSON | 共享职责与工具说明撤销泛化豁免；新 BGS Web 默认 Scene/UI 可编辑数据与真实消费，明确排除原生引擎重复 JSON、未经授权迁移旧项目 | 已有格式/布局/只读来源/消费检查复用，不新增统一 Scene 模型或强制阶段 |
| 验收只加载根 env，没走正常本地服务环境 | 导出并复用既有 buildRuntimeEnv；paidDebugRuntimeConfig 先拒绝不完整显式资源配置，再复用正常本地配置；验收脚本实际传入 resourceSelectionRuntimeConfig | 新帮助函数只做配置，无服务启动/模型派发。合成 transport 查询验证正常鉴权、无鉴权失败与上游失败；凭据不进入 Agent 适配脚本 |

## 查证后新增的未闭环项

1. `routes.contentView` 对自主 Run 可读取保存的 index/Scene/UI；但 `contentOwners` 从旧 Task 推导可保存路径，自主 Run 无这些 Task，因此只读。已补反例确保不误授写权限，并修正只读说明中的“必须 Task”措辞。没有伪造 Task 或放开并发写入。
2. 自主工程直接保存数据、撤销旧测量当前性、重建再测的完整编辑路径仍待独立 debug 接线；规范 §3.3、§7.1、§9.11 单列，不能把只读测试计为编辑完成。现有同工程 Agent 需求变更不等于该 UI 数据保存入口已成立。
3. 完整 legacy package/index 的版本来源不能靠填假的文档/Manifest 指纹解决；继续区分已有纯草稿工具与完整消费契约，后续按实际消费者核对来源，不复活八文档发布门禁。
4. 真正的专业设计、美术/音频表现、资源选择/制作/消费及 Token 改善仍需授权实际验收。程序化制作不天然是占位，optional 资源库策略也不允许省掉表现要求。

## 回归记录

- 接单、生产续作、资源配置/transport、原生工具与数据只读：5 文件，40 pass / 0 fail，368 expects（1.97 秒）。首次在禁止 loopback 的沙箱内 16 pass / 24 fail，错误均由监听随机端口失败及其后续影响造成；同一源码在允许本机连接的测试环境重跑通过，没有放宽产品权限或删除失败反例。
- 现有格式/空间布局/来源失效/资源检查与 debug 路由：2 文件，7 pass / 0 fail，55 expects（0.554 秒）。
- 根配置 `bunx tsc --noEmit --pretty false`：退出 0。
- 真实 CLI + 本机固定 provider / 独立 debug、实际浏览器 UI/Canvas 数据消费反例、绑定/资源配置：6 文件，51 pass / 0 fail，316 expects（111.83 秒）。原生五回合/25 次本机请求，实际 Skill/Question/修订/续作、测量与导出通过；付费调用 0。合成模型输入/输出计数不能拿来估算真实成本。
- 三组无重复测试文件，合计 13 文件、98 pass / 0 fail、739 expects。这里统计回归范围，不以测试数量证明游戏品质；本轮未跑全仓所有测试。

关键命令：

```text
bun test scripts/workflow-v3-paid-debug-config.test.ts scripts/beegame-dev-lib.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/agent-tools.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/content-view.test.ts
bun test packages/agent-workflow-server/src/beegame/workflow-v3/context-content.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/debug-page.test.ts
BEEGAME_TEST_REAL_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal-native.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/ui-consumption.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/pixel-consumption.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/runtime-checks.test.ts packages/agent-workflow-server/src/beegame/content-binding.test.ts packages/agent-workflow-server/src/__tests__/resource-selection-config.test.ts
bunx tsc --noEmit --pretty false
```

## 修改边界与成本

- 新增仅一个小型纯配置适配文件及其回归，复用正常启动器，不增加工作流框架、阶段、数据库表、限额或自动付费重试。
- 系统制作职责（不含 brief）为 3,329 字符，较前轮多了必要交付说明；不预载八稿或全部 Skills、不新增总结回合。字符数不是 Token 用量，未宣称减少实际费用。
- 正式 frontend、Claude Code `src/`、`packages/builtin-tools` 整树指纹与本轮开始一致；脏工作树中的既有改动保留。
- 下一步优先关闭自主数据保存/重新测量的 Task 依赖；真实游戏继续或迁移须明确授权，不用手工修补「磁轨调度」作为成功证据。

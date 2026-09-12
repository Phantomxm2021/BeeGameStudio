# Reviewer 测试基准（P0）

> **退役状态（2026-09-11，原生文件审阅迁移后）**：下文记录的是旧 host-mediated / native-tools-v2 / GDD-led 实验，不代表当前 `native-file-audit.v1` 实现。本目录尚未完成物理归档；旧 task factory 注入入口不能用于当前生产验收，也不能据此启动新付费批次。历史命令、指标和旧额度仅为历史记录。
>
> 当前离线验收入口为 `packages/agent-workflow-server/src/__tests__/foundation-reviewer-public-infrastructure.test.ts` 以及 Reviewer 的 `single-agent-lifecycle.test.ts`、`review-comparison.test.ts`、`public-dependencies.test.ts`。历史报告与摘要兼容测试继续保留。新模型语义评测需要先迁移执行器，再另行获得授权。

唯一权威：[可靠性推进总计划](../../docs/foundation-reviewer-reliability-plan-2026-09-10.md)。本目录只是测试数据和离线核验，不是新的生产审查模块。

最新单会话 Flash 对照已关闭：`glm-5.3-flash` + 同一 B24/r1，检出 7/8、漏 S06、正常例误报 0/8，新增 4.6206 积分已结算，仍未通过。使用隔离 runner 副本，只改模型/单会话/12 积分登记；本目录生产及原 runner 源码未为此改动。不复用额度或补跑，详见[结果与证据](../../docs/foundation-reviewer-r1-semantic-glmflash-2026-09-11.md)。

## 2026-09-11：r1 两会话已关闭，语义未通过

`semantic-runner.ts` 已在新批次中显式接入 `semantic-instructions-r1`，并强制登记匹配候选摘要；`semantic-candidate-runtime.ts` 仅在隔离进程绑定 task factory，不改变生产源码或 public API。实际请求逐份核验候选正文。53 项相关离线测试与类型检查通过，不等于模型效果通过。

两个获批 GLM-5.3/B24 会话新增 7.7925 积分，均完成结算；检出分别 8/8、7/8，各有 1/8 正常例误报，故本批失败并关闭。不得复用执行 claim 或额度、不补跑、不启用生产。详见[结果与持久证据](../../docs/foundation-reviewer-r1-semantic-glm53-2026-09-11.md)。下面的离线修复及候选准备段落保留其当时状态；不构成新的付费授权。

## 2026-09-11：历史错误离线复现与测试执行器修复

`bun scripts/reviewer-reliability/reproduce-semantic-report.ts <只读证据目录>` 校验本批 52 个归档文件摘要，重放真实最终参数，并分别验证：历史错误引用可通过结构准入、越界引用被拒绝、只改正确行号不改变既有漏报。默认没有网络、凭据或模型入口。S06/S08 只用于该历史回归的明确断言，不是通用语义评分器，也不进入生产提示。该命令不改原报告、不产生新的模型观察。

测试执行器支持模块：`evaluation-credential.ts` 绑定原 owner/session，通过既有本机会话路由续期，兑现 forceRefresh，并对只读配置查询的 401 限定一次刷新重试；`evaluation-finalization.ts` 等待执行锁释放及用量封存/结算，核对正式回执与发布绑定，区分配置 unchanged / changed / unknown。

继任入口为 `semantic-runner.ts`，替代历史临时 runner 用于未来另行批准的批次。`bun scripts/reviewer-reliability/semantic-runner.ts --preflight` 在没有新批次时只报告零网络就绪，不读取真实凭据、不调用模型。它没有本轮可用的付费登记，不能重新打开原批次。未来须另行批准后，准备全新的目录及 `registration.json`、冻结输入/manifest、`freeze.ts`、绑定新目录的 `capture.ts`、生产 base-task，再设置 `BEEGAME_REVIEW_BATCH_ROOT`；模型、次数及保护值须与登记一致。当前常量沿用 GLM-5.3、两次、12/24 积分保护，只是校验边界，**不代表旧额度自动续用或已获新授权**。本轮不创建有效付费登记。

本地验证命令：

```sh
bun test scripts/reviewer-reliability/evaluation-runner.test.ts
bun node_modules/typescript/bin/tsc --noEmit --pretty false -p scripts/reviewer-reliability/tsconfig.json
```

测试使用合成会话、进程内 Hono 路由和注入的请求/时钟，不启动网络监听、不调用真实认证、计费或模型。根项目的 tsconfig 不包含 scripts，因此额外配置将新脚本纳入类型检查。修复的范围与证据详见[离线跟进记录](../../docs/foundation-reviewer-v2-offline-followup-2026-09-11.md)。

## 固定命令

独立语义提示候选：`semantic-prompt-candidate.ts`，说明见[最小候选 r1](../../docs/foundation-reviewer-semantic-instructions-r1-2026-09-11.md)。仅宿主指令增加两句，未接入生产或付费执行器；测试命令 `bun test scripts/reviewer-reliability/semantic-prompt-candidate.test.ts`。不得把离线测试通过当作模型效果通过，付费验证仍需新登记。

原生工具 v2 就绪检查：`bun scripts/reviewer-reliability/native-v2-check.ts`；测试：`bun test scripts/reviewer-reliability/native-v2.test.ts`。

它复用原有冻结输入和评分说明，不改题、不加载旧报告、不调用模型。检查 10 个新协议 schema、模型实际收到的输入与评分数据隔离，并通过原生 `review_read` 逐份读取三套输入的需求和八文档、核验原文与调用日志。输出 `offline_ready` 和 `semanticQuality: not_evaluated`，不是模型语义通过。临时工具日志由命令自行清理，不删除历史验收材料。

新协议输入导出：`bun scripts/reviewer-reliability/native-v2-check.ts --input B24`（也支持 R41/R86）。只输出冻结 input。没有联网或自动模型测试参数；真实批次需先登记模型、次数、费用及停止门槛。保留组不用于提示词迭代。

以下 P0 命令保留历史口径与旧协议呈现检查，不用其结果冒充 v2 质量验收。

从仓库根目录执行 `bun scripts/reviewer-reliability/check.ts`。

该命令验证成对样例只改变一条陈述、固定输入摘要、八文档呈现无损、模型输入不含评分元数据、保留组只有预置的三个文件改变，以及五份历史原报告摘要；输出同一份历史评分汇总。不会联网、调用模型、改动原报告或生成新的语义评分。原历史文件位于 rubric.json 指定的本机隔离目录；缺失或被改动时明确失败，不静默跳过。迁移环境前应完整归档原记录并显式更新路径，保持摘要不变。

只导出模型输入：`bun scripts/reviewer-reliability/check.ts --input B24`。这一分支只序列化 input，不带 rubric、历史报告或答案。代码没有自动运行真实测试的参数。

## 四个文件的职责

- `fixtures.ts`：一套含16个独立小样例的基础判断输入 B24；冻结的两套小型八文档输入 R41/R86。B24 是基础判断诊断，不冒充完整游戏交付验收；R41/R86 才是小型完整游戏保留样本。
- `rubric.json`：人工评定依据、原始位置、正反例映射、冻结摘要和历史评分；不得发送给模型。
- `check.ts`：上述离线完整性核验与输入导出，不自动判断报告的语义正确性。
- 本文：运行方式与边界。

## 评分方式

新运行先保存完整原始报告、工具记录、用量和回执，然后人工将每个判定映射到样例/锚点与 finding 索引，并写出原文理由。合并问题只要实际覆盖各独立错误仍可计命中；不能以关键词或引用行号命中代替正确解释。

B24 正常8例、确定缺陷8例，家族覆盖引用身份、权威、公式ID、距离、模拟/表现、图板/应用面、双状态字段与明确例外。R41 未预置缺陷，R86 预置三项；若人工发现保留样本自身有意外缺陷，先修订并重新冻结基准，不能反过来要求模型隐瞒它。

历史七个核心锚点与两个扩展锚点分别记分。窄任务排除了数值两项，其分母为5，不与完整任务7项直接混比；三项子集只是历史对照指标。报告失真与范围过度确定另列，命中不能抵消。

所有语义标签为内部人工评定，不声称第三方盲测或穷尽真值；离线核验通过也不代表模型质量通过。保留样本不得用于候选提示迭代。

## 进入 P1 前

只使用 B24，当前模型、当前报告结构、两个新的独立会话、无旧报告。先按计划落盘数值化批次预算及判定问题，再发起调用。不得因为本目录就位而自动跳到提示修改、模型切换、事实流水线或强制复核。

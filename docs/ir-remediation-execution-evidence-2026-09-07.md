# IR 整改首批执行证据

日期：2026-09-07。状态：IR-0 与 IR-R0 已关闭；不代表已修复 F1—F8，未达到 R6 整改准入。

## 提交与隔离

- 本轮开始前所有既有改动已提交：`484e77806cbd044bf3a3c5a9e665428286a2894f`（489 文件）。已核验 staged diff 无空白错误，未 push。
- Foundation 目标仍在 `codex/game-ir-isolation-recovery`，不覆盖其已完成的阶段隔离。
- 新整改工作区：`/private/tmp/beegame-ir-remediation.6TvmRK`，固定源 `4335363b2cd33d1f0b7bd807bff95d9389c67ce1`。源工作树不写入；R6 前不迁入目标生产目录。
- IR-0 / IR-R0 成果提交：`8920ce4803d74f7be1fd031d8746bc4d07b625f0`，独立分支 `codex/game-ir-conformance-remediation`；8 个新增文件（清单/证据、3 个回归测试、独立清单校验器与测试专用 tsconfig），无生产源码修改。未 push。清单、回归和校验工具均已进入 git，不只留在临时日志里。
- 主 agent 负责契约、清单与因果审计；Luna high 执行独占清单/回归任务。未改变产品运行模型配置。

## 本地环境与计数边界

根目录直接共享源 `node_modules` 不足以复现隔离环境：会缺失 per-workspace 包，并造成 TypeScript 私有类跨 worktree 身份冲突。最终改为每个 workspace 独立依赖链接：同仓包按名称映射整改源码，第三方依赖只读复用已有安装。设置脚本：`/private/tmp/ir-remediation-link-dependencies.mjs`（347 个链接、32 个 package 目录；无安装、无锁文件变更）。

`dist` 只读链接源工作区已有产物，供 native command 单元测试验证路径存在；这些测试使用假进程，未以它执行真实模型。该链接不是本轮源码 build 通过的证据。初次缺依赖/缺路径的环境失败单独记录，不计为新增 IR 缺陷，也不冒充有效基线。

IR 的历史命令按路径子串选择，包含目录外同前缀 `game-ir-checkpoint-terminal-recovery.test.ts`；因此是 46 文件。严格 `./.../game-ir/` 目录为 45 文件，不与旧 46 文件数字混用。

## 精确运行命令

均从整改工作区执行。IR 基线（本轮实际 635 pass / 0 fail，46 文件，2 snapshots，6197 assertions，240.92s）：

```sh
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
```

外层 10 文件（本轮实际 268 pass / 2 fail，270 tests，2097 assertions，13.48s）：

```sh
bun test \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/controller-game-ir-admission.integration.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/controller-game-ir-preflight.integration.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts \
  ./packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts \
  ./packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts \
  ./packages/agent-workflow-server/src/beegame/runtime-observability.test.ts \
  ./packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

两项已知失败：`turns native projection output into a service-bound operation terminal`、`starts a fresh projection session for every slice without rebinding or full packet prompts`。均为旧 fixture 未提供 obligationInventory，在 `projection-slice-authority.ts:284` 读取 moduleId 时失败，归入 F4 / IR-R4；不在 R0 偷修。

```sh
bun run typecheck
```

类型检查本轮 exit 0。两个不重叠测试集合合计 903 pass / 2 fail；准备中的新增 RED 不计入此数。日志：`/private/tmp/ir-remediation-baseline-core-20260907.log`、`/private/tmp/ir-remediation-baseline-outer-20260907.log`。测试数量不是符合性完成标准。

## 后续关闭证据

IR-0：已核验逐文件清单/外部边界及[公开契约冻结](ir-remediation-contract-freeze-2026-09-07.md)。整改树内 `docs/ir-remediation-source-manifest-2026-09-07.json` 覆盖 107 项（IR 38 生产、45 测试、3 测试辅助，加 21 外层接缝/证据），另有 19 个补充边界文件及 11 项 Foundation 保护差异；`node scripts/verify-ir-remediation-manifest.mjs` 从固定 git 对象独立校验真实 AST 依赖集合和 SHA-256，exit 0。曾发现并纠正生成器误识别字符串/遗漏选定外层依赖及保护 SHA 的问题，未将错误清单作为关闭证据。

IR-R0：三个正式文件已纳入整改分支 `codex/game-ir-conformance-remediation`，主 agent 独立重跑为 0 pass / 4 fail，3 文件、13 assertions、exit 1。没有 `.skip`/`.todo`/`.only` 或外部工作区绝对 import；失败均为所审缺陷的正确行为断言。F1—F8 本身继续未关闭，R1 的双向身份协议须先主审。

```sh
bun test \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/controller-game-ir-conformance-f1.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir-source-conformance-f2.test.ts \
  ./packages/agent-workflow-server/src/beegame/delivery-workflow/controller-game-ir-conformance-f3.test.ts
```

- F1：GDD 明确变量和 condition 规则，走真实 controller/dispatcher/journal，slice.0 仍未完成。
- F2：两个独立测试分别证明 catalog 和 validator 丢失重复正文（均 0，而不是 2）。
- F3：实际派发的来源/compile 身份、admitted inventory 及提交 records/FAIL 相同，仍为 running 而非 needs_action。两轮是反例构造，不是固定重试 cap。

新增测试也通过 `node node_modules/typescript/bin/tsc --noEmit -p scripts/ir-remediation-r0.tsconfig.json` 的单独完整类型检查（exit 0），不依赖根配置排除测试文件。完整因果/未验证边界记录位于整改树 `docs/ir-remediation-r0-evidence-2026-09-07.md`。下一步为 IR-R1 协议决策和实现，随后 R2/R3；本批只新增文档、校验脚本与回归测试，没有生产代码修复、迁入或真实模型调用。

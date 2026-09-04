# Foundation Author / Reviewer / Revision 职责重整方案

状态：实施前审计通过（已吸收纠偏）

基线：`codex/checklist-implementation` (`70df2e2c79bd214862af3959a257c5f5f42bd666`)

Game IR 保留源：`codex/game-ir-preserved` (`4335363b2cd33d1f0b7bd807bff95d9389c67ce1`)

## 1. 目标

恢复已验证的整篇 Foundation Markdown 撰写方案，并纠正 Stage 2 在正文格式、内容和质量上的越权。

唯一职责链为：

```text
Stage 2 Author：完成八份候选文档并原样落盘
        ↓
Stage 3 Reviewer：审计格式、内容、质量和跨文档一致性
        ↓
Stage 4 Revision：修复 Reviewer 发布的全部 Issue
        ↓
Stage 3 Reviewer：重新审计，直到 Issue Registry 为空
```

本方案不修改、接入或运行 Game IR。Game IR 代码继续由独立保留分支持有，后续只能通过 Foundation READY receipt 接入。

## 2. Stage 2 唯一职责

每份 Foundation 文档继续使用上一稳定方案的一次完整 Raw Markdown 撰写任务和既有安全并行调度。Author prompt 可以提供推荐模板、文档职责和写作要求，但这些要求不构成 Stage 2 admission。

Stage 2 只处理无法留给 Reviewer 的执行事实：

- 模型调用是否明确成功；
- 是否获得非空文本；
- 目标路径是否为当前 dispatch 的唯一服务端指定路径；
- 文档是否成功持久化；
- receipt、digest 与实际文件 bytes 是否一致；
- committed upstream authority 是否在撰写期间发生变化。
- worker 是否尝试使用被禁止的工具或越过 dispatch 文件权限。

Stage 2 不解析、拒绝、修正或重试以下正文问题：

- H1/H2/H3 的大小写、名称、数量和顺序；
- 缺少、重复或额外章节；
- Markdown fence、inline code、table、Mermaid 或 SVG 格式；
- protocol marker、Production Materials 形状或 acceptance criteria；
- 文档引用拼写、正文重复、职责越界、事实遗漏或质量不足。

只要 provider 成功返回非空文本，Stage 2 就保存该候选正文。不得根据正文格式触发 continuation、replacement、fresh dispatch 或 `needs_action`。服务端拥有的路径、版本、时间戳和 receipt 元数据不由 LLM 声明，也不属于正文质量修复。

后续 Author 的 committed upstream projection 也不得成为隐藏格式 gate。每个已提交 upstream path 在模型侧统一投影为一个 `path + content` source：当合同声明的全部 Section marker 可精确解析时，`content` 只包含这些相关 Section；任一必需 marker 不可解析时，`content` 改为该 path 的完整 raw Markdown，且只出现一次。该规则只选择只读 evidence scope，不修正、认可或拒绝正文格式；source path、完整 document digest、projection canonical bytes 与撰写期间 authority drift 仍须严格验证。不得按标题别名、大小写或关键词增加兼容 parser。

## 3. Stage 3 完整 Reviewer

Stage 3 首先执行同一 Reviewer 内的文档可审计性检查。它不是 Stage 2 admission，也不修改任何文档。

### 3.1 文档级格式 Issue

当文档无法建立可信 SectionIndex 时，Reviewer 发布 document-scoped format Issue，至少包含：

- canonical document path 与精确 document digest；
- 观察到的格式问题；
- 权威文档要求的期望结构；
- `patch` remediation with `scope: document`；
- 不依赖伪造 SectionRef 的整篇证据范围。

每份不合格文档在同一轮只产生一个合并后的 document-scoped format Issue，列出该文档的全部结构问题，避免按标题、表格或围栏拆成大量 Issue。只要任一文档存在这类 Issue，本轮 Reviewer 就发布它们并进入 Stage 4；不得把 parser/SectionIndex 异常转换成 workflow `needs_action`，也不得另起一个 format-reviewer worker 或第二份 Registry。格式修复后重新运行 Stage 3，再进入 SectionIndex、Fact、Contract 和 semantic review。

格式不成立时，本轮不能可靠建立 SectionRef，因此不伪造 section-scoped 内容结论。Revision 修复结构后，下一轮 Stage 3 对完整八文档执行全部内容与质量审计。这是同一 Reviewer/Revision 闭环的顺序收敛，不是新的 stage 或并行审计轨。

### 3.2 完整质量审计

当八份文档均可建立可信 SectionIndex 后，Stage 3 使用现有 Reviewer 继续检查：

- canonical 结构与材料格式；
- 内容完整性、正确性和可实施性；
- 重复、职责越界和无效引用；
- 八文档事实、规则和接口冲突；
- 版本、路径、材料及跨文档 authority；
- 用户要求的其他质量标准。

所有问题进入唯一 Issue Registry。不得在 Stage 2 保留相同检查，不得建立第二份格式错误列表。

## 4. Stage 4 Revision

Stage 4 继续只消费 Stage 3 发布的唯一 Issue Registry。

- `patch` remediation 增加互斥的 `scope: section | document` 判别字段；section scope 使用现有 section patch，document scope 只允许格式 Issue并改写该任务绑定的完整 staged 文档；
- 两种 scope 复用同一 revision planner、task collection、worker type、staged document、terminal、receipt 和 publication；不得增加第二个修订器、fallback、双写或并行 candidate；
- 修订正文统一使用 raw Markdown 输出，禁止把完整 Section 或文档编码进 JSON/工具参数。section scope 不暴露工具，只返回全部授权 Section 的 canonical heading + body；document scope 只允许一次绑定只读，然后返回完整 staged Markdown。原子合并、metadata、digest、snapshot 与 receipt 全部由服务执行，不保留模型侧 Apply/Submit 兼容轨；
- section scope 继续使用既有 PatchValidation、impacted Fact 与 targeted semantic recheck；document scope 因原文没有可信 SectionIndex，只在 Stage 4 提交边界机械验证非空、完整 canonical 结构及 digest，发布后由 fresh Stage 3 完整复审，禁止伪造 section targeted recheck；
- 修订发布后必须回到 Stage 3，不能从 Stage 4 直接声明 Foundation READY。

Stage 4 可以拒绝越权写入、空输出、receipt/digest 不一致或未解决 Reviewer Issue；这些是修订提交与复核职责，不是重新引入 Stage 2 admission。

## 5. 删除旧轨

实施时必须删除，而不是停用：

- Stage 2 正文结构 admission；
- Stage 2 基于 heading/fence/material 的 continuation 与 replacement；
- Stage 2 complete-document readiness gate；
- Stage 2 正文格式 audit sidecar 和虚假的 `canonicalStructure: passed` 声明；
- 本轮已撤销的 unit cursor、unit receipt、unit stream、skeleton assembler 及其测试；
- 任何在 Stage 2 和 Stage 3 同时判断相同文档质量的代码。

保留的 canonical complete-document validator 只能有两个明确边界：Stage 3 Reviewer 用它产生唯一格式 Issue，Stage 4 用它验证该 Issue 的整文档修订提交。Stage 2 不得调用；Stage 4 不得据此产生第二份 Issue 或第二条审计轨。

## 6. 实施顺序

1. 冻结 `codex/checklist-implementation` 生产基线和 5 个已验证测试夹具修正。
2. 将 Issue source/remediation 改为严格的 section/document discriminated union；提升当前 workflow schema version，旧状态严格拒绝且不增加 migration reader。
3. 增加 Stage 3 每文档单一 document-scoped format Issue 合同测试。
4. 实现 Stage 4 document-scope staged rewrite、完整文档提交验证和 publication/recovery，并复用现有唯一 revision state machine；发布后回到 fresh Stage 3。
5. 从 Stage 2 删除完整文档 validator；仅保留 Stage 3 Issue 生成入口与 Stage 4 document-scope 提交验证入口。
6. 删除 Stage 2 的结构判断、格式驱动续写/替换和 readiness 阻断。
7. 更新 Author、Reviewer、Revision prompt，使职责与本方案一致。
8. 运行 Stage 2、Stage 3、Stage 4、恢复、全服务回归和边界扫描。
9. 使用故意破坏标题大小写、章节、围栏、表格和引用的 mock 文档证明：Stage 2 全部落盘，Stage 3 生成 Issue，Stage 4 修复，Stage 3 复审通过。
10. 启动一个全新 Chrome 项目，从 Idea 跑完八文档、Reviewer 和 Revision；记录真实耗时、Token、修订轮次和最终质量，不设置任意硬上限。

## 7. 禁止项

- 不增加格式白名单、标题/关键词兼容 parser 或自动正文修补器；上游证据在 marker 不可用时投影一次完整 raw document，不视为格式修复或第二 author 轨；
- 不把 Reviewer 内部格式检查做成新的 workflow stage；
- 不恢复 unit authoring 或多候选 author 轨；
- 不使用完整文档 JSON/YAML 输出；
- 不设置固定 Token、字数、时间、轮次或 attempt 上限；
- 不修改 Game IR、Resource、Content、Implementation 或 Acceptance；
- 不让 Game IR 反向影响 Stage 2、Stage 3 或 Stage 4。

## 8. 完成标准

- Stage 2 对任意非空 Raw Markdown 只提交一次，不因正文形状重试或阻断；
- 所有格式、内容和质量问题只由 Stage 3 发布到唯一 Issue Registry；
- Stage 4 能修复没有合法 SectionIndex 的整篇文档；
- 修订后重新进入 Stage 3，Registry 为空才产生 Foundation READY；
- Stage 2 不再存在正文 validator、格式 repair、format retry 或对应旧状态；
- Game IR 保留分支的 tree 与 commit identity 不变；
- 自动回归与真实 Chrome 验收均通过。

# Stage 2 交付契约、输入覆盖与串行路径清理

## 本轮授权与边界

用户批准先提交全部已有改动、再按规划实施。已有改动已提交为 `247f5055a`（`fix: refine stage2 author contracts and record acceptance evidence`）。本轮后续改动尚未提交。

本轮只调整 Stage 2 私有作者输入/交付契约、旧串行作者分支及前端文档状态。Reviewer、Revision、Game IR、共享验证器、控制器、传输、计费和模型配置不变。不增加语义拒绝关卡、不改整份 Markdown 输出、不设置固定 Token/时间上限。

## 实施与离线证据

- 真实 d3108 的 GDD、Level 文档作为输入投影回归样本；仅规范化文件末尾换行，正文不改。首先复现 UI 缺少提前预告义务、Asset 缺少完整波次组成的两个失败，再修正已有区块选择。
- 四组事实（公平性、波次组成、交互、音频交付）共同声明 producer 定义位置与 consumer 区块。测试独立列明预期消费者，验证 owner 存在、完整传递且不重复。没有增加文档依赖边或全文输入。
- Technical 与 Asset 共用 Stage 2 私有交付说明，替换旧的不完整 `systemDeliveryContract` 提示字段；仍以真实 manifest/content parser 为准，不创建第二个验证器。
- 旧 doc2–8 串行派发、完成游标及默认审计回退被删除；初始作者固定为 GDD，后续由既有依赖批次及其回执推进。旧串行恢复状态不默默进入新路径；批次 journal 摘要与合法 replay 保留。
- 前端文档基线改为真正的八份 foundation 文档，包含 Level、Balance，不把后续 gameplay checklist 算入分母。补交付物刷新失败和过期请求响应保护，并明确区别计划内审查前暂停与故障/用户停止。

首轮集成：479 pass / 2 fail。失败分别是旧提示字段断言和旧串行第八作者 fixture；后者改用真实 batch 末作者完成，保留 Reviewer 交接断言。最终回归结果、代码冻结信息和单次 Chrome 验收结果将在完成后记录，当前不能宣称验收通过。

## 单次验收计划

以 d3108 为直接比较基线：349918 原始处理 Token，1503.578 秒，278762 Markdown bytes，211565 投影 bytes；8 作者/8 响应，无截断续写，停在 Reviewer 前。需求 digest 为 `6876069b7512499ce1040edada84ef39d25634a25ee7a09a856362d07ff0d9bc`；模型配置 `llm_ac40e5d1be394ffe925e3f2532dedd34`，模型 `ark-code-latest`。

离线全部通过后冻结业务代码，只创建一个新项目，复用既有认证 bootstrap 与相同 confirmed brief，再在 Chrome 检查进度和八份文档，停在 Reviewer 前。启动并非全程 UI 点击。运行期间只读观察，不改代码/产物，不重跑挑选结果。分别报告流程、内容和成本，Token 变化不等于同幅账单变化。

## 最终离线结果与真实验收启动

- 服务端集成：52 文件，490 pass / 0 fail / 3972 assertions；包含 delivery-workflow、投影、响应观测、complete-document 会话。
- 恢复专项：5 文件，124 pass / 0 fail / 505 assertions；与上述部分重叠，不累加为独立测试数。
- 前端：5 文件，135 pass / 0 fail；涵盖 documentProgress、RightSidebar、ArtifactsPanel、DashboardView、WorkflowCard。初次执行暴露了新增测试 mock/fixture 不完整，修正后重新真实执行通过，不以 typecheck 代替测试。
- 服务端 typecheck、前端 `tsc -b && vite build`、`git diff --check` 通过。前端缓存写入权限不足后使用已授权本地构建执行，没有绕过测试。
- Chrome 旧 d3108 项目先验证新 UI：协作流显示“8 份基础文档已完成，等待审查”，交付物标签和面板均为 8/8，Level/Balance 在内且八个预览按钮可见。首次还发现未打开面板时标签显示 0/8，已在新项目启动前修复：以 durable canonical workflow tasks 补齐计数及刷新事件，不要求先恢复聊天记录。
- 业务代码冻结：29 个改动/新增源码及测试/fixture 文件，SHA-256 `db8b58fbee636806b00f1bc65a6fb69c9014485206f65a7123e6455a4b062e09`。按 `git ls-files -m -o --exclude-standard apps/frontend/src packages/agent-workflow-server/src` 的排序路径，对每项 `path + NUL + bytes + NUL` 连续计算。文档报告不包含在此指纹中。
- 本轮唯一项目：`project_stage2_system_20260905_08`，`foundation-contract-cutover--d60195f18234`，bootstrap 202。
- run：`152dcfa3-e047-4f8a-8230-76563dc95bdc`；confirmed brief digest 与直接基线一致，模型配置 ID 一致。`run.created` 已确认 `foundationAuthoringPause=requested`（控制意图在事件中，不是 run.json 字段）。
- Chrome 从用户菜单→历史项目进入新项目。目录起初为旧缓存，刷新后显示新项目；没有重复 bootstrap、没有恢复旧项目。

## 真实验收结果

首次作者派发 `2026-09-05T09:16:34.972Z`，最后作者完成 `09:39:44.128Z`，总墙钟耗时 1389.156 秒。`09:39:44.140Z` 记录暂停 `reached`；run 为 `stopped / DOCUMENT_DRAFTING / FOUNDATION_DRAFTING`，原因是 `foundation authoring complete; paused before review`。

- 8 个 document-author 派发、8 个成功终态、8 个 committed 回执；最终文件 byteLength 与 SHA-256 全部匹配。
- 8 次响应，0 截断、0 续写、0 失败重试；未派发 Reviewer、Revision 或其他 worker。
- 八份原始 init 均为 `ark-code-latest`；usage 无缺失，日志解析无异常。所有投影保持 sections 选择，无全文回退。
- UI 的实际投影包含 GDD `challenge_recovery`；Asset 的实际投影包含 Level `encounters`、`spawn_checkpoint` 及 pacing material。输入修复到达真实模型运行，不仅是合成测试通过。
- Chrome 观察到 Level、Balance 完成后无需切换面板即可更新计数和预览入口；八份文档均已打开并看到正文。最终协作流、标签计数均为 8/8，显示正常审查前暂停，不再显示泛化故障说明；没有点击“继续”。
- 运行后重新计算源码指纹，与启动前完全相同（29 文件、`db8b58f…b062e09`）。运行期间只读审核与记录报告，没有修改业务代码、测试或生成产物。

### 成本和耗时

| 指标 | 直接基线 d3108 | 本轮 d60195 | 变化 |
| --- | ---: | ---: | ---: |
| 原始处理 Token | 349918 | 358098 | +2.34% |
| input | 147229 | 165323 | +18094 |
| cache read | 59668 | 59612 | -56 |
| output | 143021 | 133163 | -9858 |
| 墙钟耗时（秒） | 1503.578 | 1389.156 | -7.61% |
| Markdown bytes | 278762 | 279228 | +0.17% |
| 模型投影 bytes | 211565 | 241846 | +14.31% |

Token 为原始 terminal input + cache read + output，不是计费金额；三类 Token 单价不同，本轮未核对账单金额。输出 Token 降低，但输入增加抵消其数量收益；不能宣称已实现降本或正文显著缩短。单次耗时改善不是稳定分布证据，也不能排除模型随机性和本轮内部设计变化的影响。

| 文档 | Token | 秒 | Markdown bytes |
| --- | ---: | ---: | ---: |
| GDD | 25059 | 202.051 | 28872 |
| Level | 39758 | 257.021 | 25982 |
| Balance | 41853 | 273.850 | 38789 |
| UI | 46755 | 322.364 | 47625 |
| Technical | 59630 | 317.756 | 42975 |
| Art | 39583 | 234.679 | 29870 |
| Audio | 39888 | 217.139 | 30279 |
| Asset | 65572 | 289.873 | 34836 |

实际关键路径仍为 GDD → Level → UI → Technical → Asset；Balance、Art、Audio 在各自依赖满足后并行。上游文档完成是后续作者的必要条件，不能把等待依赖的时间都算作传输延迟。

### 内容质量：仍未通过

以下为人工只读抽查与算术复算，不是新增运行时 gate，也不冒充已运行的 Reviewer 或游戏试玩。行号均指本轮项目 `docs/` 下的对应产物。

| 文档 | 核对结果与关键证据 |
| --- | --- |
| GDD | 本文内部开波、暂停、终局优先级基本一致：78/100/314–329 的 10 秒备战与提前开波一致；67 要求敌人血条常驻；102/108 限定重开仅结算、暂停只允许继续。尚无实际试玩证据。 |
| Level | 177 将实际路径点写成 10，但 216–233 只有 9 个顶点、8 段。8 段合计 2360 正确；14 组、64 敌人及末次出怪时间复算通过。191 声称验收不重复，但 LV-8/LV-9 仍重复 GDD 重开/暂停验收，去重不完整。 |
| Balance | 190–196/402 的防死锁要求与参数不符：清波 40 < 最低建造 60。207 的升级边际每金币伤害不降不成立，例如速射 `(14-9)/45=0.111`，`(21-14)/75=0.093`；209 的“2→3 价高于任一建造价”也不成立。239 称速射每金币 DPS 最高，但 L1 重击 `37.5/90=0.417 > 22.5/60=0.375`。64/66 称毒雾射程最大，实际重击各级均更大（368–401）。全击杀预算 854 与波次无减速时长上界复算通过，不能由此推出试玩通关保证。 |
| UI | 249/327 的侧栏互斥显示与 334–335/378–385 的上下半区同时存在不一致，影响 GDD 70 的备战信息常驻。346 的最小缩放 .55 不能满足 402 的缩放后 8px 下限，12px×.55=6.6px。362–366 声称界面不与世界矩形相交，但 409 的建造栏实际位置 `(360,796),600×88` 与世界 `(20,152)-(1300,872)` 重叠。328 允许暂停重开，冲突于 GDD 102/108；69 写小视口恢复到原阶段，而 332 写恢复到暂停态，恢复语义也未统一。 |
| Technical | 64/392 允许暂停缓存建造/升级，与 GDD 108、UI 65 的拒绝/封锁冲突；130/398 承接暂停重开，与 GDD 冲突。329/349 仍设计占位视觉/音频文件与解码失败路径，未与 UI 71 的纯程序资源约定统一。manifest index/modules 和受支持 content kinds 的描述已改善。不能把应用层新设计的 SchemaValidator 误认为系统 auditBeeGameContent 自带的能力；本文确有应用组件定义，因此不据此报系统 parser 夸大错误。 |
| Art | 抽查血条常驻、最小显示尺寸、暂停动画冻结与 UI/Level 的引用基本一致；继承 UI 的 .55 缩放阈值问题。没有仅凭本次抽查宣称全部视觉质量通过。 |
| Audio | 63 声称 ECON 不受任何限流，但 109/202 对拒绝音规定 200ms 限流，绝对化文字与具体规则未闭合。手动/失焦冻结与静音降级基本一致；小视口暂停对应的音频路径未明确，记为交接待确认而非已证实的播放故障。 |
| Asset | 索引/modules、content kinds 和 registry 绑定方向已改善，但 33 把 `audio-variants` / `loop-points` 填入只允许扩展名的 `asset_format_capabilities`；169 将两个 JSON 文件作为一个程序化 `audio-cue`。两者已用真实 manifest parser 复现拒绝，详见下。 |

总体结论：代码实施与单次流程验收完成；内容质量和降本目标未通过，不能把离线测试、输入完整性或 8/8 落盘当成语义正确。保留本次产物，停在 Reviewer 前，不增加提示词补丁或再次生成来挑选结果。

### Asset 交付契约专项：仍有未覆盖的真实限制

1. **格式扩展名与语义能力混淆（确证）**：Asset 33 将 `project_target.asset_format_capabilities` 设为 `[audio-variants, loop-points]`。真实 `asset-contracts.ts:1049` 起要求 ASCII 字母/数字组成的小写文件扩展名；主线直接调用 `parseCanonicalBeeGameAssetManifest`，该值被拒绝，改为 `[json]` 的同形样本通过。语义能力属于 acquisition/resource capabilities，不是输出扩展名。
2. **程序化音频资源文件数量（确证）**：Asset 169 规定 `audio-cue` 资源含 `patch-atk.json`、`patch-hit.json` 两文件；真实 `asset-contracts.ts:1294` 起要求程序化音频为一个 provisional `audio-cue` 或 `audio-bank` 的单一 JSON root。主线构造相同角色与两路径的 manifest 记录，真实 parser 返回 `programmatic audio must be one provisional audio-cue or audio-bank JSON root file`。没有修改真实产物，也没有伪称已提交实际资源。
3. **多 cue 与 kind 不匹配（确证的设计约束冲突）**：169–173 的五个资源均标为 `audio-cue`，却分别承载 7、5、10、2、4 条线索。真实 authored-programmatic-audio 接受流程要求 `audio-cue` 恰好一条 cue（`asset-contracts.ts:1417` 起）；多条需采用匹配的 `audio-bank` 形状，或拆分。不能据“零媒体文件”要求而强迫新增音频容器；程序化 JSON 是合法方向，但须满足其真实结构。
4. **程序化内容结构说明不完整（交接缺口）**：Asset 169–173 描述振荡器、包络、滤波等自定义 patch 参数，未明确 `beegame-programmatic-audio-v1`、`cues[]`、`voices[]` 及其闭集字段。实际 `programmatic-audio-resource.ts` 不是任意节点图容器。由于本阶段没有生成这些 JSON，不能声称“实际音频文件已经验证失败”；只能确认计划尚不足以保证合法交付。
5. **模块路径不是 parser 错误**：Asset 82–84 采用可读固定模块名，而规范 writer 使用内容寻址文件名。reader 接受直接 JSON 文件名，因此这不是 manifest parser 拒绝原因；属于应交由规范 writer 生成索引与模块路径的交接差异，不与前两项错误混为一谈。
6. **默认占位生成路径还有能力缺口（条件性集成风险）**：当前 `configured-provisional-resource-adapters.ts:10–20` 明确从 JSON adapter 支持列表排除所有音频 kind；93–119 的音频占位采用 WAV。若后续通过这套 adapters 的 `CommitResourceInventory` 占位分支提交 JSON + `audio-cue` / `audio-bank`，`resource-inventory-commit.ts:253–257` 会因 kind 不受支持而拒绝；改成 WAV 又不符合本轮零音频容器的设计。此项是代码路径核对，不是本轮已执行到资源提交的失败，也不等于所有 authored-programmatic-audio 路径都不可用。私有说明仍需区分“合法 authored JSON”与“当前默认 adapter 可自动生成”。

这也暴露了本轮实现本身的不足：私有 adapter 已补索引、字段、闭集 kind、registry 与来源形状，但仍漏了格式值语义和程序化音频条件约束；现有正例以普通 data 资源为主，不能证明所有资源变体均被覆盖。下一轮如继续，应先补这两个真实失败样本及程序化音频正/反例，再以同一系统约束来源完善私有说明；不修改共享 validator、不通过关闭约束掩盖问题。本轮不继续改代码或重跑。

## 后续授权修复：程序化音频契约覆盖

用户随后要求“OK 继续”。本节记录后续修改，不改变上述冻结运行的代码身份或验收结论。

- 仅修改 Stage2 私有 `foundation-authoring-delivery-contract.ts` 与对应测试，另更新本报告；未修改生成产物、共享 validator、资源工具链、Reviewer、Revision 或 Game IR。
- 先添加回归并观察 4 pass / 3 fail：真实 parser/注册流程已复现原错误，失败点是私有契约缺失相应说明。补充实现后转绿。
- 音频闭集字段、类型、枚举和数值范围直接由现有 `beeGameProgrammaticAudioResourceSchema` 经 `z.toJSONSchema` 投影，不另建 validator。JSON Schema 无法表示的唯一 cue ID、循环边界、voice 时间边界、包络合计边界以只读规则补充，并通过真实 parser 负例覆盖。
- 明确扩展名语义、单 JSON root、provisional 要求、cue/bank 基数，以及规范 writer 的模块路径职责。已用真实 `registerBeeGameAuthoredResources` 验证单 cue 与多 cue bank 均可注册，且多 cue 的 audio-cue 被拒绝。
- 默认占位格式/kind 表直接取自 `CONFIGURED_PROVISIONAL_RESOURCE_ADAPTERS`。说明明确“内部注册函数存在”不等于“worker 工具入口已提供”；零音频容器方案必须确认 authored JSON 交接，否则应记录集成依赖，不能静默换 WAV 或宣称 JSON 占位支持。
- 验证：delivery-workflow 目录回归 475 pass / 0 fail（49 文件，3865 assertions）；补充最后一组 schema 边界用例后，契约/成本/隔离专项 25 pass / 0 fail（3 文件，904 assertions），后端 typecheck 与 `git diff --check` 通过。两组测试有重叠，不相加计数。
- 尚未新开真实生成运行，既有项目仍停在 Reviewer 前；未把离线覆盖改善当成新产物质量通过，也未宣称降本。新增修改尚未提交。

下一项真正的自动交付闭环涉及资源工具链的 authored JSON 入口/adapter，超出本轮 Stage2 私有说明范围；需要单独确认扩展范围后实施。原验收中的 Balance/UI/Technical 语义问题仍保留，并未因本节改动而自动消失。

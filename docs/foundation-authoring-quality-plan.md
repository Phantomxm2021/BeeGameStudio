# 八文档生成质量调整

## 作者指令对照验收（2026-09-05，生成完成，质量未全面通过）

最新核验：dae07b0c2f18已8/8完成，全部文件digest与回执一致，8次document-author dispatch、无其他worker，pause=requested/reached，stopped。契约diff SHA256仍为16b0840b280341d838607ed4c30f849395699552dd1b4241a7c12277446ea482。以下启动记录保留为历史，不代表仍在运行。

与d1584c2a4cfe相比：总Token 462309→418739（-9.42%）；墙钟1961.560→1857.141秒（-5.32%）；正文367774→287018 bytes（-21.96%）；输出182120→178613 Token（-1.93%）。本次154841 input、85285 cache、178613 output；投影221959 bytes。模型终态均为ark-code-latest。没有价格加权账单结论，也没有稳定分支产物质量对照。

关键开销：Balance 536.495→717.556秒，输出33603→51196 Token。首模型响应包含38921 thinking bytes、0 text bytes，stop=max_tokens、output_tokens=32000；第二响应41558 text bytes、19196 output_tokens、end_turn。原始流仅一个外部user请求和一个最终success result，没有BGS空正文重派证据；属于底层执行内的恢复。thinking bytes不等同于thinking Token，不能据此精确计算所有文档推理Token。其余七文档输出合计下降14.21%，被Balance增量抵消。总Token下降主要体现在input减少40113；Balance第二响应input+cache为25597，上轮为57522，因此不能把全部降幅归因于文案收缩。

内容定向检查（非全面质量验收）：八份仍有主要设计与交付材料，Level含12建造点和5波，Balance保留参数和公式，UI有布局/焦点，Art有色值与动画，Audio有cue/编码，Technical有运行接口，Asset有文件与变体。仍发现：Level图中S1标992 px但端点-96→800及里程0→896均为896；Art给出亮度0.558/0.316/0.449却声称两两比值≥1.4，0.558/0.449仅约1.24；GDD将零漏怪参考序列列为Balance交付依赖，Balance加入REF/CALC验算职责，这可能增加工作量但尚未证明是推理增长原因。不得以正文缩短判定无质量退化，也不把这些内容错误变成Stage2新增硬校验。

旧版对照已由用户取消：干净提交70df2e2c7保留于/private/tmp/bgs-checklist-baseline-70df2e2c7；项目0dab529d0996已通过旧版stop接口停止，reason=user cancelled baseline comparison; restore current runtime。首次因未构建dist/cli-bun.js失败，构建后恢复，但不是完整可比较的旧版样本。当前runtime已恢复game-ir-isolation-recovery，未再启动生成。安装旧版依赖曾触发其postinstall Chrome MCP注册，已告知用户，属于安装副作用而非工作流测试结果。

本轮仅替换 Stage 2 私有 FOUNDATION_AUTHORING_INSTRUCTION 中的内容密度要求：恢复最小必要决策、最少必要理由、不逐句扩展职责为小节、不复述图表，以及不重复推导；明确保留必需参数、公式、几何、接口和不同边界示例。不整体恢复旧代码，不恢复校验或作者重派。INPUTS、GUIDANCE、章节与材料职责、模型、预算、续写、调度及其他阶段本轮均未修改；原有未提交修改保留。

基线使用当前已有 d1584c2a4cfe，不声称比较了稳定分支历史产物。基线：462309 Token（194954 input、85235 cache、182120 output），1961.560秒，367774正文bytes，8/8并停在Reviewer前；Balance一次max_tokens续写。相同需求不等于相同上游生成结果，本次不是固定上游的严格单文档实验。

离线验证：作者成本、隔离和投影24 pass/492 assertions；回执、complete-documents和交接12 pass/92 assertions，共36 pass/584 assertions；typecheck及git diff --check通过。测试仅验证指令传递与边界，不证明实际质量、Token或耗时改善。

真实验收仅启动一次：project_stage2_instruction_20260905_05，目录foundation-instruction-acceptance--dae07b0c2f18，run f835db2b-8c20-48eb-bfc6-f02abbb6596b。复用完整confirmed brief，digest 6876069b7512499ce1040edada84ef39d25634a25ee7a09a856362d07ff0d9bc；模型配置ID保持llm_ac40e5d1be394ffe925e3f2532dedd34。现有认证bootstrap返回202，run创建已记录pause=requested，实际GDD transcript已确认新指令存在。启动时代码契约diff SHA256为16b0840b280341d838607ed4c30f849395699552dd1b4241a7c12277446ea482。运行中不改业务代码或产物；最终质量、用量、耗时和pause=reached尚待核验。

## 当前唯一方案：先验证生效，再按关键依赖链减负

### 当前执行：按深审后的修订方案分批取舍

本轮先处理已证实的必要输入缺失，不统一重写八文档，不继续追加案例关键词。此前 Level/Asset 职责改动及其失败验收保留为历史证据，本轮不宣称它们已经稳定降本。

| 分类 | 证据与现有owner | 本轮决定 |
| --- | --- | --- |
| 必要输入缺失：时长 | ab09 的 GDD metrics 持有6–10分钟；UI/Art/Audio实际投影未包含该值，却按约一分钟写作 | 三个既有GDD依赖增加metrics，不额外加入core_loop/vision |
| 必要输入缺失：视觉规格 | Art asset_specifications明确引用character_style/environment_style/color_lighting；Asset库存使用其尺寸、形状和颜色 | Asset既有Art依赖补三个owner，不加入所有Art章节 |
| 必要输入缺失：音频变体 | Audio sfx持有无多音源变体及确定性音高策略；Asset需要决定具体交付文件 | Asset既有Audio依赖增加sfx，不更改变体或音频设计 |
| 必要输入缺失：焦点/失焦 | UI input与focus-accessibility-matrix分别持有交互规则和具体动作映射，Audio需定义相应事件 | Audio既有UI依赖补这两个owner |
| 已有正确要求未遵守 | 文件总数、攻击计时公式、UI缩放、色值比率、暂停权限及重复总计 | 本轮不加专属prompt禁令，不改历史产物，仍由Reviewer/Revision处理生产问题 |
| 重复职责候选 | Asset责任/许可/排期可能重复，但其独立职责仍被现有共享契约要求；跨文档同场景不同验收维度不必然重复 | 不删除整个材料、不统一搬迁owner；已有私有去重要求已在上轮落地，本轮不叠加 |
| 冻结边界冲突 | 多维Level预算与Stage3 integer；Technical并行时未持有后续具体文档 | 单列，不修改Stage3/4、不增加循环依赖，不将接口引用认定为读过未来文档 |

实施仅修改Stage2 INPUTS和对应测试：没有新增上游文档边、没有删除已有owner、没有字段截取或LLM摘要、没有第二份事实库；现有调度拓扑不变。所有源区块继续使用同一个投影器按原文一次传递。

固定ab09产物离线比较（使用现有projectFoundationAuthority/modelFoundationAuthorityProjectionBytes，不调用模型、不改产物）：

| 目标 | 旧投影bytes | 新投影bytes | 增量 |
| --- | ---: | ---: | ---: |
| UI | 28289 | 29779 | 1490 |
| Art | 28767 | 30257 | 1490 |
| Audio | 26176 | 35569 | 9393 |
| Asset | 59264 | 74114 | 14850 |
| GDD/Level/Balance/Technical | 不变 | 不变 | 0 |

合计245132→272355 bytes（+27223，约11.1%）。这是补齐必要事实的输入代价，不是成本优化收益。所有source仍为sections；没有完整原文回退或新增文档依赖。新增区块可能含必要事实以外的上下文，但本轮不为裁剪它们引入启发式解析或新摘要系统。

真实单份验收入口核查：现有complete-document边界测试使用模拟sessions，生产bootstrap启动整个工作流、resume继续既有run；本轮未找到可直接复用且保持固定上游的独立Asset真实验收入口。按修订方案，不为此建立新调度入口，也不绕过局部收益验证直接运行另一整轮。下一项费用性验证仍未开展；输入覆盖通过与真实生成质量/节省分开验收。

状态：Asset 调整后的真实验收 ab09f4af54d2 已完成。8/8及暂停边界通过，未进入 Reviewer/Revision；整轮479915 Token、32分35秒，相比紧邻上轮分别增加0.92%和8.65%，整轮优化目标未通过。Asset 局部体积与用量下降但仍需续写，质量仅定向抽查，不能宣称完整通过。代码检查点 `a9dfd81f9`（后续 `215ab5203` 仅方案及末尾空行清理）；新代码尚未提交，历史记录不代表当前验收结论。

本轮输入修正离线验证：新增覆盖测试先 RED（6 pass / 1 fail），修正后作者成本、阶段隔离、authority projection 共23 pass / 0 fail、455 assertions；complete-documents、authored receipt、handoff equivalence 共12 pass / 0 fail、92 assertions，合计35 pass / 0 fail、547 assertions。覆盖新增事实只出现一次、未选区块不混入，以及已有交接边界。不代表真实文档质量或成本已经改善；本轮未调用模型、未启动新项目。

### Asset 新职责的真实验收（2026-09-05）

仅启动一个新项目 `project_stage2_asset_20260905_03`，run `9145d26d-5d82-4e31-93ba-fd8343009ef9`。使用现有认证 bootstrap（202）与 Chrome 观察，非全程点击式验收。开始前本地服务已停止，确认没有运行中任务后按现有入口启动服务；没有改模型配置。创建日志记录 pause=requested，完成后 reached；8次 author dispatch，零其他阶段 dispatch，八份回执 digest 均匹配文件，终态用量均与 documentPerformance 相等。

confirmedBriefDigest 为 `6876069b7512499ce1040edada84ef39d25634a25ee7a09a856362d07ff0d9bc`，与上轮相同；ark-code-latest、SDK 2.8.4、fast off。实际 Asset 请求75403 bytes，包含全部新增职责，旧 recompute 指令不存在。运行前后 author contract diff SHA256 均为 `54ba994e01f310f3375d08bbb60697503f7c2a619b59dec4a36025f1ea8a7b9b`。运行期间未修改业务代码、输入或产物。

| 文档 | Token | 秒数 | 正文 bytes | 投影 bytes |
| --- | ---: | ---: | ---: | ---: |
| GDD | 25304 | 212.969 | 29863 | 0 |
| Level | 54218 | 482.095 | 40575 | 20983 |
| Balance | 45983 | 301.858 | 42238 | 30310 |
| UI | 50488 | 378.234 | 54258 | 28289 |
| Audio | 45764 | 331.588 | 44997 | 26176 |
| Art | 44355 | 340.553 | 43426 | 28767 |
| Technical | 58635 | 353.926 | 49535 | 51343 |
| Asset | 155168 | 527.327 | 63981 | 59264 |

合计194044 input + 102983 cache + 182888 output = **479915 Token**；正文368873 bytes、投影245132 bytes。首个 author 04:28:51.693Z 至最后完成05:01:26.331Z，1954.638秒，四舍五入32分35秒；Chrome计时显示00:32:34。相比上轮475527 Token/1799.061秒，本次总 Token +0.92%、墙钟+8.65%。两项均没有改善，不能称整轮优化成功，也不是实际价格加权账单比较。

Asset 相比上轮162129 Token/564.787秒/69892 bytes，分别下降4.29%/6.63%/8.46%。但其投影也从65828降到59264 bytes（上游重新生成），不能把全部局部收益归因于新指令。本次 Audio 选择两音乐层和无多音源变体，与上轮上游内容不同；Asset 的文件数减少不能简单认定为职责精简或丢失必需变体。前七份总量324747 Token，上轮313398，尤其 Level 再次波动至31926 output Token，尽管没有续写，耗时仍由239.532升到482.095秒。

Asset 仍在同一 dispatch 内触发一次 max_tokens：首请求34729 input + 8532 cache + 32000 output = 75261；续请求32067 input + 43259 cache + 4581 output = 79907。其中续写上下文75326 Token，明显大于尾部4581 output。不是失败重派或重复扣费快照。流式首段54718 bytes、后段8475 bytes；断点“仅非商”→“业用途”正确接续，没有复现上轮两行粘连。这只是本次成功接续，不保证未来模型不会漏写。

定向内容结果：

- 库存材料20057→16837 bytes，格式规则5444→3480，验证4400→3785；许可4986→4065。里程碑反而4271→5588，inventory正文1885→2742，减负不均匀。
- 不同上限不构成冲突的解释已正确出现（Asset第113行），不再复现上轮假冲突及其替代目标。
- 库存仍夹带冠部角数、层级、动画/绘制要求与设计理由（第228行起），引用式去重没有完全落实。
- inventory第39行新增“一个文件只能归属一条资源”的硬规则，限制了文件共享；本次契约未要求此规则。记录为内容边界问题，不在验收中追加特判或修改产物。
- 库存、责任、依赖、许可与里程碑五个材料均存在，但这不是全部需求逐条覆盖审计，也不证明八文档语义质量通过。正常暂停仍显示泛化 blocked 提示，未改 UI。

取舍：本次验收已经完成，停止继续花费模型调用。局部职责收缩有部分遵从，但未形成稳定成本收益；不继续凭一次局部下降宣称成功，不擅自回滚或扩大到 transport/预算/Reviewer/Revision。下一步需结合本次结果重新评估投入，而非立即追加提示或再跑一轮。

证据目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/foundation-asset-acceptance--ab09f4af54d2`。性能与暂停：`.beegame/workflow/events.jsonl`；实际 Asset 请求：`transcripts/foundation-asset-acceptance-ab09f4af54d2__dcdc3a7d.jsonl`；原始流：`.beegame/workflow/logs/9145d26d-5d82-4e31-93ba-fd8343009ef9/bf588838-80f2-4c69-802f-cb0923576513/agent.raw.jsonl`。

### Asset 调整落盘与离线断点回放（2026-09-05）

用户批准调查后的实施仅涉及 Stage 2 私有作者视图与测试；未运行新项目、未重启服务、未修改既有产物或模型预算。

断点诊断：Asset 首段末尾停在责任矩阵一行的中文说明中，没有闭合单元格或换行；后段直接以另一资源行起始。现有 mergeTextBlocks 在无重叠时逐字连接，既没有删除分隔符，也没有漏掉 provider 文本。新增源自实际断点的缩减回放测试，确认 pending Markdown 与两段原文逐字一致。它是归因测试，不是“表格质量修复通过”测试；不能通过猜测插入管道符/换行来证明缺失内容已恢复。未改流接收器、SDK 续写或共享 transport，也没有增加 Stage 2 格式阻断。

本次替换而非叠加的作者职责：

- Asset 库存材料 purpose 将 unique detail 明确为交付所需明细/例外；语义、优先级、时长与设计理由引用上游 owner ID/章节，保留具体交付规格及每个必需变体。材料身份、格式和共享 authorityRule 不变。
- inventory 正文同步指向 delivery-specific detail；formats_budgets 只补已有上游未拥有的交付格式/预算规则，不扩展运行时适配层或第二套预算；不同上限本身不构成冲突，有证据的不兼容仍须记录。
- validation 保留检查方法、状态、证据和缺陷流程，替换原先要求重新计算总计的措辞，不在撰写时再做一次设计审计。

不变：七份其他文档的本次配置、所有输入投影、数量/变体要求、章节材料 ID/顺序/格式、Reviewer、Revision、Game IR、UI、调度和任何预算。Level 上轮未提交调整保留，不作为本次新增变更。没有引入摘要调用、分段生成、表格修补白名单或第二条作者路径。

验证：缩减断点回放、作者成本契约、阶段隔离三文件25 pass/0 fail/339 assertions；回执、投影、worker prompt三文件35 pass/0 fail/532 assertions，共60项、871 assertions。服务端 typecheck 与 git diff --check 通过。测试证明契约传递、接收保真和边界不变，不证明模型必然减少输出或不会再次漏写。成本/耗时仍待新代码真实验收，不复用 a014 的数据作为本次结果。

### Level 调整后的真实验收（2026-09-05）

项目 `project_stage2_level_20260905_02`，run `e5041443-f1e3-4e56-95b1-9ffa56f4a63d`。通过现有认证 bootstrap 启动、Chrome 观察，并非全程点击式操作。Chrome 确认8/8、已暂停、00:29:59；服务端为 stopped、pause reached，8次 author dispatch、零其他阶段 dispatch，八份文件均与提交回执 digest 一致。没有失败重派；Asset 同一 dispatch 内有一次输出预算续写。

与上轮93981f7848fd的 confirmed brief digest 相同：`6876069b7512499ce1040edada84ef39d25634a25ee7a09a856362d07ff0d9bc`。模型均 ark-code-latest、SDK 2.8.4、fast_mode_state off，未调整模型或预算。实际 Level transcript 的 user.message 中确认三处新 purpose 全部存在、两处旧重复推导指令不存在；请求33118 bytes。代码 diff SHA256 在运行前后均为 `cfda0113e5ea63a9a79bca537d4eec5a9217437dd48dbcbb1226cab5f80290e6`，没有边跑边改。

| 文档 | 本次最终 Token（含缓存） | 上轮 Token | 本次秒数 | 上轮秒数 |
| --- | ---: | ---: | ---: | ---: |
| GDD | 25,573 | 22,376 | 220.149 | 162.576 |
| Level | 35,599 | 110,133 | 239.532 | 576.396 |
| UI | 50,484 | 47,235 | 396.554 | 390.859 |
| Balance | 49,800 | 45,119 | 413.640 | 353.172 |
| Audio | 43,640 | 35,247 | 331.707 | 215.466 |
| Art | 47,090 | 44,906 | 366.066 | 353.025 |
| Technical | 61,212 | 57,868 | 360.867 | 388.330 |
| Asset | 162,129 | 72,032 | 564.787 | 466.247 |

整轮最终用量：input 194115 + cache 105066 + output 176346 = **475527 Token**，对照434916增加9.34%。墙钟1799.061秒（29分59秒），对照1984.502秒下降9.34%；不能将并行任务耗时相加。文档394008 bytes，上游投影251611 bytes（对照212270，增加18.53%）。这些 Token 不是价格加权账单。更早同 brief 的 e880 样本为390176 Token、1798.218秒，本次也没有优于该历史样本的整轮成本。

Level Token下降67.7%、耗时下降58.4%、正文体积下降15.5%，保留坐标、路线、建造格、触发器及五波可展开时间表，正文重复几何推导明显减少。但上游 GDD 是重新生成的，内容与体积发生变化；不能把全部差额因果归于三处 purpose，更不能据单次运行保证普遍收益。

Asset 原始请求记录明确为：首请求36876 input + 8524 cache + 32000 output = 77400，stop=max_tokens；续请求32067 input + 45398 cache + 7264 output = 84729，stop=end_turn。第二次请求的上下文用量是这次费用反弹的重要直接原因，属于同一次 dispatch 的续写而非失败重派。它比上轮增加90097 Token，超过 Level 节省的74534 Token。这里只确认触发与用量，不把输出预算触发本身误当完整根因；为何产出量增长仍需结合 Asset 的实际内容职责分析。日志没有独立 reasoning Token 字段，不能推算隐藏推理占比。

定向 Level 内容审查仍发现：

- W3最小间隔标1.5秒，实际12→12.75→13.5为0.75秒；准备阶段复用数6与表中5次不一致。
- B07位于S6路线中心线，B11点击区域与S8重叠，与非重叠约束冲突。
- 复杂度有多项有限预算，但单一复杂度预算表达仍有歧义；上轮也存在，并非本次删除预算造成。

这不是八份文档全面质量通过或 Reviewer 清零证明。本轮没有启动审计/修订。Chrome 把正常的验收暂停仍显示为 “Workflow is blocked and needs attention.”，与服务端真实暂停原因不符，记录但不越界修改 UI。

结论：**Level 去重有局部实证收益，整轮降本方案尚未成立。** 保留当前窄范围改动供后续取舍，不自动扩展到其他七份、修改预算、开启新测试或推进 Stage 3/4。下一项候选应先解释 Asset 实际内容和续写开销，不追加泛化自审或把减少必要输入当收益。

证据目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/foundation-level-acceptance--a0146c2b0631`。终态及性能见 `.beegame/workflow/events.jsonl`；Asset 原始日志见 `.beegame/workflow/logs/e5041443-f1e3-4e56-95b1-9ffa56f4a63d/8ad27eae-d48d-4c15-9d21-cf409fbdfb3d/agent.raw.jsonl`；实际 Level 请求见 `transcripts/foundation-level-acceptance-a0146c2b0631__07a598e4.jsonl`。独立内容审查只读产物，运行期间业务代码未变。

### 证据与判断

| 八文档指标 | 前轮 cdb6b899a313 | 最新 e880973fc2e1 | 变化 |
| --- | ---: | ---: | ---: |
| 最终 Token 合计（含缓存读取） | 503,020 | 390,176 | −22.4% |
| 首个 author 开始至最后 author 完成 | 33分31秒 | 29分58秒 | −10.6% |
| 输出 Token | 200,909 | 173,840 | −13.5% |
| 文档 bytes（含服务元数据） | 402,158 | 362,958 | −9.7% |
| 上游投影 bytes 合计 | 258,018 | 245,656 | −4.8% |
| Asset 最终 Token | 158,227 | 67,740 | −57.2% |

原始记录：[前轮 events](</Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/mushroom-tower-firefly-defense--cdb6b899a313/.beegame/workflow/events.jsonl>)、[最新 events](</Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/mushroom-forest-tower-defense--e880973fc2e1/.beegame/workflow/events.jsonl>)。这里只相加 documentPerformance 的八个 author terminal，不使用整个后续工作流的累计量。

两轮均八份成功且 receipt digest 与文件一致；最新零续写、零失败重派。前轮 Asset 有一次 max_tokens 续写，约80.2%的总 Token 降幅集中在 Asset，其余七份合计只降6.5%。这不是“全链路已稳定节省22.4%”的证明。Token 不是价格加权费用，completion 也不等于最终 Markdown 的 Token；不得据此宣称账单节省相同比例。

更关键的是，[最新 Level projection](</Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/mushroom-forest-tower-defense--e880973fc2e1/.beegame/workflow/document-projections/e62dc17a-ef5f-4412-8502-0ea2ec08d46c.json>) 仍缺新增 core_loop/metrics；[Balance projection](</Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/mushroom-forest-tower-defense--e880973fc2e1/.beegame/workflow/document-projections/e6baa69f-6760-4037-a60c-a23101454278.json>) 仍缺 pacing_beats。至少新增输入配置没有生效，不能把这次生成归因于已提交的新方案。最终 brief 也并非字节相同，生成波动和需求差异须保留为混杂因素。

最新运行没有预设 authoring 暂停：02:25:08.9Z 完成八文档，随后启动4个 fact extractor，02:25:14.483Z 被用户暂停。不能称为“未进入 Reviewer”；这四个任务不计入上述 author 统计，取消前是否另有 provider 消耗须与已有计量记录单独核对，不把缺失 terminal 当成零费用。

### 顺序一：完成已有优化的有效验收，不再先加代码

1. **先固定对照与启动意图，不调用模型。** 以最新 e880973fc2e1 的完整 confirmedBriefContext 为唯一对照，保留原始 bytes/digest及八文档记录；前轮仅作历史参考，不择优更换对照。预选未使用的新 project ID，并核实可使用已有认证调用 bootstrap。启动请求与日志对象不是同一 shape：按现有 app.ts 的 buildConfirmedBriefPrompt 映射 selected_option→option、confirmed_gdd→confirmedGdd、build_source→buildSource、analysis_id→analysisId，显式传语言和资源策略，保留 idea/settings；不能把 normalized context 原样提交导致 option 丢失。通过既有测试/无模型请求装配核对字段，不新增业务转换模块。默认模型/配置及 SDK 版本一并记录，不调整配置；实际模型标识或配置改变时不作单变量归因。相同别名也不保证远端模型版本完全相同。
2. **带暂停配置启动已核对的服务。** 确认没有活动任务后，先将现有 BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID 设为上述 ID，再重启该测试 runtime；记录实际 worktree、commit、启动入口（源码或构建产物）、进程及启动时间。入口若是旧构建产物，按既有构建方式更新，不能只核对 cwd。确认三项输入新增与 author outputPolicy、逐文档 mergeReferenceRule 来自该代码，并通过已有暂停初始化/隔离测试。磁盘配置与测试通过只是前置证据，仍须下一步核对实际运行输入。无安全认证入口则停止并说明前置条件，不新建健康接口、调度器、debugger、浏览器随机数覆盖或 journal 篡改。纯 UI 随机 ID 路径不用于此受控对照；采用现有 API 启动、Chrome 观察，报告中如实区分，不能称为全部点击式 UI 验收。
3. **只跑一个新项目，并尽早排除无效运行。** 通过生产 bootstrap 启动后，立即核对 run.created 的 requested 暂停意图及 confirmedBriefContext/digest与对照一致；不一致则暂停留证，不跑完整八份。按顺序出现的持久投影核实新增块及其原文内容；仍是旧输入则暂停，不花整轮费用验证未生效版本。不得在运行中改源码、需求或旧产物。八份完成后确认 stopped、pause reached、Reviewer dispatch 数为0；否则单独判定停止边界未通过。请求超时先查询既有项目/run状态，不盲目重发 bootstrap或另建项目；不得假定启动请求可幂等重放。
4. **按内容与实际成本决定下一步。** 按 runId/dispatchId 去重现有终态记录，分别统计输入、缓存、输出、投影/正文 bytes、耗时、续写与失败；不重复累加流式累计快照。缺失终态列为未知，不当零成本。报告八文档墙钟与模型用量，不将并行耗时相加；已有实际扣费证据可另列，缺失时不推算账单。质量检查覆盖必要事实及已知错误类型，不要求零缺陷才能结束 Stage 2，更不启动自动修订。若主要冗余已减少且必要覆盖不退化，依据下述取舍结束或提出一项明确候选，不追逐预设降幅。

取舍：Token 和墙钟分别判断。两者下降且无必要信息退化，记为本案例观察到正收益；只降一项则明确另一项的代价，不能称“双降”；没有实际节省则不能宣称成本优化成功。必要事实缺失时停止该项收缩，先查实际输入和 owner 覆盖，不凭单次随机输出立即回滚所有改动。补回必要上下文造成输入增加应记为正确性成本，不伪装成节省。一次样本的结果不足以证明稳定收益；仅当波动使保留/撤回无法判断，或出现明确新风险时才追加有决策价值的复测，不默认连续跑多个完整项目。

### 顺序二：仅在有效验收仍显示冗余时，定向收缩作者职责

只修改 Stage 2 私有作者契约及对应测试，替换重复 purpose，不追加一层自审指令。下表是候选清单，不是同时修改全部八文档的任务包；有效验收后只选能由证据说明收益的一组重复职责，再测试比较。不在顺序一之前实施。

| 优先对象 | 可收缩的重复 | 必须保留 |
| --- | --- | --- |
| Asset | 正文、多表重复的计数、未交付声明、M0/M1/M2规则、同路径替换说明；相同责任/许可/成熟度记录可列明确 ID 集合 | 完整需求映射、每个资源的文件/变体与例外；唯一库存计数口径；许可替换权、状态更新权和必要估算 |
| Level | 布局/路线/节拍材料与正文复制同一坐标、波表、时长结果；多处重写相同验收解释 | 完整坐标、路径、格位、波次编排及节奏目标；正文独有的时长或语义不能假定已被图表覆盖 |
| Technical | 重述玩法、状态流程及多处解释同一无联网/无存档决定；教程式实现说明 | 运行接口、事件顺序、固定步长、追赶上限、加载与恢复契约等可执行事实，不把参数名字当参数值 |
| GDD / Balance | 重复胜负/操作权限说明；复制参数及同一推算结果；未经支持的定价论证 | 行为规则、动作授权、参数单位/精度、公式、必要独特边界和验证方法，不要求作者证明全部策略可通关 |
| UI / Art / Audio | 跨正文与材料重复状态映射、表现约束、N/A和等价验收文字 | 几何、键盘路径、视觉状态、音频事件/层/编码等独有交付要求；不以缩短为由删变体 |

时长优先依据本案例关键链 GDD → Level → Balance → Technical → Asset（约4:23 + 6:33 + 6:00 + 6:25 + 6:36），不是按单份 Token 从大到小盲排。UI/Art/Audio 已并行；缩短非关键路径可省 Token，但未必缩短总墙钟。其他案例的关键链从该案例日志重算，不硬编码此游戏顺序或数值。

精简前核对既有 material authorityRule、foundation-fact-definitions 的 owner定位及下游 input选择。仅保留 heading/ID不代表兼容：必要语义若移出消费者读取的 block，仍会破坏交接。删的是重复副本，不是既有 owner 的最后一份必要事实；不得为了去重改变共享 Fact owner或将决定全部挤入图表。消费者原本需要正文独有事实时保留正文及现有投影；只在私有契约对应测试里验证覆盖，不建立第二份持久事实表。若必须更改共享 owner/交接协议才能实现该项，则从本轮候选移除，另行评估。

### 质量回退检查与不做事项

已有文档问题作为离线验收检查点，不作为游戏关键词 prompt 补丁：同一胜负条件分叉、升级等级与备战时间多定义、DPS单位计算错误、几何重叠、技术时间参数缺失、渲染层顺序冲突、流式播放与零请求互斥、实例/文件计数混用、早期里程碑要求未来文件。特别是 Asset 第133/230行的一文件一条目与45条目冲突、第366行M0门禁，以及 Technical 缺dt/追赶值，均不能以文档更短认定为优化成功。

保留既有 Reviewer/Revision 的语义审计责任；本方案不修改或运行它们来补救 Stage 2 成本验收。离线评审发现缺陷时分别报告新出现、仍存在、已消除，不把模型设计错误自动归因于传输或某条 prompt。必要生产事实缺失时否决对应收缩；成本上升但有明确必要覆盖收益时单独解释，不强行算成成本收益。

不改 raw Markdown、不分区生成、不新增摘要模型/事实缓存/第二权威、不删不明用途的输入块、不加 Token/字数/时间上限、不改模型/SDK/全局 Claude Code 配置、不改调度并发、不修改共享审计契约或交接协议。开始前的版本与暂停核对属于验收操作，不进入 Stage 2 文档质量门禁。

候选调整须先通过冻结 Stage 3/4、全部章节/材料身份、必要 owner事实及投影覆盖的回归与类型检查，再做一次有明确待验证问题的生成。无决策价值不重复整套测试；不同复杂度案例在首轮观察到收益后才扩展，不能凭首轮称普遍稳定。此处不存在自动扩大实施范围的授权。

### 检查点记录

2026-09-05：现有全部50个文件改动已提交为 `a9dfd81f9`，提交前复跑67项聚焦测试通过（879 assertions，8 files），服务端 typecheck 通过。首次 staged whitespace 检查发现新文件末尾多余空行，随方案文档提交清理；没有业务行为改动。本次只保存方案，未重启服务、未发起新生成或修改历史项目。

方案复审：对照 app.ts 的 bootstrap、brief归一化及暂停初始化实现，以及现有 Fact owner定义，修正请求字段、启动顺序、对照口径、收益取舍与事实迁移边界。仅修订本文件；实现可行性有代码依据，但安全认证、服务加载与实际成本收益仍须执行时核验，不宣称已完成真实验收。

### 本次受控验收结果（2026-09-05）

项目 `project_stage2_cost_20260905_01`，run `715da6f6-173c-48c9-ae1a-c72075b280dd`。产物与原始记录：[项目目录](</Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/foundation-cost-acceptance--93981f7848fd>)；数据来自其中 `.beegame/workflow/events.jsonl`、`document-commits/`、`document-projections/` 和逐 dispatch 的 `agent.raw.jsonl`，不是 UI 累计数字。

执行边界：确认旧任务无活动后，只重启测试 runtime，从本 worktree 的源码入口 `/tmp/bgs-stage2-service.ts runtime` 加载 `215ab5203`，启动前设置既有 project ID 暂停变量。通过现有认证 bootstrap API 启动一次，Chrome 观察全过程；不是全部点击式验收。完整 confirmedBriefContext 与 e880 对照一致，digest 均为 `6876069b7512499ce1040edada84ef39d25634a25ee7a09a856362d07ff0d9bc`。实际 Level 投影包含 core_loop/metrics，Balance 投影包含 pacing_beats；新增输入已生效。记录模型均为 `ark-code-latest`，未调整模型、速度或 SDK；同一别名不证明远端版本或生成结果完全可控。

启动前现有暂停初始化、成本配置、阶段隔离测试共 10 pass / 0 fail（278 assertions）。八份终态均成功，只有 Level 同 dispatch 内一次 max_tokens 续写；8 个 author dispatch、零失败重派、零非 author dispatch，全部 receipt digest 与实际文件一致，documentPerformance 用量与原始 result 一致。`02:48:58.618Z` requested，`03:22:03.150Z` reached，最终 stopped / DOCUMENT_DRAFTING，Reviewer/Revision 没有启动。八份正文中的 `docs/*.md` 字面路径检查没有发现缺失文件；这不等于锚点或语义审计通过。

| 文档 | 基线 Token → 本次 Token | 基线秒 → 本次秒 | 基线 bytes → 本次 bytes |
| --- | ---: | ---: | ---: |
| GDD | 28,314 → 22,376 | 263.5 → 162.6 | 35,604 → 20,819 |
| Level | 47,959 → 110,133 | 393.0 → 576.4 | 40,164 → 38,149 |
| Balance | 48,394 → 45,119 | 359.9 → 353.2 | 50,158 → 49,259 |
| UI | 47,654 → 47,235 | 348.2 → 390.9 | 50,323 → 57,004 |
| Technical | 61,085 → 57,868 | 385.3 → 388.3 | 50,235 → 55,590 |
| Art | 43,032 → 44,906 | 307.2 → 353.0 | 39,620 → 47,063 |
| Audio | 45,998 → 35,247 | 366.9 → 215.5 | 49,071 → 28,970 |
| Asset | 67,740 → 72,032 | 396.4 → 466.2 | 47,783 → 59,926 |

合计：434,916 Token（输入 175,422、缓存读取 78,754、输出 180,740），较基线 390,176 增加 **11.5%**。八文档墙钟 1,984.502 秒，即 **33分04秒**，较基线 29分58秒增加 **10.4%**。正文 356,780 bytes（−1.7%），投影 212,270 bytes（−13.6%），输出 Token 反而增加 4.0%。此处不是价格加权账单统计。

成本归因：Level 增量 62,174 Token，其他七份合计减少 17,434（−5.1%）。Level 第一请求输出 32,000 后触及底层输出预算，第二请求额外携带输入 32,066 + 缓存 19,086，并输出 7,893；最终 110,133 是两个请求的真实合计，不是重复累计。Level 投影已从 22,124 降至 14,272 bytes，正文也略短，说明输入缩短不保证推理/输出及续写成本下降。不能从一次样本认定新增必要输入直接造成全部增量，更不能据此删除这些输入或盲目提高预算。本轮关键链为 GDD → Level → UI → Technical → Asset，已不同于基线等待 Balance 的关键链。

#### 八文档内容取舍

以下是离线内容审查，不是新增 Stage 2 门禁。行号均指本次项目 `docs/` 下对应文件；旧稿同样存在缺陷，不能把新稿的每个错误都直接归因于这次改动。

| 文档 | 改善 | 未通过或退化证据 | 可收缩但不得删必要事实的部分 |
| --- | --- | --- | --- |
| GDD | 摘要偏向索引、状态重复减少；旧备战时长冲突减少 | 119/198 又新增结算金币，与 brief notes 排除候选额外机制不符；90 缺不同毒雾来源交互；76/77 与暂停/重开流程不完全一致 | 重复规模、不可退款等裁定；行为边界不能因移至图中而遗漏 |
| Level | 92/285–294 正确消费10秒备战；空间与完整波表仍在 | 52 的 BP-09 垂距应为88而非64；59/211 的最大投影间隙及总数错误；201 净空目标与 y576 建造点仅余8px冲突；208 无塔跑完W5与即时失败互斥 | 59/187/210–211/274–275 重复覆盖推导；布局数据只保留一个 owner，不额外证明所有塔阵策略 |
| Balance | 旧漏乘攻速及46伤害却声称击杀60生命的问题消除 | 173–176 定价比较反例；225 结算≤75而103/319–320第五波奖励78；107保底伤害例子算错 | 反复未实测声明、重复定价论证；保留参数、单位、公式和必要例子 |
| UI | 结构和焦点覆盖完整 | 373 扩展底栏至536–640却声称无建造点，覆盖Level两个y576点；189满级2与两级升级冲突；441与54塔型选择可用状态冲突；354–355 SVG高度与标签不符 | 每项决定的长篇理由、N/A未来影响、正文/两张流程图重复；不能删真实布局与焦点契约 |
| Technical | 49补1/60秒及最多5步；55/377冻结模拟仍绘制 | 380暂停全静音与Audio65冲突；160/175零请求未澄清首次静态资源加载；152实体“演算上界”仍无具体数值 | 教程式解释、重复边界；保留已补的实际时序参数 |
| Art | 50/236射程圈层序统一 | 52/64将48px格位当实体尺寸；110/118声称色值已在表内但225–241仅定性档；141/262动画参数缺数值 | 重复剪影说明、新增全塔待机呼吸及虚构边界论证；先保留owner实参，不能用空引用代替 |
| Audio | 完整事件/编码仍在；116不再流式播放；体积明显下降 | 21称14音效，149–168实际20；105与246压低对象冲突；248 UI永不丢弃与43 P1规则冲突 | 总数复述、策略在正文与图中多次定义；保留具体事件与交付差异 |
| Asset | 正文开始引用材料；110/278/359将旧M0门禁限定本批 | 127写53文件，按188–198内容11项实际52；206的ART-BUILDPOINT漏于245–260责任表；365要求M3峰值测量但368又限定M4 | 200–238复述上游设计，未产出/授权声明及就绪判据多处重复；资源映射、责任例外和真实许可事实不能省略 |

额外观察：Chrome 最终显示“已暂停 / 8/8”，但副文案仍是 `Workflow is blocked and needs attention.`；实际服务端原因是 `foundation authoring complete; paused before review`。这是正常暂停的展示误导，不是本轮生成失败。本轮留证，不借此修改 UI 或共享阶段。

#### 本次决定

本轮验收完成，但**不宣称成本优化成功或质量无损**。不自动追加项目、不启动 Reviewer/Revision、不修改历史产物、不提高输出预算、不恢复旧 author 轨道。补回的必要输入有改善证据，保留；不能用整轮成本回退证明应删除所有改动。

顺序二不扩大为八份同时重写。此次验收选定 Stage 2 私有 Level purpose 中重复的布局推导职责：原 objectives_routes 与 production_acceptance 都要求 computable layout evidence，且材料再次拥有布局映射。消除重复要求与重复推导时，保持必要坐标、波表、唯一 owner 实参及下游可读块不变，不把全部审计塞回生成。不保证可完全避免底层续写。Art 等实参缺失另外列为质量风险，不能通过全局“多写/少写”指令顺带修复。

本轮业务代码零改动；仅在本计划中补充执行结果与上述取舍。暂停后不再继续生成。

### 后续 Level 调整落盘（用户再次确认后）

已修改 `foundation-authoring-contract.ts` 的 Stage 2 私有视图，仅替换 `world_structure`、`objectives_routes`、`production_acceptance` 三处 purpose。移除模型可见的重复布局推导要求，分别保留独有场景语义、目标/选择/完成语义、生产责任/依赖/具体预算/检查方法；坐标、路径、格位、触发器与互斥证据引用已有 world/route materials，不新增材料或另一条 author 路径。共享旧 purpose 仍服务冻结的审计契约，不再混入 Level 作者视图，不是并行的生成方案。

主审纠偏：第一版仍在两个章节保留“require computable layout evidence”，现已移除，验收章描述如何检查已有证据而非再算一套表。按现有 Fact owner，复杂度预算实际值仍在 production_acceptance，实体 ID 仍在 encounters、资源需求仍在 content_matrix；不迁入材料导致读取空洞。INPUTS、全部 material purpose/authorityRule/身份/格式、其他七份作者契约及共享阶段代码均未调整。

验证：实际 buildWorkerPrompt 的新职责与旧要求移除断言、完整材料定义不变断言、既有 Fact owner 断言和六个下游的合成事实透传测试；连同既有投影、回执、worker prompt及冻结 Stage 3/4 回归，5文件 **46 pass / 0 fail（834 assertions）**。服务端 typecheck、git diff --check 通过。独立 Astra 审计无必修项。合成事实透传只能证明输入路径与契约边界，不证明 LLM 必然保留内容或减少消耗。

成本取舍：三处 purpose 从515增至826 UTF-8 bytes（+311），增加的是明确归属说明，目标是减少输出端重复推导，不宣称 prompt 本身变短。新代码尚未重启到测试服务、尚未发起新模型运行；此前434,916 Token不代表此改动结果。下一步只验收这一已落代码的变量，不先叠加 Asset 或其他七份修改，不自动重复多轮完整生成。Level以外候选尚未实施，真实收益尚未验收。

## 历史：上轮成本收缩实现（不再作为活动顺序）

### 审计结论与取舍

已完成样本 `mushroom-tower-firefly-defense--cdb6b899a313`：八份均 committed、receipt digest 与文件一致、无失败重派；Asset 在同一 dispatch 内一次 `max_tokens` 后续写成功。总量 503,020 Token（含缓存读取）、墙钟 33分31秒、正文含元数据 402,158 bytes。Asset 单份 158,227 Token、投影 68,029 bytes、耗时约8分15秒。成本集中不等于其输入可以任意删除；续写后的累计输入也不能当作首请求输入。与旧成功项目的需求不完全一致，不能宣称严格 A/B 或归因全部增量。

审计否决“先整体削减 Asset 输入块”的顺序：当前块包含场景格位、视觉状态、音乐层、编码、焦点/静态文字及交付限制，尚无可普遍证明安全删除的整块。不得引入新的 LLM 摘要、关键词裁剪或第二份事实库存来压缩它们。调度并行已存在，本轮不修改并发或依赖路径，不复制调度器。

可落地项：Stage 2 作者视图遗漏了已有 outputPolicy 和逐文档 mergeReferenceRule，且 Asset 的正文 purpose 与五个材料的 owner 责任重复要求定义。修正这些指令，而不是另加一层自审。另已证实此前投影遗漏 GDD core_loop/metrics 的时长目标以及 Level pacing_beats 的时长说明；图表并不等价于这些正文，必须补回，不能把减少必要输入算作收益。

### 唯一实施顺序与边界

1. 仅在私有 `foundation-authoring-contract.ts` 传递现有 outputPolicy 和逐文档 mergeReferenceRule，保持共享审计契约、章节/材料 ID、顺序与格式不变。移除已有重复指令，不追加全面校验、推演或自审工作。
2. 将 Asset inventory、ownership、dependencies、source_license、milestones 的正文要求改为引用各自 owner material，仅补必要解释；具体资源规格只在库存拥有，验证章节描述方法而不重复库存总计。相同责任、许可或里程碑可在明确列出库存 ID 的同一记录中表达；不得合并不同约束、丢失例外或把上游变体改成可选。
3. Level 输入补 GDD core_loop、metrics；Balance 输入补 Level pacing_beats。保留原始块、材料与同一个投影器；不改其他输入、不新增解析/摘要轨、不设置大小上限。必要覆盖补回可能增加输入体积，单独报告，不声称输入已缩小。
4. 测试覆盖作者规则透传、全部八文档交接身份保持、独立正文事实投影覆盖，以及冻结 Stage 3/4 的隔离回归。测试断言配置与覆盖，不机械评分模型文档。
5. 离线通过后冻结代码，通过 Chrome 新建项目验收八文档；复核完整 confirmed brief、平台与资源策略，不能只复用 Idea 就宣称相同需求。开始前设置并核验现有八文档结束暂停边界，绝不进入 Reviewer/Revision。运行中不修改代码或历史产物。
6. 逐份记录输入/缓存/输出 Token、投影 bytes、正文 bytes、耗时、续写/失败及内容覆盖；比较阶段墙钟而非并行任务耗时加总。completion Token 不等同于最终 Markdown Token，总 Token 不等同于价格加权费用。遇错留证后停止扩展测试；成功也需审查质量，不以字节下降代替质量验收。

本轮不修改 SDK、模型配置、Token 上限、传输、收据、恢复、调度、Reviewer、Revision、Game IR 或 UI；不把格式/语义检查前置到 Stage 2，不新增分区生成或新 author 路径。仅成本方向与实施边界审计通过，实际 Token/耗时收益仍待真实生成测量；若内容缺失或成本增长而无必要质量收益，不保留对应优化。

### 本轮执行记录

作者配置已落地，新增 `foundation-authoring-cost.test.ts`。独立复审纠正了三项精简遗漏：状态更新权不等于资源成熟度事实、许可替换权保留、必要估算与产能假设保留。主代理聚焦回归 50 pass / 0 fail（794 assertions，5 files），服务端 typecheck 与 diff whitespace 检查通过；没有新增 Stage 3/4、调度、收据或 UI 修改。

Chrome 已生成候选并在补充说明中纠正玩法差异，停在最终确认页，尚未启动新的八文档生成。现有自动暂停入口在 run 创建时按环境变量匹配具体 project ID，而页面 bootstrap 在点击后才随机生成 ID；直接点击无法预先保证结束时不进入 Reviewer。尚未为绕过此限制添加断点、修改浏览器脚本或扩大生产代码范围。真实成本验收仍未完成。新候选与旧候选文本不同，即使显式约束已对齐，也不得将随后运行宣传为字节一致 brief 的严格 A/B。

## 上轮纠偏记录（已完成，下文顺序不再执行）

阶段隔离和已落盘的输入去重保持不变。本轮仅修复 Stage 2 续写尾段覆盖全文，并撤掉新增的全面自审、强制计算证明负担；保留必要参数、公式、设计解释与既有章节身份，不要求作者在返回前完成 Reviewer 的完整审计。删除被取代的生成指令，不保留并行 author 路径。

依据：当前样本 `mushroom-tower-forest-defense--8367644d6846` 的 Level、Art、Audio 流式正文被末段 terminal 覆盖；Balance 四次触及底层输出预算，共 128,000 输出 Token 而没有 Markdown。后一项不能仅凭相关性归因于 prompt，减负收益必须实测。历史参考样本与本次最终 brief 不完全相同，不作为严格因果对照。

顺序：真实事件结构的脱敏失败回放 → 正文收集修复与聚焦回归 → Chrome 全新项目八文档验收，结束即暂停。先记录正文完整性和必要内容，再比较真实输入、缓存、输出、耗时；离线通过不能声称实际质量或成本已验收。不为单独 Balance 对照新增业务接口或测试调度轨；现有入口会启动完整工作流，因此在同一次八文档验收中重点观察 Balance。历史样本的上游正文有损坏，不把新运行与旧运行包装成严格的单变量对照。

### 上轮 Chrome 验收步骤（历史记录）

1. 冻结本轮代码；确认测试服务加载修复后的版本，以及新验收项目的八文档结束暂停边界生效。旧失败项目保持原样，不用继续按钮复用损坏的上游产物。
2. 通过 Chrome 新建项目，复用并核对已保存的最终 confirmed brief、平台与资源策略，避免仅复用 Idea 却重新随机选择需求。固定需求不代表 LLM 生成的上游设计完全相同，比较报告必须注明这一限制。
3. 从头运行 Stage 2；逐份记录开始/结束时间、最终 Token 用量（输入、缓存、输出）、正文体积、续写和失败情况。Balance 重点核对是否真实产出正文，不能只看 UI 状态。
4. 遇到失败先保留日志、输入与产物，停止本轮自动重试；定位具体原因后再决定下一项调整，不在运行中修改代码。成功时八文档提交后暂停，不进入 Stage 3/4 或 Checklist。
5. 对八份文档逐份检查完整性、必要设计覆盖、冗余和跨文档一致性；汇总墙钟、真实 Token 与质量结果。传输修复、模型生成成功、内容质量和成本收益分开判定，不因一次生成成功就声称全部问题消失。
6. 首轮结果符合预期后，才扩展不同复杂度的新案例；若仍失败或出现无质量收益的成本增长，则回到该项根因分析，不继续叠加笼统优化。

不调整共享 SDK 的输出上限、推理配置或自动续写，不修改 Reviewer、Revision、Game IR、全局 Claude Code 配置，不新增 Stage 2 内容准入关卡，不再次收缩投影或重构架构。Balance 减负后仍失败则重新诊断，不盲目加大额度或重复整套生成。错误展示优化后置。

正文收集以修订后的权威文档 3.0 为准：保留同一明确续写链的完整正文，避免重复计入 snapshot，不能把末段当全文或拼入独立重生成草稿。正文修复是可回放验证的正确性收益；减负是待实测收益，若必要内容退化或成本增加而无质量收益，则撤回对应调整。

本轮离线验证：8 个聚焦测试文件 60 pass / 0 fail（818 assertions），服务端 typecheck 与 `git diff --check` 通过。对当前样本 5 份成功输出的实际日志在临时目录回放，保存正文与流式正文逐字节一致；Level 37,452 bytes、Art 45,809 bytes、Audio 54,033 bytes，不再被各自 terminal 尾段 6,052 / 15,895 / 11,058 bytes 覆盖。原项目产物未改写。此结果只证明传输修复，不证明内容质量、Balance 成功率或 Token/耗时收益；真实生成对照与全新八文档验收尚未执行。

## 历史调整背景

此前先执行 [阶段业务隔离计划](workflow-stage-isolation-plan.md)。以下保留为已实施背景，不授权继续增加质量要求；本轮执行以上纠偏范围。

基线：`dffad4194`。范围仅 Stage 2。Reviewer、Revision、Game IR 的业务行为、文档路径、章节标识、提交协议保持不变。

实施顺序：生成配置边界 → 正文与材料投影 → 职责及冗余指令 → 同源依赖调度 → 离线验证 → 相同 brief 新项目八文档验收 → 两个不同复杂度案例。

原始样本：`mushroom-tower-forest-defense--9829cee82e46`，run `402eba0e-4f8c-426d-b73e-40608f7e4045`。8 个成功 author turn、零工具调用、零错误终态；366,460 Token（含缓存），输出152,551 Token，墙钟23分34秒，339,169字节。

已证实问题：生成投影未携带 owner materials；Balance验证链要求与禁止派生结果的指令冲突；UI/Art/Technical实际依赖未进入调度；文档内部算术和跨文档口径不一致。此前17条Reviewer发现并非完整、准确的质量判定。

生成侧独立配置应成为调度、投影和author prompt唯一入口。原共享契约参与Reviewer manifest摘要，因此其审计图保持冻结，不能把它当作可随生成优化变化的配置。两者分别定义生成输入选择和审计证据，不得保留两个author路径或fallback到旧author指令。

投影包含明确选择的section与material，按原文顺序去重。协议marker不完整或有歧义时，同一个投影器只携带一次完整原文，不添加启发式解析或因文档格式阻断生成。缺失文件等基础设施错误仍报错。

生成顺序：GDD → Level → Balance/UI并行；UI完成后Art/Audio可运行，Balance与UI完成后Technical可运行；Asset等待全部依赖。沿用现有并发容量。

职责：GDD拥有行为与硬性产品约束；Level拥有空间与波次编排；Balance拥有战斗/经济参数、公式和可追溯推演，不能重定义空间与编排；UI拥有交互呈现与几何；Art消费几何并定义视觉；Technical实现既定接口；Audio拥有音频行为和参数；Asset映射已有需求且区分计划来源与证据。

不改变raw Markdown、不新增质量阻断关卡、不设置token/字数/时间合格线、不要求模型输出大型JSON。集中等价验收场景和N/A说明，保留真实计算材料。离线验证地图互斥、布局尺寸、数值来源和材料完整性；这些验收不进入Stage 2生产准入。

## 阶段隔离边界

Stage 2 私有模块：

- `foundation-authoring-contract.ts`：唯一生成输入依赖及 author 内容指导。
- `foundation-authoring-prompt.ts`：唯一 raw Markdown author 提示构造。
- `foundation-authoring-input.ts` / `foundation-authority-projection.ts`：读取、选择并持久化本次生成输入，不承担内容审计。
- `authored-document-receipt.ts`：生成提交回执。输入依赖与调度同源，避免生成成功后被另一套依赖表拒绝。

共享 worker 提示/会话入口只分发到生成模块，不保留旧 author 提示或旧投影实现。恢复模块仅在 `DOCUMENT_DRAFTING / FOUNDATION_DRAFTING` 的 author 分支读取生成依赖；不得改变审计、修订、资源的恢复规则。

阶段交接仍使用既有 canonical Markdown、文档标识、版本及提交结果。Stage 3/4 不读取 Stage 2 私有输入投影或提示配置。共有产物契约、审计 manifest、Issue/Revision/Publication 语义保持基线不变。后续隔离迁移允许 controller 的 Stage 2 业务区变为委托，其余区域保持基线。共享传输与基础设施没有复制成新实现。

“不影响其他阶段”指实现与配置不反向耦合，不意味着不同文档会得到相同审计结果，也不是进程或故障域的物理隔离。更改交接协议或共享基础设施不属于本轮授权，必须另行评估。

生成输入变化只用于新 dispatch。不得把旧进行中任务的输入证据重写为新配置，也不增加旧配置兼容分支。历史已提交文档与 Stage 3/4 状态保持原样；真实验收使用全新项目。

隔离验证：`foundation-authoring-isolation.test.ts` 将冻结模块及非 author 提示与 `dffad4194` 对照；测试需要本地 Git 保留该基线对象。另覆盖依赖无环、section/material ID有效、源顺序、歧义marker完整原文回退、格式不合格Markdown仍提交后交给Reviewer。

2026-09-05：扩大回归774项通过，类型检查通过。此记录不代表Chrome内容质量、Token或耗时已验收。

验收逐轮推进，8/8提交后停止后续阶段；记录输入、缓存、输出、投影体积、墙钟、重试及内容缺陷。首轮通过才扩大案例。不得将离线测试通过表述为真实质量验收通过。

本次另经独立批准增加全局交接一次性 durable 暂停，仅用于新验收项目八文档完成后的人工调度；不改变 Reviewer/Revision 业务。

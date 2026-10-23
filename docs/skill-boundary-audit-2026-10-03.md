# Skill 职责边界审计

本轮按“Agent prompt 定义任务职责和权限，Skill 提供专业方法”检查仓库技能。问题确实不只在 GDD：一些技能重复了文档归属和阶段政策，另一些 CLI 技能把调用技能理解为更广的行动许可。两者需要区分，不能把所有专业方法、工具约束或安全提醒都删掉。

首次审计清理了两个 GDD 相关技能及三份引用；后续清理了其余 18 个有明确问题或混合职责描述的技能，以及 UI 布局引用。阶段适配复核又发现 4 处条件表达缺口，现已处理，其中两个技能此前已清理过。生成的项目文档、内容和运行证据未修改，未启动真实模型测试。

## 检查范围和判定标准

检查了 `.beegame/skills/builtinskills` 的 19 个技能、23 份引用，以及 `src/skills/bundled` 中有注册实现的 19 个 CLI 技能。CLI 的 `verify` 同时有 SKILL.md 和 TypeScript 注册，按一个技能计，共 38 项。也阅读了浏览器和记忆整理技能引用的现有 prompt。

这里的“全部”限于仓库现有技能源码，不含全局安装技能、用户账号动态安装技能或历史文档中未注册的示例。部分 CLI 技能有功能开关或内部用户限制；列入审计不代表当前 BGS 会加载它们，也不代表它们导致了此前 GDD 失败。

- **已清理**：删除或改写了重复职责、混合交付说明或扩大授权的指令，保留专业方法；不等于已通过模型行为验收。
- **未发现违反**：当前内容主要是方法、能力适用条件和技术或安全约束，不代表行为已经通过验收。
- **无法完整判断**：入口有占位内容，或引用的技能正文不在当前仓库。

技能说明“适用于哪类任务”、解释数据格式、区分规则与实现、要求证据匹配结论，都可以保留。条件式的文档写作建议也不自动等于授权；问题在于它是否成为一套独立维护的职责或阶段政策。

## 已完成的 GDD 清理

1. [game-systems-designer-expert](../.beegame/skills/builtinskills/game-systems-designer-expert/SKILL.md)：删除 `For BGS GDD authoring, own...` 整段。保留循环、经济、成长、参数和状态分析方法，修正状态引用的说明。
2. [game-creative-director-expert](../.beegame/skills/builtinskills/game-creative-director-expert/SKILL.md)：删除 GDD 交付职责，以及专业文档归属、author/review 修订和后续基线政策。保留创意、体验定位和制作取舍方法。
3. [core-loop-contract](../.beegame/skills/builtinskills/game-systems-designer-expert/references/core-loop-contract.md)：移除 GDD 权威范围，保留循环说明与未决依赖检查。
4. [parameter-boundary-model](../.beegame/skills/builtinskills/game-systems-designer-expert/references/parameter-boundary-model.md)：移除 Balance、Scene、UI、GDD 的文档分权表，保留数值来源、单位、边界和估算区分。
5. [state-machine-rules-boundary](../.beegame/skills/builtinskills/game-systems-designer-expert/references/state-machine-rules-boundary.md)：移除文档归属和派工要求，保留玩法状态、界面状态和执行时序的专业区分。

GDD 的职责、禁止代决范围及交接要求已经在 [project-author.ts](../packages/agent-workflow-server/src/beegame/project-author.ts) 的 `responsibilities['GDD.md']` 和 author 任务指令中；跨阶段权限在 [project-conversation.ts](../packages/agent-workflow-server/src/beegame/project-conversation.ts) 的现有项目上下文中。本轮没有新增另一份边界定义，也没有改这些 prompt。

## BGS 技能逐项标记

下表记录清理后的状态及具体改动。专业内容保留；职责、修订权和阶段政策不在 Skill 内重复维护。

| Skill | 标记 | 定位和判断 |
| --- | --- | --- |
| game-systems-designer-expert | 已清理 | 移除 GDD 职责和三份引用中的文档分权，保留系统分析方法。 |
| game-creative-director-expert | 已清理 | 移除 GDD 交付职责、跨文档权威及阶段修订政策。 |
| game-art-director-expert | 已清理 | 移除八文档阶段要求、Art/UI 固定分工及交接后的修订政策；保留构图、可读性和视觉证据比较方法。 |
| game-balance-designer-expert | 已清理 | 移除 Balance 文档归属及 Author/Review 分工；保留计算工具、合法状态建模、数值来源和证据独立性。需要独立检查时再按任务安排，不强制增加 Agent。 |
| game-level-designer-expert | 已清理 | 移除固定文档交付、Content 阶段前置及 UI/Scene/Tech 分权；保留计算命令、坐标转换和共享 viewport 的技术依赖。将可玩路线检查限定为已有可玩游戏且任务包含运行验证时使用，设计检查不提前要求实现游戏。 |
| game-ui-ux-designer | 已清理 | 移除文档权威、阶段交付、禁止召回作者及固定方向兜底策略；同步清理 layout-calculation.md。保留布局算法、字段、命令和证据限制，支持方向取自任务要求。 |
| game-feel-designer | 已清理 | 移除六份文档的固定职责及禁止第九份文档或新阶段的政策；保留事件确认、反馈编排、取消清理和体验检查方法。 |
| game-technical-artist | 已清理 | 移除 Art/Gameplay/Technical Art 职责表及 Resources/Content/Implementation 分工；保留技术表现实现、既定规则一致性和资源与集成证据的区别。 |
| game-content-pipeline-engineer | 已清理 | 将具名文档交付说明改为按实际任务使用的内容集成与资源规划方法；保留导入契约及避免布局双份数据。 |
| game-audio-designer | 已清理 | 移除 AUDIO_DESIGN 与 Asset/Resource 的固定分工；保留事件到音频的设计方法及行为设计与文件来源的区别。区分设计、独立资源和可用运行时的检查，文档或资源检查不等于集成验证，也不以运行游戏作为所有任务的前提。 |
| gameplay-programmer | 已清理 | 移除 TECHNICAL_DESIGN 写作归属；保留执行选择与玩法规则的区别、结果事实和事件消费方法。代码或数据所有权不等于 Agent 权限。 |
| beegame-interaction-contracts | 未发现违反 | 按实际控制模型选方法，配套引用提供控制数学与检查项，没有定义 Agent 的文档修订权。控制 profile 是方法参考，不应覆盖明确设计。 |
| evidence-before-completion | 未发现违反 | 主要限定证据能支持的结论，不授予额外审核或修订权；没有强制新增审核 Agent 或阶段。 |
| game-implementation-planning | 未发现违反 | 提供按来源和依赖拆解的规划方法，明确不是新增交付阶段；修改来源以当前任务许可为条件。 |
| game-plan-execution | 已清理 | 保留执行和验证方法，修正检查失败后无条件修改责任源的表达：定位源不等于获得修改权限；只在当前任务编辑范围内修正，否则报告证据、影响和所需纠正。派工可选，不强制提交或新增阶段。 |
| root-cause-debugging | 已清理 | 保留定位第一处偏差和验证假设的方法，区分仅诊断与已请求的修复；超出当前编辑范围的责任源仅报告原因和建议。修复后的回归检查只针对实际实施的修正。 |
| game-playtest-performance | 未发现违反 | 区分运行正确性、真实玩家证据与性能，不发明放行阈值，也不把测试通过当成发布许可。 |
| spatial-computing-game-expert | 未发现违反 | 提供空间交互与舒适性方法，不定义固定 Agent 权限或交付阶段。 |
| spatial-computing-ux-designer-expert | 未发现违反 | 提供空间布局、输入和人体工学方法；跨专业协调是依赖提醒，没有独立定义文档权威。 |

清理前核对了既有任务 prompt 已承载项目职责和跨阶段权限，因此没有新增“权限 Skill”、分权框架或第二套总规则，也没有修改 Agent prompt。所有 BGS 技能的触发描述均保持不变。

## 阶段适配复核

复核以现有任务指令为依据：Author/Review 交付设计与必要计算，不要求提前实现游戏；后续任务可以修复实现或内容，但不能自行修改已评审设计。专业方法涉及运行时、跨专业依赖或后续验证，不自动构成阶段冲突。

Audio 和 Level 的问题是将运行检查写成无条件步骤，可能使文档或资源任务提前要求可玩实现。Plan Execution 和 Root-Cause Debugging 的问题是从发现责任源直接进入修复，没有在具体步骤中区分当前可编辑源与只能报告的源。后两者已有范围保护，因此标记的是条件性冲突风险，不是已经证实的越权行为。

这 4 处均以补清方法条件处理，不在 Skill 中复制阶段表、文档修订权或固定角色政策。阶段和权限仍来自现有 Agent 任务指令。本轮对修改后的 4 个技能重新执行格式检查，并复跑技能发现与存储测试，19 pass、0 fail；未新增文案匹配测试或付费模型实验。

## CLI 技能逐项标记

CLI 工作流技能可以讲“怎样执行这个工作流”。固定步骤不自动违反分工原则；真正需要标记的是其是否自行定义授权、接管其他任务或覆盖用户约束。

| Skill | 标记 | 定位和判断 |
| --- | --- | --- |
| ultracode | 已清理 | [ultracode.ts](../src/skills/bundled/ultracode.ts)：移除自行开启全局模式、每项任务默认派工、成本不受约束及固定并发访谈；保留工作流 API、实际技术限制和脚本方法，触发说明收窄为已有授权的脚本任务。 |
| dream | 已清理 | [dream.ts](../src/skills/bundled/dream.ts)：移除“full tool permissions”声明，保留记忆整理方法；不替运行环境声明权限。 |
| stuck | 已清理 | [stuck.ts](../src/skills/bundled/stuck.ts)：默认输出本地诊断报告，移除固定 Slack 频道外发；外发需另有用户请求与内容、目的地选择。内部用户开关保持不变。 |
| schedule | 已清理 | [scheduleRemoteAgents.ts](../src/skills/bundled/scheduleRemoteAgents.ts)：移除生成 prompt 时自动创建云环境的代码及提示；无环境时提供创建指引，查看既有计划不依赖环境。新增离线测试确认入口只读环境列表、不创建环境。 |
| batch | 已清理 | [batch.ts](../src/skills/bundled/batch.ts)：移除固定 5 至 30 名 Agent 及必做 commit、push、PR；按真实独立工作量拆分，并发/worktree 按需要使用，外部交付按用户授权。显式调用和计划批准流程保留。 |
| simplify | 已清理 | [simplify.ts](../src/skills/bundled/simplify.ts)：保留三种审核角度，移除必派三名 Agent；范围限定为请求中的改动，不盲目修所有审核意见。 |
| loop | 已清理 | [loop.ts](../src/skills/bundled/loop.ts)：移除安排计划后必须立即执行一次的要求，保留解析与调度方法。 |
| skillify | 已清理 | [skillify.ts](../src/skills/bundled/skillify.ts)：区分可复用方法与单案例产物、临时补丁、Agent 分工及观察到的权限；不自动固化角色或复制工具授权，逐步检查只在有用时保留。用户访谈和保存确认保留。 |
| update-config | 已清理 | [updateConfig.ts](../src/skills/bundled/updateConfig.ts)：.gitignore 和既有错误修改以实际范围为条件；移除向既有代码注入瑕疵的测试方式，改用安全的临时样本或范围内探测，无法安全验证时报告限制；区分 JSON 解析与完整 schema 验证。 |
| use-artifacts | 未发现违反 | 说明公开上传方法与可见性，要求用户请求分享，不把本地交付故障当成上传授权；安全条件不是另一套项目职责。 |
| remember | 未发现违反 | 只整理记忆变更提案，实际修改等待授权，分类和去重是能力方法。 |
| debug | 未发现违反 | 显式用户调用后启用当前会话日志并诊断，子 Agent 只是可选，没有自动修改其他工程或外发报告。 |
| claude-in-chrome | 未发现违反 | 提供浏览器工具启动、故障恢复和页面操作方法；工具可用性提示不等于外部写入许可。 |
| keybindings-help | 未发现违反 | 提供配置格式、保留既有绑定和技术冲突说明，没有扩展为其他配置管理职责。 |
| lorem-ipsum | 未发现违反 | 生成明确用途的测试填充文本，限制输出量，未定义 Agent 职责或外部动作。 |
| cron-list | 未发现违反 | 对应列出计划的只读请求，提供工具调用和展示方法。 |
| cron-delete | 未发现违反 | 对应用户指定 ID 的取消请求，缺 ID 时只提供用法，没有扩大删除范围。 |
| verify | 无法完整判断 | [SKILL.md](../src/skills/bundled/verify/SKILL.md) 只有 `# Skill`，两个 examples 也只有标题。没有发现边界条款，但不能当成完整、可用的验证技能。 |
| claude-api | 无法完整判断 | 注册和加载代码已读；[claudeApiContent.ts](../src/skills/bundled/claudeApiContent.ts) 引用的 claude-api/SKILL.md 及 25 份文档不在当前仓库，无法审核真实注入正文。未据此判定通过。 |

此外，[bundled/index.ts](../src/skills/bundled/index.ts) 按功能开关引用 hunter 和 runSkillGenerator，但对应源码不在当前仓库，无法检查其技能名和正文。未运行这些入口，也未联网取得缺失内容；未编造或补建这些功能。

## 总结和验证限制

38 项中：22 项已清理，14 项未发现违反，2 项无法完整判断。首次与扩展清理涉及 20 个不同技能；阶段适配复核修改 4 个技能，其中 2 个重叠，因此新增清理项是 2 个。此前标出的明确问题和待判断项已有源码部分均已处理；无法判断的占位或缺失正文不计为通过。CLI 的 schedule 是入口代码风险，不能与 GDD 的重复职责直接归为同一个故障原因。

本轮使用 skill-creator 指导最小修改，因此保留触发描述、专业方法和技术约束，没有把项目政策改写为更多通用禁令。审计记录按 write-page 的写作要求区分源码事实、风险判断和未验证内容。

- 前次全部 19 个 BGS 技能通过 quick_validate 格式检查；前次修改的 9 个 CLI 源码和 2 个测试文件通过 TypeScript 转译器语法检查。本次修改的 4 个 BGS 技能重新通过格式检查。
- 前次技能发现与存储、ultracode 注册及 schedule 无环境入口测试共 24 pass、0 fail；schedule 测试覆盖两种环境状态与四类请求，断言读取 8 次、创建 0 次。测试不访问真实云服务。本次复跑发现与存储测试为 19 pass、0 fail；这些检查支持加载未发生已测回归，不证明模型遵守阶段条件。
- Agent prompt、BGS 触发描述和正式项目产物未改；CLI 注册和既有功能开关保留，部分触发描述收窄，schedule 移除了隐式创建环境的副作用。
- 差异空白检查通过；未运行全仓类型检查，不能据局部检查声称全仓构建正常。
- 没有重新生成 GDD，也没有行为验收。静态清理不证明 LLM 已稳定遵守职责；后续验证仍须使用独立案例和明确任务范围。

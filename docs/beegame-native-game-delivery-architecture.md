# BeeGame 游戏交付架构

## 1. 目的

BeeGame 接收用户确认的游戏 Idea，并通过持久 Delivery Workflow 调度相互隔离的 Claude Code Worker，交付符合文档、可玩、可预览、可部署且具有完整美术表现的游戏项目。

BeeGame 不实现第二个 Coding Agent，也不解释游戏语义。BeeGame Delivery Workflow 是唯一的阶段、revision、dispatch、重试、证据和恢复状态机；Claude Code Worker 在每个阶段合同内自主使用可用工具完成文档、资源与内容准备、实现、审计和验收工作。

本架构必须同时满足：

- 以用户确认的 Idea、方案和约束为唯一产品意图来源。
- 新项目先建立文档基线，再进入实现。
- 修改需求时先判断是否需要更新受影响文档，再修改实现。
- 文档作者、审查者、实现者和验收者之间具有清晰的独立性。
- Resource Library 被用于探索和导入资源；项目使用 JSON 描述资源映射、实体、事件和波次，使用 YAML 描述世界与场景，而不是机械填充一对一 Slot。
- 下载到项目的资源必须在目标运行时中真实加载和使用。
- 未获得当前版本的文档审查和运行验收证据时不得宣称交付完成。
- Workflow 只按持久状态和结构化终态推进，不从 Worker prose、关键词或 UI 状态推断下一步。

相关边界与资源定义：

- [BeeGame / Claude Code boundary](./beegame-claude-code-boundary.md)
- [BeeGame resource and content contract](./beegame-resource-content-contract.md)

## 2. 不可破坏的系统边界

### 2.1 Claude Code Worker 是唯一语义执行主体

Claude Code Worker 负责：

- 理解确认简报和已有项目状态。
- 决定计划、工具、Skills、Subagents 和实现顺序。
- 创建或更新项目文档。
- 组织资源探索、美术设计和目标运行时集成。
- 编写和修改代码、场景、测试及项目原生文件。
- 消化 Reviewer、Auditor 和 Validator 的 findings。
- 在失败后继续修复并重新验证。
- 通过唯一结构化 terminal 提交完成、失败或阻塞事实。

### 2.2 BeeGame 承担平台与持久 Workflow 职责

BeeGame 可以：

- 认证用户并隔离多用户工作目录和 Session。
- 管理额度、平台权限、管理员 Feature 可用性和部署权限。
- 启动、恢复或停止当前阶段唯一的 Claude Code Worker Session。
- 将 durable run 中的确认简报、revision-bound artifacts 和阶段合同提交给 Worker。
- 提供 Resource Library、预览、部署及目标环境工具。
- 转发权限决定和原生后台任务通知。
- 持久化并呈现 Claude Code 原生事件、Workflow phase、dispatch 和累计使用量。
- 验证并记录 Reviewer、Auditor、Validator 的结构化终态证据。
- 向 Claude Code 提供只读的确定性交付合同诊断；诊断只报告平台部署合同事实，不解释游戏语义。
- 在该只读合同能力中返回当前 Session 的用户确认简报事实，使原生 Reviewer、Auditor 和 Validator 无需从项目文件或摘要反推产品意图。
- 被动记录原生工具调用树，以核验 Validator 声明的运行、Skill 与资源证据确实来自其当前调用。
- 使用当前 workspace revision 判断证据是否过期并确定性失效下游结果。
- 按唯一状态机推进 Document、Resource Production、Implementation、Audit 和 Acceptance。
- 在有限修复次数内将结构化 findings 交给唯一业务 owner，并在上限后进入 `needs_action`。
- 在缺少当前版本有效证据时阻止部署。
- 核验资源工具的结构化结果、实际导入文件和原生 Agent 调用之间的因果顺序；`tool.completed` 本身不代表资源导入成功。

BeeGame 禁止：

- 选择 Claude Code 应使用的 Skill、Agent、工具或实现策略。
- 在同一 phase 并行启动互相竞争的 Worker 或维护第二条修复轨道。
- 在没有当前 revision 的合法 terminal/evidence 时推进阶段。
- 修改项目文档、代码、场景或资源引用。
- 解释游戏语义、选择 Pack、挑选元素或组装场景。
- 将构建成功、文件存在、资源已复制或中间消息解释为交付完成。
- 重写、翻译、截断或修复 Agent 的原生回复内容。
- 根据自然语言、关键词、正则或消息文案决定 phase、finding 或修复目标。

## 3. 确认简报与语言合同

确认简报必须保存用户明确选择的产品意图，不得由 BeeGame 根据关键词推断。至少包含：

- 游戏 Idea 和用户选定方案。
- 目标平台、引擎、维度、类型、输入方式和范围。
- 美术风格和资源库使用策略。
- 项目文档语言。
- 游戏内玩家可见语言。
- Agent 用户可见回复语言。

确认简报是 Session 级不可变产品事实。BeeGame 在用户明确确认时保存其结构化
摘要，并在同一 Session 的后续用户消息、显式继续和服务重启恢复后原样附带给
Claude Code。项目文件、Agent 摘要、压缩上下文和后台任务通知均不得覆盖这些
值；只有用户再次明确提交新的确认简报才能替换它们。该记录不是阶段状态机，
不决定 Claude Code 的计划或下一步，只用于上下文恢复和部署时的事实交叉校验。

三个语言维度必须相互独立：

| 字段 | 用途 |
|---|---|
| `document_language` | GDD、技术设计、美术、音频、资源和验收文档 |
| `game_user_visible_language` | 游戏 UI、教程、字幕、提示和玩家可见内容 |
| `agent_response_language` | Claude Code 主 Agent 面向用户的回复，以及用户可见 Subagent 摘要 |

### 3.1 Agent 回复语言规则

- 所有面向用户显示的 Agent 自然语言回复必须使用 `agent_response_language`。
- 主 Agent 启动 Subagent 时，应把确认简报和语言合同显式传入需要面向用户产生摘要的 Subagent。
- Reviewer、Auditor、Validator 的机器字段和值域可以保持稳定英文标识，例如 `READY`、`passed`；`summary`、`detail`、`finding` 等人类可读内容应使用 `agent_response_language`。
- 代码标识符、API、命令、文件路径、包名、格式名和不可翻译技术术语保持原样。
- 用户在同一 Session 中修改回复语言后，后续用户可见回复使用新的选择；已生成文档和游戏文本不会因此被静默改写。
- BeeGame 只传递语言选择，不得在 Agent 输出后进行翻译或内容重写。
- BeeGame 自己产生的按钮、认证、额度、权限和部署错误属于平台 UI，应使用平台 i18n，而不是伪装成 Agent 消息。

如果用户没有明确选择回复语言，应使用产品确认环节产生的显式界面语言；不得通过关键词或姓名推断语言偏好。

## 4. 原生多 Agent 协作模型

### 4.0 Game Delivery Skill

BeeGame 将 `beegame-game-delivery` 作为内置 Claude Code Skill 投影到每个
认证用户的隔离运行配置。确认简报要求主 Agent 在规划或修改项目文件前加载
该 Skill。Skill 保存本文档定义的产品交付依赖、语言要求和资源策略，但不执行
命令、不选择资源、不推进阶段，也不替代 Claude Code 的 Todo、Task、Skill、
权限、恢复或后台任务机制。

这属于向 Claude Code 提供项目交付规范，与 TUI 中的项目指令或 Skill 等价；
BeeGame 仍不得把它实现为第二套状态机。

### 4.1 Delivery Worker

每个 Worker 获得当前阶段的精确合同、允许路径和 revision，只对该 dispatch 负责。Worker 可以在业务边界内自主调用已启用工具，但不能探索 Workflow 日志、改写其他阶段产物或自行推进 phase。

以下独立性是交付可信度所必需的：

- 编写文档的人不能自证文档已准备完成。
- 编写实现的人不能仅凭代码存在宣称玩家路径通过。
- 复制资源的人不能仅凭文件存在宣称资源已经集成。
- 运行验收必须观察当前 revision，而不是读取旧报告或完成声明。

### 4.2 Document Reviewer

Document Reviewer 使用新的只读 Claude Code 上下文，并遵循 [Document Reviewer 单轨收敛合同](./beegame-document-reviewer-convergence-plan.md)：

- 接收完整确认简报和三个语言维度。
- 只读取服务端提供的 revision-bound canonical artifacts、固定 check set 和 durable review authority。
- Initial Review 对当前 scope 完成一次开放式语义审计，并为每个 check 提交 conclusion 与真实 artifact anchor。
- Closure Review 只复核 prior findings、server diff、固定影响 checks 和修改直接造成的 regression。
- 不修改项目，不发明第二份产品需求。
- 返回唯一终态：`READY`、`NEEDS_REVISION` 或 `BLOCKED`。

READY 只有在当前 revision 的 required checks 全部具有有效 pass evidence 且 findings 为空时成立。修复按 `foundation -> checklist -> resource` 的唯一 owner 顺序执行；Closure 只能关闭当前 repair batch。上游变化按确定性依赖失效下游 approval，自动返工达到上限后进入 `needs_action`，不得重新开放同一 revision 的全文审计。

### 4.3 Resource / Art Subagent

资源与美术 Subagent 负责从文档中的 Art Direction、目标运行时和性能约束出发，探索 Resource Library 并提出目标原生的美术方案。

它应：

- 先确定共享的视觉基线和主要 Pack，再探索其中的元素族。
- 观察 Pack 预览、比例、轴心、材质、贴图、动画、依赖和模块关系。
- 将角色整体、模块化环境、Sprite Atlas、Tilemap、UI 套件和音频集合视为有依赖关系的逻辑资产，而不是孤立文件。
- 需要跨 Pack 时，说明维度、渲染风格、形状语言、材质、色板、比例和主题如何保持统一。
- 让主 Agent 或目标运行时专业 Subagent 在真实项目中完成场景图、实体组合、图集、动画状态、物理和输入集成；Workflow 合同不绑定任何引擎专有对象类型。
- 通过预览观察和美术复查迭代，而不是导入文件后立即宣布完成。

Resource / Art Subagent 是 Claude Code 可选择的原生协作者。BeeGame 不自动调用它，也不根据项目类别强制某个固定名称。

### 4.4 专业实现 Subagent

主 Agent 可按实际项目需要调用游戏系统、关卡、美术、UI、音频、目标运行时、性能或测试专业 Subagent。是否调用、如何拆分、串行还是并行均由 Claude Code 决定。

专业 Subagent 必须获得明确、有限且不冲突的任务范围。主 Agent 负责合并结果并保持项目文档、资源合同和实现一致。

### 4.5 Implementation Auditor

Implementation Auditor 是独立只读 Agent，负责静态与结构化交付审计：

- 文档中的需求和玩家路径是否映射到真实实现与测试。
- 文档声明的模块、文件、接口和资源是否真实存在。
- Asset Manifest 是否符合当前合同。
- 资源是否存在真实项目引用，而不只是被复制。
- 导入格式、依赖路径和目标运行时是否兼容。
- 是否存在未使用资源、影子构建产物、虚假测试或无断言测试。
- 是否存在文档、实现和资源之间的矛盾。
- 文档当前范围内承诺但实现缺失的内容必须判为失败；只有文档明确标记为可选或未来范围的内容可以是非阻塞观察。

Auditor 不操作游戏，不代替 Acceptance Validator，也不修改项目。
Auditor 的终态同样必须来自完成了 `ProjectDeliveryContract` 的原生 Agent 调用树；
主 Agent 的转述、旧报告或没有读取当前合同的结构化文本均不构成审计证据。

### 4.6 Acceptance Validator

Acceptance Validator 使用新的只读 Claude Code 上下文验证当前 workspace revision：

- 读取已经 READY 的项目文档。
- 运行项目自身的构建和测试。
- 使用目标运行时真实启动项目。
- 按文档指定的玩家输入方式重现玩家路径。
- 观察进度、状态变化、胜负、重开、UI、声音和资源加载。
- 对视觉和资源要求观察最终渲染结果，而不是只检查 import 或文件存在。
- 返回唯一终态：`passed`、`failed` 或 `blocked`。
- 终态结果必须枚举当前验收清单的全部稳定 ID；测试数量或概括性结论不能替代逐项覆盖。

Validator 报告中的 `runtime`、`skill` 和 `asset` 字段不是自证。BeeGame 只做
机器事实核验：对应原生 Agent 调用树中必须存在已完成的目标运行能力、Skill
调用和资源证据。源码 Read/Glob/Grep 不能被标记为运行证据。BeeGame 不解释
玩家路径语义，也不决定 Validator 使用哪个目标运行工具。

Validator 之后任何会影响文档、实现、资源、测试或运行表现的修改，都会使旧结果变成 `stale`。主 Agent 必须在需要交付时自行启动新的 Validator。

## 5. 文档驱动的项目行为

### 5.1 新项目

主 Agent 应先检查空工作区并建立与项目相关的八份 Foundation 文档：

- `docs/GDD.md`
- `docs/BALANCE_DESIGN.md`
- `docs/LEVEL_SCENE_DESIGN.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/ART_DIRECTION.md`
- `docs/UI_UX_SPEC.md`
- `docs/AUDIO_DESIGN.md`
- `docs/ASSET_PLAN.md`

Foundation 文档必须来自当前确认简报，不得套用某个示例游戏。八份文档的集合、事实归属与最低完整性以 `beegame-foundation-document-authority-plan.md` 为唯一权威。八份文档经独立 Foundation Review 达到 READY 后，才创建 `docs/acceptance/gameplay-checklist.md`；Checklist 结构通过后才进入 Resource Production 并由服务创建 `assets/asset-manifest.json`。资源文件与 JSON/YAML 内容描述通过门禁后，独立 Comprehensive Review 对九份项目文档、Manifest 和内容描述执行实施前审计。Checklist、Manifest 或实现不得提前与 Foundation 并行创建。

### 5.2 已有项目和修改需求

主 Agent 先读取已有文档、实现、测试和资源合同，再判断变更类型：

- 如果修改影响玩家行为、美术、资源、交互、接口、架构或验收预期，应先更新受影响文档和清单，再实施并重新 Review。
- 如果文档正确而实现存在缺陷，应保持产品合同稳定，只修复实现和回归证据。
- 如果用户只询问或要求审计，不应自动修改项目。

该判断属于 Claude Code，不属于 BeeGame。

## 6. Resource Library 的 Agentic 使用方式

### 6.1 Pack-first，而不是 Slot-first

资源探索首先确定适合当前 Art Direction 的主要 Pack。Agent 浏览 Pack 的整体风格、用途和模块族，再选择构成游戏所需场景、角色、道具、特效、UI 和声音的资源。

项目责任与资源不是一对一关系：

- 一个场景责任可能需要几十个模块、道具、材质、音频和特效。
- 一个角色文件可能已经包含模型、蒙皮、骨骼、材质、贴图和动画。
- 一个 Sprite Atlas 可以同时支持多个角色、动画和 UI 区域。
- 一个导入资源可以被多个场景或需求复用。

### 6.2 资源库使用策略

确认简报明确保存：

- `optional`：允许完全不使用 Resource Library。
- `preferred`：优先探索和使用 Resource Library；没有采用时应由 Claude Code 说明事实原因。
- `required`：必须真实集成资源库资源，否则验收不能通过。

如果产品目标是默认交付具有丰富美术资源的游戏，默认策略应为 `preferred`；用户明确要求使用资源库时使用 `required`。管理员启用 Resource Library Feature 仅代表工具可用，不会自动改变项目策略。

当前产品的新项目默认值为 `preferred`。只有确认简报显式保存了 `optional` 或
`required` 时才覆盖该默认值。

原生 Document Reviewer 必须从调用方提供的确认简报中原样返回该策略；BeeGame
将该返回值和当前 Asset Manifest 分别与用户确认时保存的结构化事实比较，而不
允许 Reviewer 与 Manifest 互相自证。这样可以阻止项目通过把
`preferred` 或 `required` 静默改为 `optional` 来绕过资源阶段，但 BeeGame 仍不
选择 Pack、不决定元素，也不规定目标项目如何组装资源。

`preferred` 和 `required` 的“已探索”必须来自当前 Art Direction、Asset Plan
与项目目标上下文中的原生 ResourceLibrary Pack 浏览记录，不能由文档中的一句
“已评估”代替。`required` 必须存在当前 Manifest 中可追溯的真实导入资源；
`preferred` 必须真实浏览 Catalog 并采用所有合适资源，但在没有合适候选时允许以
独立、可执行、可替换的 provisional 文件完成剩余职责。任何尚未由后续成功重试解决的
资源操作失败保持为当前事实，但只要同一职责已经由合法资源完成，失败的候选尝试不再
污染 readiness。该校验只核验调用、Manifest 和文件事实，不会替 Agent 选择 Pack、
元素或组装方式。

### 6.3 导入和内容准备

资源完整链路是：

1. 浏览并观察 Pack。
2. 选择逻辑资产根或模块族。
3. 解析并复制完整依赖闭包。
4. 固定 Pack、版本和来源。
5. 保持模型、材质、贴图、骨骼、动画、Atlas 或 Tilemap 所需路径关系。
6. 用 JSON 定义稳定资源映射、实体、事件、波次和数值；用 YAML 编排世界、场景、层级和实例摆放。
7. 在目标运行时中建立真实引用并实现场景、角色、UI、特效、音频、物理和输入行为。
8. 启动预览并观察最终结果。
9. 根据视觉和玩家体验继续迭代。
10. 由独立 Validator 验证当前运行时。

只有结构化工具结果确认至少一个文件成功复制，并且 Manifest 中每个 resource 的
`root_path`、`file_paths` 与本地 hash 都对应工作区内真实、非空的文件时，导入才成立。空目录、仅元数据
刷新、全部失败的批次和缺失文件的历史记录都不得进入后续审计证据。
如果项目尚未声明真实的 `project_target.asset_format_capabilities`，整个导入批次
必须在解析和下载前以一个结构化、可修复结果失败；不能对同一缺失前置条件逐个
资源重复发起远程解析和下载。原生工具抛出的失败和零成功批次都必须作为当前
资源上下文中的失败事实保留，直到 Claude Code 修复并获得可用导入。

资源文件被复制到项目只表示原料已存在；通过完整性校验后 resource 才是 `verified`。必要的格式转换由目标适配器写入可删除的 `assets/generated/**`，不会创建新的资源身份。Resource Library 不验证美术完成度，也不生成场景或玩法。

## 7. 唯一持久 Delivery Workflow

BeeGame 只保留以下一条持久状态链：

```text
用户确认 Idea
→ Foundation Drafting
→ Foundation Initial Review / ordered remediation / Closure
→ Gameplay Checklist
→ Resource Production
→ Comprehensive Initial Review / ordered remediation / Closure
→ Atomic Task Planning
→ Implementation
→ Implementation Audit
→ Runtime Acceptance
→ Delivery
```

每个箭头只由当前 durable revision 的结构化 terminal、确定性 gate 和 transition 推进。Workflow Card 只投影该状态，不能反向推断或改变 phase。Card 的阶段、任务、状态和进度文案必须来自服务端结构化 workflow/tool 状态；不得把 Worker 自由 prose、流式片段、terminal JSON 或工具参数直接作为 Card 文案。

## 8. 失败、后台任务和恢复

- Active Session 仍存在时恢复同一 dispatch 和事件订阅，不创建竞争 Worker。
- Session 丢失且没有合法 terminal 时，按统一 transport 恢复合同处理；不得用 phase 专属 attempt 上限终止业务 task，也不得重置语义修复状态。
- 已登录用户的唯一 HttpOnly session 必须覆盖长时 Delivery Workflow，并通过同一服务端 refresh token 记录续期 access token。会话寿命不得短于正常完整交付；后台阶段切换不得退回 bearer token、绕过认证或建立第二认证路径。显式 logout、服务端撤销或 refresh token 被认证提供方判定无效时才终止该会话。
- 所有 Worker 的 token 统计与 Project Info 使用同一累计 `total_tokens` 口径，包含 input、cache read、cache creation 与 output；dispatch 只以开始时的累计快照计算增量。统计只用于可观测性，不得为 Resource、Reviewer 或其他阶段设置 token、wall-clock、工具次数或自动 attempt 业务终止条件。长任务通过能力隔离、紧凑输入、canonical artifact checkpoint 和同一 dispatch 恢复控制消耗，不重置累计统计。
- Reviewer findings 进入唯一 `documentReviewState` 和有序 owner 队列；超限后进入 `needs_action`。
- 用户停止任务时，BeeGame 停止当前 dispatch 并持久化累计时间和状态。
- 权限拒绝是事实，不得通过 BeeGame更换命令或伪造证据绕过。
- Context compaction 和 Worker 内工具行为遵循 Claude Code 原生机制；phase、revision、retry 和 evidence 以 Workflow durable state 为准。

## 9. 交付证据与完成条件

项目只有同时满足以下条件才可被描述为已交付：

- 当前确认简报和语言合同可追溯。
- 当前 foundation 和 comprehensive revision 具有完整 Document Reviewer check coverage 与 READY approval。
- 确认范围中的需求和玩家路径存在可观察证据要求。
- canonical Resource Inventory 与 JSON/YAML 内容描述完整，并在实现中真实引用。
- Implementation Auditor 没有阻塞性矛盾或虚假实现证据。
- 当前 workspace revision 获得 Acceptance Validator 的 passed 与真实运行证据。
- Validator 之后没有修改影响交付的文件。
- 构建、预览和部署使用的内容与验收 revision 一致。

BeeGame 只依据结构化终态、canonical artifacts、revision 和真实工具事实判断这些门禁。它不能把 `blocked` 包装成完成，也不能用 Worker prose 替代独立证据。

## 10. 当前权威专项设计

- [Document Reviewer 单轨收敛设计](./beegame-document-reviewer-convergence-plan.md)
- [Resource Production 单轨设计](./beegame-resource-production-plan.md)
- [Resource 与内容描述合同](./beegame-resource-content-contract.md)
- [Project lifecycle](./beegame-project-lifecycle.md)

这些文档分别拥有明确业务边界，不得再增加另一个 Document Review、资源选择、修复或兼容合同。

## 11. 系统级验收标准

使用全新项目和已有项目分别验证，测试内容不得被硬编码进系统逻辑：

- Idea、语言和资源策略正确进入 durable run，并随每个相关 Worker contract 传递。
- Agent 用户可见回复持续符合 `agent_response_language`。
- 新项目先产生项目相关文档，而不是直接生成代码。
- 文档由独立 Reviewer 审查，修改后旧证据失效。
- Worker 在当前阶段权限内自主使用已启用工具。
- Resource Library 探索只发生在 Resource Production Worker 中。
- Agent以 Pack和模块族进行资源规划，而不是机械一对一填槽。
- 导入资源被用于真实场景、角色、UI、音频或特效。
- 资源缺失、格式不兼容或依赖不完整时不会被伪装成 `verified`；无库内匹配时会创建独立、可替换的 placeholder 资源。
- Implementation Auditor 能发现文档、代码、测试和资源之间的通用矛盾。
- Validator 能在目标运行时复现文档中的玩家路径。
- failed 后只进入对应 owner 的有限修复；blocked/needs_action 明确展示真实原因。
- 当前 revision 未 passed 时部署被拒绝。
- 相同 revision 不会重复开放式审计，修复和 transport attempts 在重启后不重置。
- Web UI 只显示 durable Workflow 状态，不根据消息文案推断 phase。

## 12. 设计评审准则

任何未来修改在合入前必须回答：

1. 是否只有一个 durable phase、revision、owner 和 terminal authority？
2. 是否根据结构化事实推进，而不是关键词、正则、Worker prose 或 UI 状态？
3. 是否引入平台、引擎、游戏类型、项目名或测试 fixture 硬编码？
4. 是否留下旧 reader、fallback、双写、双读、feedback 或兼容轨道？
5. 修改是否保持用户选择的回复语言、文档语言和游戏语言相互独立？
6. 重启、继续和重试是否恢复同一状态且不会重置预算或次数？
7. 上游 revision 变化是否确定性失效全部下游证据？

任一答案不满足时不得合入。

# BeeGame 原生 Claude Code 游戏交付架构

## 1. 目的

BeeGame 接收用户确认的游戏 Idea，并通过一个原生 Claude Code Session 交付符合文档、可玩、可预览、可部署且具有完整美术表现的游戏项目。

BeeGame 是 Claude Code TUI 的 Web 与平台化外壳，不是第二套 Coding Agent、工作流协调器或自动修复系统。项目规划、文档、资源探索、实现、审查、验收和失败修复均由 Claude Code 主 Agent 及其原生 Subagent、Skills 和 Tools 完成。

本架构必须同时满足：

- 以用户确认的 Idea、方案和约束为唯一产品意图来源。
- 新项目先建立文档基线，再进入实现。
- 修改需求时先判断是否需要更新受影响文档，再修改实现。
- 文档作者、审查者、实现者和验收者之间具有清晰的独立性。
- Resource Library 被用于探索、导入和组合资源，而不是机械填充一对一 Slot。
- 下载到项目的资源必须在目标运行时中真实加载和使用。
- 未获得当前版本的文档审查和运行验收证据时不得宣称交付完成。
- BeeGame 不决定 Claude Code 下一步做什么，也不维护平行的 Agent 阶段状态机。

相关边界与资源定义：

- [BeeGame / Claude Code boundary](./beegame-claude-code-boundary.md)
- [BeeGame logical asset and composition contract](./beegame-resource-composition-contract.md)

## 2. 不可破坏的系统边界

### 2.1 Claude Code 是唯一任务执行主体

Claude Code 主 Agent 是项目 Delivery Lead，负责：

- 理解确认简报和已有项目状态。
- 决定计划、工具、Skills、Subagents 和实现顺序。
- 创建或更新项目文档。
- 组织资源探索、美术设计和目标引擎集成。
- 编写和修改代码、场景、测试及项目原生文件。
- 消化 Reviewer、Auditor 和 Validator 的 findings。
- 在失败后继续修复并重新验证。
- 判断任务是否确实完成或被外部条件阻塞。

### 2.2 BeeGame 只承担平台职责

BeeGame 可以：

- 认证用户并隔离多用户工作目录和 Session。
- 管理额度、平台权限、管理员 Feature 可用性和部署权限。
- 在用户请求时启动、恢复或停止一个原生 Claude Code Session。
- 将确认简报、用户消息和附件无损提交给 Claude Code。
- 提供 Resource Library、预览、部署及目标环境工具。
- 转发权限决定和原生后台任务通知。
- 持久化并呈现 Claude Code 原生事件。
- 被动记录原生 Reviewer、Auditor、Validator 的终态证据。
- 向 Claude Code 提供只读的确定性交付合同诊断；诊断只报告平台部署合同事实，不解释游戏语义。
- 被动记录原生工具调用树，以核验 Validator 声明的运行、Skill 与资源证据确实来自其当前调用。
- 使用当前 workspace revision 判断证据是否过期。
- 在缺少当前版本有效证据时阻止部署。

BeeGame 禁止：

- 选择 Claude Code 应使用的 Skill、Agent、工具或实现策略。
- 自动启动、轮询、恢复、重试或替换任何 Subagent。
- 自动推进文档、编码、审计、验收或修复阶段。
- 修改项目文档、代码、场景或资源引用。
- 解释游戏语义、选择 Pack、挑选元素或组装场景。
- 将构建成功、文件存在、资源已复制或中间消息解释为交付完成。
- 重写、翻译、截断或修复 Agent 的原生回复内容。
- 维护独立于 Claude Code Session 的 Agent 任务状态机。

## 3. 确认简报与语言合同

确认简报必须保存用户明确选择的产品意图，不得由 BeeGame 根据关键词推断。至少包含：

- 游戏 Idea 和用户选定方案。
- 目标平台、引擎、维度、类型、输入方式和范围。
- 美术风格和资源库使用策略。
- 项目文档语言。
- 游戏内玩家可见语言。
- Agent 用户可见回复语言。

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

### 4.1 Delivery Lead：Claude Code 主 Agent

主 Agent 保持完整 Session 上下文并对最终交付负责。它不是 BeeGame 创建的阶段执行器，而是 Claude Code 原生主循环。

主 Agent可以根据项目需要调用任意已启用的专业 Subagent 和 Skill，但以下独立性是交付可信度所必需的：

- 编写文档的人不能自证文档已准备完成。
- 编写实现的人不能仅凭代码存在宣称玩家路径通过。
- 复制资源的人不能仅凭文件存在宣称资源已经集成。
- 运行验收必须观察当前 revision，而不是读取旧报告或完成声明。

### 4.2 Document Reviewer

Document Reviewer 使用新的只读 Claude Code 上下文：

- 接收完整确认简报和三个语言维度。
- 阅读当前项目文档与机器合同。
- 通过只读 `ProjectDeliveryContract` 能力读取当前确定性合同诊断。
- 检查完整性、内部一致性、可实施性和可验收性。
- 检查需求与玩家路径是否具有稳定 ID。
- 检查每条玩家路径是否具有操作、可观察预期和证据要求。
- 不修改项目，不发明第二份产品需求。
- 返回唯一终态：`READY`、`NEEDS_REVISION` 或 `BLOCKED`。

文档发生实质修改后，旧 Reviewer 结果立即过期。主 Agent 必须在需要继续实施时自行启动新的 Reviewer。

### 4.3 Resource / Art Subagent

资源与美术 Subagent 负责从文档中的 Art Direction、目标运行时和性能约束出发，探索 Resource Library 并提出目标原生的美术方案。

它应：

- 先确定共享的视觉基线和主要 Pack，再探索其中的元素族。
- 观察 Pack 预览、比例、轴心、材质、贴图、动画、依赖和模块关系。
- 将角色整体、模块化环境、Sprite Atlas、Tilemap、UI 套件和音频集合视为有依赖关系的逻辑资产，而不是孤立文件。
- 需要跨 Pack 时，说明维度、渲染风格、形状语言、材质、色板、比例和主题如何保持统一。
- 让主 Agent 或目标引擎专业 Subagent 在真实项目中完成场景、Prefab、Node、Blueprint、Atlas、动画图、物理和输入集成。
- 通过预览观察和美术复查迭代，而不是导入文件后立即宣布完成。

Resource / Art Subagent 是 Claude Code 可选择的原生协作者。BeeGame 不自动调用它，也不根据项目类别强制某个固定名称。

### 4.4 专业实现 Subagent

主 Agent 可按实际项目需要调用游戏系统、关卡、美术、UI、音频、目标引擎、性能或测试专业 Subagent。是否调用、如何拆分、串行还是并行均由 Claude Code 决定。

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

### 4.6 Acceptance Validator

Acceptance Validator 使用新的只读 Claude Code 上下文验证当前 workspace revision：

- 读取已经 READY 的项目文档。
- 运行项目自身的构建和测试。
- 使用目标运行时真实启动项目。
- 按文档指定的玩家输入方式重现玩家路径。
- 观察进度、状态变化、胜负、重开、UI、声音和资源加载。
- 对视觉和资源要求观察最终渲染结果，而不是只检查 import 或文件存在。
- 返回唯一终态：`passed`、`failed` 或 `blocked`。

Validator 报告中的 `runtime`、`skill` 和 `asset` 字段不是自证。BeeGame 只做
机器事实核验：对应原生 Agent 调用树中必须存在已完成的目标运行能力、Skill
调用和资源证据。源码 Read/Glob/Grep 不能被标记为运行证据。BeeGame 不解释
玩家路径语义，也不决定 Validator 使用哪个目标运行工具。

Validator 之后任何会影响文档、实现、资源、测试或运行表现的修改，都会使旧结果变成 `stale`。主 Agent 必须在需要交付时自行启动新的 Validator。

## 5. 文档驱动的项目行为

### 5.1 新项目

主 Agent 应先检查空工作区并建立与项目相关的文档基线，包括：

- `docs/GDD.md`
- `docs/ART_DIRECTION.md`
- `docs/UI_UX_SPEC.md`
- `docs/AUDIO_DESIGN.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/ASSET_PLAN.md`
- `docs/acceptance/gameplay-checklist.md`
- `assets/asset-manifest.json`

文档必须来自当前确认简报，不得套用某个示例游戏。文档经独立 Reviewer 达到 READY 后，主 Agent 才应把它作为实施基线。

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

`preferred` 和 `required` 的“已探索”必须来自当前 Art Direction、Asset Plan
与项目目标上下文中的原生 ResourceLibrary Pack 浏览记录，不能由文档中的一句
“已评估”代替。`required` 还必须存在真实导入记录。该校验只核验调用事实，
不会替 Agent 选择 Pack 或元素。

### 6.3 导入和组装

资源完整链路是：

1. 浏览并观察 Pack。
2. 选择逻辑资产根或模块族。
3. 解析并复制完整依赖闭包。
4. 固定 Pack、版本和来源。
5. 保持模型、材质、贴图、骨骼、动画、Atlas 或 Tilemap 所需路径关系。
6. 在目标引擎中建立真实引用。
7. 组合场景、角色、UI、特效、音频、物理和输入行为。
8. 启动预览并观察最终结果。
9. 根据视觉和玩家体验继续迭代。
10. 由独立 Validator 验证当前运行时。

资源文件被复制到项目只表示 `available`，不表示 `integrated`。Resource Library 不验证美术完成度，也不生成跨引擎通用场景。

## 7. 非编排式能力流

以下顺序描述的是正常游戏开发依赖关系，不是 BeeGame 状态机：

```text
用户确认 Idea
→ Claude Code 建立或更新文档
→ Claude Code 调用独立 Document Reviewer
→ Claude Code 处理 findings
→ Claude Code 探索资源与制定美术方案
→ Claude Code 调用专业 Subagent 实现可玩增量
→ Claude Code 调用独立 Implementation Auditor
→ Claude Code 修复静态与资源集成问题
→ Claude Code 调用独立 Acceptance Validator
→ Claude Code 根据 failed findings 继续修复
→ 当前 revision 获得 READY + passed
→ BeeGame 允许用户预览、部署和交付
```

BeeGame 可以从原生事件被动显示进度，但这些显示不得反过来控制 Claude Code。

## 8. 失败、后台任务和恢复

- Subagent 后台化后遵循 Claude Code 原生终态通知，不由 BeeGame 主动轮询。
- Reviewer 或 Validator 返回 failed/blocked 后，由主 Agent 决定修复、重新调用或向用户报告 blocker。
- 服务重启后恢复原生 Session 和事件订阅；BeeGame 不重建 Claude 上下文。
- 用户停止任务时，BeeGame只转发原生停止请求。
- 权限拒绝是事实，不得通过 BeeGame更换命令或伪造证据绕过。
- Context compaction、resume、Task、SendMessage、Skills 和后台通知均遵循 Claude Code 原生行为。

## 9. 交付证据与完成条件

项目只有同时满足以下条件才可被描述为已交付：

- 当前确认简报和语言合同可追溯。
- 当前文档 revision 获得独立 Document Reviewer 的 READY。
- 确认范围中的需求和玩家路径存在可观察证据要求。
- 资源合同有效，所需资源在目标运行时中真实引用和加载。
- Implementation Auditor 没有阻塞性矛盾或虚假实现证据。
- 当前 workspace revision 获得独立 Acceptance Validator 的 passed。
- Validator 之后没有修改影响交付的文件。
- 构建、预览和部署使用的内容与验收 revision 一致。

BeeGame只记录和比较这些原生事实。它不能把 `blocked` 包装成完成，不能用主 Agent声明替代独立证据，也不能根据项目文件自行推断游戏已经可玩。

## 10. 分阶段落地计划

### P0：边界与原生多 Agent 闭环

1. 审计并移除 BeeGame 中遗留的阶段调度、自动修复、自动重试和 Agent语义控制。
2. 保持一个原生 Claude Code 主 Session 作为唯一 Delivery Lead。
3. 完善只读 Document Reviewer、Implementation Auditor 和 Acceptance Validator 原生 Agent 定义。
4. 被动记录 Agent 工具生命周期、终态 JSON 和当前 workspace revision。
5. 保证文档修改、实现修改和资源修改会使对应旧证据 stale。
6. 为 Validator 提供管理员启用且目标适用的原生运行能力，不在 BeeGame中实现平台玩法逻辑。
7. 保持 Claude Code 原生工具链与 Sandbox 行为；本地模式不得把 npm、pnpm、Yarn 或 Corepack cache 重定向到工作区外的不可写路径，云端通过每用户或每 Session 隔离 Worker/容器提供独立 HOME、cache 和临时目录，而不是由 BeeGame Prompt 或 Agent 状态机管理工具链。
8. 将 `agent_response_language` 加入确认简报并贯穿用户可见 Agent 输出。

### P1：Resource Library Agentic 接入

1. 提供 Pack 浏览、Pack 检查、Pack 内元素浏览、预览和客观元数据工具。
2. 支持逻辑资产根、嵌入子资源、外部关系和依赖闭包。
3. 支持 3D 角色整体、模块化环境、Sprite Atlas、Spritesheet、Tilemap、UI、VFX、字体和音频集合。
4. 提供精确导入与固定来源，不进行自动选择或替换。
5. 让 Asset Manifest 记录 requirements、imports、compositions 和目标原生引用事实。
6. 由 Claude Code在目标运行时完成场景和游戏组合。
7. 由 Auditor 和 Validator 区分 copied、referenced、integrated 和 runtime verified。

### P2：完整交付质量

1. 支持按项目需求发现和使用美术、关卡、UI、音频、系统、性能和目标引擎 Skills。
2. 支持视觉预览、玩家路径操作和目标原生运行验收。
3. 支持修改需求后的文档影响分析与增量回归。
4. 支持多用户并行 Session，确保工作区、权限、资源和事件不串用户。
5. 在 Dashboard 分开展示文档 Review、静态审计、运行验收和资源集成事实。
6. 验证管理员 Feature 开关只影响能力可用性，不替 Claude Code做选择。

## 11. 系统级验收标准

使用全新项目和已有项目分别验证，测试内容不得被硬编码进系统逻辑：

- Idea、语言和资源策略正确进入同一个 Claude Code Session。
- Agent 用户可见回复持续符合 `agent_response_language`。
- 新项目先产生项目相关文档，而不是直接生成代码。
- 文档由独立 Reviewer 审查，修改后旧证据失效。
- Claude Code可以自主发现并调用已启用 Skills 和专业 Subagents。
- Resource Library探索发生在 Claude Code原生工具调用中。
- Agent以 Pack和模块族进行资源规划，而不是机械一对一填槽。
- 导入资源被用于真实场景、角色、UI、音频或特效。
- 资源缺失、格式不兼容或依赖不完整时不会被伪装成 integrated。
- Implementation Auditor 能发现文档、代码、测试和资源之间的通用矛盾。
- Validator 能在目标运行时复现文档中的玩家路径。
- failed 后主 Agent继续修复；blocked 明确展示真实 blocker。
- 当前 revision 未 passed 时部署被拒绝。
- BeeGame没有自动调度、自动修复或改写 Agent 输出。
- Web UI 的 Session、权限、后台通知、resume 和 compaction 行为与 Claude Code TUI保持一致。

## 12. 设计评审准则

任何未来修改在合入前必须回答：

1. 这个能力是否已经属于 Claude Code、Skill、Subagent 或目标引擎工具？
2. BeeGame是在提供或呈现能力，还是在决定 Claude Code下一步行为？
3. 同样的需求在 Claude Code TUI 中如何完成？
4. 修改是否引入平台、引擎、游戏类型、文件名、关键词或测试用例硬编码？
5. 修改是否会让 BeeGame的状态与原生 Session状态形成双轨？
6. 修改是否重写了 Agent消息或把平台消息伪装成 Agent回复？
7. 修改是否保持用户选择的回复语言、文档语言和游戏语言相互独立？

只要修改会影响 Claude Code下一步调用哪个 Agent、何时重试、如何修复或是否完成，就不属于 BeeGame职责，应退回 Claude Code原生能力或用户授权配置。

# 自主交付闭环修订规划：基于月光邮差的代码、日志与产物审计

日期：2026-09-19。状态：实施中。本文既是通用落地指导方针，也是月光邮差案例的回归计划。

## 实施进度（2026-09-19）

- **批次 A 已完成**：终结 workflow worker 仅释放传输会话，不再删除 transcript 或 native-session snapshot；显式 native resume ID 已接通，不会误当成 transcript ID。实现完成后的自然语言总结也写入实现证据。
- **批次 B 已完成**：实现、资源和 Content Prompt 不再规定检查次数或工具顺序；实现 Agent 自主运行、观察、修复。默认不再派发 `acceptance-validator`，也不再解析固定 `ACCEPTANCE`/逐 ID 报告。ACCEPTANCE 保留为宿主针对当前 revision 的轻量交付确认。
- **批次 C 已完成**：月光邮差已修复暂停时的条件 hooks、无尺寸文本的收缩换行、生产包遗漏 `assets/manifest`。已通过 TypeScript、生产构建、18 个资源描述文件 JSON 校验，以及浏览器中 Esc、P、暂停按钮三入口和标题/暂停界面的回归。
- **批次 D 未开始**：尚未建立全新项目做端到端量化验收。

本轮已通过相关单测与 TypeScript 检查；完整仓库测试中存在 9 个既有 Foundation Author 离线/认证类失败，与本次交付流程修改无调用关系，需在独立任务中归因，不能被当作本方案通过或失败的证据。

## 1. 目的与结论

目的不是让 Workflow 显示成功，而是让原生 CLI Agent 根据用户确认的八文档，自主获取或制作资源、生成可编辑 Content、实现并验证可交付的 Web React 游戏；BGS 负责工作区、授权、产物管理、状态和真实证据，不重新实现 Agent 的思考和工具调度。

当前底层已经直接启动原生 CLI。需要修正的是上层工作安排和交付事实，不是再造一条“直接 CLI”执行链。

本次确认的核心问题：

1. 游戏确有暂停崩溃、文本布局错误、生产包漏资源描述文件三个缺陷，不能交付。
2. 实现 Prompt 将工作收窄到静态检查，运行验收另开只读会话，切断“实现—运行—观察—修复”的连续过程。
3. 验收要求按全部 ID 填写固定格式 PASS/FAIL，但报告仍出现“PASS 同时承认功能损坏”的语义矛盾。格式完整不等于质量合格。
4. Workflow worker 结束时主动删除 transcript，索引却保留。大量诊断事件不能替代被删除的工具输入输出和对话记录。
5. 最新状态是验收失败后等待处理，不是仍在无限审计。历史重启、版本变化和实际测试耗时必须分开，不得全部归因于 Agent 不智能。

方向：保留用户需要的产物约束和必要安全边界，删除规定 Agent 工具顺序、检查次数、长篇固定验收报告的控制；让实现 Agent 自主完成运行和修复，宿主保留轻量、可核查的交付确认。

## 2. 审计范围与证据定位

### 2.1 当前对象

- 代码工作树：`claude-code-main/.worktrees/ir-workflow-integration`，本文位于该工作树的 `docs/`。
- 项目根目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/moonlight-post-stealth-delivery--5613abc6036e`。
- Run：`38b6624d-72a4-4ecd-a0a5-9db7b2ef1093`。
- 最新验收 dispatch：`3fb02be0-91eb-465e-848c-adc60fe5cf48`。
- 最新实现/工作区 revision：`9ed7965fb05dd0027cb67500c9751853e58647d0618aad11dc8a0283ee4d3f72`。
- 当前状态文件：项目下 `.beegame/workflow/run.json`，`ACCEPTANCE / needs_action`。
- 最新验收证据：项目下 `.beegame/workflow/evidence/acceptance-validator-3fb02be0-91eb-465e-848c-adc60fe5cf48.json`。

以下项目证据路径均相对于上述项目根目录；代码链接相对于本文所在工作树。时间除另注外均为 UTC。

### 2.2 已核查证据

| 证据 | 支持的事实 | 使用边界 |
| --- | --- | --- |
| `run.json`、`events.jsonl`，后者第 21430–21433 行 | 最后一次验收从 13:18:43.742 至 14:17:39.409，随后 needs_action | 不等于仍在后台修复 |
| 最新验收 evidence + 项目 `UIRenderer.tsx`、`styles.css`、`vite.config.ts` | 三项缺陷有报告与代码对应 | 本轮未重新运行浏览器，复测属于实施后的工作 |
| `transcripts/moonlight-post-stealth-delivery-5613abc6036e__09a5dde1.jsonl` | 较早验收曾遇到源码/运行版本差异；生产包加载失败后切换开发服务继续检查 | 这是较早会话，不能冒充最新验收的完整 transcript |
| `logs/index.json` 与实际 transcript 文件 | 31 个索引条目中 24 个目标文件不存在，含最新验收会话 | 不能据此声称完整回放了最新 59 分钟 |
| `.beegame/workflow/logs/` 下该 dispatch 的 runtime diagnostics 与原生执行日志 | 会话生命周期、工具数量、usage、输出间隔 | 传输元数据不等于工具内容；无输出间隔不等于纯模型等待 |
| 当前 worker Prompt、terminal parser、session disposal 代码 | 静态检查限制、固定格式协议、清理 transcript 都真实存在 | 有干预证据，但不能量化其造成了多少分钟损失 |

## 3. 根因、责任边界与需要纠正的判断

### 3.1 游戏不能交付：不是只有 Workflow 状态问题

| 问题 | 已确认的实现原因 | 最小修复方向 |
| --- | --- | --- |
| 暂停白屏 | `src/ui/UIRenderer.tsx:146` 可见性提前返回；普通 `renderButton` 函数在 327–328 行调用 hooks，按钮是否渲染改变父组件 hooks 次序 | 将有 hooks 的按钮作为独立 React 组件渲染，保证 hooks 稳定；不能靠捕获异常后继续显示掩盖 |
| 文本逐字换行、遮挡 | 绝对定位父子布局缺乏可用宽度；23 个 text 节点中 18 个未显式给 size，渲染器没有正确处理这种合法输入 | 修复渲染器的自然尺寸/宽度语义，而非强迫全部 Content 补 size 或新增 IR 层 |
| 生产包无法加载内容 | `vite.config.ts:48` 复制过滤排除了 `assets/manifest`，运行时却需要其中 18 个资源描述文件 | 生产产物包含实际运行依赖；用独立静态服务验证 `dist`，不能用 dev 成功替代 |

“UI 问题是模型能力缺陷”目前无法证实。能证明的是 Agent 生成了具体错误，而现行实现任务又没有承担运行视觉闭环。解除限制有助于发现和修复，但不会自动保证正确，仍需看实际运行结果。

标题竖排本身不一定错误：八文档允许相应构图选择。真正要修的是非预期逐字断行、HUD 不可读和控件遮挡，不把个人审美当成新增需求。

### 3.2 上层干预：有明确代码，不是猜测

[worker-prompts.ts](../packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts) 当前要求实现阶段：

- “Run existing non-runtime checks once”。
- 无现有检查时只做简短静态检查。
- “Runtime acceptance is a separate phase”。

随后 acceptance-validator 被要求只读，不得修改项目，还必须对全部 task/checklist/content/resource ID 按固定英文格式逐一表态。资源、Content 阶段也含 `once` 和预设验证/渲染顺序。

这不是单纯描述“做出什么”，而是在规定“怎样工作、检查多少次、何时不能运行”。最小调整是删掉这些限制，而不是再添加一组更细的自主工作规则。

独立八文档 Reviewer/Revision 本身不构成已证实根因；本轮不删除这一用户认可的职责划分。最终只读复核也不天然错误，错误在于它成为实现之后首次主要运行验证，并承担昂贵的全量 LLM 审计。

### 3.3 最新验收为什么长，哪些归因不能成立

最新 dispatch 耗时约 **58 分 56 秒**，原生会话约 **58 分 54 秒**。原生 terminal 为正常结束，游戏结论为 FAIL：不能混同为授权失败、模型崩溃或进程仍卡住。

可见工具启动 130 次：Bash 104、Read 21、TodoWrite 4、Write 1。没有在这些事件中看到 Agent/Task 调用，不能把长时间归咎于 subagent。最长 stdout 间隔约 6 分 54 秒，但完整 transcript 已缺失，无法把它可靠分成推理、工具等待或其他等待。

本次 dispatch usage：

| 项目 | 计数 |
| --- | ---: |
| input_tokens | 396,333 |
| cache_read_tokens | 12,303,121 |
| completion_tokens | 116,247 |
| total_tokens | 12,815,701 |

这是多次调用累计口径，包含重复读取的缓存上下文；不是单次上下文长度，也不直接等于计费 tokens。全 Run usage 更大，不能拿全 Run 累计数当这次验收成本。

可确认的成本来源是大量验收工具工作、较早失败/重启造成的重复工作，以及独立验收重新理解项目。固定逐项报告是可能的成本放大因素，尚不能给出因果占比。与人工“十分钟”比较前，必须匹配模型实际端点、配置、起始文件、任务范围和验收深度；不能只匹配模型别名。

### 3.4 日志缺失已找到直接清理路径

[session-manager.ts](../packages/agent-workflow-server/src/beegame/session-manager.ts) 的 `disposeWorkflowWorker()` 在 worker 空闲后执行 `rm(record.transcriptPath)`，但 `updateProjectTranscriptIndex()` 写下的索引仍保留。

[delivery-worker-session-port.ts](../packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts) 终结时调用该清理。不是只缺一个 responseTrace 开关，而是已有记录被主动删除。未逐一重建全部 24 个文件的删除历史，但代码已明确提供与现象一致的正常终结删除路径。

[project-records.ts](../packages/agent-workflow-server/src/beegame/project-records.ts) 的写入异常也被静默忽略。需要保留“日志故障不打断 Agent”的性质，同时让宿主可见记录失败，不能用假完整的索引掩盖。

### 3.5 版本、预览、Retry：纠正此前过度归因

- **不是 dist 缺 package.json 导致生产包无效。** [preview-manager.ts](../packages/agent-workflow-server/src/beegame/preview-manager.ts) 在解析得到的 workspace 根查 package.json。必须查实际路径/预览会话；静态 dist 不需要 package.json。已证实的是资源描述文件漏打包，不能通过往 dist 复制 package.json 修复。
- **不同 revision 的历史 PASS/FAIL 并存不证明错误复用。** [validation-stage.ts](../packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.ts) 已有 revision 一致性检查，应保留并回归，不另建版本系统。
- **较早验收有测试期间代码变化证据，写入者身份未确定。** 不把 transcript 中 Agent 的推测当成外部进程身份事实；当前脚本 ID 也不能继续按旧不一致状态判错。
- **Retry 并非必然只重跑验收。** [transition.ts](../packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts) 已将 acceptance failed 的 retry 转回 IMPLEMENTATION。问题是跨 dispatch 新建会话、重复理解，以及实现 Prompt 仍不承担运行修复；不是缺一个全新自动重试状态机。
- **当前 needs_action 有合理原因。** 三项实质缺陷未修复，不能删除失败显示来“交付”。但展示应说清具体问题，而非笼统的 another attempt；本轮不扩展为前端重构。
- **报告局部 PASS 不可信。** 如 `ui_hud` 标 PASS 却同时记录文本错误和暂停崩溃；资源 dev 可加载不能证明 dist 可交付。保留这些记录作为观察，不作为完整功能合格证据。

## 4. 目标方案：保留产物链，撤掉 Agent 行为编排

主线维持：

`确认八文档 → 自主资源交付 + Manifest → 可编辑 Scene/UI/VFX Content → 自主实现、运行与修复 → 同版本交付确认`

这不是新增阶段。继续使用现有原生 CLI runner、会话机制和 Workflow 状态；不恢复已移出的 Game IR，不新增 engine adapter、第二套配置或“审计 Agent 管理器”。

### 4.1 Agent 与宿主各自负责什么

| Agent 自主负责 | BGS 必须负责 |
| --- | --- |
| 阅读必要文档、规划步骤、选择工具与是否委派 | 提供准确目标、目录、可用能力与用户授权范围 |
| 搜索/制作资源，判断视觉质量并迭代 | Manifest 路径、引用有效性、许可来源记录的保存与检查 |
| 生成独立 Scene/UI/VFX Content，并实现引擎消费 | 保留可编辑 JSON 的单一数据来源，不偷换为代码常量 |
| 自主运行浏览器、检查画面与交互、修复发现的问题 | 管理进程、停止、日志、产物 revision、真实交付状态 |
| 决定必要的检查次数与顺序 | 不靠报告语气、英文关键词、LLM 正常退出冒充产品通过 |

产物格式、安全权限、用户需求属于必要边界，不等于干扰。规定只能静态检查、只能检查一次、必须委派、逐 ID 填表属于应移除的行为限制。

### 4.2 实现任务采用普通对话式目标

建议实现 Prompt 的主体：

> 按项目已确认的八文档、Manifest 和 Scene/UI/VFX Content 完成这个 Web React 游戏。Scene/UI 保持为运行时读取的可编辑数据。请实际运行并检查画面、交互和生产构建，修复影响使用或违反需求的问题。使用你认为合适的工具和工作方式；完成后简要说明结果、验证证据及仍未解决的问题。

上下文只附真实文件路径、目标平台、当前失败证据和必要授权。不重复粘贴整套文档，不要求固定数量工具调用，不要求新建验证框架，也不禁止 Agent 在需要时写小型针对性测试。

实现阶段正常结束应代表 Agent 已尝试完成运行闭环，而非仅文件写完。Agent 的结论仍是报告，不是唯一交付证据。

### 4.3 失败后的接续，而非重新审计一切

- 正常实现中，Agent 可以直接观察、修复、再验证，不经宿主强制拆成 reviewer/revision 多轮。
- 最终确认发现问题时，将具体操作、错误和证据交回实现任务；优先续接该项目的原生实现会话，不引入新的复盘 Agent。
- runner 已支持 native `--resume`；session port 当前拒绝 `resumeWorkerSessionId`。最小实现是在 BGS 层保存并校验项目对应的 native session ID，接通已有续接能力，不修改原生 Agent 引擎。
- 无法续接时如实记录原因，使用当前文件和简短失败事实恢复，不重放整个历史 transcript，不伪称同会话。
- 不增加自动无限 Retry 或固定 N 轮审计。用户停止必须有效；会话正常结束但问题未解决时保留 needs_action，解释剩余问题，不能靠宿主不断追加任务掩盖失败。

### 4.4 最终验收不再默认发起一次全量 LLM 审计

保留现有 ACCEPTANCE 状态作为交付确认边界，但默认不再为逐 ID 报告另开长篇审计会话。

复用实现期间产生的可检查证据，并在同一 revision 的生产产物上运行已有构建/冒烟检查；需要的浏览器功能与视觉检查由实现 Agent 执行并保存结果。宿主确认实际产物、检查结果和证据属于当前版本，缺失部分标为未验证，而非推断为 PASS。

移除基于 `ACCEPTANCE: PASS` 和每个 ID 英文行的业务判定，不换成另一套大 JSON 填表协议。现有宿主 evidence 记录保留 revision、检查结果、证据路径与未解决问题即可；自然语言报告供人阅读，不由正则推导游戏质量。

不将“存在截图”视为审美达标，也不将“命令退出 0”视为全部玩法正确。已确认的功能/视觉结果必须有对应操作与观察。用户要求独立深度复核时再执行，不作为默认重复成本。

### 4.5 版本与可编辑性

- 保留现有 revision 检查，防止历史通过冒充当前通过。
- 验证期间不由另一工作流偷偷改同一源码；优先复用已有项目占用/运行状态，不预建分布式锁或全面快照系统。
- 若用户编辑 Content 或源码，旧证据失效；检查对应变化，不清空八文档与全部资源重新生成。
- 编辑 Scene/UI 的位置、缩放、替换资源后，运行时读取同一份 JSON 生效，不需要 Agent 重新生成代码；部署副本可以重新发布，但不是新的实现阶段。
- 验收对象是实际交付的生产包。开发服务与生产包测试结果分开记录，不能混成一个 PASS。

## 5. 落地顺序与退出条件

以下是工程实施批次，不是新增运行时 Workflow 阶段。每批满足退出条件后再前进，不边失败边叠加规则。

### 批次 A：保全证据，避免下一次测试仍不可解释

改动范围：`session-manager.ts`、`project-records.ts`、现有 observability 与相关单测。

1. worker dispose 只释放进程、订阅和必要临时状态，不删除用于查证的 transcript；保留续接所需的最小会话关联。
2. 索引和保留策略一致；历史已丢失文件明确 unavailable，不能伪造恢复。未来显式清理时同步更新索引。
3. 日志写入失败产生可见诊断，但不让 Agent 因日志问题中断。
4. 使用已有事件保存工具名、调用 ID、输入/结果、开始结束时间、退出状态、stderr；如原生事件提供父子调用信息则保留。没有 subagent 证据就标未知，不猜测。
5. 不创建第二套响应追踪框架，不记录密钥或完整环境变量；不要求模型暴露隐藏推理。根目录环境按既有配置加载，仅记录非敏感配置指纹。

退出条件：正常结束、失败、停止三种情况的 retained transcript 均可读取；索引无悬空目标；工具事件可关联；权限等待可与工具运行区分。历史缺失不计为修复后新数据通过。

### 批次 B：撤掉不必要行为控制，接通实现闭环

改动范围：`worker-prompts.ts`、`delivery-worker-session-port.ts`、`validation-stage.ts`、`recovery.ts`/`transition.ts` 的实际相关调用点。

1. 删除只做静态检查、检查一次、必须按固定工具顺序、必须逐 ID 报告等指令与依赖这些指令的解析分支。
2. 默认不再启动全量 acceptance-validator LLM 会话；复用现有 ACCEPTANCE 状态记录轻量交付确认，不新增平行策略开关。
3. 复用 runner 续接能力，交回具体失败事实；保留停止与项目/用户会话隔离。
4. 保留 Manifest/Content 实际消费约束、revision 校验、必要权限和确定性数据校验；不删原生引擎内部代码。
5. 移除只服务于退休逐 ID 协议的函数、类型及测试；先确认调用关系，不因名字含 reviewer、revision 或 validation 就全删。

退出条件：实现 Agent 可正常使用浏览器且可修改实现；失败反馈不强制全量重审；已有不匹配 revision 测试仍通过；不依赖英文回答格式或严重性分类决定成功。

### 批次 C：以当前案例验证修复能力

保留现有八文档、资源和 Content，不新建项目、不重置进度 0。将三项已确认缺陷及证据交给实现 Agent，允许其自主分析和修复。

实现期间不由另一个后台任务改同一工作区。检查游戏实际生产构建，而不是给数据加限制来规避渲染器错误；不引入新 IR、asset loader 框架或完整自动化测试平台。

退出条件见下一节。不能只交付一次手工改好的示例，却不修复 BGS 的断裂流程与证据删除问题。

### 批次 D：单次新项目端到端验收

仅在 A–C 完成后，以相同用户需求建立一个全新 Web React 项目，走完整主线。保持真实模型端点、版本、根目录环境配置和工具能力可核对，统计各阶段消耗与产物质量。

默认不再额外跑一次付费对照实验；如果仍存在显著时间差，先用保留下来的工具/等待记录归因，再决定是否需要严格同条件的原生 CLI 对照。

退出条件：新项目达到独立交付标准、日志可回放、无需人工偷改绕过错误。记录实际耗时，不承诺一定十分钟，也不通过时间墙或 tokens 上限强迫完成。

## 6. 可量化验收标准

这些是本案例的结果标准，不作为约束 Agent 工具步骤的 Prompt 脚本。

| 维度 | 合格标准 |
| --- | --- |
| 暂停 | Esc、P、按钮三个入口均可用；暂停/继续重复操作不白屏，无 hooks 错误；游戏逻辑按文档暂停 |
| UI | 960×540、1280×720 下关键文字可读，HUD/按钮无非预期重叠或逐字断行；保留文档允许的艺术排版 |
| 静态交付 | 新构建的 dist 脱离开发中间件可以启动；18 个运行时描述文件均可加载并解析；检查内容类型，不能把返回 HTML 的 HTTP 200 当 JSON 成功 |
| 玩法 | 收集三封信并投递成功、被抓失败、重试、暂停恢复均有真实浏览器观察；不以直接修改状态变量冒充正常操作成功 |
| 资源与特效 | Content 引用资源通过 Manifest 解析；拾取、警戒、投递特效可见，资源无缺失；无随意占位替代既定美术 |
| 编辑链路 | 修改 Scene 位置/缩放、UI 位置或已存在资源引用后，重载消费同一 JSON 生效，不需生成新代码 |
| 版本 | 当前 evidence 与交付产物对应；用户编辑后旧通过不得继续代表新版本；保留既有拒绝陈旧证据的回归 |
| 证据一致 | 无“同一功能 PASS 同时承认损坏”；开发环境成功不覆盖生产失败；正常模型退出与产品通过分开 |
| 日志 | 新测试的保留期内索引可读率 100%；结束/失败/停止后仍能追查工具结果；缺失数据有明确标记 |
| 授权与停止 | 已授权范围内不重复无意义弹窗；超范围仍需授权；停止后不继续调度修复，不能以自主性为由关闭安全控制 |

视觉质量另附关键界面的截图与简短判断，针对八文档中可读性、层级、构图、风格一致性逐项解释；这不是仅用 schema/build 可证明的数值，需要人工检查或明确的视觉观察证据。

## 7. 时间和 tokens 的统计方式

沿用已有日志，补齐事实，不新增复杂指标系统：

- 每阶段记录 dispatch 开始、原生进程启动、首个输出、工具开始/结束、权限等待、原生 terminal、宿主 reconcile。
- 总墙钟以起止时间相减；并行工具时间取区间并集，父子调用不能重复累加。
- 能确认的权限等待、工具执行、启动/收尾单独报告；其余标为模型/传输等未分解时间，不能把无输出全部算“模型生成”。
- input、cache read、cache creation、output 分列；按 dispatch 去重累计，区分 Run 总量与单阶段量。供应商没有费用数据就不估算实际扣费。
- 保存失败尝试和服务重启成本，不把它们藏进某一次成功会话，也不声称每次重启都是模型失败。

本轮基线只有“旧最新验收约 58:56”及该次 usage。新方案改变了阶段职责，不能把一个变短的 ACCEPTANCE 阶段直接称为端到端性能提升；必须看同范围实现、修复、验证的总耗时和质量。

目标先落实为：移除一次默认全量重复 LLM 验收；无强制逐 ID 报告开销；不再因删除日志无法归因。速度改善百分比在新样本完成后计算，当前不给无证据承诺。

## 8. 删除范围、保留范围与风险

删除：明确的静态检查限制/次数限制、固定逐 ID 终结协议及专用解析、默认重复全量验收调度、worker 终结删除 transcript 的行为。

保留：原生 CLI 引擎、八文档及已认可的文档审阅职责、Manifest、Scene/UI/VFX 可编辑 Content、资源许可信息、现有版本一致性、用户权限与停止、简单的产物与运行正确性检查。

不做：回滚到旧 v1、恢复 Game IR、实现通用 engine adapter、重写编辑器或路由、修改原生引擎、对所有阶段增加快照/锁框架、增加自动无限审计或预算截断。

风险与处理：

- 同会话可能继续增长上下文：复用原生会话/压缩能力，不自制摘要调度器；无法恢复则透明降级。
- 解除工具限制后仍可能产出错误：用真实运行验收判断，不能把“更自主”当质量证明。
- 简化报告可能减少表面覆盖感：保留用户需求与实际观察的对应，不用全部 ID 填满换取虚假的完备性。
- transcript 保留会增加存储：采用已有日志保留/显式清理机制，确保索引一致，不在会话刚结束时销毁诊断依据。
- 生产包证据不足：保持未验证/needs_action，不能为走通流程伪造成功或静默回退 dev。

## 9. 文档收敛与实施交接

本文覆盖当前无 Game IR 主线的实现/验收/日志修订方向。以下历史文档用于理解设计目的，不作为已正确实现的证明：

- [原生交付架构](beegame-native-game-delivery-architecture.md)
- [资源与 Content 契约](beegame-resource-content-contract.md)
- [引擎中立 Content 实践规划](engine-neutral-content-package-practice-plan-2026-09-15.md)

实施 B 时同步修订上述文档中仍描述旧 IR 或固定验收协议的现行入口，保留历史记录并标明替代关系；不一次性重写所有历史方案。

下一步从批次 A 开始：先停止删除证据，再撤掉行为限制和重复验收，之后修复当前案例并验证。不先重新跑长测试，不通过继续加 Prompt 规则修补由 Prompt 限制造成的问题。

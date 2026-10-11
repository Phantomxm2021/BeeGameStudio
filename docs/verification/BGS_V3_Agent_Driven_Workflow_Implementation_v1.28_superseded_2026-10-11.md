# Bee Game Studio — V3 Agent-Driven Workflow 实施规范

> 版本：1.28 · 2026-10-11  
> 状态：通用任务控制已有代码与合成／数据库证据；构建、运行、Preview 和已测工程导出目前只接静态 Web，BGS Scene/UI 消费检查是另一个可选专项，不是跨技术路线交付能力。Unity／Godot 的引擎控制、实际运行和工程交付尚未接通。正式 frontend 的 V3 接入已撤回，后续只用独立 debug／脚本验收。当前 `deliveryEligible=false`，默认 V3／发布未开放；历史局部通过不代表完整游戏、真实模型质量或成本达标。  
> 目标：用户输入 idea，交付满足确认需求、可运行和可继续修改的游戏；取消固定文档批次作为生产前提，保留必要设计、专业工具和实际验收。  
> 修订原则：按实际依赖推进；复用可靠能力、替换不合目标的业务约束；不改 Claude Code 原生循环，不以更多 Agent、Schema 或 Gate 宣称质量和成本已解决。

**当前执行依据**：§3.3–3.5 定义技术路线及保留／移除／尚缺边界，§12 定义新的实施顺序。§1.3–1.29 为历史记录，其中“下一步”、当时状态与正式前端操作不是当前授权或排期；保留原证据，不追溯修改通过结论。此次只修订规范，没有实施下面列出的代码调整。

## 0. 决策摘要

1. **取消固定顺序，不取消交付责任。** 八领域是设计职责，不是八次模型任务，也不要求先写齐八份 Markdown。必要规则、数据和专业要求仍须在其消费者开始前明确。
2. **Agent 选择工作方法，BGS 管理授权、任务交接和交付事实。** Planner/Replanner 是协调 Agent 的规划能力，不预设两个额外付费服务。BGS 不安排逐工具步骤、不重写工具描述/结果、不隐藏追加执行限制。
3. **一次保存只有一份事实来源。** 以项目实际 Markdown／代码／配置／原生场景或已选择的 BGS 数据为准；小型索引只存身份、来源、归属和关联，不再复制一套玩法规则。首版不建立全量 DesignRecord 知识库。
4. **允许验证所需的原型实现。** 尚未证明的手感、性能和平台假设可以进入明确标为探索的原型任务；不能因为“实现前要全部验证”禁止实现本身所需的验证。探索产物不得冒充正式交付。
5. **Gate 只证明实际检查过的对象和条件。** Schema、引用、构建、空间布局、目标运行时观察、专业 Review 各自记录覆盖与限制。没有输入、未执行或证据过期是未验证，不是通过。
6. **先做最小纵向切片，再迁移生产能力。** 不引入 FastAPI、Redis、Temporal、独立 Planner/Gate/Artifact 服务或每次任务一个容器的全套架构。跨进程领取确需补持久并发控制，但不重建身份、项目、计费和资源服务。
7. **成本治理不等于硬截断 Agent。** 不恢复默认 maxTurns 或固定 3/2/3 重试上限；预算仅在用户明确设置或平台真实额度要求时生效。取消、中断、无新增依据的重复派发仍须处理，不自动无限付费续跑。
8. **通用业务不指定游戏技术实现。** Web／React 直接使用项目代码与正常开发工具；Unity／Godot 使用引擎 CLI 和／或 MCP 操作真实工程。CLI／MCP 是引擎控制方式，不是所有路线必须通过的统一开发层。开发技术、发布平台和是否采用 BGS 内容编辑是三个不同选择。

“不再强制八文档”是明确的 V3 业务变化，不是当前代码已支持的配置项。不得只改提示词、把八文档门禁留在后台，再称迁移完成。

## 1. 审计范围、证据及版本边界

### 1.1 实际代码基线

本轮审计工作目录：

`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration`

分支：`codex/idea-to-playable-game-20261006`。包含大量既有未提交修改，以本轮实际工作树文件为准，不把 HEAD 当成全部实现。

本文所在的 `bee-game-studio` 仓库不是这批最新业务实现的源目录：其中没有同名 `project-delivery.ts`/`project-author.ts`。本轮以 62174 监听进程的 cwd 核对到上述 worktree；这只能定位运行入口，不能证明所有 CLI 构建与工作树字节一致。迁移前须另外记录服务版本、CLI 构建摘要和数据库版本，不能用“已经重启”替代版本核对。

下文源码路径均相对上述 worktree，定位优先使用函数名。旧方案 v1.0 已另存原始副本，本文为审计后替代规范。

### 1.2 已核查的能力

| 证据 | 真实实现 | 可以证明 / 不能证明 |
|---|---|---|
| S01 `packages/agent-workflow-server/src/beegame/project-delivery.ts`、`delivery/phases.ts` | author → review → resources → content → implementation → acceptance；公共入口推进、保存 | 六阶段已模块化；不是动态任务 DAG |
| S02 `project-author.ts`、`delivery/stages/planning.ts::preparePlanningAssignment/advancePlanning` | 五个写作批次覆盖八文档，最终技术整合；GDD 需当前完成结果和保存索引 | 固定八文档仍是业务约束；文件存在不能单独推进 |
| S03 `project-conversation.ts`、`app.ts::sendNativeProjectRequest` | 准备上下文、派发专业作者、解析结果、自动交接；同一会话继续 | 宿主并非“只发一条命令”；有实际调度、格式和业务门禁 |
| S04 `delivery/state-store.ts::withStateMutation/save` | canonical workspace 锁键、进程内 Promise 串行、临时文件 rename | 同进程写入可序列化；不是跨进程租约、事务和 fencing |
| S05 `session-manager.ts`、`native-cli-process-runner.ts` | 原生 stream-json、取消、权限、问题、会话恢复、子代理事件、用量快照 | 可以复用传输；服务恢复后的“recovered”不是旧任务仍在运行或自动安全续作 |
| S06 `src/beegame/native-assignments.ts`、`production-task.ts`、`author-skills.ts`、`src/query/stopHooks.ts` | 当前 BGS 特定写作/生产调度、原生子代理身份、Skill 预载、保存/读稿检查 | 存在原生集成耦合；V3 不应继续叠加 QueryEngine/StopHook 特判 |
| S07 `game-content-schema.ts`、`asset-contracts.ts`、`content-binding.ts` | Scene/UI 稳定 id、assetRef、资源清单、批量绑定与输入摘要 | 契约和绑定已存在；不要改成另一套 node_id/asset_ref |
| S08 `design-layout-check.ts`、`design-browser-inspection.mjs`、`packages/scene-editor/src/*inspection*` | 布局计算、实际字体/资源检查、保存 UI 批量渲染 | 几何和部分实际渲染可核查；不证明玩法、趣味、艺术品味或全交互闭环 |
| S09 `design-handoff.ts`、`project-content-authority.ts`、`delivery/design-protection.ts` | 文档/索引/保留证据版本；当前内容权威摘要汇总八文档及资源清单 | 有基线保护；不能据全局摘要推导每次局部修改的影响范围 |
| S10 `delivery/stages/acceptance.ts`、`runtime-acceptance.ts`、`deployment-manager.ts` | 当前报告、证据和被测文件校验；产品失败回实现；发布版本关联 | 可以复用保存证据和发布约束；模型所写 passed 与文件 hash 不证明每项行为真的正确 |
| S11 `session-usage-outbox.ts`、`session-manager.ts::getLatestRuntimeUsage`、计费服务 | 中断/累计计数、会计 epoch、计费幂等与待结算恢复 | 已有计费事实链；不能重建第二本独立费用账或漏算缓存 Token |
| S12 `docs/beegame-supabase-schema.sql`、`supabase-dashboard-store.ts` | Bun/TypeScript/Hono；已有 Supabase/PostgreSQL、项目/权限/存储/计费 | 项目 id 是 text；不是新建一个 uuid projects 表的空白系统 |
| S13 `packages/workflow-engine/src/engine/runWorkflow.ts` | 已有 JS 脚本编排、journal、resume；scriptChanged 会截断 journal | 当前项目交付入口未接入 runWorkflow；不能未经适配就称其支持局部 DAG 重规划 |

模块化测试证明部分边界，不能证明所有共享工具、状态及文件已绝对隔离。V3 必须按真实任务输入、写入和消费关系继续核对。

### 1.3 本轮验证结果

无付费模型、无生产数据写入的检查：

```sh
bun test \
  packages/agent-workflow-server/src/beegame/delivery/state-store.test.ts \
  packages/agent-workflow-server/src/beegame/delivery/stage-isolation.test.ts \
  packages/agent-workflow-server/src/beegame/project-delivery.test.ts \
  packages/agent-workflow-server/src/beegame/content-binding.test.ts \
  packages/agent-workflow-server/src/beegame/design-layout-check.test.ts \
  packages/agent-workflow-server/src/beegame/runtime-acceptance.test.ts
```

规范审计轮结果：83 passed、0 failed、562 assertions。覆盖当前同进程状态保存、局部恢复、绑定、布局与验收报告行为，不证明 V3 已实现、跨进程恢复安全或游戏语义完整。该审计轮仅修订本文；后续获授权的实施记录如下。

### 1.4 V3-01／02／03 实施记录

本次仅修改 BGS server 与配套测试／迁移；未修改 Claude Code 原生源码、真实生成项目、已有运行证据或部署服务，未调用付费模型。实现位置：`packages/agent-workflow-server/src/beegame/workflow-v3/{state,store,checks,execution,routes}.ts`；接线位于 `app.ts`、`session-manager.ts`，项目元数据适配保留持久模式标识。

| 项目 | 已落盘及验证 | 未完成边界 |
|---|---|---|
| V3-01 | 独立协议／原始需求快照／显式 V3 API；旧入口在保存、排队和调度前拒绝 V3 项目；关闭 V3 存储配置不能把已绑定项目静默改回 legacy；任务会话不覆盖用户 Chat | 前端 V3 入口和进度展示属于 V3-09，尚未接入；默认新建项目仍不改为 V3 |
| V3-02 | Run／不可变计划快照／Task／Attempt／检查结果；版本 CAS、单写者、fence 和重复请求身份；单进程本地后端合成验证；新增两张持久表和 host-only RPC 的迁移文件 | SQL 尚未在 PostgreSQL 执行；跨进程 CAS、同目录唯一写者及数据库权限必须实测，不能以本地 Promise 锁测试代替 |
| V3-03 | 通过既有 SessionManager 普通原生提交协议；不发送旧作者／生产字段；正常最终回复后退出写者，再运行宿主检查；原生事件／用量映射；真实 Question 答复按请求所属会话路由；取消保留部分成果，不自动重派；真实原生 CLI＋本机假模型→实际保存→宿主检查已通过 | 未测试付费模型生成真实游戏；Skills 实际使用归 V3-04 验证；运行时／工程包接线归 V3-06 |

新增接口均在 `/api/projects/:id/workflow-v3` 下：GET 当前运行、POST `/runs`、PUT `/plan`、POST `/tasks/:taskId/execute`、GET `/events`、POST `/stop`。`/runs` 绑定一个已有项目的真实 Chat 会话，并保留全文需求及结构化约束；计划引用宿主返回的需求 revision。首版 `expectedOutputs` 需要填写实际项目相对文件路径，不把逻辑名当成现存文件；计划只是数据，不执行模型提交的 JS。尚不支持旧生产项目自动迁移、已执行计划重写或失败任务自动重试。

宿主已连接 `artifact-json`、现有纯 `content-schema`、实际 `bun run build` 和 `bun run test:rules`。前两项只证明格式；后两项只证明实际进程与其覆盖内容，不能把作者测试全绿等同于确认需求被满足。缺文件、缺脚本、未接入的 `runtime-smoke`／`delivery-package` 返回未验证；测试驱动错误与产品失败分开记录。检查版本漂移不授予成功。

**任务成功不等于 Run 交付完成。** 当前切片 `deliveryEligible=false`；所有任务结束仍明确 blocked，并说明尚缺目标运行时和交付验收，不产生 accepted 或伪造交付报告。

迁移文件：`supabase/migrations/20261010010000_workflow_v3_vertical_slice.sql`。复用 text 项目 id；RPC 仅授予 service_role，执行前再次校验现有项目所有者；状态和不可变审计快照同事务保存。唯一部分索引按宿主 realpath 规范化目录排除跨项目别名写者；不会因超时放开旧写者。服务密钥仅留在宿主存储适配器，不进入原生 env、任务输入或返回结果。当前权限沿用已部署项目 owner 访问模型，不擅自扩大共享项目权限。

生产后端需要现有 Supabase URL 和宿主 service-role 配置以及上述迁移，配置不足返回 unavailable，不降级本地执行。本地开发须显式选择 `BEEGAME_WORKFLOW_V3_STORE=local-single-process` 或注入测试 store；它不是多 Worker 后端。服务重启后的旧 writer 活性展示 unknown，不启动第二个写者；未知写者恢复和完整外部副作用核对仍属 V3-08。

本轮验证记录：`docs/verification/bgs-v3-vertical-slice-2026-10-10.json`。核心 119 项及新增真实 V3 CLI 假模型链路 1 项，共 120 项通过、0 失败；相关原生适配器独立假模型回归另有 54 通过、2 失败。另有旧完整交付用例 4 项失败，经不改工作树的预改动加载对照仍同样失败；未靠修改期望把它们记为通过。真实 V3 CLI 首轮测试使用未被 SessionManager 转发的 ANTHROPIC_API_KEY，改为其既有 ANTHROPIC_AUTH_TOKEN 契约后通过；没有修改原生认证代码或付费重试。聚焦 state/store/checks 的类型检查通过；全量 typecheck 仍有跨包路径和类型诊断，不能宣称全仓库构建通过。

### 1.5 V3-04 及 V3-05／06 增量实施

本轮仍只修改 BGS 系统与合成测试；不改 Claude Code 原生源码、不改真实项目、不付费、不部署。没有现成的本机 PostgreSQL／Docker 执行环境，未连接生产数据库补做实验；V3-02 继续保留未验收。

| 项目 | 实际落盘与证据 | 保留的边界 |
|---|---|---|
| V3-04 | 独立任务上下文仅含原始需求一次、当前授权和局部来源指针，不附兄弟任务正文／历史；新增只读 `/workflow-v3/sources`，从既有任务、文件版本和检查导出索引，不维护第二份设计正文；Task 可声明 `skills:["bgs-builtins:gameplay-programmer"]` 等原生命名，明确要求调用，保存实际 Skill 工具成功／失败及子代理归属 | Skill 成功加载不证明正确运用；专业选择仍依赖任务规划与原生执行。目录发现、作者声称使用、调用失败或缺少工具完成证据均不能满足已声明的 Skill 要求；宿主不预载全部 Skill、不添加原生特判。索引中的 recordedChecks 是历史结果，不是对当前文件的新验收 |
| V3-05（部分） | `content-structure`／`content-layout`／`content-resources` 宿主检查连接当前 Schema、结构／层级、空间算法、成员选择及实际资源审计；读取当前任务文件和其显式 Camera／underlay 链，绑定关联场景、manifest 模块和资源成员实际版本；局部资源检查不要求其他资源任务交付，也不要求八文档 | 批量绑定的执行入口仍依赖旧 `projectContentAuthority`，尚未完成 V3 来源适配，不能勾整项。空文件／空资源范围、缺链接、TileSet 暂缺、world-space 无 screen 观测、provisional 资源保留未验证。检查不证明省略的需求／界面、实际字体、观感、声音或运行消费 |
| V3-06（准备修正） | 修正首构建入口：先实际 build，再检查产物；返回实际退出与产物版本，零退出而缺产物不能 passed；后续格式检查消费构建后的字节 | `runtime-smoke`／`delivery-package` 驱动仍未连接；没有以作者生成报告、脚本退出码或文件同名证明正式 JSON 实际被消费。Run 不授予交付资格 |

实现新增 `workflow-v3/context.ts`／`content-checks.ts`／`context-content.test.ts`；共享 `design-layout-check.ts` 增加显式局部文件参数，默认旧调用不变；`asset-contract-audit.ts` 增加显式局部资源参数，默认全量验收不变。这两项不是新算法，只把已有纯能力与固定文档／整项目政策分开。

验证：11 文件合成及共享消费者回归 147 passed／0 failed／933 assertions；真实 V3 CLI＋本机假模型 2 passed／0 failed／25 assertions，分别验证普通保存和实际 Skill→保存→宿主检查。聚焦 state/context/checks 类型检查通过。原生调用未修改 native query/tool/StopHook，也没有 authorBatch／旧项目原生任务字段。没有重跑生产 DB、付费游戏及全量 typecheck；§1.4 已记录的全量类型诊断和其他既有失败仍不能算已解决。本轮证据独立保存在 `docs/verification/bgs-v3-context-content-2026-10-10.json`，不覆盖上一切片记录。

下一步先完成 V3 批量绑定的来源／写入范围适配与真实输入版本回归，再接目标运行时和被测工程包消费链；SQL 需要隔离的真实 PostgreSQL 权限／并发环境。不得因此用空输入、伪造 PASS 或付费自动重跑填平缺口。

### 1.6 V3 批量绑定执行入口

本轮完成 §1.5 保留的绑定缺口。没有新增服务、数据库表或原生工具特判；复用 `content-binding.ts` 的批量校验／保护／逐文件提交。默认旧入口仍读取原八文档权威；V3 通过宿主函数注入实际任务来源与写入范围，不传空权威绕过验收。

Task 可选声明 `bindingPlan:"binding-map.json"`，表示授权宿主应用这个严格的 JSON 映射。映射和目标 Scene/UI 都须在 expectedOutputs，并处于 writablePaths；映射不得混入 Scene/UI 文档目录，验证任务不得用它修改游戏。没有 bindingPlan 的任务保持原行为，不强制每个任务或每份文件新增一个绑定步骤。

执行链：原生任务按当前文件 ID／哈希保存映射 → 正常结束并退出写者 → 宿主核对当前 writer／fence／plan → 调用已有批量绑定器 → 针对实际新字节检查 → 原子结算 Attempt。宿主按需提供当前任务的轻量绑定操作数，不复制全量几何、八文档或后台历史；没有再派一个绑定 Agent，也不在完成后要求模型另写总结。

来源保护包括原始需求版本、任务源文件、实际 Camera／underlay 关联文件、映射、manifest 模块和实际引用资源成员；绑定提交前核对版本，并沿用当前设计投影摘要，不能借资源绑定修改布局、坐标、颜色、相机或行为等受保护决定。原生任务直接改动原输入时仍拒绝接受；只有宿主已核对的绑定转换更新后续检查版本。Attempt 保留原输入哈希、实际写入／未写入／问题记录和新输出哈希；下游引用本次绑定任务输出，不继续以旧生产者哈希消费已变化字节。

逐文件提交不是整批事务。取消／源漂移／部分失败保留真实 partial 结果，不回滚、不自动重试、不宣布通过；重复 execute 请求不会再调模型或再绑定。未知旧写者恢复仍归 V3-08，不因超时解锁。局部检查不证明遗漏需求、整游戏资源齐备、实际字体／画面或运行消费。

验证：12 文件回归 157 passed／0 failed／985 assertions；真实 CLI＋本机假模型 4 passed／0 failed／54 assertions，覆盖普通保存、Skill、绑定、Skill＋绑定组合。新增反例包括错误计划、越界目标、旧哈希、受保护设计字段、丢失 fence、资源字节变化、Scene componentId、取消 partial 和同请求幂等；验证下游按新源消费且无关 UI 字节不变。聚焦 state/context/checks/binding 类型检查通过。完整游戏／费用优化效果仍未验证；未改 Claude Code 原生源码、真实项目、生产数据库或服务。证据：`docs/verification/bgs-v3-binding-2026-10-10.json`。

数据库在本方案中用于持久保存 Run／Plan／Task／Attempt／Check 与审计，并由事务、CAS 和 workspace 唯一约束防止多个 BGS 进程重复领取写作任务；不是第二套游戏设计库，也不提供模型判断或外部生成 exactly-once 保证。生产复用现有 Supabase/PostgreSQL，执行所列迁移，不要求用户本地另装数据库。明确的单进程本地开发可用文件存储；跨进程、数据库权限／迁移验收需要隔离的真实 PostgreSQL，可以使用现有测试实例，并非必须在本机安装。当前未执行生产迁移，V3-02 继续未验收。

下一步 V3-06：接目标运行时和当前工程包检查，证明正式 Scene/UI 数据确实被消费。旧独立 CLI 属 legacy 兼容入口，不是 V3 的权威旁路；不因绑定回归通过开放完整游戏交付。

### 1.7 实际静态构建、局部修订与恢复边界

本轮继续连接 V3-06，并落实执行中已暴露的局部修订缺口。没有改 Claude Code 原生源码、真实游戏产物、生产数据库或运行服务；没有调用付费模型，也没有新增服务、通用测试框架或数据库表。

| 范围 | 已实现 | 不能据此声称完成 |
|---|---|---|
| V3-06 运行冒烟 | Task 可选 `runtimeArtifact` 指向项目内静态 web 构建目录，须含 `index.html`；宿主启动现有独立 Chromium、通过 Node/pinned Playwright 加载被测文件，记录当前字节、1280×720 DOM/绘制容器存在性、脚本/console 错误、缺失资源与实际请求。外部请求、WebSocket 或无容器/文本为未验证；环境/驱动错误不算产品失败。取消后关闭自有脚本和浏览器 | 容器存在不证明实际像素/渲染内容。不支持 server/native/XR 驱动，不是已发布部署观察，不证明开始→游玩→结算、手感、音频、其他设备或正式 JSON 的语义消费。请求过 JSON 不能当作消费证明 |
| V3-06 工程包副本 | 读取现有 v2 index，核对 ID/路径/类型/startup 入口、已保存 Scene/UI 的结构与所引用资源闭包；源 JSON/manifest 模块/成员与构建副本须为相同字节。旧包、缺成员、无 registry、未注册 JSON 或检查缺口不能 passed | 不以作者填的 revision/hash 取得设计权威；未连接 VFX 资源闭包、编译转换映射、完整导出/安装与运行消费。此处 passed 只表示所述副本/结构检查通过，不开放 Run 交付资格 |
| 版本与结算 | Check 保存实际文件和目录摘要；文件修改、目录新增/删除及源 content 目录变化会使检查失效，结算前再次核对。Attempt 保留原始输入版本 | 不证明隐式 build 依赖全覆盖、外部写者不存在，或旧检查器版本可以继续使用 |
| V3-07 Question 基础链 | 真实 CLI＋本机假模型实际调用 AskUserQuestion；空答案保留等待，有效答案仅发给所属任务会话，并继续实际保存/检查 | 不是全部产品裁决闭环；finding/source revision 绑定、争议 Review/Repair 及其 UI 仍待完成 |
| V3-08 局部修订 | 显式 PUT plan 在无 writer 时核对旧实际 inputs/outputs/checks；只使任务约定变化、源版本变化及声明/已记录消费者失效，保留无关成功 Task/Attempt。`plans[].impact` 记录宿主推导的影响原因；不删除文件或历史，不派模型，不自动重试相同失败 | 仅现有 Task 声明和已记录检查输入的保守影响分析，不保证 Bash 间接读写完整；不是原始需求变更协议或未知外部操作恢复 |
| 分支与自修订 | 一个失败分支只阻断自己的消费者，无关就绪工作仍须新的显式 execute 请求。开发任务可读取并修订其 writablePaths 内、同时列为 expectedOutputs 的候选；检查使用新字节，Attempt 保留旧版本。验证任务不得改输入，bindingPlan 原生阶段仍须保持旧输入不变 | 不拦截原生工具，不证明所有越界写入都已观测；局部任务正常结束和格式通过不证明修复内容正确 |

Bun 进程内 Playwright CDP 连接在本机复现超时，而相同浏览器使用 Node 立即连接。因此沿用现有浏览器检查脚本的 Node 执行方式；宿主负责启动/取消/等待退出。Node 或测试浏览器缺失时明确 execution-error，不下载、不隐藏重试。静态资源由受控路由读取列出的构建文件，拒绝符号链接、目录越界及外部 HTTP/WebSocket 请求，Node 驱动不继承宿主密钥；这不是通用网络/执行沙箱。

局部修订不要求新 Agent、第二份知识库或源字段分类框架。计划尚有旧/未知 writer 时拒绝切换，不能靠超时或 PUT plan 解锁。迟到结果继续按现有 attempt/fence/plan 校验拒绝；相同计划保留失败状态。新的 plan 不能用旧 requestKey 冒充新执行，旧 attempt 保留可查但不再作为新请求的 202 结果返回。原始确认需求保持不可覆盖；改变需求的授权/版本协议仍待实施。

回归：14 文件合成/共享消费者 166 passed／0 failed／1051 assertions；真实 CLI＋本机假模型与 Chromium 14 passed／0 failed／132 assertions（7 个原生案例＋7 个浏览器/取消案例）。聚焦 state/context/checks/binding/runtime-checks 类型检查通过。全量 server typecheck 仍失败、含 3556 条诊断，本次日志无 workflow-v3 路径诊断，不据此称全仓构建合格。结果单独记入 `docs/verification/bgs-v3-runtime-revision-2026-10-10.json`，不覆盖前三轮证据。下一步仍是正式数据消费的实际条件→变化→观察证明、具体 finding/Question/Repair 闭环和恢复边界，而不是把静态加载或作者报告升级为完整交付。V3-06／07／08 清单保持未勾选。

### 1.8 持久暂停、恢复与派发前依赖核对

本轮核查发现三个具体缺口：`stop` 只取消当前执行、不保存人工暂停意图；消费者启动只依赖上游成功状态和部分输出 hash、未重核上游实际检查源与目录变化；合法自修订的旧输入快照会误使刚验收的新输出失效。本轮只修正 BGS V3 生命周期与有效性判断，不新增服务、数据库表或原生工具限制，不修改真实游戏产物或历史验收证据。

- 现有 POST `/stop` 先持久保存 `Run.paused`，再取消本 Worker 的原生执行和检查。空闲时也保存暂停；任务收尾、PUT plan 和本地状态重建不清除暂停。未知写者仍保留 lease/fence，并明确报错，不能靠暂停或超时解除。
- 新增 POST `/resume`，请求须含现行 `planRevision`。只有旧 writer 已确认结束才解除暂停；不自动派发，不把部分成果验收，也不重置失败任务。需要继续修复时，仍提交明确的受影响任务修订计划。
- 消费者派发前，只递归核对其已声明依赖及祖先的实际 Attempt、必需检查、输入、输出、检查源和目录摘要；检查资源变化或构建目录新增文件时，即使入口文件未改，也不能发起付费消费者。返回具体依赖和修复方向，不自动扫描重做无关阶段。此处不能证明未声明/Bash 隐式依赖完备，也尚未核对检查器实现版本漂移。
- 合法开发自修订/宿主绑定仍保留原输入快照，但当前有效性用已验收输出固定替换的同一输入；必须在明确的输出及写入范围内。以后再改输出仍会失效，只读输入和 verify 输入不因此放宽。
- 暂停与收尾竞争时，只在 CAS 冲突后重新读取并合并一次纯状态记录；重新校验 Run、plan 或 attempt/fence 身份。不会重跑原生任务、检查、绑定或文件写入；仍冲突则保留诊断/写者，不强行覆盖。

验证分别覆盖空闲暂停、重规划/重建保持暂停、失败成果不被 resume 重试、未知写者不解锁、两种暂停/收尾竞争、HTTP 版本校验、传递依赖失效、资源/目录变化和自修订误失效。真实原生 CLI＋本机假模型验证 AskUserQuestion 等待期间暂停：问题取消、迟到答复拒绝、用量保留且无新派发。完整 Review/Repair、正式数据消费、原始需求变更、跨进程/数据库与未知外部副作用恢复仍未完成，06／07／08 保持未勾选；交付资格仍禁用。

回归：15 文件合成/共享消费者 172 passed／0 failed／1114 assertions；真实 CLI＋本机假模型与 Chromium 15 passed／0 failed／152 assertions。聚焦类型检查通过；全量 server typecheck 仍失败，3556 条诊断，本轮日志无 workflow-v3 路径诊断，不能宣称全仓构建通过。

结果单独记录于 `docs/verification/bgs-v3-control-2026-10-10.json`。未调用付费模型、未部署/重启服务、未改 Claude Code 原生源码、未运行生产迁移。本轮使用既有 JSON 状态持久字段，不新增 migration；已有 V3 数据库迁移仍未在真实数据库验收。将来回退运行版时，不得把暂停 Run 交给不识别 paused 的旧 V3 执行器；先停用该执行入口，保留项目模式、状态与只读成果，不能靠回退清除人工暂停。

### 1.9 正式 UI 消费与来源绑定的 Review／Repair

本轮落实的是 §7 的后端交接与一个可实测的正式 UI 消费切片，不是全平台消费框架。复用现有 UI 空间算法、独立 Chromium、任务快照和 SessionManager Question；未增加服务、数据库表、原生工具规则或自动付费循环，未改真实游戏产物及 Claude Code 源码。

| 已证实缺口 | 最简单落地 | 尚不能证明 |
|---|---|---|
| 读取 JSON 或构建副本相同，不证明实现用到了布局 | `ui-data-consumption` 在目标静态构建上观察：原数据 → 单独位置变更 → 单独尺寸变更 → 恢复原数据。期待几何从正式 UI JSON 和现有算法推导，变更仅替换隔离浏览器的内存响应，不写源或构建文件 | 只检查代表节点的 DOM 几何；不是所有节点、遮挡、像素、字体、互动、Canvas、Scene、Tilemap、资源或音频消费证明，也不支持编译后映射 |
| 模型可能漏选画面、字段或视口，造成假覆盖 | 从 v2 registry 核对所有已注册 UI 文档，并核对源内 `targetViewports`；缺 probe、隐藏节点、不请求源、旧副本或变更低于可观察容差均未验证。位置与尺寸分开，部分消费或错误倍率失败 | 不能证明 registry 本身没有漏登记必需画面，也不保证一个代表节点覆盖整屏；覆盖限制随 Check 保存 |
| Reviewer 可以用一句声明或删除问题表示关闭 | 实际报告保存 finding ID、需求、所有者、源 hash／原文、下游影响和关闭条件；宿主核对真实绑定来源。旧 blocker 只能保留，或引用当前有效、获授权的修复及实际消费者证据关闭 | 核对引用不判断意见正确与否，不保证语义无漏检；绿色规则测试也不证明测试代表原始需求 |
| 修订可能扩大范围，或拿格式通过替代产品修复 | Repair 只承接选定 finding；写入范围按原审查计划的所有者授权核对，不按后来扩大后的范围核对。必要消费者检查实际执行、绑定新版本；纯格式／Skill 加载及用户答案均不能单独证明关闭 | 宿主不拦截每个原生工具，不保证 Bash 间接读写完整。没有可执行关闭证据的语义／审美争议需有权者处理，不能自动宣告修好 |
| Question／答复没有绑定争议来源，复核也可能看不到实际答案 | 使用标准 AskUserQuestion，header 为对应 finding ID；宿主在发问和答复时核对需求／计划／writer／fence／源版本。实际问题和答案保留到 Attempt，定向复核只收到相关修订证据与答案 | 不自动修改原始确认需求，不将用户沉默、过期答复或答案本身当作修复证明；新前端产品状态与需求变更协议尚未完成 |

执行方式仍为显式计划和 execute：审查发现阻断 → 一次集中修订 → 定向复核。可以复用原 owner／review Task ID 发布新 spec，分别用 `repairOf`／`reviewOf` 引用旧审查 Attempt；复核另存报告，不覆盖原报告。计划切换只使真实受影响任务失效，无关成功结果和历史保留。没有新增强制轮数、失败自动重试或全八文档重做；复核不能闭合时保留阻断并升级具体问题。

实际回归包括目标页面跟随 UI JSON 变化并恢复、忽略／错误倍率／仅消费单个字段、缺画面／视口、不请求源、旧副本与小于容差变化；报告伪造、漏掉旧 blocker、无有效修复、范围扩大、检查过期、纯格式“修复”、未答复／旧来源／暂停后的 Question。真实 CLI＋本机假模型实际执行 Skill、Read、AskUserQuestion、Write 和正常结束，宿主执行真实规则命令；Review／Repair／复核分别为三个独立原生会话，没有 legacy 作者／生产字段。

回归：16 文件核心／既有消费者 180 passed／0 failed／1163 assertions；真实 CLI＋本机假模型和 Chromium 27 passed／0 failed／216 assertions；共享 Question／会话 9 passed／0 failed／42 assertions。聚焦类型检查通过；完整 server typecheck 仍失败，3556 条诊断，本轮日志无 workflow-v3／session-manager 路径诊断，不据此声称全仓构建通过。

结果单独保存于 `docs/verification/bgs-v3-consumption-review-2026-10-10.json`，不覆盖历史证据。未做付费模型能力／成本实验、真实数据库／跨进程、部署或重启。V3-06／07 保持未勾选，Run 交付资格保持禁用。可回退 V3 路由／执行入口，保留新状态与报告；不把已含 review／decision 字段的 Run 交给忽略这些资格条件的旧 V3 执行器。

### 1.10 实际 Canvas／图片消费与前端任务控制

本轮仅推进有独立可观察证据的静态 2D 图像消费，不新建渲染引擎。新增可选 `pixel-data-consumption`，沿用当前 content Schema、manifest 成员／atlas 选择、Scene 相机与父层级投影、UI 布局、既有 Chromium 和实际构建入口。期待位置由实际保存的数据计算，不接受作者填 PASS 或预期矩形。原图 → 标记图 A → 标记图 B → A＋单独位置变更 → A＋单独尺寸变更 → 原图恢复；仅替换浏览器内存响应，源与构建字节不变。观察真实 Canvas 截图的像素区域和摘要，记录源／构建／成员／atlas 版本及覆盖限制。

缺注册图像 probe／目标视口、隐藏／不请求／没有可隔离像素、旧副本和不支持的对象均未验证；位置／尺寸字段被忽略或投影错误失败。父层级、相机位置、普通 Scene sprite、UI image 和显式 named atlas frame 已有反例回归。named frame 只证明当前选择的像素被实际绘制，不证明 atlas 元数据或 assetRef／member／frame 选择字段被动态消费。重复同图同 frame、旋转／着色／遮挡、Tilemap、3D、动画、字体和音频没有获得消费证明；没有图像的 Scene／UI 也不因此获得完整覆盖。该检查不是整屏美感、全部相机／层级字段或整游戏验收，不能开放交付。

前端复用现有鉴权 API 和 Chat 权限面板，新增轻量 V3 Task 视图：目标、当前版本、writer 活性、任务／检查／未验证项、全部 Attempt（含失败／中断）的宿主用量；实际金额未接入时显示未知。派发、持久暂停和解除暂停均为显式操作；解除暂停不执行任务，丢失响应的同一派发重试复用幂等键，不自动重试模型。无权、依赖未满足、writer 未解除或等待 Question 时不显示可执行状态，服务器仍独立核验授权和版本。

已证实 V3 Task 属于独立原生会话，普通主 Chat 事件不能保证通知其问题：V3 状态刷新同时刷新现有项目待答权限投影，继续由原 AskUserQuestion 面板及答复 API 发送真实答案，后端来源／fence 保护不变。新增面板不拉全工具历史；旧项目无 Run 时保持原 Chat，已持久为 V3 而数据库缺失则显示不可用，不静默降级。暂不把 V3 普通输入或停止按钮发送给 legacy 路径；此缺口在 UI 明示。V3 子任务事件聚合、Preview／编辑／导出、需求变更与初始规划 UI 尚未闭环，09 不勾完成。

回归：核心及既有消费者 180 passed／0 failed／1167 assertions；真实原生 CLI＋本机假模型／原 DOM 浏览器 27 passed／0 failed／216 assertions；新增实际 Canvas 浏览器 19 passed／0 failed／83 assertions；路由模式发现及共享 Question／会话 11 passed／0 failed／50 assertions；前端 jsdom 组件、Chat／权限／适配器 151 passed／0 failed。前端完整类型检查通过；server 仍有 3556 条既有诊断，本轮 workflow-v3 路径无诊断，不能宣称全仓构建通过。前端测试不是已部署 UI／真实用户或付费模型验收。

证据单独保存在 `docs/verification/bgs-v3-pixel-frontend-2026-10-10.json`，历史记录未覆盖。不改 Claude Code 源码、真实生成项目、数据库或服务；不付费、部署、重启。新增字段及检查只在明确声明的 V3 Task 生效；回滚时停用相应任务／前端入口并保留历史，不使用忽略新检查的旧执行器接受这些任务。

### 1.11 正式 Scene／UI 保存数据的只读前端查看

已核实旧 `/api/projects/:id/game-content` 读取仍要求 legacy 交付状态，并使用八文档 revision 权威；V3 已保存的正式 JSON 因此不能进入原有 Scene／UI 查看器。本轮修正这个实际读取断点，没有开放无来源保护的编辑，也没有另画替代 HTML。

- 现有 GET 先按 owned project、持久模式／实际 Run 和 canonical workspace 选择 V3；存储不可用仍报错，不落回 legacy。没有 V3 Run 的旧项目保持原行为。
- 新增轻量 `workflow-v3/content-view.ts`，直接使用已有 v2 registry 和 Scene／UI Schema。核对真实 ID／kind／path、读取当前字节并返回哈希；拒绝目录越界、路径别名和符号链接。只读 snapshot 的 `state=draft`、`readOnly=true`，明确不是通过／已交付，`documentRevision` 等旧索引字段不再冒充 V3 任务权威。没有 index 是等待内容；格式错误／缺注册正文不是等待或通过。
- 有未解除 writer／正在运行的项目原生任务时拒绝读取；读取结束核对字节及 Run 版本，避免把变动中的文件作为当前稳定视图。不写任务／文件、派发模型或补旧八文档；候选的只读显示不授予消费／交付资格。
- 原 Artifacts 文件选择、Scene editor 和 UI renderer 消费这一份保存 JSON。V3 明示只读，禁用保存和数据修改；菜单、快捷键、Inspector、拖动等仍受中心修改入口保护，查看／选中／取景／切换视口保留。旧编辑默认行为不变；服务端原有 V3 模式保护继续拒绝 legacy PUT／publish，不能靠前端禁用按钮代替授权核验。
- 未接通 V3 被测构建 Preview。现有 Preview Manager 会选择项目脚本／工作目录，不能据此证明当前所见就是 `runtimeArtifact` 的已测字节；未强行复用或改写游戏以适配路由。后续先复用现有鉴权和 sandbox iframe，明确被测构建身份、文件范围及 URL 基路径，再接预览；不以编辑器渲染代替目标游戏。

回归：BGS 核心／公开 HTTP 路由／已有内容与隔离消费者 127 passed／0 failed／741 assertions；前端 Scene／UI／Artifacts／Chat／权限／适配器 195 passed／0 failed；真实原生 CLI＋本机假模型 9 passed／0 failed／141 assertions。共 331 项，重复执行不重复计数。前端完整类型检查通过；server 全量仍有 3556 条既有诊断，本轮 workflow-v3 无诊断，不能称全仓构建通过。没有本轮真实浏览器画面／已部署 UI／付费完整游戏验收。

证据单独保存在 `docs/verification/bgs-v3-source-view-2026-10-10.json`。未改 Claude Code 原生源码、真实生成项目或历史证据；未付费、部署／重启服务、执行数据库迁移。没有新增持久字段或数据库表。09 仍不勾完成；完整编辑／导出、初始规划／需求变更、子任务事件和被测构建预览仍待落实。

### 1.12 已测静态构建的真实 Preview 与权限／撤销闭环

已证实的问题：旧 Preview Manager 选择项目脚本／目录，不绑定 V3 的实际 runtimeArtifact；路径前缀不能保持游戏的根路径模块／JSON／图片 URL，改写 HTML 又不再是原被测字节。因此不为此启动项目脚本或新服务，不注入桥接脚本；在现有 BGS HTTP 服务上使用专用预览域名，复用原 capability 权威和 sandbox iframe。

- 新增宿主侧 measured-preview，仅接受当前成功 Task／Attempt、明确的静态构建及宿主实际 runtime-smoke 检查版本、覆盖文件、目录摘要。复用既有依赖有效性核对，连同必要上游证据核对，不将模型 PASS、build 成功或 Schema 当运行证明。Preview 不写 Run／游戏文件、不派 Agent、不重新构建或复测、不授予交付／发布资格。
- 保存实际文件路径和检查哈希，读取时核对来源／构建／写者以及当前文件字节；返回原 HTML／JS／数据／资源，不作 SPA 回退或路由改写。拒绝构建外文件、未测文件、别名／符号链接及私有点路径。对预览主机上的所有路径先于 API／鉴权路由处理，只能返回已测静态文件或错误，不能进入宿主 API；仅 GET／HEAD／OPTIONS，无宿主凭据转发。
- 打开／状态／关闭使用项目原 API 下的 workflow-v3/preview。打开要求 project.read、preview.manage 和当前计划／尝试；同一有效测量重复打开返回原凭证。关闭按具体 Preview id，旧关闭请求不撤销新预览；迟到的打开请求不能覆盖较新的凭证。状态读取不派任务。源变化、写者出现、证据失效或显式关闭会撤销；服务重启后旧 URL 失效，用户可依据持久测量显式重开，不重放生产。
- 配置 BEEGAME_WORKFLOW_V3_PREVIEW_ORIGIN：开发例 http://localhost:62174（BGS 服务端口，不是 Vite 端口）；生产必须是独立 HTTPS 预览域名，通配 DNS／TLS／网关转发到同一 BGS 服务并保留 Host。不由客户端／Agent 指定任意地址、不依据 Forwarded 头选择上游。TLS 可在网关终止；未配置明确 503，不降级到 dev 脚本。配置示例已加入环境模板，未修改实际 env 或部署 DNS／网关。
- 前端从成功的已测 Task 显式打开，显示 task／attempt／构建路径／SHA-256 和覆盖限制。复用无 allow-same-origin 的既有 iframe sandbox；明确加载不等于验收，不用 onload 宣称游戏合格。显式重载／关闭、状态失效移除 iframe、项目切换／迟到响应保护均有回归。V3 模式确认后，主页面关闭旧脚本预览／发布／旧自动修复入口并提示任务面板；legacy 行为不因 V3 模式标记而改写。
- 回归发现并修复已有注册顺序缺陷：V3 路由和 legacy 模式保护先于统一鉴权，异步身份还未解析便误报 409。将原鉴权中间件移到这些路由之前，保留原公开 session-refresh／capability 边界；401／503 与真实模式冲突分别返回，不把任意错误改写为 v3-route-required。没有新增登录体系。

独立 Chromium 回归先实际执行运行冒烟，再将同一构建放入原 sandbox：根路径模块／JSON／图片加载、重载、父页面／storage 隔离与 API 隔离通过；正文返回字节与被测文件完全相同。合成案例覆盖源／构建变化、无关修改保留、中途 Run 变化、未知／活动写者、权限、缺测量、私有路径、别名、并发撤销及服务重启。真实原生 CLI＋回环假模型和已有 Review／Repair／恢复链仍是协议回归，不是模型判断力或真实游戏质量证明。详细结果和源码／日志摘要保存在 docs/verification/bgs-v3-measured-preview-2026-10-10.json，失败的探索记录不删除。

最终所选回归：V3／Preview 主回归 138 passed／0 failed，公共鉴权消费者 32 passed／0 failed，鉴权上下文 32 passed／0 failed；按文件和用例去重为后端 183 项。前端所选 7 文件 146 passed／0 failed，共 329 项独立用例，重复执行不重复相加，不以数量证明整游戏质量。前端类型检查通过；server 仍有与上一轮相同的 3556 条全仓既有诊断，本轮 app／workflow-v3 无新增诊断。

边界：本轮未部署／重启服务、执行真实数据库迁移、付费调用或修改真实生成游戏；未进行完整 Dashboard 真浏览器交互、目标移动端／触控／音频／游戏全流程验收。扩展回归中的旧 BeeGameLivePreviewPage 测试仍存在头像 data-state 预期与当前组件不符及 jsdom 无 Path2D 的失败，单独保留，不称全仓测试通过；server 全量既有类型失败也不伪装为已消除。单文件读取重复核对整条已测依赖会有宿主 I/O 成本，未做缓存性能承诺；本链不产生模型 Token。没有新增 DB 表或持久 Preview 状态。

下一纵向闭环：按已测版本导出，再把预览中实际观察的问题接回现有有权 Review／Repair 和定向复测；不借预览可见就放开发布，也不把旧 Chat 自动修复接回 V3。完整编辑／初始规划／需求变更、子任务事件、目标运行覆盖和真实数据库边界仍按清单保持未完成。

### 1.13 已测静态包导出与 Preview 观察的有权闭环

本次针对两个实际缺口：旧工程导出打包整个工作区，不保证与测量对象一致；Preview 观察没有进入现有的来源／所有者 Review／Repair。采用既有 HTTP 路由、Run JSON、计划和原生任务，不另建问题数据库、模型审计服务或循环框架。

- **导出**：`POST /api/projects/:id/workflow-v3/export` 接收 `{taskId,attemptId,planRevision}`，要求当前用户拥有项目、`project.read` 和 `project.export`。不要求 `preview.manage` 或模型权限，不依赖活跃 Preview 凭证／配置。与 Preview 共用实际测量选择及文件覆盖核对；ZIP 中只含 `build/` 原被测字节和 `measurement.json`。回执给出尝试／目录摘要／文件哈希、实际运行冒烟覆盖与限制，不复制私有来源、原始需求、凭证或主机状态。必须以 HTTP 的 build/ 为根目录运行，不承诺 file:// 可用。这不是可编辑工程包，更不是完整游戏验收／发布授权。
- **一致性**：导出期间源／构建／目录成员变化、符号链接、私有点路径、未覆盖文件、未知检查版本、活动写者或 Run 版本变化均不返回候选 ZIP。包先完整收集核对再返回，没有一半文件已下载后才失败的流式假成功。复用现有 BGS ZIP32 写入器，路径标明 UTF-8；超出 ZIP32 能力明确失败，不截断。本实现仍有内存收集及宿主 I/O 成本，未承诺大包性能或安装兼容。
- **观察**：`POST .../preview-issues` 保存 `{requestKey,taskId,attemptId,planRevision,artifactSha256,requirementIds,steps,expected,observed}`。只关联实际当前测量和已确认需求；用户描述是观察，不是可信缺陷、新增需求或指令。记录追加到既有 Run JSON，不写游戏源或新 DB 表；同键同内容幂等返回，不同内容拒绝，暂停／重启保留历史。此操作要求原有 `agent.send_message` 项目变更权限，但不派模型、不修源码。
- **定向 Review**：`POST .../preview-issues/:issueId/review-plan` 只准备独立 verify 任务和局部计划变更，执行仍需用户另点现有 Execute。读取测量实际输入与当前源，只给绑定源的真实所有者指针，不携带兄弟任务正文／历史。`previewIssues:["<已保存 UUID>"]` 为可选 Task 关联；报告另存 `observations:[{id,disposition:"finding"|"not-reproduced"|"out-of-scope",findingIds:["F1"],reason}]`，每项必须有明确处置和依据。未复现不是已修好；不能遗漏观察或用无来源的用户断言代替 finding。finding 仍要求原文／哈希、确认需求、实际所有者、影响、关闭条件和实际检查。Review 的当前测量也成为 check 的输入和目录摘要，审查期间新增文件不会漏出版本核对。
- **有权 Repair／复核**：`POST .../preview-issues/:reviewAttemptId/repair-plan` 接收当前 `planRevision` 及 `findingIds`，只准备选定 blocker 的原所有者集中修订和一次定向复核。不扩大原计划权限，源／报告变更或 owner 合同变更时要求明确重新授权。没有可信审查不能据用户观察直接 Repair。依赖真实受影响时，原测量消费者按已有依赖机制等待重测；无关成功任务保持不变。原 owner、重测、复核均独立显式 Execute，不自动循环或付费。涉及需求裁决仍调用原 AskUserQuestion，保留实际来源绑定及答案；关闭仍要求当前有权修订、实际消费者检查和新源。复核失败保留问题并升级，不自动再准备下一轮；有权用户仍可通过既有局部计划协议作新的明确决定，不是新增原生轮数限制。
- **前端**：已测任务提供独立导出权限按钮；Preview 内填写复现／预期／实际，仅保存观察。任务面板展示原版本、观察处置、所有者、阻断与关闭证据，明确区分准备任务和执行。保存／准备／状态刷新／下载均不调用 Agent；仍使用现有问题面板。旧 Chat 自动修复／发布没有接回 V3。

回归及源码／日志摘要单独保存到 `docs/verification/bgs-v3-export-feedback-2026-10-10.json`。覆盖原字节 ZIP／不泄露工作区、独立权限、版本／目录／别名变化、CAS／幂等／重启读取、遗漏观察和旧报告拒绝、有权 Repair／重新测量／定向关闭、无关成果保留及显式操作无派发。真实 CLI＋本机假模型实际执行 Preview 观察 Review、Skill、Read、Question、Write、宿主规则命令和静态构建重测；仅证明协议链，不证明真实模型语义／审美判断和真实游戏品质。

保持 `deliveryEligible:false`，06／07／09 不勾整项完成。未改 Claude Code 源码或真实生成项目，未付费、部署／重启服务或执行数据库迁移。真实 DB 的持久竞争／恢复、完整 Dashboard 真浏览器下载与交互、可编辑源码工程导出、目标平台和整游戏验收仍待验证。已有 server 全量类型失败及旧 BeeGameLivePreviewPage 的 jsdom／头像测试失败不由这轮掩盖。

### 1.14 可编辑工程导出：实际源码副本构建与已测字节一致

已证实缺口：原 build 只绑定任务声明的输入；未声明源码、资源或配置不在这份证据内。直接将当前工作区加进 ZIP，不能证明它生成了已测构建。最小方案是可选的源码副本构建与原测量复用，不新建导出任务框架、快照数据库或模型总结阶段。

- **授权与构建**：开发 Task 显式声明 `editableProject:true`、`runtimeArtifact:"dist"`、`checks:["build","runtime-smoke"]`，并具有完整 `dist/**` 写权限。宿主枚举工程实际可导出文件，不让作者选择一份遗漏源码的清单。排除旧构建、`.git`／`.beegame`／私有点文件、`node_modules`、宿主保留的根 `transcripts/`、`logs/index.json`、`logs/runtime-diagnostics.jsonl` 及其数字编号轮转档，和计划中实际保存的 Review 报告；保留其他 logs 文件及 `.gitignore`／`.editorconfig`／`.browserslistrc`。从这些原字节的临时副本执行既有 `bun run build`，不继承宿主密钥、不自动安装依赖。缺少 package script 或依赖锁文件、依赖别名逃出项目、构建修改源码或需要被排除的私有配置，明确失败／未验证，不能宣称可编辑工程已测。
- **依赖及安装**：已有项目内 `node_modules` 可作为单独摘要的实际构建输入链接给源码副本，要求保留锁文件；依赖不进入 ZIP。记录 Bun／Node 兼容版本、平台及架构。前后核对源码集合与哈希、依赖摘要和构建副本；只将成功候选原字节替换到已授权构建目录，不合并旧文件。取消或发布前失败保留原构建；无法恢复旧构建时保留备份，不删掉唯一旧成果。随后按既有顺序对同一构建执行真实运行检查。
- **保存与下载**：既有 CheckResult／Run JSON 保存宿主 `v3-editable-build.1` 来源清单、构建摘要和排除报告路径，无新 DB 表。`POST .../workflow-v3/export` 可加 `kind:"project"`；省略保持原静态导出行为。工程导出必须是当前成功 Attempt，具有实际源码副本 build 和同摘要 runtime-smoke，且当前导出源码、安装依赖、被测构建及 Run 版本未变。ZIP 为 `project/` 下原源码、数据、资源、package／锁文件和原路径已测构建，加外部 `measurement.json`（文件哈希、运行版本、运行方法及限制）。下载只核对／打包，不重新构建、不执行 Agent、不写 Run。
- **局部影响**：完整源码枚举只服务这项构建来源及工程导出，不将它添加为所有任务的全局失效条件。未声明源码变化会拒绝冒充已测工程包，但不自动重派无关任务或删除既有成功记录；未变的原静态测量仍按原资格可读／导出。新增的真实 Review 报告可排除；若该路径原本属于实际构建源码，不得借改名为报告隐去已测源。旧测量缺少来源证据时只保留静态包资格，显式重建重测才取得工程导出资格。
- **前端与权限**：原任务面板新增“导出可编辑工程”，只对实际来源证据显示可操作状态；仍要求原 `project.read`／`project.export`，不要求 Preview 或 Agent 执行权限。向受信任跨域 Dashboard 暴露构建摘要／包类型响应头，不扩大原 origin 白名单或暴露凭据。写者、来源变化和错误包类型明确提示，无静默降级、自动重建或模型请求。手工编辑／重构建后产生新未测版本，不能继续沿用旧测量资格。

验证记录单独保存在 `docs/verification/bgs-v3-editable-export-2026-10-10.json`。合成工程实际经过源码副本构建、浏览器测量、ZIP 解包重建和编辑重建；验证字节一致和编辑后构建摘要变化，同时覆盖未声明源增删改、隐藏配置、源变更、取消／别名、旧构建残留、依赖／锁文件、旧测量拒绝、权限／Run 版本／重启读取和下载无派发。保留原 Review／Repair、真实 CLI 假模型及 Preview 共享回归，不以合成例证明模型规划、完整游戏品质或全新安装环境兼容。

真实 CLI 回归最初失败：BGS 将 Chat 及诊断写在工程根 `transcripts/` 和 `logs/`，初版枚举误将其纳入源码。依据 SessionManager 的实际保留路径修正排除，不放宽断言、不重写原日志；再次真实 CLI 回归证实源码包不含这些记录。源码扫描仍保留非宿主日志文件，不泛化删除同名业务目录。另据真实 app CORS 核对修正响应头可读性；未知 origin 仍不能读取授权响应。

最终选定回归 310 个不同测试通过：后端 V3／共享 Preview 158、前端相关面板／原查看器 151、既有 canonical 工程导出 1；定向重复运行不累加数量。前端类型检查通过；server 全量仍失败，3556 条诊断与上轮逐行一致，无新增／移除，不宣称全仓类型检查或全部测试通过。

边界与回退：仅静态 Web 工程；这是实际输入字节与构建／测量身份链，不是 OS／网络隔离、全依赖安装验收或位级可复现保证。仍有全源／依赖扫描及内存 ZIP 成本，不新增轮数或用量硬限制。可关闭工程下载和新 opt-in，保留原静态导出及已保存来源；旧执行器不能忽略新 Task 字段后声称其完成源码副本构建。未改 Claude Code 源码、真实生成项目或历史证据；未付费、部署／重启、迁移真实数据库。完整 Dashboard 真浏览器下载、数据库竞争／恢复及完整目标平台／游戏验收仍未验证，`deliveryEligible:false` 和 06／09 整项未完成保持不变。

### 1.15 正式编辑与用户授权需求变更

本轮不将编辑保存等同于任务通过，也不自动派模型修订。复用既有 Scene／UI 编辑器、单写者 CAS／fence、原 Task/check 和源码副本构建；未改 Claude Code 原生源码、真实项目或历史证据。

- **正式编辑**：`GET .../game-content` 对具备 `project.create`／`agent.send_message` 权限、有当前开发所有者的正式注册 JSON 返回 `editing:{version,planRevision,requirementsRevision,paths}`。无权或无所有者仍只读。原 `PUT .../game-content/document` 接收 path、旧文件 hash、编辑后完整 JSON 和 workflow 版本；V3 不进入旧八文档／delivery 保存权威，也不开放旧 publish 等写入口。保存限定现有注册 Scene／UI 的 id／kind，拒绝路径／别名／hardlink、源变动、过期版本和未停止写者。
- **先失效后保存**：一次 CAS 先保存受影响计划资格失效及宿主编辑 writer/fence，然后保留原 JSON 到 `.beegame/workflow-v3-edits/<attempt>/before.json`，原子替换候选，最后持久化实际保存状态并解除写者。宿主编辑 Attempt 标明 saved／failed，不伪造 native Skill、用量、任务成功或测量。无变化保存不重做任务。取消／失败不盲回滚候选；资格已经失效，中断或收尾失败留下未知写者，不因超时解锁。数据库和文件系统不是一个事务，此处保证失效先于写入，不承诺跨系统原子提交或自动恢复。
- **影响范围**：保留任务显式依赖和已记录输入，并纳入 `projectBuild.files` 的实际源码副本构建输入。局部 JSON 保存重新授权所有者和实际受影响消费者；无关任务历史／成功不重做。宿主不证明 Bash 隐式依赖完备，也不静态推断源码语义。受影响的运行测量须有当前 `editableProject` 实际源码副本构建祖先；不满足时保存前提示修订任务权限，而非沿用旧静态输出复测。
- **需求变更**：`POST .../workflow-v3/requirements` 由项目有权用户显式提交 `expectedVersion`、`requirementsRevision`、幂等 requestKey、新全文 requirements 与有权 tasks。自动规范化原 requirement 输入中的版本指针，不猜新增写入权限。原始需求和每次 before／after、actor、时间追加保存，禁止覆写历史。重复同键只能确认同一需求／任务范围，不自动执行。旧版本的 repairOf／reviewOf／Preview finding 引用不能授权新范围，需当前普通任务／Review 计划。
- **新版本必须新证据**：目前每个任务看到整份确认需求，所以全文需求变化使当前任务资格全部失效；不能声称任意语义变更都局部。文件局部编辑则按实际影响失效。所有旧 Attempt／check 保留为历史；新需求不能用旧虚拟 requirement 输入或无需求版本的旧结果满足依赖。编辑后执行有权任务及实际源码副本 build，再运行当前 runtime-smoke／必要消费者检查，才获得新 Preview／静态和工程 ZIP 资格；构建字节完全相同也需要新需求版本的实际执行及测量，不复制旧 PASS。
- **前端**：现有 Scene／UI 保存带当前版本，成功更新版本指针，显示“候选、待重建测量”。任务面板有显式新需求确认表单及历史；高级 JSON 计划需用户核对范围，无自动规划／派发。历史宿主编辑标为无模型调用，不把缺 native transcript 当错误或虚假模型 Token。过期保存／变更提示刷新，不覆盖正在编辑的草稿、不静默重试或回退 legacy。

证据单独保存于 `docs/verification/bgs-v3-authorized-edit-change-2026-10-10.json`。合成项目通过正式 HTTP 保存、真实源码副本构建／Chromium 测量、旧 Preview／导出拒绝、重新测量与工程导出、无关任务保留、漏声明但实际构建输入的失效、中断 writer／暂停保留、需求历史／CAS／幂等／权限。真实 CLI＋本机假模型通过需求确认→新任务读写→宿主实际构建／测量→同版本工程导出；假模型只证明接线，不证明语义／趣味或所有用户需求均已正确实现。旧结果没有自动升级资格。

迁移文件：`supabase/migrations/20261010020000_workflow_v3_authorized_changes.sql`，替换既有 host-only commit RPC 以允许严格追加授权需求变化；不新增表、不改旧迁移。生产需求变更须先应用并实测该迁移，缺迁移应明确失败，不回退本地。SQL 未在真实 PostgreSQL 执行，跨 Worker 竞争／未知操作恢复未验收。关闭编辑／变更前端和新入口可回退，保留历史和候选；旧版本不得清除未知编辑 writer、沿用旧测量或把新数据静默切到旧交付流程。首次规划／普通 Chat 创作变更、部署后完整 UI、全目标运行与整游戏验收仍未完成，`deliveryEligible:false` 和 08／09 整项未勾选保持。

### 1.16 真实数据库与本地运行版部署预检（未完成验收）

本轮连接现有远端 Supabase REST，使用宿主凭据进行只读发现。REST schema 未暴露两张 V3 表及两个 RPC；逐对象读取返回 `PGRST205`／`PGRST202`。这是数据库对象／schema cache 不可用的实际证据，不足以断言 PostgreSQL 内部一定没有对象。没有 SQL 管理连接、数据库密码或管理 API 凭据，尚未执行迁移；service-role REST 密钥不是 DDL 执行凭据。未改真实项目，也未用本地 store 冒充真实数据库。

实际部署核对发现并修正：两个开发启动器沿用旧规则删除宿主 service-role 配置，导致 V3 远端 store 无法构造。现在可信 BGS 宿主持有该配置，普通请求仍使用原用户 RLS／RPC；前端环境移除密钥，原生启动入口同时移除继承及误传的两种 service-role 变量，源码副本构建仍仅使用原有最小环境。不授权把可信宿主配置发布给用户运行的客户端。扩展回归另发现模型日志仍读取旧名称，已让 BGS 日志识别现行 `BGS_DEFAULT_*_MODEL`，不改变模型选择。

新增只读命令 `bun scripts/check-workflow-v3-database.ts --env-file <宿主环境文件>`：只输出必需 REST 对象缺失情况，不显示凭据、不执行 DDL、不写项目、不派模型。表／RPC 名称存在也不证明同名替换 RPC 的第二份迁移、权限或竞争正确；这些始终标为未验证。commit 的缺 schema 错误明确列出两份迁移，授权需求变更被拒绝时同时提示核对迁移与追加历史，不能误判为模型问题或自动重试。

已启动本机当前工作树的 BGS 后端、Vite 前端、计费及技能服务，四个 HTTP 健康入口为 200；浏览器仅核对首页正常加载。不是生产域名部署或完整编辑验收。资源 worker 启动会自动恢复既有队列，因此本轮未启动它，不触发无关资源生产。未重建 CLI，不改 Claude Code 原生源码。迁移完成前不创建真实 V3 验收项目、不派发付费模型、不勾选 V3-02／08／09。

下一步顺序固定为：用有权 SQL 管理入口核对对象／迁移历史 → 仅执行缺失的 `20261010010000`、`20261010020000` 迁移并刷新 PostgREST cache → 实测权限、两连接 CAS 和同目录单写者 → 独立项目通过正常 API／编辑器修改 → 核对旧 Preview／导出资格失效 → 有权任务真实重建及测量 → 新版本导出与刷新后的历史核对。缺管理权限是明确阻塞，不添加第三套存储、通用迁移框架或虚假通过记录。

本轮证据：`docs/verification/bgs-v3-database-deployment-preflight-2026-10-10.json`。相关回归 131 passed／0 failed（84 项部署/权限环境/接口回归，47 项编辑、需求变更、实际源码副本构建／Chromium 测量／导出回归；重复运行不重复累计）。真实数据库迁移、跨 Worker SQL 竞争、部署后完整编辑／需求变更仍未验收，`deliveryEligible:false` 保持。

### 1.17 真实数据库迁移执行与核验

经用户当次确认，通过 Chrome 已登录的 `bgs.phantominfra.com/project/default` SQL Editor 执行两份 V3 迁移。先用 `to_regclass`／`to_regprocedure` 确认目标对象确实不存在；该自托管实例也没有 `supabase_migrations.schema_migrations`，不擅自创建新迁移框架或伪造标准 CLI 历史。两份原迁移按顺序分别返回 Success，每份原有事务保持完整；实际粘贴 SQL 的 SHA-256 与本地文件完全一致。没有修改旧 SQL 查询、既有项目记录、游戏文件或计费数据。

数据库实际函数 `prosrc` 的 MD5 与迁移中的函数正文一致：read 为 `b9df094bc07b6b9a7ea61f65e4ce12f8`，当前 commit 为第二份迁移的 `67777dc73615da652aea0a9d389f3323`。14 项结构/权限核验全部 true：两表 RLS 开启、无客户端 policy、anon/authenticated 无表访问及 RPC 执行权限、service_role 有 RPC 执行权限、SECURITY DEFINER 与限定 search_path 正确、唯一部分索引有效、两表均为空。发送 PostgREST schema cache 刷新通知后，远端只读结构预检必需对象缺失数为 0。

额外真实 REST 核验：宿主调用 read/commit 并指定不存在的项目均返回 403／42501 `workflow_project_forbidden`；匿名调用两 RPC 和读取两表均返回 401／42501，宿主只读两表返回 200 空数组。没有通过管理员制造成功 Attempt，没有向真实项目写入测试数据。核验查询首次使用了错误的字符串连接运算符，查询失败后改为 PostgreSQL `||`，重跑 14 项全部通过；这不是迁移执行失败，历史证据如实保留。

证据：`docs/verification/bgs-v3-database-migration-2026-10-10.json`，浏览器截图 `/private/tmp/bgs-v3-database-migration-verified.png`。本轮不改系统/Claude Code 源码，不调用模型，不重启服务。迁移、函数版本、结构权限及 REST 访问边界已验证；成功 Run 的 SQL 事务、两连接 CAS／单目录写者竞争、未知写者恢复、部署后真实编辑／需求变更→重建→测量→导出仍未验收。它们不能因迁移成功而自动算通过，V3-02／08／09 整项不勾，`deliveryEligible:false` 保持。

### 1.18 真实数据库竞争及已运行界面编辑／需求变更验收

本轮以用户已登录 Chrome 的正常项目入口和现有远端数据库继续验收。仅新建明确标记的合成项目／源文件，不手工修补既有游戏；基线由宿主真实构建及 Chromium 加载建立，明确不是模型生产／游戏品质验收。其后 UI 编辑、需求确认和任务执行均走正常 BGS 入口。

**数据库缺陷及修复**：真实双进程 CAS 的落败请求没有及时返回。核对两份迁移发现业务版本冲突使用 SQLSTATE `40001`，这是可重试的序列化失败，不是不可重试的业务冲突。追加 `20261010030000_workflow_v3_conflict_http.sql`，仅将既有 commit 函数该分支改为 `PT409`，不更改历史迁移、访问权限或业务数据。Chrome SQL Editor 实际执行，核验新错误码、旧错误码移除、host-only ACL 三项均成立；官方 PostgREST/Supabase 文档说明同类自动重试问题，但未据此猜测本实例服务版本。

修复后真实两个独立 Bun 进程／HTTP 事务通过 11 项断言：两次相同版本 CAS 均只一个胜者，落败明确 HTTP 409／PT409；同目录不同项目写者竞争只一个胜者，落败无半条 Run／事件；Run、事件及项目模式原子保存且独立重载一致；授权需求历史仅能追加，覆写被拒且当前版本未改变。写者合成任务未启动工作，明确结束为 blocked，不制造 PASS。失败尝试与所有合成记录保留。该证据不证明未知原生进程或外部付费操作可安全恢复。

**前端恢复缺陷及修复**：URL 直接恢复仅设置本地 activeProject，没有像历史项目点击一样恢复宿主 Chat 绑定。复用原 `openProject`，绑定完成后再暴露选中项目；等待期间切回首页／换项目不得由迟到结果重开。没有另建登录或会话协议，未改 Claude Code 源码。

**已证实编辑闭环**：正式 UI 编辑器将合成按钮高度 52→64，保存显示未测量候选，受影响 game 任务待执行，无关任务仍保留原成功 Attempt。正常付费原生任务保存候选后，宿主独立源码副本 build／Chromium 冒烟成功，生成新 Attempt `3618752a-c835-4d8b-8928-b38ce6eef2cf`；构建摘要从 `f3616d2cab1a27afe97855827909425e902dd6de1701fb85d1ddd15c5400b76b` 变为 `c459671b1ca1962ddeecf10c6f33ae2b6a0cc9ae62f52fc5ea73bda7346a2634`。真实 sandbox Preview 测得 200×64，点击输出 Clicked。旧资格从界面撤除；独立直访旧预览被浏览器客户端阻断，因此本轮不据该直访声称服务端错误分支已实测。

两类 ZIP 通过正式按钮实际下载，自动化 download 事件超时并不等于下载失败；只读取对应本地文件，核对源码包 11 个文件与静态包 4 个文件全部摘要、Attempt 和构建身份一致。解包可编辑工程后真实 `bun run build`，产物与下载的已测静态包逐文件一致。仅重建导出的独立副本，未改验收工作项目。

需求变更经正式表单确认全文和原有任务范围，计划版本 3→4、需求版本更新，旧资格全部失效且没有自动派模型。正常执行 game 任务修改标题及主标题为 Changed Goal，保留高度 64 及 Scene/UI JSON，宿主重新构建和 Chromium 测量成功；后续界面、工程下载、重载及原始历史核对的最终证据单独记录，不用作者的自检声明替代。

最终闭环又发现：独立记录任务合法更新了 `notes.json`，该文件属于实际工程源码副本，因此旧工程资格被服务端正确拒绝。初始合成计划遗漏它与后续构建的真实先后依赖；前端又没有仅修订计划的恢复入口，不能为恢复而虚构需求变化。复用现有 `PUT .../plan` 补显式任务计划表单：确认当前 plan／requirements 版本及任务 JSON，只撤销受影响资格，不改需求、不派发。真实界面补正已证实源码依赖后，game 待执行，记录任务仍保留原成功 Attempt；正常执行获得新构建／测量 `f3e98340-dfa5-45bd-9065-56466fe2a3fa`。没有添加针对 notes 或本案例的排除规则。

最终 Preview 实际显示 Changed Goal，按钮 200×64 且点击输出 Clicked；构建摘要为 `de815d731d98e64c601aca20c85465299d7235eef4a65abfec2468613f5d5e2b`，与前一需求构建字节相同，但新 Attempt 确实重新构建和 Chromium 测量，源码记录已更新。正式按钮下载的工程包 11 文件摘要全匹配；解包真实重建后所有已测输出摘要不变。暂停→真实 Chrome 重载→解除暂停保留需求历史、计划版本 5、8 个 Attempt 及两任务资格，不增模型调用。远端重载 Run version 为 23。

回归：V3 后端全目录 144 passed／0 failed／1159 assertions，前端路由／App／WorkflowPanel／已测 Preview 最终 52 passed／0 failed，前端 `tsc -b && vite build` 成功。首个前端分组曾因 jsdom 没有 Path2D 出现未处理错误，不能算通过；在路由测试中隔离无关动画模块后重跑无未处理错误。真实付费执行发生过原生 Bash 中 bun 读取 cwd 失败及浏览器不可用，作者额外探索／桩检查造成成本；宿主实际 Chromium 证据另行保存，不据此宣称原生沙箱或用量问题已解决。4 次正常原生任务共记录 1,327,857 Token，其中 cache_read 1,170,424、非缓存 prompt 143,837、completion 13,596；实际金额未知。小型维护任务仍反复探索和自检，不能声称用量已达标。

最终证据保存在集成工作树 `docs/verification/bgs-v3-database-deployed-acceptance-2026-10-11.json`，含真实 SQL、并发、编辑／测量、下载重建、恢复日志及截图摘要。正式 Scene 编辑器的真实保存交互本轮未另外执行；实际 Canvas 消费和保存接口由回归覆盖，不用 UI 编辑成功替代所有 Scene 交互覆盖。

不改 Claude Code 原生源码，不改现有游戏，不删除失败证据，不重启数据库、不终止未知原生进程、不启动无关资源队列。仅本地运行版界面与远端数据库，不是生产域名游戏发布。保持 `deliveryEligible:false`；完整游戏品质、普通 Chat 自动初创／变更规划、未知写者／外部操作恢复等边界仍未完成。

### 1.19 前端修改范围纠正与检查器版本时效

用户明确要求：恢复上一轮扩大的 frontend 修改；后续系统实施可用独立 debug 页面、脚本及后端回归，不再顺带改正式界面。此要求优先于文档中的前端接线清单，不以“测试通过”代替修改范围授权。

- 撤回上一轮 `projectStore` 的公共 URL／Chat 恢复和导航逻辑及配套测试；撤回 `App.test` 中新增的动画 mock。这三个 tracked 文件当前与各自 Git 基线无差异；其他既有前端修改不整文件回滚。
- 撤回 `WorkflowPanel` 新增的“修订任务计划”入口及双模式表单，恢复原需求变更行为；撤回 `workflowV3Api` 的 `/plan` PUT 特判和新增测试。后两份文件的摘要与 §1.15 保存的此前摘要相同；不删除此前已经存在但未提交的 V3 文件。
- §1.18 的正式界面验收、截图和结果保留为历史证据，不覆盖；其中 URL 自动恢复修复和局部计划新增表单**不再是当前实现**。后端现有 `PUT .../plan` 保留，未改 DB、真实项目或旧测量。URL 恢复差异另列待处理，不通过改公共导航补齐本轮验收。后续接线须先明确必要性及正式界面影响并取得用户确认。

继续实施 V3-08 的已登记缺口：`checkIsCurrent` 原先只检查输入／构建字节，没有核对驱动版本。合成案例在文件不变而检查版本过期时，消费者依赖检查仍成功；修复前回归明确失败，非凭推测新增机制。

最小修复使用一份显式检查版本表，已有检查生产者及有效性消费者共同引用；不新增表、服务、自动升级或全局发布摘要。驱动版本只在对应检查契约实质改变时提升。旧结果与成功历史不改写；派发、Preview／导出及修订关闭不能把过期检查继续视为当前有效。显式计划修订仅使受影响任务及其真实消费者待验证，无关成功任务／文件保留，不自动付费重跑。可编辑源码副本 build 与普通 build 也必须匹配所属任务模式。

回归：V3 后端全目录 149 passed／0 failed；最终诊断和 Review 调整补跑受影响的 20 项，均通过、与前述重叠不重复累加。包含独立本机 Chromium 和真实 CLI＋回环假模型，不是付费模型或完整游戏验收。恢复后的前端导航／任务／Preview 三文件 34 项通过、`tsc -b` 通过；完整 `App.test` 仍有 7 个 jsdom 缺 Path2D 的未处理错误，该运行失败，不再追加 mock 掩盖。server 全仓类型检查仍失败；本轮 workflow-v3 路径无最终诊断，不能称全仓合格。首次沙箱内浏览器失败记录保留，仅停止了已核对的自身测试进程，再以正常本机权限回归；不终止运行服务或未知进程。

独立记录：集成工作树 `docs/verification/bgs-v3-frontend-scope-check-versions-2026-10-11.json`。此前原始证据不覆盖。后续先核对 V3-08 未知写者／外部操作的真实活性与恢复条件；不因超时自动解锁，不以新增正式前端入口代替恢复正确性。

运行边界：本轮不重启／部署、不执行 SQL、不修改现有游戏、不调用付费模型，也不开放交付。未知写者／外部操作恢复、完整游戏消费、成本达标及普通 Chat 规划仍未完成。检查器版本需维护者按实际契约变化更新；版本核对不证明语义正确，不替代运行或完整覆盖。

### 1.20 全部 V3 正式前端接入撤回

§1.19 只撤回最近一轮修改，遗漏了此前新增的 V3 正式界面，不符合用户要求。此次完整撤回 V3 顶部提示、Chat 任务面板及输入锁定、已测 Preview／两类导出／问题反馈界面、需求变更入口、Artifacts 提示，以及 Scene／UI 编辑器的 V3 版本提交和只读控制；删除对应五份 V3 专用前端源码及测试，保留可恢复副本。共享 Scene 编辑器新增的 V3 只读逻辑同步撤回。

此前明确要求的非 V3 功能（子代理消息／工具归属、首页声音移除、头像暗色修正、资源菜单层级、制作验收和 JSON 渲染修复）不撤回。后端、数据库、已保存项目、检查证据及历史验收记录不修改；也不解除后端 V3／legacy 安全隔离。当前正式前端不再提供 V3 操作闭环，不能把历史界面验收当作当前交付状态。此轮仅撤回和回归，不继续新增功能。后续系统验证使用独立脚本或经确认的 debug 页面，正式 frontend 修改须单独取得确认。

### 1.21 独立 Debug 操作与合成闭环验收

遵照用户最新边界，本轮仅在 BGS server 增加独立开发页，不恢复任何正式 frontend 接入，也不改 Claude Code 原生源码。已证实的缺口是 §1.20 撤回后无法独立操作已落盘的 V3 接口；最简单方案是一个静态 HTML／JS 客户端，直接调用既有鉴权、版本、编辑、计划、执行、Preview 和导出 API。不另建状态机、任务协议、数据库表或服务。

- 入口：BGS 服务以 `BEEGAME_WORKFLOW_V3_DEBUG=1` 启动时提供 `http://localhost:<BGS端口>/debug/workflow-v3`。默认不存在，只允许 loopback host；不把它挂到正式 Dashboard 或 Chat，也不创建公共访问入口。页面仅使用正常用户 Access Token，当前页内存保存，不使用 service-role、不读正式页面的本地凭据、不持久保存或显示 Token。项目数据和操作仍通过正常 API 鉴权；debug 页面本身不授予权限。
- 操作：显式读取 Run／事件／来源；读取注册 Scene／UI JSON，按原始来源摘要及 workflow 版本保存候选；显式提交候选计划／需求变更；暂停及恢复；选定任务执行；现行已测 sandbox Preview 及静态／工程 ZIP。执行和授权范围变化有确认，页面不自动派发、轮询、重试或换请求身份。冲突保留草稿；刷新 Run 不自动重绑定旧草稿的版本。
- 合成浏览器验收：页面加载没有 API／模型请求；未登录 API 返回 401；修改 UI 后仅实际所有者／消费者失效，无关 notes 状态及字节保留；过期 JSON 和需求草稿返回 409，保留原稿且不重试；一次假原生完成后宿主重新执行源码副本 build 和独立 Chromium 测量，两类包可下载；独立来源 sandbox Preview 实际消费新高度，需求变化后旧 URL 返回 409；暂停重载保留暂停，没有自动恢复。新用例调用一次合成本机 provider，不是付费模型或实际游戏验收。
- 回归：完整 V3 目录 151 项通过；随后补充真实 BGS app 开关／正常 API 鉴权边界用例通过，合计 152 个不同测试（重复定向运行不累加）。server 类型检查仍失败，3556 条既有诊断；本轮 debug／workflow-v3／app 路径无诊断，不宣称全仓类型检查通过。正式 frontend、Claude Code 源码及 builtin-tools 的既有差异摘要前后相同。
- 运行边界：没有重启当前服务、执行 SQL、修改真实项目或原始证据，没有付费测试；debug 开关尚未在运行服务启用。新页面没有 Question 答复及 Preview 问题提交入口，亦未证明真实数据库上的 debug 完整交互、未知写者／外部响应丢失恢复、游戏品质或真实成本达标。V3-09 继续部分完成，V3-08 的 unknown 不解锁，完整交付保持关闭。

记录：集成工作树 `docs/verification/bgs-v3-independent-debug-2026-10-11.json`。关闭 debug 开关即可撤下页面，保留后端和历史；不影响正式 frontend。后续先继续有证据的恢复／真实数据消费缺口，不把开发页的合成成功代替产品验收；任何正式 frontend 修改仍需另获确认。

### 1.22 有退出证据的写者收尾与独立 Question 答复

继续按用户边界推进，正式 frontend、Claude Code 原生源码和 builtin-tools 不改。此次解决的实际缺口是：退出与结算之间没有持久化证据；BGS 会话清理失败原先只记录日志，等待结束仍可能被误认为退出；独立 debug 页没有真实 Question 答复；读取一个缺失的历史文件会遮蔽当前待答问题。不是给模型增加规则或自动重试机制。

- **退出证据**：原生清理完成，且宿主写入／绑定／检查全部返回后，在既有 Run 的对应 Attempt 保存 `quiescedAt`，保留当前 writer／fence，并留存真实用量及问题决策来源。正常结算随后释放 writer。只增加一次宿主 CAS，不增加模型请求、新表或服务；任一清理／证据保存失败均保留未解决写者，不靠终端回复、无会话或时间推断退出。
- **显式收尾**：正常鉴权的 `recover-writer` 接口要求当前 Run 版本、Attempt、fence，拒绝仍在运行的本机写者及其他活动会话。只有已保存的宿主完整退出证据可收尾；中断任务记为失败，宿主编辑保留未验收候选及失效状态。保留用户暂停、无关任务、原文件和历史；不把旧检查恢复为通过，不派发／重试／再次收费。数据库现有 JSON 状态即可承载，未执行新 SQL。
- **Question**：debug 页显式读取当前真实待答请求，原文／选项／finding 来源照实显示，答案不预填；提交／拒绝复用 `/api/projects/:id/permissions/:toolUseID`，不建立第二套答复权。HTTP 接收不等于授权成立，用户需查看原生 `workflow.question.validated/rejected` 事件。既有来源和版本 guard 继续拒绝来源变化、暂停、中断后的答复；重载只读历史决策，不能补填已结束问题。
- **历史缺失**：事件和问题读取按 Attempt 报告 `historyUnavailable`，不让一个未启动／缺档的旧 Attempt 挡住当前待答请求。缺档／不可读不是“没有决策”或检查通过的证明；不改写或补造历史。
- **验证范围**：独立本机 Chromium＋真实 BGS API 的合成答复、拒绝、来源竞态、暂停取消、历史重载、证据型收尾和无证据拒绝通过。最终固定代码的 V3 全目录 158 passed／0 failed（1364 assertions），包含实际 CLI＋回环假模型；另有会话／Question／原生进程适配器 85 passed／0 failed。server 全仓类型检查仍失败，3556 条诊断；本轮 workflow-v3／session-manager 无诊断，不宣称全仓合格。初次失败及修正另存审计，不以重复运行累加用例数量。受保护源码差异摘要前后一致。
- **未完成边界**：在退出证据写入前直接崩溃，或旧版根本没有退出证据的写者仍为 unknown，本轮没有增加跨主机 PID／进程登记框架，不能从时间、人工声明或文件摘要解锁。外部收费操作响应丢失仍不证明成功或可重做。真实远端数据库上的恢复／debug 交互、完整游戏品质和成本尚未验收；未重启运行服务，debug 开关未在运行服务启用，整游戏交付仍关闭。

记录：集成工作树 `docs/verification/bgs-v3-question-recovery-2026-10-11.json`。V3-08／09 仍部分完成，不因本次合成闭环而全项勾选。下一步先明确无退出证据情况下可获得的真实进程／外部操作证据；不盲目重发操作，不修改正式 frontend。

### 1.23 独立 Debug 的 Preview 观察与有权修订闭环

本轮先核对无退出证据的恢复边界：原生 runner 的 child／退出状态保存在进程内，已有持久会话 ID／用量标识不是可跨重载核对的进程身份。没有证据就不能断言旧写者已退出；继续保持 unknown，不为解锁增加进程框架或凭时间猜测。转而完成文档中另一项已有后端、缺独立验收入口的最小切片。

- **范围**：仅扩展 BGS server 的独立 debug HTML／JS 及合成浏览器回归，复用当前 Preview、观察、Review／Repair 计划和任务执行接口。不改正式 frontend、Claude Code 原生源码或 builtin-tools，不新增数据库、服务、检查器、业务流程或模型规则。
- **观察**：必须先显式打开选中任务的现行已测 Preview；草稿绑定实际 Attempt、计划及构建摘要，需求 ID／步骤／预期／实际表现由操作者填写，不预填结论。保存不派发，不把观察认定为已证实缺陷。重复同 key 同内容幂等，改变内容拒绝；刷新不会把旧草稿重绑定新版本，冲突保留原稿。
- **Review／Repair**：从已保存观察显式授权定向 Review；显示当前实际报告、来源和检查。选择 finding IDs 后由后端核对全部阻断项、来源和原所有者授权，生成原所有者集中修订及定向复核计划，不自动执行、不扩大写入范围。各任务执行仍需一次显式确认；无关成功任务／Attempt／文件保留。
- **实际闭环**：临时合成工程实际从 JSON 渲染 64px 按钮，与已确认的 80px 要求不符；合成来源报告提出 F1，原所有者修订后由宿主重新执行规则测试、源码副本 build 及独立 Chromium 测量，新 Preview 实际显示 80px。修订成功不关闭旧报告；有来源、实际修订 Attempt 和当前检查证据的定向复核随后关闭。旧 Preview 拒绝访问，原报告和观察保留，两类新工程／静态包导出通过，无关 notes 原样保留。这里的语义报告是受控假 provider，不证明 LLM 能稳定识别问题或游戏品质合格。
- **新需求边界**：原有需求变更接口正确拒绝把历史 repairOf／reviewOf／previewIssues 当成新需求授权；debug 草稿明确提醒重拟目标、输入和检查，不自动删字段猜测计划。合成测试先证明拒绝且原稿保留，再显式提交新普通任务计划，旧资格失效，仍需重新构建测量。
- **回归**：独立浏览器、debug 鉴权、导出／反馈三个文件 16 passed／0 failed；冻结本轮代码后完整 V3 目录 158 passed／0 failed（1367 assertions，23 文件，155.87 秒），含真实 CLI＋回环假模型与独立 Chromium。server 全仓类型检查仍失败，3556 条既有诊断，日志摘要与前轮一致；workflow-v3 无诊断，不宣称全仓通过。正式 frontend／Claude Code／builtin-tools 差异摘要前后一致。两个中间浏览器运行因测试把历史修订计划用于新需求而失败；保留拒绝断言，并显式提供新普通任务计划后通过，未削弱系统边界。重复运行不累加用例数。
- **运行／能力边界**：没有重启服务、启用运行版 debug、执行 SQL、修改真实工程或调用付费模型。远端数据库 debug 的完整交互、旧／崩溃写者无证据恢复、外部响应丢失、完整游戏运行消费和成本仍未验收。V3-07／08／09 保持部分完成，整游戏交付继续禁用。

记录：集成工作树 `docs/verification/bgs-v3-preview-feedback-2026-10-11.json`。现有服务需要另行安排部署才能加载本轮代码；不以测试启动专用服务等同生产部署。

### 1.24 真实数据库上的独立 Debug 完整操作验收

本轮使用正常 Chrome BGS 登录态、实际 Supabase Store 和现有 API，仅在 OS 临时目录创建明确标记的合成工程。任务 runner 是受控替身，不调用模型；构建、规则测试、独立 Chromium 测量、数据库事务、Question 权限接口及下载文件均为实际执行。专用临时服务不等于正式部署。

- **最小接线修正**：独立 debug 支持已有 HttpOnly 登录态，不读取／复制 Cookie，不注入管理员身份。实际恢复所属 Chat 后，显式填写全文需求、创建 Run 和首计划；不再使用编造 Chat ID 或预先写入通过状态。响应正文读取完成后再检查项目／身份，修复延迟旧响应污染新页面的竞态，并补延迟 body 回归。验收脚本支持严格校验合成身份后的冷恢复，不覆盖现有 Run／计划／文件。
- **真实本地编辑与运行**：初始游戏任务实际构建；保存 UI 52→64、Scene X0→42 后旧资格失效，重新构建和测量。新 Preview 实际显示 64px／X42，点击反馈为 Clicked。局部编辑和后续 Repair 均保留无关 notes 的原 Attempt 与字节。
- **Question／Repair 闭环**：保存真实 Preview 观察；来源绑定的受控 Review 提出 F1 并要求用户选择 80 或 96。当前原生 Question 在 debug 页实际显示，正常权限答复选择 80，`workflow.question.validated` 携带 finding／版本／来源。原 game 所有者修订后实际执行 build、runtime-smoke、rule-tests 和 repair-verification；定向复核依据当前正文和实际修订 Attempt 关闭 F1。原报告、观察和历史不删除。此处只证明交接／证据链，不证明 LLM 审计水平。
- **已测导出**：计划 5 的真实工程／静态 ZIP 通过正常接口和 Chrome 下载；元数据指向实际已测 Repair Attempt。解包工程实际 `bun run build` 成功，12 个源码／产物文件摘要与导出收据一致。后来的新需求版本不能沿用这些历史包的资格。
- **未知写者恢复**：在宿主真实持久化退出证据后，故意丢失结算提交；数据库保持 writer／fence。暂停后停止专用进程，冷启动仍为 unknown，没有自动解锁、派发或重试。显式 `recover-writer` 只凭原 `quiescedAt` 收尾，任务记 failed、没有通过检查，原暂停与无关成果保留；其后单独显式 resume 仍不派发。真实远端事件版本 31→32→33→34 分别证明退出证据、暂停、收尾保留暂停、显式恢复。
- **新需求／新测量**：明确新确认版本保留既有 80px／X42 行为，不宣称实现新功能；新计划不用历史修订字段。需求变更不派发，game／notes 变为 pending 且无旧 Attempt 资格，旧 Review／恢复任务 superseded 但历史保留。显式执行后产生新构建、规则与运行检查，Preview 实际仍为 80px／X42／Clicked；notes 字节未变。全局需求快照变更要求 notes 重新核对，与局部修订保留 notes 不同。旧 Preview 已撤销。最终 Run 版本 42、计划 6，显式暂停后页面重载保持暂停、无写者和 11 份 Attempt 历史。
- **回归与边界**：冻结代码后的 V3＋正常鉴权／项目会话回归 164 passed／0 failed、1388 assertions、24 文件；定向 4 passed／0 failed；实际双进程数据库并发 11 项断言通过。server 全仓类型检查仍有 3556 条既有诊断，workflow-v3 无诊断，不宣称全仓通过。本轮无正式 frontend／Claude Code／builtin-tools 修改，受保护差异摘要前后一致；没有执行 SQL、重启正式服务或调用付费模型。
- **失败记录不隐去**：两个早期合成夹具分别因测量后新增源文件、编造 Chat 身份失效；后者被正常接口 409 拒绝，未执行任务。正确夹具最初漏 Preview origin 导致 503，只修正专用脚本配置，不开放未测预览回退。浏览器确认／选择器／下载等待等驱动问题均以实际持久结果及下载收据核对，没有按“尝试点击”算通过。

记录：集成工作树 `docs/verification/bgs-v3-remote-debug-2026-10-11.json`；可重用的 opt-in 夹具入口 `scripts/verify-workflow-v3-remote-debug.ts`。合成项目和原始证据保留，临时服务收尾后关闭。

V3-07／08／09 的**真实数据库 debug 交互**已有本轮证据，但整项仍不勾：退出证据保存前崩溃、无证据旧写者、未知外部收费操作、完整游戏／专业运行消费、付费成本、普通 Chat 和正式部署均未由此验证。`deliveryEligible` 仍为 false，不以合成操作闭环冒充游戏交付验收。

### 1.25 独立 Debug 到真实 CLI 的保存、消费与变更闭环

上一轮 §1.24 使用受控 runner，不能直接证明真实 CLI 工具调用能贯通同一操作链。本轮在 OS 临时合成工程、本地持久 Store 和明确的合成身份下，通过独立 debug 页驱动**真实 native CLI**；仅将模型端替换为 loopback 确定性接口。不能把本轮与上一轮证据拼成“真实数据库＋真实 CLI＋真实模型完整验收”。

- **实际执行**：正常恢复 Chat／创建 Run／计划；CLI 调用 Question，经 debug 页正常权限接口答复 80；实际加载 gameplay-programmer Skill、Read／Write 保存正式 UI。宿主执行源码副本构建、规则检查和 UI 位置／尺寸变化及恢复观察；已测 Preview 实际显示 80px，点击反馈为 Clicked，正常接口下载可编辑工程包。没有预写通过状态。
- **需求变更闭环**：明确确认新需求 96 后，不自动派发；旧 Task 资格被移除、旧 Preview 返回 409。显式执行产生另一 native Session／Attempt，Question 答复 96，实际保存、重建并重新测量；Preview 显示 96px。无关 notes 字节不变；暂停后重载保持暂停且无 writer。两次实际 native 执行共 10 次本机假模型请求，不是付费用量证据。
- **发现并修正宿主误报**：UI 消费测量已通过，但原冒烟检查要求 body 有正的流式高度。绝对定位 UI 不撑开 body，导致可见界面错误地被判未验证。最小修正是检测位于视口、具有实际尺寸且祖先可见的具体表面，不要求 body 流式高度。新增绝对按钮／Canvas、隐藏／透明／移出视口、空白流式容器、正文与脚本混排反例；不将表面存在当作像素、趣味或游戏品质证明。
- **检查版本与历史**：仅 runtime-smoke 驱动升至 `v3-static-artifact.2`；UI 消费、工程导出等契约不改。旧 `.1` 记录保留为历史，不能作为当前资格；受影响工作须显式重新测量，不自动重跑项目或改写远端记录。§1.24 的旧版本通过记录不由本文升级为新版本通过。
- **回归**：冻结代码后 V3＋正常鉴权／项目会话回归 **172 passed／0 failed、1436 assertions、25 文件**；定向 18 passed／0 failed、130 assertions。全仓 server 类型检查仍有 3556 条诊断，workflow-v3 无诊断，不能宣称全仓通过。最初表面修正漏掉带 script 的普通正文，导致四项工程导出回归失败；已纠正直接文本节点检测并通过最终完整重跑，失败日志保留。
- **范围与后续**：无正式 frontend／Claude Code／builtin-tools 修改，受保护差异摘要前后一致；无付费模型、SQL、正式服务重启或真实项目修改。实际 CLI Review／Repair 和远端 debug 已有独立证据，但尚未在一个真实数据库＋真实 CLI 的 debug 综合案例内验证；退出证据保存前崩溃、未知外部收费操作、完整游戏／专业运行消费、成本、普通 Chat 和正式部署仍未完成。V3-06／07／08／09 不据此整项勾选，`deliveryEligible` 保持 false。

记录：集成工作树 `docs/verification/bgs-v3-debug-native-2026-10-11.json`；可重跑入口为 `workflow-v3/debug-native.test.ts`，使用专有测试 Chromium，不连接用户 Chrome。临时 fixture／服务已收尾，原远端合成工程与历史证据未改。下一步先补真实 CLI Review／Repair 与远端 debug 的组合边界，不追加付费实验或正式前端入口。

### 1.26 真实数据库＋正常 Chrome＋真实 CLI 的 Review／Repair 综合验收

补齐 §1.25 的单例组合缺口：新建明确标识的 OS 临时合成工程和真实 Supabase 项目，正常 Chrome HttpOnly 登录态通过独立 debug 操作，同一 Run 的五次执行全部进入实际 native CLI。模型端仅连接本机确定性假接口；没有付费调用、正式服务重启、SQL 或正式 frontend／Claude Code／builtin-tools 修改。

- **实际链路**：基线 game／独立 notes → 版本绑定的 Preview 观察 → 来源绑定 Review 的 F1 → 原 game 所有者 Repair → 实际 AskUserQuestion 答复 → native Write 保存 → 宿主源码副本构建／规则／runtime-smoke .2／UI 位置与尺寸变更恢复测量 → 定向复核关闭 F1。修订通过时 Review 仍为 pending，没有让作者自行关闭问题；最终关闭项引用真实修订 Attempt 和当前 UI 原文／hash。
- **真实交互与保存**：Question 初始答案为空；本代理仅在明确合成用例的正常 debug 答复界面选择 80，宿主记录来源验证后的决定，实际 CLI 据原生 tool_result 写入 80。Chrome 已测 Preview 的实际高度为 80px，并产生 Clicked 反馈。初始观察记录为提交者观察；程序测量另有初始 52px 的实际边界证据，不把观察文字独自当成缺陷证明。
- **导出与隔离**：正常 Chrome 下载 11,206 字节工程 ZIP；独立读取 measurement.json，核对修订 Attempt／构建 hash 和全部 12 项文件 hash。原 Review 报告原字节保留；notes 的任务／Attempt／输出 hash 均未变化；五次执行有五个独立 native session。暂停后刷新仍为 version 21、无写者；真实数据库独立读取与页面一致，deliveryEligible=false。
- **回归与试验纠错**：173 passed、0 failed、1,469 assertions、25 files；新增组合回归与保留的原保存／变更回归共 2 passed。服务 TypeScript 仍有 3,556 项全量诊断，V3／新增 fixture 无诊断，不能宣称全仓类型通过。试验第一轮失败是测试假模型错误地在运行中读取尚未结算的决定；改为消费实际原生 Question 结果，未改产品逻辑或预填宿主 PASS。失败日志保留。
- **不扩大结论**：19 次假模型请求的用量字段是合成传输值，不是实际 Token／成本数据。受控 Review 只验证传输、来源、所有权和实际检查，不能证明真实模型漏检已解决、专业 Skill 应用质量或游戏品质。本例不重跑退出证据型恢复、手动编辑／需求变更；前轮独立证据不自动合并为本例覆盖。退出证据前崩溃、未知外部收费操作、Tilemap／3D／动画／字体／音频、普通 Chat、正式部署和完整交付仍未验证，06／07／08／09 仍部分完成。

验收记录：集成工作树 docs/verification/bgs-v3-remote-native-debug-2026-10-11.json。仅关闭本轮专用服务和本代理 Chrome 标签，保留新合成目录、数据库历史与下载包；既有原项目和历史证据未改。下一步按实际专业运行消费缺口推进，不新增正式前端入口或自动追加付费实验。

### 1.27 静态 2D Tilemap 的目标运行时消费

继续补 V3-06 已列出的专业运行消费缺口。先用正确的独立 Tilemap renderer 复现：已注册 Scene／Grid／TileSet／图集齐备，但旧像素准备逻辑只识别 sprite／image，因此仍返回未验证。本轮扩展已有 `pixel-data-consumption`／`pixelProbes`，不新增任务 Schema、检查 ID、数据库对象、渲染框架或正式前端入口。

- **输入与覆盖**：声明实际 Canvas、Scene nodeId 和准确的 tilemap componentId；宿主从保存的 Tilemap 展开所有已用 tileId 及其全部格子，不让作者只选代表格或提供期望坐标。复用现有 Grid／TileSet 解析和层级／Camera 投影，读取实际 cell／gap／anchor／pivot／offset／size，并绑定 Scene、TileSet、manifest、图片、图集及构建副本的当前字节。
- **实际消费证明**：自有 Chromium 加载目标游戏构建，不加载 BGS 预览 renderer。仅替换浏览器内的图片／图集区域与 Scene／TileSet 响应，分别改变两种标记颜色、节点位置、格子位置、Grid cellSize 和 TileSet tile size；逐项观察实际 Canvas，再恢复原响应并核对原画面 hash。没有改写源文件或让作者提交 PASS。
- **防漏格与资源歧义**：除了整体边界，每个格子的内部区域均须至少 90% 命中标记像素；边缘允许 2px 栅格化误差，格子区域之外不得出现标记。反例验证「中间少一格、整体包围框不变、总覆盖仍超过 90%」仍被检出。图片身份按实际注册路径和图集区域判断；不同 frame 名称指向同一区域，也保持未验证，不误称已隔离。
- **版本和影响范围**：仅将像素检查版本由 `v3-canvas-image-consumption.1` 升为 `.2`。旧记录不删除，但不再作为当前像素验收；需要显式重测，不自动追加 Agent／付费任务，不重做无关阶段。没有修改 runtime-smoke、UI 消费或 Review／Repair 的版本。
- **回归**：冻结代码后 191 passed／0 failed／1,562 assertions／26 files，包含 18 项 Tilemap 正常、失败和未验证案例，以及原 UI／sprite、独立 debug、真实 CLI＋本机假模型、Review／Question／Repair、恢复、绑定、需求变更和导出回归。正确图集、独立图片、父节点缩放与 Camera 位移通过；错格、错 tileId、缺格／多格和忽略关键数据未获通过；缺探针、旧 TileSet、共享区域、旋转等保持未验证。服务全量 TypeScript 仍有 3,556 项既有诊断，本轮无 workflow-v3 诊断，不宣称全仓类型通过。首个受限浏览器启动失败属于 macOS sandbox 环境错误；随后在获准的独立浏览器运行环境验证，未降低浏览器安全设置。
- **仍未证明**：仅覆盖静态、轴对齐、不重叠、图片区域可隔离的 2D Tilemap。碰撞／排序、旋转／遮挡／混色、跨绑定共享图片区域、动画、3D、字体、音频、动态玩法、多设备及大地图性能不由此证明。本轮没有再做远端数据库＋用户 Chrome 的 Tilemap 综合验收，也没有付费模型质量／成本验证。V3-06 仍部分完成，`deliveryEligible=false`。

本轮未改正式 frontend／Claude Code／builtin-tools，受保护差异摘要前后一致；无真实项目修补、数据库写入、SQL、正式服务重启或付费调用。独立证据：集成工作树 `docs/verification/bgs-v3-tilemap-consumption-2026-10-11.json`。历史验收记录保留，不用本轮结果追溯升级之前的证据。

### 1.28 显式绑定静态 DOM 字体的目标运行时消费

继续补 V3-06 的实际字体缺口。独立目标页面复现了「加载并注册字体，但文字仍用 monospace」：原 `ui-data-consumption` 通过几何检查。这不是旧几何检查器实现错误，其原职责从未覆盖字体；不能把预览字体检查或下载记录升级成目标游戏字体证明。

- **最小入口**：新增独立 `font-data-consumption`（`v3-dom-font-consumption.1`），复用 `runtimeArtifact`、现有 `uiProbes`、注册资源、字体字符表和自有 Chromium。不新增 Task 字段、数据库表、服务、阶段或渲染器，不让模型提交期望字体／PASS。原几何、像素、Review／Repair 检查版本不变，旧几何结果不自动补授字体资格。
- **覆盖依据**：从注册 UI 找出全部显式 `data.font` 绑定的静态、单行 `node.text`，核对源声明目标视口和准确字体成员。绑定 source／manifest／font 及构建副本的当前字节；已有字符表解析器核对原文字符，避免缺字时把系统兜底或缺字框当成正确字体。字号继承与响应式投影沿用现有 UI helper；共享解析器只增加可选的宿主模块路径参数，原环境变量调用保持兼容，没有另建解码器或改全局环境。
- **独立观察**：目标游戏自行绘制；宿主观察实际 DOM 原文、计算字号、Chromium 的实际 glyph 字体和元素画面 hash。仅替换浏览器响应，单独重复原文、改变有效字号 +7、屏蔽准确字体文件，再恢复原响应。通过要求原文／字号变更被消费，原始／变体／恢复都由单一可隔离自定义字体绘制，字体屏蔽使实际字体签名和画面均变化，恢复后字体和画面 hash 一致。源和构建文件不被改写。
- **检查器自身纠错**：反例证实初版只要求“实际字体都是 custom”会漏掉混用：绑定字体仅画首字，另一字体画剩余文字，却通过。已收紧为单一可隔离字体，混用保持未验证；没有按字体名称或测试案例写特殊规则。另一个组合反例证实：布局与字体共用 `uiProbes` 时，字体检查错误拒绝普通无字体按钮。现在各消费者按实际绑定取自己的节点，仍强制已绑定字体的完整覆盖，不因多检查拆额外任务。
- **回归范围如实分开**：完整 V3／共享字体／鉴权回归 214 passed／0 failed／1,670 assertions／28 files，覆盖原 UI／Tilemap、独立 debug、真实 CLI＋本机假模型、Review／Question／Repair、恢复、绑定、需求变更和导出。随后仅修正字体隔离判断和字体探针筛选，最终全部字体／UI 组合、共享字体解析与检查版本定向回归 27 passed／0 failed／190 assertions／3 files。最终包含 22 个字体正常／失败／未验证案例，另有旧几何覆盖边界与计划授权测试；不伪称修正后重新跑了一次全量 215／216 项。最终类型检查仍有 3,556 项既有诊断，本轮 V3／共享字体无诊断，不宣称全仓类型通过。
- **明确限制**：本矩阵实际绘字覆盖 TTF；既有共享字符表回归另测 WOFF2，不由此声称其他格式的目标运行都已验收。当前只证明已选文件的消费，不证明 assetRef／member 字段的动态切换；继承字体绑定、系统字体、混用、富／动态／多行／伪元素文本、Canvas／Scene 文本、字重／字形样式／变体／塑形、完整排版适配和美感仍不在此证明。字体专属的远端数据库＋真实 CLI Review／Repair 综合案例未另测。V3-06 继续部分完成，`deliveryEligible=false`。

本轮未改正式 frontend／Claude Code／builtin-tools，受保护差异摘要前后一致；没有改真实项目、执行 SQL／数据库写入、重启正式服务或调用付费模型。独立证据：集成工作树 `docs/verification/bgs-v3-font-consumption-2026-10-11.json`；失败、部分运行及最终日志分别保留，不覆盖历史验收记录。后续仍按实际运行缺口推进，不追加正式前端接线或自动付费实验。

### 1.29 编码资源到 HTML 音频的实际消费

继续补 V3-06 音频运行缺口。独立目标页面可请求 Scene／音频、显示 Play 按钮，但按钮不播放：原 runtime-smoke 仍通过。冒烟检查只负责初始表面与加载，不能据此宣称音频已交付；不是把旧检查器重新解释成音频审核。

- **最小入口**：新增 audio-data-consumption（v3-html-audio-consumption.1）和可选 audioProbes，复用既有 probe 基础字段、注册资源检查、自有 Chromium、任务来源／版本及 Review／Repair。音频需要准确组件和独立播放／停止路径，不能直接把 UI 几何 selector 当成播放证明；不新增数据库对象、服务、业务阶段、播放器或原生循环补丁，也不强制每个声音一个 Task。
- **实际输入**：全部注册 Scene 的 audio-source 须有探针；源给出 assetRef、明确的 data.volume（0..1）／data.loop 及可选准确 data.member。宿主读取现有 manifest／模块和真实编码资源，绑定当前源与构建副本字节。缺探针、缺参数、旧副本、不可隔离成员或无有效资源保持未验证，不接受作者预期值／PASS。
- **实际观察**：目标游戏自行从真实点击播放和停止，宿主不代调用游戏 play／pause、不唤醒其音频图。观察原生媒体的状态、时钟、当前源、静音、音量／loop 等字段；独立捕获 tap 读取解码信号，不连接输出。仅替换隔离浏览器响应：原数据→单独音量变化→单独 loop 切换→准确文件替换静音 WAV→恢复原字节；原文／资源／构建文件不改。静音样本由宿主内生成，不嵌入游戏代码／文档，也不新增模型交接请求。
- **不把捕获当作听感**：[W3C 捕获语义](https://www.w3.org/TR/mediacapture-fromelement/)明确媒体元素的音量／静音不改变捕获信号，所以分别观察原生属性。通过仅证明既定资源产生解码信号、响应替换能使其静音并恢复，及 volume／loop 属性被消费；不是最终设备音量、混音、真实循环边界或美感证明。驱动限定未静音、单位播放速率、从 idle 进入播放且持续覆盖短采样窗口的 HTML audio；其他源参数语义、短音效、自动播放、脱离 DOM 的 Audio、Web Audio／合成／空间音频需其他证据。
- **现有闭环而非新审查层**：合成 Review 将忽略 volume 的来源问题归给实际所有者，以 audio-data-consumption 作 verifyWith。旧冒烟可成功，但未修的实际音频／repair-verification 不能关闭问题；授权修订后须重新播放／变更／替换／恢复并定向复核，旧检查器版本仍不能关闭。语义报告是受控测试，不由此证明真实 LLM 漏检已解决；没有音频专属的远端 DB＋CLI 综合验收。
- **冻结源码回归**：V3＋共享字体 230 passed／0 failed／1,764 assertions／28 files；另测实际鉴权／会话路由 33 passed／0 failed／224 assertions／2 files，分别保留日志，不伪称一个命令完成。新增 20 项测试覆盖正常／显式成员／延迟加载、忽略字段／停止、下载不播放、解码错误、漏覆盖／旧副本／静音原资源、旧冒烟边界和 Review／Repair。共享布局、字体、Canvas／Tilemap、独立 debug、本机假模型 CLI、Question、编辑／重建／导出、恢复及权限无回归失败。全 server 类型检查仍有 3,556 项既有诊断，本轮 V3／共享字体无诊断，不称全仓通过。
- **保留未验证**：实际编码矩阵为 WAV，不外推全部格式／设备；不证明 assetRef／member 动态切换、完整游戏事件映射、重置／重开／淡入淡出及听感。无付费模型调用或 Token 降幅证明，无真实项目修改、SQL、正式服务重启、个人 Chrome 操作；正式 frontend／Claude Code／builtin-tools 差异摘要前后一致。V3-06 仍部分完成，deliveryEligible=false。

独立证据：集成工作树 docs/verification/bgs-v3-audio-consumption-2026-10-11.json，记录最终源码／日志摘要、预期失败／未验证反例及开发期类型错误修正；历史字体／Tilemap 证据不覆盖。音频能力已落盘，不等于正式运行服务已切换版本。

### 1.30 技术路线与实施方向再审计（本轮仅文档）

完整阅读本文并核对当前工作树，发现的偏差不是“Web 检查全无价值”，而是将 Web 专项逐步当成所有游戏的通用实施主线。下列为源码事实，不是新增运行验收：

| 核对位置 | 当前事实 | 归因／修订 |
|---|---|---|
| `app.ts::BEEGAME_INTAKE_SETTING_VALUES` | 推荐引擎列有 React、Unity、Godot、Unreal | 入口能声明引擎，不证明下游执行、构建和交付支持这些引擎；Unreal 不由本轮扩展 |
| `workflow-v3/state.ts::taskSchema`、`execution.ts`、`context.ts::taskContext` | 两种通用任务、普通原生提交；Web 探针可选且按任务注入 | 不是每个任务都被强制用 JSON／浏览器，也没有证据说明原生 CLI／MCP 被禁用；但可选字段及检查名混合了通用交接与专项能力，需纠正适用范围 |
| `checks.ts::runChecks/commandCheck` | `build`／`rule-tests` 读取 package.json，执行 Bun 的 build／test:rules | 通用名称对应 JS 专项实现；不能作为 Unity／Godot 构建和规则测试的证据 |
| `runtime-checks.ts::runArtifactCheck`、`measured-build.ts`、`editable-project.ts` | 静态 index.html／Chromium；工程包要求源码副本 Bun 构建及同一静态测量 | 实际支持范围窄于“运行／工程导出”名称；保留 Web 行为，禁止套用到引擎路线 |
| `content-checks.ts`、`binding.ts`、UI／pixel／font／audio consumption | 基于 BGS registry、Scene/UI JSON、manifest，部分检查还限定 DOM／Canvas／HTML audio | 为采用这些数据与消费者的项目服务；不能要求普通 React 或原生引擎工程复制同一套数据才能交付 |
| `state.ts::Run`、`routes.ts`、§1.20–1.29 | 全局交付资格仍关闭；专用 debug、局部证据与恢复保留限制 | 不将“所有专项都没补齐”设为未来全部项目的门槛；也不因修订文档直接打开交付 |

本次只核对上述源码及既有记录，未重跑测试、部署、调用模型或控制引擎；没有证实完整游戏质量、付费降耗或 Unity／Godot 可用性。历史中“无退出证据恢复”、未覆盖专业能力及全仓类型失败继续保留。具体取舍和依次实施见 §3.3–3.5、§12。

## 2. v1.0 方案审计及修正决策

以下是原 RFC 的设计缺陷，不应全部标为“当前系统漏洞”。

| 等级 | 原方案问题 | 影响与修正 |
|---|---|---|
| P0 | 八 Domain 漏 AUDIO_DESIGN，加入 build_checklist | 专业职责不完整；恢复音频，构建/交付清单归技术和验收 |
| P0 | “覆盖/可执行性/范围”都由 Plan Validator 自动证明 | 声明有关联不等于需求被满足；分清确定性图检查与语义/运行证据 |
| P0 | GateResult 只有 passed 布尔，实际还需来源、覆盖、时效 | unknown、driver failure、缺资源可能被伪装通过；采用分型结果和输入版本 |
| P0 | Worker 掉线/租约过期即可重试 | 原 worker 或外部请求可能仍有效，导致重复生成/计费；先核对活性、fencing 和外部操作记录 |
| P0 | 仅用 depends_on 推导所有局部影响 | 隐式读文件/公共能力修改漏报；声明实际输入、记录观察写入、局部不确定时扩大有依据的回归 |
| P0 | 替换未开始任务，却没有已完成结果变更后的现行状态 | 历史 succeeded 可能继续被消费；历史保留，但当前满足关系必须可失效 |
| P1 | 全量 DesignRecord 优先，同时维护正文、记录、追踪矩阵 | 重复权威和修订量；首版正文为唯一决策来源，小索引存指针，不存第二套答案 |
| P1 | 所有 accepted 产物先验证才允许实现 | 原型/能力测试无法开始；区分探索输入和正式交付使用资格 |
| P1 | 新 FastAPI、多服务、全套表、每 Attempt Worktree | 与现有技术栈/必要成本不符；保留现有服务，生产写任务先串行 |
| P1 | 默认 maxTurns、3 次 Attempt、2 次修复、3 次重规划 | 恢复已取消的隐藏限制；只执行明确预算、真实权限和无进展派发规则 |
| P1 | Planner 获取全 ProjectSnapshot + 多个独立模型阶段 | 复制全量知识和历史，可能进一步放大 Token；任务局部上下文、按需展开 |
| P1 | 新 node_id/asset_ref/schema_version | 破坏 strict Schema 和现有消费者；沿用 id/assetRef/schema，版本放外部输入清单 |
| P1 | 重新创建 projects(uuid) 与 /v1 API | 不兼容现有 text 项目 id、会话与权限；增量扩展现有 /api/project 路由 |
| P1 | 每个 Issue 必须有 DB Migration | 不必要且危险；仅持久格式变更迁移，其他任务明确写“不需要迁移” |
| P2 | 全部重规划、故障修复都先启动 Replanner | 程序已能定位的小错误也变成模型流程；区分交接错误、产品修复、设计变化、环境故障 |
| P2 | Golden Set 只重复固定题、以优于旧版判成功 | 会有验证偏置；独立交付标准、保留未见 idea 与变更/中断案例 |

## 3. V3 边界：自由执行与可靠交接

### 3.1 角色

| 角色 | 有权做什么 | 无权做什么 |
|---|---|---|
| 用户 | 确认目标/约束，批准范围、预算和重要变更 | 沉默不能被当成批准 |
| 协调 Agent（含规划/重规划能力） | 选择设计深度、功能切片、工具、必要委派；提出任务和依赖 | 修改原始确认需求、授予自己额外权限或以自评代替交付证据 |
| 专业作者/执行者 | 在任务授权内完成决策和产物，使用专业 Skills，保存结果和问题 | 静默改其他任务内部产物或已确认范围 |
| BGS Workflow 控制模块 | 验证任务交接数据、调度、授权、状态、版本、取消、用量及检查器结果 | 控制每次 Read/Write、重写原生工具、强制专业解法、替模型判断玩法语义 |
| Review | 基于原始需求、实际来源和下游影响提出问题 | 没有充分依据就阻止交付、创造新增需求、自己决定用户承诺的变化 |
| Revision 所有者 | 修正受影响源和消费者；在原要求内作专业取舍 | 向用户转嫁普通专业决策、凭作者声明关闭独立验证 |
| 确定性检查器 | 运行其明确范围内的 Schema、布局、引用、构建和规则测试 | 输出“游戏完整/足够有趣”的笼统结论 |

职责定义在角色/任务 prompt 和用户授权中；Skills 提供工作方法，不再定义另一套业务边界。要求使用相关 Skill 时，记录实际加载/执行证据，目录里出现名字不等于使用。

### 3.2 Claude Code 兼容红线

- V3 不修改 Claude Code 的 query loop、原生工具描述、压缩、思考、工具结果或最终回复提取。
- 使用已有正常 stream-json 和 permission/question 协议。完成请求仍由原生执行器正常结束；不靠文件出现提前杀进程，不用伪造 assistant complete 省一轮请求。
- V3 首版不发送旧 `beegame_direction_authors`、`beegame_project_turn.authorDocument/reviewDocuments/milestoneResult/production` 来触发固定流程。新旧运行路由必须分开；不能借旧字段偷偷调度八文档或开启旧 StopHook。
- 已有原生 BGS 特判属于 legacy 兼容，不在本文修订中删除。新运行须证明未进入这些路径；旧项目退役之后才另行决定原生补丁清理。
- 现有协议不够时，优先使用已有权限接口和 BGS 可调用能力；必要新增接口只为明确交接问题。不得假定“原生取消/子代理已完成”自动等于业务成功或父任务全部完成。
- 本规范不是关闭权限、安全沙箱或真实账户额度的授权。

### 3.3 通用业务与技术路线

通用业务只负责：确认 idea／约束 → 授权必要任务 → 保存实际成果与版本 → 按项目要求验证／Review／Repair → 交付当前已测游戏与可继续修改的工程。这个描述不是六个强制串行阶段；简单游戏可以在同一开发任务中完成设计与实现。

| 层面 | 负责 | 不负责 |
|---|---|---|
| 通用 BGS | 需求、任务输入输出、所有者、权限、独立上下文、事件／用量、版本、暂停恢复、真实 Question、问题与修订交接 | 指定 DOM／Canvas／Scene JSON、Bun 构建、引擎玩法实现；给每种操作套额外 MCP |
| Web／React 路线 | Agent 写项目源代码、使用正常包管理／构建／浏览器工具；以实际运行与工程包验收 | 不需要额外引擎控制 CLI／MCP 层；不为已有检查器改用其指定的表现形式 |
| Unity／Godot 路线 | Agent 通过已可用且获授权的引擎 CLI 和／或 MCP 操作真实工程；源文件、场景、资源、运行和构建均以该工程为准 | 不要求同时具备 CLI 和 MCP，不将引擎工程转换成 HTML 或 BGS JSON 才能交付 |
| BGS 内容专项（可选） | 采用 BGS Scene/UI 编辑／内容消费时，沿用其 JSON、registry、manifest、绑定与适用检查 | 不是另一条必选开发路线；普通代码 UI、引擎原生 Scene/UI 不因此强制维护第二套权威 |

开发路线与发布平台分开：Unity／Godot 项目即使导出浏览器版本，开发控制仍属于引擎路线；Web 运行检查至多覆盖那个导出版本，不能证明原生工程可继续开发。React 是 Web 技术选择，不是必须控制的外部引擎。

技术路线依据原始需求和已有项目，在必要任务开始前写清**所用技术／版本、开发控制方式、目标运行环境、需交付的工程与产物、验证入口、是否采用 BGS 内容**。先复用当前需求 `constraints` 和任务目标／输入／输出，不新增路线注册表或复制一份工程描述。当前 constraints 只是被保留和传递，尚不等于代码已按它选择驱动。

用户已指定技术不得静默替换；有权专业选择不必每次发 Question，改变已确认技术／平台、安装或连接需要新权限时才确认。工具不可用应报告具体缺口，不通过改成 Web、补 package.json 或伪造通过绕开。

### 3.4 保留、移除与收窄清单

这里的“移除”首先指退出通用规则／默认排期；不是本轮删除源码或历史数据。

| 对象 | 处置 | 理由／代码调整边界 |
|---|---|---|
| Run／Plan／Task／Attempt、CAS／fence、项目权限、事件与计费 | 保留 | 解决真实交接、并发和费用问题，与游戏引擎无关；不再建一套 |
| 原始需求、薄来源指针、局部上下文、Skill 实际使用记录 | 保留 | 不复制设计权威；Skill 帮助工作方法，不扩大职责或证明品质 |
| 来源绑定 Review／Repair、Question、过期证据拒绝 | 保留通用交接；收窄证据解释 | 格式和当前引用可复用；现有 verifyWith 受 CHECK_IDS 限定，缺引擎实际检查不能以格式检查关闭产品问题 |
| Web build／runtime-smoke、已测 Preview、静态及源码 ZIP | 保留为已实现 Web 专项 | 不删正确能力；停止称它们为通用工程构建／运行／导出，后续不支持的路线返回准确未验证 |
| BGS 内容布局／资源／绑定、UI／Tilemap／字体／音频探针 | 保留为明确选择的专项 | 不强制其他项目生成 BGS JSON、复制资源或提供 DOM selector；检查的已有局部覆盖不扩大解释 |
| 八领域必要设计及可读说明 | 保留 | 游戏规则、场景、UI、数值和专业方向仍须明确；写在该路线的实际权威来源，不恢复八份稿存在性门禁 |
| Web 专项全部补齐才算通用 V3 完成的排期 | 移除 | 暂停无项目依据的 3D／动画／字体／音频驱动补齐；项目真有要求时再验证，不删既有需求或把缺证据改成通过 |
| 通用计划默认 package.json／index.html／BGS registry 的示例与说明 | 移除默认含义，归位为专项示例 | 不改现行已保存任务字段或旧证据；修改实际驱动选择时才同步必要调用方，不先做协议大迁移 |
| 新跨引擎框架、通用渲染器、统一 Scene 模型、独立控制服务 | 不新增 | 尚无必须靠这些解决的已证实问题；先接一个实际引擎任务，发现重复再讨论最小复用 |
| 正式 frontend 接线、Claude Code query／tool／StopHook 改动 | 不实施 | 当前授权明确排除；debug 复用正常鉴权，不能替代以后单独授权的正式产品入口 |
| legacy 固定流程及原生旧特判 | 暂保留兼容，分开退役 | V3 不进入旧特判；BGS 无调用旧分支经核对可退役，Claude Code 侧清理不在授权内，旧项目和原始记录不删 |

### 3.5 尚缺能力与不扩大结论

| 缺口 | 最小需要 | 当前状态／不应替代的方法 |
|---|---|---|
| 需求选择与真实执行一致 | 保留确认的开发路线，将实际工具／产物／检查匹配到同一任务；错误说明适用范围 | intake 引擎枚举已有，V3 的匹配未接通；不能只加一句 prompt 声称支持 |
| 引擎真实操作 | 先核对本机已有引擎、版本、CLI／MCP 能力及权限；在临时合成工程验证一次真实修改、保存和运行 | Unity／Godot 未验收；不先预建两套适配器，不自动安装或注册 MCP |
| 路线对应构建／测试／运行证据 | BGS 记录已授权实际入口的退出、诊断、源码与产物身份；观察该游戏开始→游玩→结果→重开 | 当前 build／rule-tests 为 Bun、runtime 为静态浏览器；引擎日志无错误也不等于可玩 |
| 引擎工程交付与版本一致 | 导出／打开该引擎需要的源码、场景、资源、配置及必要说明；重开后运行；改动后重新验证 | 现有已测 Web ZIP 不适用，不要求原生工程含 index.html；不承诺所有发布平台同时支持 |
| 引擎／MCP 副作用的修改和中断恢复 | 区分原生 Agent 结束与编辑器／构建／导入等操作结束；确认工程保存及无旧操作继续写入，保留操作身份和候选 | 现有 quiescedAt 只覆盖已收尾的宿主／原生任务，不自动覆盖未知引擎操作；不凭超时解锁，也不关闭无关编辑器 |
| 真正用户入口与完整游戏／成本 | 先通过 debug 验证从 idea 到新版本工程；付费后逐请求统计，并检查实际玩法、反馈、美术、音频是否满足当前要求 | 普通 Chat 自动初创／变更、正式部署及真实模型质量／成本仍缺；正式 frontend 暂不实施，不能宣称产品已经闭环 |

未支持的检查器是能力缺口，不是游戏必须改技术的理由。即便工具可调用，BGS 仍可能缺少可靠观测／身份记录；此时可做明确标注的探索，但不能沿用作者声明或 Web 的 passed 获得完整交付资格。某条路线的缺口不迫使已支持路线重做，也不要求每个游戏用齐所有专项检查。

## 4. 设计和产物：一份答案，可继续修改

### 4.1 八个设计职责

| Domain | 必要交付责任 | 可留到实际制作验证 |
|---|---|---|
| gdd | 玩家承诺、范围、核心循环、动作/结果、成功失败、状态转换 | 手感、节奏、趣味假设 |
| technical_design | 运行路线、必要能力依据、数据/初始化/清理/集成 | 实测性能、组织细节 |
| art_direction | 视觉语言、层级、非颜色辨识、资产和界面一致性 | 实际观感与细节打磨 |
| audio_design | 事件映射、播放/停止、并发、静音及跨状态行为 | 音色、响度、混音听感 |
| ui_ux_design | 画面与导航、输入/反馈、适配/异常入口及该路线的 UI 实现依据 | 目标运行时交互、实际字体/文本 |
| level_scene_design | 可构建布局、目标/路线/障碍/出生与取景及该路线的场景实现依据 | 难度节奏及局部布置 |
| balance_design | 单位、计算关系、合法范围、可运行初值和调优目标 | 最终平衡 |
| asset_plan | 必需资源覆盖、规格、来源/许可/消费与授权回退 | 非必要装饰替换 |

玩法和范围归 GDD；专业需求归对应角色；技术实现不反过来改玩法。数值不是全部归 Balance：音频时长等专业参数归其实际所有者。资源清单不能新增玩法。

八份文件名称作为 legacy 和可选导出格式保留，不作为 V3 新建项目的存在性 Gate。用户要求完整文档时仍须交付，不因减少 Token 删除用户要求。

### 4.2 唯一权威与小索引

- 必需设计可以写在短 Markdown、实际代码／配置、引擎场景或已选择的 BGS Scene/UI 数据中；同一决策只维护一个位置。可读说明解释玩法和修改入口，不复制已经生效的坐标、参数或 UI 树。
- 使用带版本的原始 confirmed brief/附件作为需求来源；普通 profession 选择不是新的用户要求。
- 最小需求索引包含稳定 id、原始来源、必需/可选、所有者、决策来源指针、关联任务和验证方法。声明“accepted”或“covered”由宿主记录，不由作者自己落字段。
- 需求索引不复制状态表、关卡坐标、数值表、播放规则。可读导出从源和指针生成，不让 Agent 再写一篇同义总结。
- 用户显式平台、语言、方向、输入、资源策略等结构化约束由宿主直接保留。自然语言需求的提取可能漏项：保留全文、展示有实质风险的解释，检查原始需求而非只查模型生成的索引。
- 一项需求有 Task/Test 链接，只证明关联存在；不能因此宣布它已正确实现。语义遗漏没有被 Schema 自动消除。
- 每次授权修改产生新源版本；已测输入和历史源快照保留。工作文件可以作为新候选版本更新，不承诺“整个工作树只读”；promotion 时须证明输入版本未漂移。
- 后续用户改游戏时，以当前确认需求、任务来源和正式产物为依据，不以长会话记忆或旧 reviewer 摘要为依据。

### 4.3 BGS Scene/UI/资源契约（仅已选择该内容能力的项目）

以下不是通用游戏产物要求，也不因采用 Web／React 自动适用。采用 BGS 内容时直接沿用当前：

- `beegame-content.v1` 文档，`beegame-content-package.v2` 包索引，`game-object-v2` Scene 模型；
- `id`、`parentId`、`assetRef`、组件 id 和当前角色/组件词汇；
- `assets/asset-manifest.json` 及其 requirements/resources 和现有资源注册/绑定接口。

不得为 V3 向 strict 文档随意加 `node_id`、`asset_ref`、`pending_asset_ref`、`version`。正式占位使用现有 draft 校验和已声明未绑定资源需求；记录待生成关系在任务输入/资源计划，不伪造可解析的 Ref。确需扩展 Schema 时，同步作者、编辑器、消费者、绑定器、检查器和兼容读取，不只改一处。

Scene/UI 设计、资源生成、绑定可按有效局部依赖交接；不是所有资源都齐了才允许写第一份 UI。绑定后的最终资源、字体和内容必须再次验证。空间计算不证明字体、交互和视觉质量；静态渲染不证明运行游戏消费了该 JSON。

只有明确选择 BGS Scene/UI 编辑或内容消费能力的项目，才必须生产并实际消费对应 JSON；Agent 不能为避开已确认能力自行取消它。普通 Web／React 和 Unity／Godot 原生工程采用自身实现来源，不为 BGS 校验维护第二份 Scene/UI。资源来源／许可／可用性仍须验证，但现有 manifest 不是所有技术路线的强制文件格式。探索原型可用临时占位，须明确非正式交付；不假定屏幕检查适用于 XR。

## 5. 最小架构与数据模型

### 5.1 技术栈和复用决策

继续使用现有 Bun/TypeScript/Hono、Supabase/PostgreSQL、项目存储、权限、计费和原生执行适配器。Workflow/Gate/Artifact 是职责模块，不是首版独立微服务。

这里描述的是 **BGS 宿主技术栈**，不是游戏必须采用的技术栈。游戏项目的构建、场景、UI、音频、工程包和运行方式按 §3.3 的实际路线确定；不把宿主使用 Bun 推导成所有游戏都要 `bun run build`。

`packages/workflow-engine` 先做适配评估，不默认重用也不默认另建同名引擎。其现有脚本 hash 改变会清 journal，与“保留有效子任务”不一致；动态任务定义不得被转换成无沙箱的模型生成 JS 执行。首版使用数据形式的计划及一个 BGS 控制模块；任何复用须通过本文的恢复/局部变更案例。

### 5.2 最小对象

- **Run**：某项目的一次明确目标/局部变更；绑定 workflow protocol、原始需求快照、现行 plan revision、状态。
- **PlanVersion**：不可变任务与依赖快照。不是每次工具调用一份新计划。
- **Task**：独立可交接的功能/产物集合；稳定 task id、spec revision、输入/写入范围、依赖、检查要求。
- **Attempt**：一次原生执行；原生会话/turn/子代理身份、输入 manifest、结果、用量、外部副作用记录、失败证据。
- **Artifact/Check reference**：现有文件/构建/资源/观察的身份、字节摘要、来源版本和检查条件；不引入每段 prose 一个数据库对象。
- **Question/Change**：真实用户选择及授权，绑定需求/计划版本；计划中的“请用户批准”不是已经发出的问题。

首版持久化使用现有项目身份，并增量增加 run、plan version、task、attempt、check result 和状态事件的数据；来源/产物清单可作为不可变 JSON 快照保存，不先建全量 design_records、artifact 注册和通用依赖库。

`project_id` 引用现有 `beegame_projects.id text`，复用 workspace/owner/共享权限。不得新建一套 projects/users/sessions/usage_events。是否拆表按事务、查询和审计需求决定，不强制每个概念一个表。

### 5.3 必须持久化的约束

这些不是“以后生产化再补”：
- tenant/project 权限、同 run 依赖、唯一 task key/attempt/idempotency key；
- plan revision 的 compare-and-swap；一次只发布一个现行计划；
- 原子领取、同 workspace 的写者租约和递增 fencing token；
- attempt result 只允许当前 attempt、当前租约、当前输入版本提交；
- 状态、check 关联和事件在同一事务提交；禁止只写事件不写状态或反之；
- 计划/已接受源/check 历史不可被后续任务静默覆盖；
- 外部计费、生成操作保留幂等键/请求身份；不能把 DB 事务说成对外部服务的 exactly-once 保证。

本地文件后端只能用于明确单进程开发模式；现有 Promise 锁不能支持多 Worker。租约过期不证明旧进程停止：未能终止或核实旧写者前不授权新写者进入同一工作目录。

### 5.4 状态

Task 当前状态：`pending → running → validating → succeeded`；另有 `blocked / failed / cancelled / superseded`。ready 由依赖和权限计算，不必另存一个可能过期的权威状态。

Attempt 完成不等于 Task 成功。输入改变后，历史成功保留，但该结果不再满足现行任务；用新 spec/input revision 或新的修复任务承接，不给只读历史任意加 stale 字段。

Run：`planning / running / awaiting-user / paused / blocked / completed / cancelled`。重规划是有事件和版本的一次操作，不必为它再创建长驻 Replanner 状态机。

Artifact 的检查是能力集合而非一个万能 validated 标志：同一 UI 可“Schema 通过、布局通过、交互未验证”。任务只能按它实际需要的检查资格消费，探索使用须声明限制。以上为业务语义描述，不要求把所有状态词新增为代码枚举；当前 Run.status、Task.status 及 paused 字段以 state.ts 为准，不为名称统一另建状态机。

## 6. 规划、执行及上下文交接

### 6.1 任务粒度

一个可运行功能切片可以同时涉及玩法、Scene、UI、音频、数值和技术。不要按每个领域/检查器/文件保存建立独立任务。

合理单位：规则与输入闭环、开始/暂停/结局体验、资源与内容集成、最终目标运行时验证。领取文件、保存索引、修一处拼写不是独立调度任务。简单小游戏可只有几个业务任务，复杂项目按真实依赖细分。

Planner 输入只包含原始需求、当前局部状态、当前任务必要来源和能力目录；不复制所有文档、资源字节、历史工具日志。全量事实保留可寻址位置，需要时读取。

### 6.2 最小计划协议

计划是数据，不是模型生成的可执行脚本。必须被宿主解析的字段采用 Schema；专业说明仍可自然语言。以下是**当前静态 Web＋BGS 内容专项**的交接示例，不是通用游戏模板，也不能作为 Unity／Godot 计划示例：

```json
{
  "protocol": "bgs.workflow.v3",
  "baseRevision": 0,
  "requirementsRevision": "host-snapshot-id",
  "tasks": [
    {
      "id": "build.playable-slice",
      "kind": "game.develop",
      "goal": "按已确认规则交付首个完整可玩切片",
      "dependsOn": [],
      "requirementIds": ["req.player-loop"],
      "inputs": ["requirement:req.player-loop@host-snapshot-id"],
      "writablePaths": ["package.json", "game/**", "content/**", "assets/**", "docs/design.md"],
      "expectedOutputs": ["game/dist/index.html"],
      "runtimeArtifact": "game/dist",
      "checks": ["build", "rule-tests", "runtime-smoke"]
    },
    {
      "id": "verify.delivery",
      "kind": "game.verify",
      "goal": "核查原始需求、实际运行行为和交付文件",
      "dependsOn": ["build.playable-slice"],
      "requirementIds": ["req.player-loop"],
      "inputs": ["output:build.playable-slice/game/dist/index.html"],
      "writablePaths": ["verification/**"],
      "expectedOutputs": ["verification/runtime.json"],
      "runtimeArtifact": "game/dist",
      "checks": ["runtime-smoke", "delivery-package"]
    }
  ]
}
```

具体合法目录由项目格式决定，示例通配路径不自动授予权限。当前依赖可用稳定身份表示未来输出，但运行时必须绑定实际版本和 hash；不能用字符串逻辑名冒充已存在资源。此例展示目标链；当前 runtimeArtifact 仅支持含 index.html 的静态构建，包检查要求构建内保留与源相同字节的 content/ 与所用 assets/。缺少注册源/资源或不支持的编译、服务器目标会未验证。verification/runtime.json 是任务的实际观察记录，不是独自授予通过的报告；宿主另行执行已连接检查，Run 仍无完整交付资格。

Plan Validator 的目标范围是：结构、唯一 id、依赖存在/无环/同 run、来源类型、路径权限、检查器存在、原始已登记必需需求未丢失、用户设置的预算条件、与当前有效结果的版本关系。当前代码已连接结构/已登记来源/范围/依赖与重规划时的记录版本核对；预算策略和完整交付覆盖不能算已实现。空计划或仅有可选任务不能满足明确游戏交付目标；完整交付还必须有实际构建/目标运行时/交付证据，现有 Task 最小格式检查不替代这个条件。它不能仅凭 JSON 证明任务可行、设计无矛盾或全部自然语言需求已覆盖。

拒绝后返回全部明确错误供当前规划者一次修正，不拆成多轮零碎反馈。重复相同无变化提案不自动派新付费规划者；保留错误、交给用户或协调 Agent 的当前授权交互处理。

### 6.3 正常执行

1. 发布有效计划，确认当前用户授权、费用条件和任务输入。
2. 原子领取一个生产写任务；生成局部输入 manifest 和必要任务上下文。
3. 调用既有原生适配器；记录 Task/Attempt 与 native session/turn/子代理对应关系。
4. 保留原生工具/思考/权限/Question 事件的真实归属；子代理细节显示在其面板。
5. 原生正常结束后收集实际文件变化及完整用量；完成声明只能触发检查，不授予成功。若本任务仍有原生后台写作子代理运行，先按原生事件核对/等待其结束，不以父回复作为写者已经退出的证明。
6. 运行当前任务所需的已有检查器/实际观察；保存检查输入与结果，事务提交任务状态。
7. 满足依赖的任务继续；未满足的阻断只影响其消费者，最终交付仍等待所有到期要求。

暂停/取消先停止新派发，按原生协议取消当前执行并收尾用量。保存部分正确产物，但不标为已验收。服务重启后默认标明中断并核对活性/副作用；只有该 Run 仍有有效续作授权时才能恢复，人工暂停不能被重启解除。

### 6.4 上下文与 Skills

- 每个任务默认独立原生上下文；同一任务修复/续作可复用其历史。用户 Chat 与原生执行身份分离，不能为保持一个聊天面板而把所有任务接在同一历史上。
- 任务输入包含原始约束一次、必要专业职责、相关源、未决问题、实际能力入口。公共系统输入保持稳定，不按每一阶段换整套 system prompt。
- 交接报告只传实际路径、有效检查引用、失败/限制；不要重复正文或把后台日志注入主模型。
- 按任务使用已有策划、美术、音频、UI、场景、数值、内容和试玩 Skills；不强制一次载入全部 Skill 正文。复用原生 Skill 支持，V3 首版不新增原生 preload 特判。
- Task success 后的机械状态更新/检查汇总由宿主处理，避免额外“总结一下全部材料”的模型请求。
- 任务 native session 不得被现有“项目最近一次 session 就是 Chat”选择逻辑误认。显式保存用户 Chat 与 Run/Task/Attempt 执行身份的映射，事件按真实归属聚合；不为每个任务无标记地新建同 projectId 会话后覆盖聊天/恢复入口。
- 同一模型仍可能把保存拆小步。保留可选批量保存/绑定入口与清晰失败定位，但不能仅凭提示词或更换 Planner 宣称已经解决。

## 7. 检查、Review、Revision 和真实 Question

### 7.1 检查结果协议

每个 Check 记录：check id/version、task/attempt、实际输入文件/版本/hash、适用条件、执行入口、观察/诊断、覆盖对象、未验证项、证据位置与生成时间。

状态：`passed / failed / unverified / execution-error / not-applicable`。
其中 `not-applicable` 是适用性判断，当前 `CheckResult.status` 仅实现前四种；不要给 strict 契约写入未实现值。明确无关的检查不应被列为该任务必需项；已声明检查缺驱动／输入仍是未验证，不能临时标不适用来绕过确认需求。是否新增状态须由实际接口需求决定，本轮不新增。
- 缺输入/缺观测：unverified；
- 驱动/环境出错：execution-error，不直接推导产品失败；
- 明确不适用：必须有原始范围依据；
- 有结果但未独立执行/没有有效证据：不能 passed；
- 源、字体、资源、运行条件或检查器变动后按实际关系判定失效。

检查矩阵：

| 检查 | 主要方法 | 不证明什么 |
|---|---|---|
| Plan/索引格式与 ID | 宿主 Schema/图/范围检查；Scene/UI 格式按项目已选择的实际数据 | 决策正确、无语义遗漏 |
| 资源引用与实际成员 | 实际资源来源／引用／可用性；BGS manifest 项目使用已有成员检查 | 美术品味、音频听感 |
| UI 几何与组成 | 实际 UI／视口／叠层；BGS 内容项目复用空间算法，其他路线观察自身 UI | 未声明画面的覆盖、完整交互 |
| 正文矛盾、职责、需求理解 | 有限专业 Review；原始源与下游影响 | 绝对无漏检、平台事实真实性 |
| 规则与数值 | 实际可执行规则/算例/边界测试 | 作者自己生成的测试一定代表原始需求 |
| 工程构建 | 受控实际 build/typecheck/test | 游戏可玩、数据真的被消费 |
| 目标运行时 | 开始→游玩→成功/失败→重开，输入/暂停/音频/反馈与错误观察 | 真人觉得有趣、所有设备都已测 |
| 交付 | 当前被测构建、资源/依赖/启动说明/下载完整性 | 未测试源或另一次构建也正确 |

关键规则测试应从确认的条件/动作/结果核对，不仅接受作者测试名或绿色勾。宿主必须核实真实进程结果/记录与输入身份；AI 写 passed 报告、hash 正确或链接存在都不足以证明观察真实。

### 7.2 Review/Revision 的限度

不是恢复八文档联合审查门禁，也不是每个 save 一次 Review。
- 必要专业决策合并、跨职责冲突或重大改动触发定向 Review；实际运行问题优先按数据、规则和目标运行时验证。
- 问题必须给出实际来源、下游影响、关闭条件和有权负责人。润色、可选优化、等价偏好不得阻止交付。
- 一次针对性审查 → 集中修订 → 核对改动及实际消费者；仍有争议就升级具体问题，不自动无限聘请新 Reviewer。
- 这是自动派发边界，不限制原生 Agent 在当前授权任务中调查/修复的工具轮数；真实新证据或新用户授权可以继续。
- 不把次数到达上限当作通过。缺证据、缺裁决或不能验证的要求保留未完成/风险。
- 美感、反馈、音频和趣味必须在实际游戏中观察；不设模型主观分数作为唯一合格标准，也不让每个小游戏必做真人研究。确需真人/设备判断的关键要求，明确裁决来源和未验证影响，不承诺全自动保证。

### 7.3 需要用户裁决时

范围、确认规则、预算或重要授权变化须走真实 question 协议。复用已有权限/AskUserQuestion→UI→答复→执行链，禁止只保存 owner=user finding 后静默停机。

问题绑定 requirement/plan revision 和 finding id，包含冲突、可选方案、影响及推荐。当前 V3 用独立 debug 和正常答复接口验收，不恢复正式 frontend 接线。用户拒绝、暂不回答或交互不可用都不是默认授权。恢复时核对问题仍适用于现行版本；过期答复不能改新计划。普通专业取舍由任务有权负责人决定，不把所有缺细节都扔给用户。

### 7.4 当前后端可调用契约与适用边界

以下分为专项驱动与通用审查交接，不能因字段位于同一 Task 就认为适用于所有技术路线。现行 Schema 字段保持兼容；本轮没有新增引擎字段／检查 ID，也没有改写历史计划。字段可选，仅在任务确有相应责任时使用，不要求每次保存新增一个 Task。

**Web／BGS 内容专项**：`runtimeArtifact` 在当前代码中专指静态 Web，不是任意引擎构建路径；`editableProject` 当前只实现源码副本 Bun 构建。`build` 和 `rule-tests` 的现行实现同样是 Bun package scripts；`delivery-package` 是 BGS 内容包副本检查，不是任意项目的完整交付。UI／pixel／font／audio 消费检查仅适用于各自已支持的 BGS 数据与目标消费者。未来引擎接线不能复用同名 passed 而不记录实际驱动／版本／覆盖，也不必强行复用这些字段。

- **已测可编辑工程**：`game.develop` Task 使用 `editableProject:true`、`runtimeArtifact:"dist"`、`checks:["build","runtime-smoke"]` 与 `writablePaths:["dist/**"]`。构建消费实际可导出源码副本；要求项目自足的 build script，使用已安装依赖时保存锁文件。下载 `kind:"project"` 只接受这份宿主来源证据与同字节运行测量；不因源码同名或静态包成功补造资格。具体排除项及安装边界见 §1.14。

- **UI 消费**：Task 声明 `runtimeArtifact`、`checks:["ui-data-consumption"]` 及 `uiProbes:[{document:"content/ui/menu.json",nodeId:"play",selector:"#play",viewport:[1280,720],steps:[{click:"#open-menu"}]}]`。steps 可省略；只能是实际目标 DOM 的点击路径，不接受任意 Agent JS 或 PASS 回执。源须在真实 v2 registry 中，构建副本与源同字节；probe 覆盖已注册 UI 文档及源声明的目标视口。此驱动不能消费 Canvas／camera-reference 等未连接的目标。
- **静态图片／Canvas 消费**：Task 声明 `runtimeArtifact`、`checks:["pixel-data-consumption"]` 和 `pixelProbes:[{document:"content/scenes/level.json",nodeId:"board",componentId:"sprite",selector:"canvas",viewport:[960,540]}]`。UI image 不填 componentId，Scene 必须精确选择组件；steps 沿用实际点击路径。所有已注册图像绑定须有 probe，UI 每个图像节点须覆盖源声明目标视口；期待几何从保存源和既有投影计算，不接受作者预期矩形。实际 Canvas 内部及 CSS 尺寸须匹配视口；图片必须是可隔离的静态 raster／显式 named atlas frame。tilemap componentId 按 §1.27 展开全部已用 tileId／格子，限定静态轴对齐、不重叠、图片区域可隔离的 2D 情况；碰撞／排序、共享同图同 frame、3D／动画／Canvas 字体／音频等不由此授予通过，完整交付仍关闭。
- **静态 DOM 字体消费**：Task 声明 `runtimeArtifact`、`checks:["font-data-consumption"]`，沿用 `uiProbes:[{document:"content/ui/menu.json",nodeId:"title",selector:"#title",viewport:[1280,720]}]` 及可选点击路径；源节点须有静态 `text`、明确 `data.font:{assetRef:"<已注册资源>",member:"<可选准确注册文件路径>"}` 和有效继承字号。使用实际原生 CSS selector，覆盖全部显式绑定及源视口；源／字体构建副本须相同字节。可与 `ui-data-consumption` 共用同一任务和探针集合，字体消费者跳过已知无字体节点，不跳过缺失绑定。具体因果观察和限制见 §1.28；不要求每个字体或检查单独一个 Task，也不以 CSS family／下载记录替代实际 glyph 观察。
- **HTML 音频消费**：Task 声明 `runtimeArtifact`、`checks:["audio-data-consumption"]` 和 `audioProbes:[{document:"content/scenes/level.json",nodeId:"board",componentId:"sound",selector:"#clip",viewport:[960,540],playSteps:[{click:"#play"}],stopSteps:[{click:"#stop"}]}]`；可选 steps 只用于进入目标场景。来源为已注册 Scene 的 audio-source，组件有 assetRef、明确 data.volume（0..1）／data.loop，可选 data.member 为准确注册文件路径；所有已注册 audio-source 须有探针，源及编码资源的构建副本同字节。宿主不代调用游戏 play／pause，不接受作者期望值或 PASS；实际点击游戏按钮，观察原生播放时钟／暂停／静音状态及解码信号，改变音量／循环属性来源，替换静音响应再恢复。这里只检查 loop 属性消费，不证明实际循环边界；捕获信号不代表最终输出音量、混音或听感。短音效、脱离 DOM 的 Audio、自动播放、Web Audio／合成／空间音频等另需证据。沿用现有 verifyWith／Repair，不另设音频审查阶段，不强制每个声音一个 Task。
**通用审查交接**（现有可执行关闭检查仍受 §3.5 所述能力限制）：

- **首次定向 Review**：`game.verify` Task 声明 `reviewReport` 为 expectedOutputs 内的项目相对路径，并要求 `review-findings`。输入为原始需求及实际相关来源；必要 `skills` 显式声明并沿用真实原生加载证据。不允许修改被审来源。
- **集中 Repair**：`game.develop` Task 声明 `repairOf:{attemptId:"<旧审查实际 UUID>",findingIds:["F1"]}`，要求 `repair-verification` 及 finding 的实际 `verifyWith` 检查。来源变化时先重新明确问题，不猜旧记录；所有者不能靠扩大当前 plan 的 writablePaths 绕过旧授权。正常原生结束后宿主检查，不增加机械总结请求。
- **定向复核**：verify Task 声明 `reviewOf:"<旧审查实际 UUID>"`，另存 `reviewReport`；读取当前修订输出、保留的真实用户选择与相关实际检查。关闭项必须引用当前有效、实际成功的 repair Attempt 及被修订源；必要检查过期、删掉／降级旧 blocker 或仅写“已解决”均不关闭。

保存的审查报告格式：

```json
{
  "requirementsRevision": "<宿主需求版本>",
  "planRevision": 2,
  "findings": [{
    "id": "F1", "requirementId": "req.player-loop", "ownerTaskId": "build.playable-slice",
    "severity": "blocker",
    "sources": [{"path": "game/rules.json", "sha256": "<实际源 hash>", "quote": "<实际原文>"}],
    "impact": "具体下游影响", "close": "具体关闭条件",
    "verifyWith": ["rule-tests"], "needsUserDecision": true
  }],
  "closed": [],
  "limitations": ["实际未覆盖范围；不能保证语义无漏检"]
}
```

复核关闭项格式为 `{id,repairAttemptId,sources:[{path,sha256,quote}],observed}`；`repairAttemptId` 由宿主保留的实际修订记录取得，不自行编造。`verifyWith` 只是指定必须执行的检查，不是原始需求已覆盖的证明；只有 JSON／Schema／Skill 加载证据时，即使已回答 Question，修订仍未验证，需要具体升级处置。当前 source quote／文件 hash 格式不能自然覆盖二进制或引擎内状态；这类问题保留实际可读来源与真实运行证据，不让 Agent 伪造 JSON 报告弥补缺驱动。报告与关闭理由仍有模型／人工判断成分，宿主不伪装成语义裁判。

`needsUserDecision` 时，作者实际调用标准 AskUserQuestion，把 finding ID 放在 question header，提供冲突、选项及影响，不填答案或 BGS 元数据。BGS 的来源绑定信息放在自身事件中，不注入原生 tool input。答复仅经当前用户、当前问题和当前来源核验后发送给所属修订任务；拒绝／取消不授权，源变化则记录拒绝原因。该链复用既有权限答复接口，当前独立 debug 已有答复和状态证据；正式 V3 界面未接入。原始需求改变仍须单独的授权版本协议。

## 8. 局部修改与中断恢复

### 8.1 实际依赖，不是万能字段图

输入清单区分：直接文件/JSON节点/资源成员、必要设计源、原始平台政策、公共能力版本。结合 Agent 声明与实际工具观察核对，声明并非完整事实。

原生 Bash 对间接文件读取不一定提供完整追踪；不能因此声称依赖图准确无遗漏。首版用任务范围、入口和对应配置形成保守输入集；若需扩大回归，说明具体不确定来源。不要部署一个通用静态分析/字段级追踪框架来追求绝对隔离。

| 修改类型 | 回归范围 |
|---|---|
| 模块内部实现，输入/输出契约不变 | 模块行为 + 最近消费者集成；不要求改其他模块源码 |
| 交接格式、字段含义、版本策略 | 对应生产者、消费者、兼容读写、恢复与前端/编辑器 |
| 公共 Schema、加载器、渲染、权限、计费 | 使用该能力的消费者；必要跨任务/平台回归 |
| 单项资源替换 | 实际引用者、绑定、尺寸/字体/声音相关运行证据；不重写 GDD |
| 规则/范围/平台变更 | 真实有影响的设计、数据、代码、验收；变化本来广泛时允许广泛回归 |

文件 hash 判断字节变化，不自动判断语义影响。全局 release digest 可保留在最终发布关口；不得用它作为每个局部任务“全部重做”的依据。

### 8.2 重规划

- 保存触发原因、当前计划和有效来源版本；
- 给出新增/改变/取消任务及实际影响，保留有效历史；
- 已完成结果的现行资格失效后不能再被依赖满足；
- 运行中的旧任务先停派发，完成取消/活性核对及原子 revision 切换，再派新尝试；
- 迟到结果只作为历史/候选保存，不能提交为新计划成功；
- 计划改变不删除原生历史、原始检查或已接受产物；不调用 scriptChanged 直接截断全部 journal；
- 未改变源和输入的无关任务不重做；不为了补全新的知识库让所有旧文档再写一遍。

### 8.3 故障分类

| 故障 | 正确处理 |
|---|---|
| 参数、保存/格式、索引交接错误 | 返回准确对象和条件；原任务修复，无额外 Planner/Replan |
| 确认需求内的实现缺陷 | 有依据的局部 Repair，保持原需求和有效成果 |
| 平台/网络/测试环境异常 | 核对真实请求/进程/环境状态；不修改游戏规则来获得 PASS |
| 设计矛盾或缺少有权决策 | 有权 Revision，必要真实 Question，定向验证 |
| 依赖/方案根本不可行或确认需求改变 | 局部新计划及影响说明，范围变化由用户授权 |
| 相同输入、相同错误、没有新增证据 | 停止宿主重复付费派发，保留具体阻断原因 |
| 中断/旧 worker 活性不明 | 记录 unknown；核对/终止旧写者后恢复，不盲目重跑 |

外部生成/模型请求不支持幂等查询时，失去响应的操作记为 unknown 并核对；不能只因报网络错就再次收费生成。重放事件用于恢复事实，不重放非幂等业务操作。

## 9. Token 与耗时：具体优化对象

上一轮已授权 GDD 单次测试（不是本文新增实验）记录：

| 项目 | 实际值 |
|---|---:|
| 5 次请求总量（含缓存） | 195,011 Token |
| 首轮输入 | 33,231；去重前 33,773，减少 542 |
| 单独修正 GD D 拼写 | 40,042 Token |
| 单独保存索引 | 40,625 Token |
| 最终无工具完成回复 | 输入 40,671 + 输出 381 = 41,052 |
| 相比上一轮总量 | 增加 70.4%；不等于人民币费用增加同一比例 |

原始证据：`/private/tmp/bgs-gdd-bgsonly-paid.h0CPzf/cost.json`。旧记录只读；生产运行最终应把审计副本纳入现有保留策略，不能把临时目录当长期可用性保证。

结论：本轮不是检查失败返工；已有批量保存提示仍未保证模型批量执行。任务独立上下文、可直接调用的批量工具、确定性检查移出模型对话有合理价值，但效果必须实测。固定原生首轮工具/系统开销仍存在，拆更多小任务会增加启动开销，不能以 DAG 本身宣称降耗。

实施要求：
- Task 粒度按可交接功能，不按保存/索引/工具；
- 首轮只送必要业务输入；不试图通过篡改原生工具省固定成本；
- 宿主检查完整批次一次输出具体诊断，复用仍有效结果；
- 资源/Content 批量操作在采用 BGS 内容的项目中复用现有工具；其他路线使用自身可用入口，不让作者为适配 BGS 校验重建一套数据；
- 记录 request、task、attempt、actor、native accounting epoch 的实际 uncached/cache-read/cache-create/output；含中断和失败，避免累计快照重复相加；
- 实际计费由现有 billing/outbox 保持唯一权威；金额不可得时显示未知，不能用 Token 总数冒充费用；
- 用户预算默认未设置；仅已设置预算/真实额度触发阻断，保留用量与未完成事项。金额数据不可得却要求金额硬上限时须先明确控制方式；在途调用可能超出派发门槛，不能承诺逐 Token 精确停费；
- 不删除必要专业设计、运行验证或用户要求来达到数字目标；无意义重复不自动付费重跑。

## 10. 迁移切片与旧逻辑退出

旧项目和新 V3 Run 必须按持久协议版本路由；不能在运行中由全局 Feature Flag 改换模式。先保留兼容读取，最后删除无调用业务；不长期维护两套互相投喂的权威状态。

| 切片 | 改动位置/范围 | 必须保留 | 完成标准 |
|---|---|---|---|
| A：边界与任务贯通 | app 项目派发、project-conversation 新 V3 分支、任务持久化/领取 | 现有身份/权限/原生传输/费用；legacy 项目只读或原路径 | 合成“单可玩任务→检查→交付”贯通，无 authorBatch、八文档/旧原生任务字段 |
| B：真实设计/数据消费 | 任务局部源索引、路线的代码／原生场景／配置；采用 BGS 内容时连接其 helpers | 该项目的权威来源；已选择 BGS 能力的 Schema、id、binding | 未齐八文档可推进必要切片；规则/数据被实际使用；没有为工具省事遗漏必需领域 |
| C：定向检查/问题/修复 | Check 汇总、Review/Revision、Question、actual-runtime 验证 | 现有布局/字体/证据/原生 Question | 问题有证据和负责人；缺用户答复不假继续；伪造报告/漏验不得 passed |
| D：修改和恢复 | plan revision、输入清单、租约/fencing、外部请求身份、影响判定 | 正确产物、原生任务身份、计费幂等 | 中断、迟到结果、跨 worker、局部变更场景通过；不重做无关任务 |
| E：交付与退出旧逻辑 | 对应路线的工程导出／运行、独立 debug 状态、BGS legacy retirement | 已测版本约束、可继续编辑工程、旧历史 | 对应路线真实未见 idea 验收达标；旧项目无需重写可读取；正式 frontend／发布接线需另获授权 |

A 不先把六阶段改名成六种 Task 然后继续强制串行。B–D 可在同一纵向切片逐步加入，但每一块必须满足真实验收条件。不得先大规模建库/多服务，最后才试游戏。

需要替换或拆适配：
- `AUTHOR_BATCHES`、planning 的“写齐八文档才 review”、`NEXT_PHASE` 固定推进；
- V3 对八个 Markdown、最终 TECHNICAL_DESIGN implementationItems 和旧 receipt 的强制依赖；
- `projectContentAuthority` 全八文档摘要作为局部生产基线的用途；
- `project-conversation`/app 的业务续轮逻辑：改为有效任务依赖，不再自动下一固定阶段；
- 验收中“所有来源必为八文档条款”的要求：接受 V3 已确认源和产物指针，但不降低证据约束；
- 前端八文档/阶段进度硬编码：仅登记为未来独立授权的接线工作，本轮及当前后续排期不修改正式 frontend。

检查适配不得通过传空文档/空资源集合来绕开旧门禁并得到 PASS。需要将纯 Schema、布局、成员解码和证据算法与“八文档齐备”政策拆开，V3 自身验证所需输入覆盖；空输入只可明确 not-applicable/unverified。

不得直接删：
- 资源服务、内容 Schema、布局算法、预览/运行观察、字体/音频检查；
- 原始需求、原生安全/问题/事件/计费恢复；
- 有证据的发布门禁和历史，旧项目格式读取；
- 仅因文件叫 workflow-engine 或 delivery 就整体删除的正确实现。

## 11. API、前端和兼容

扩展现有 `/api/projects/:id` 路由，不创建第二套 /v1 项目和登录体系。首版业务操作：读取 Run/Task/检查/用量；启动授权的当前任务；暂停/继续/取消；提交用户问题答复/变更；当前版本交付/导出。

实际 URL 在实现时与现有 routes 整合，mutation 必须校验项目权限、请求幂等键、Run/Plan 当前版本。普通 Chat 询问状态/分析问题不自动授权生产续跑、重新规划或修改游戏；保留当前入口对初次创作、明确 Continue 和变更请求的区分。数据库 service credential、模型密钥和权限策略不得暴露给 Agent 文本或项目产物。

前端优先：目标、当前功能、预览、需用户回答的问题、未完成要求、实际检查和用量。高级 DAG/计划 diff 按需查看；不先做自由画布。整体进度不按任务数量冒充质量，不为玩法/美感给一个虚假的确定性百分比。

**当前前端变更边界**：后续 V3 实施／验收不顺带修改正式 frontend 的布局、入口或公共导航。开发验证优先现有后端测试、独立脚本；确需页面时使用与正式入口分离的 debug 页面，保留正常鉴权且不自动执行业务。必要正式接线须单独说明具体影响并取得用户确认，不由本清单默认授权。

旧项目：
- 保留 legacy state；目前 version:2 已被读取器拒绝，不能把数字 2 当可复用 V3 状态。
- V3 用独立 protocol/version 存储，不由旧读取器静默 normalize。
- 迁入时只读快照、来源导入和缺失工作识别；未经授权不重写文档/JSON、不补伪造 accepted 或重新生产。
- 关联无法确定则 unverified；继续可读/导出已有文件，不把“完成 V3 索引”变成用户查看工程的条件。
- 回滚切路由/代码版本，保留 V3 数据和审计；不能把新游戏成果覆盖为旧字节。

## 12. 实施清单与纠偏后的顺序

每项变更说明：已证实问题、最简单方案、输入/输出、实际源码边界、所需测试、是否需要 Migration 和回滚。不是每个 Issue 都创建 DB 表。

### 12.1 既有实现状态（不作为继续堆专项的排期）

以下 V3 编号保留方便追溯；勾选只代表所写范围，不将 Web 专项勾选解释成通用或全部技术路线完成。

- [x] V3-01 固化模式/原始需求快照/新旧路由。API 代码及核心回归完成，未切换默认生产入口；不表示已上线。
- [x] V3-02 最小 Run/Plan/Task/Attempt、原子领取、revision/fencing、权限已落盘；真实数据库三份迁移、结构／REST 权限、成功原子事务、双进程 CAS／单目录写者竞争及独立重载已验收。未知原生／外部操作恢复属于 V3-08，未借本项通过授予。
- [x] V3-03 用原生适配器贯通一个任务和实际检查，关联事件/用量。合成回归及真实 V3 CLI＋本机假模型保存/检查链路通过；未做付费真实游戏验收，不改 Claude query/tool/StopHook。
- [x] V3-04 任务局部上下文、现有 Skill 使用证据和薄来源索引已落盘并回归；实际 Skill 原生加载链通过，不代表专业方法运用或付费 Token 降幅已验证。
- [x] V3-05 **BGS 内容专项**的局部结构／布局／资源检查及批量绑定已接入，不依赖八文档；原始／新输出版本、写入范围、失败／partial 和幂等回归通过。不是普通 React 或引擎项目的必选流程，也不证明整游戏或付费效果。
- [ ] V3-06 **路线对应构建／运行／工程交付**部分完成。现有静态 Web 冒烟／包副本／Preview／两类 ZIP，以及 BGS UI／图片／Tilemap／字体／HTML 音频限定消费已有 §1.7–1.29 证据；旧结果不升级覆盖。Unity／Godot 未接通、完整游戏运行未验收。此前无限补齐 3D／动画／所有字体／所有音频等不再是本项完成前提；只有项目已确认要求才形成对应验证责任。交付资格仍关闭，不能仅修订清单就开放。
- [ ] V3-07 来源／版本绑定的 Review→所有者 Repair→定向复核与真实 Question、Preview 观察交接后端已落盘；§1.24 在真实数据库、正常 Chrome 鉴权下完成独立 debug 的观察→原生问题答复→所有者修订→实际重建测量→定向复核，保留原报告及无关成果。全部 V3 正式前端操作已按 §1.20 撤回。受控语义报告不证明 LLM／审美判断、完整产品验收或正式部署；无新证据不自动派发。
- [ ] V3-08 局部计划／历史、影响分析、失败隔离、候选修订、迟到拒绝、暂停恢复及依赖核对已回归；检查器版本漂移按 §1.19 修正。全部 V3 正式前端接入已按 §1.20 撤回，后端 API 保留。§1.24 真实数据库独立 debug 的 UI／Scene 编辑、需求变更、新构建测量、局部修订、暂停重载，以及有宿主退出证据的写者冷重载／显式收尾／保留暂停已验收；无证据旧／崩溃写者仍不解锁。完整隐式读写追踪、退出证据保存前崩溃和未知外部操作恢复仍未完成。
- [ ] V3-09 全部 V3 正式前端接入已按 §1.20 撤回。§1.24 记录正常 Chrome／真实数据库上的受控完整 debug 操作；§1.25 记录本地 Store 上真实 CLI 的保存／变更链；§1.26 已补同一真实数据库 Run＋正常 Chrome＋实际 CLI 的 Review→Question→原所有者 Repair→新测量→定向复核→已测工程导出→暂停重载综合验收。假模型不证明真实模型质量或成本，临时服务不等于正式部署。Scene 全交互、实际金额、普通 Chat 创作变更及完整部署仍未闭环，整项不勾；正式前端变更须另获确认。
- [ ] V3-10 按路线保存真实未见 idea 的付费验收证据，衡量完整游戏和逐请求成本；Web 通过不能代替引擎路线通过，不自动追加实验。
- [ ] V3-11 新流程达标后清理旧固定业务/说明及无调用分支；不删除旧数据/有效工具。
- [ ] V3-12 核对部署版本、数据库回退兼容和工程导出，才开放新项目默认入口。

### 12.2 当前实施顺序（替代旧编号串行推进）

不重新实现已正确的 V3-01–04，也不要求先补齐全部 Web 专项。以下均为待实施／待验证，不是本轮已完成代码：

| 顺序 | 最小动作及边界 | 必要回归／退出条件 |
|---|---|---|
| 1：先归位现有行为 | 在 BGS 的任务说明、检查选择和错误中明确当前 Web／BGS 内容适用条件，保存已确认路线；复用 constraints 和现有函数，不新建通用插件／注册框架 | 合成普通 Web、采用 BGS 内容的 Web、引擎任务三类交接；无关说明／格式不进入任务上下文。引擎任务不能误跑 Bun／Chromium 再误报游戏坏了，也不能因缺驱动变 passed；现有 Web／Review／恢复不退化 |
| 2：先核对引擎事实，再接一条 | 只读核对本机 Unity／Godot、版本、可调用 CLI／MCP 和现有权限；选择已具备条件的一条做临时合成工程的修改→保存→真实运行。都具备时以更少改动完成者先行并记录原因；都不具备则报告缺口，需要安装／连接时另获授权 | Agent 的正常工具路径可操作真实工程；产物不是 BGS 替代稿，实际保存和运行可核对。MCP 非必要前提，原生 Claude Code 不改；不在这一轮同时开发两套控制层 |
| 3：完成这条路线的最小业务闭环 | 复用当前 Task／Attempt／Review／Question，BGS 只接它必需的实际构建／运行／工程导出与身份记录；有实际需求才扩最少检查契约 | 合成验收覆盖必要规则→可玩结果，并用明确注入的缺陷核对 Review／Repair→新运行→可重开工程，不给真实游戏强造问题或要求额外 Review 批次。修改后旧证据失效；本路线检查不能要求 package.json、index.html 或 BGS registry。全局发布开关仍不因合成例打开 |
| 4：验证局部修改与中断 | 在同一合成路线修改一项 UI／规则并恢复一次中断，记录引擎仍活动／已结束的证据；复用已有版本和写者机制 | 无关文件及成功 Attempt 保留；旧引擎操作未解决时不授予新写者。验证不到的副作用保留 unknown，不造“绝对隔离”框架 |
| 5：真实质量与成本验收 | 用户另行批准后，只做一个未见 idea；按确认要求玩到结果、修订必要问题并重测，统计任务／请求／缓存／输出／失败消耗 | 可运行、可继续编辑，关键规则与反馈有实际证据，专业品质限制如实列出；成本评估基于付费实际数据，不以假模型或测试数量代替 |
| 6：第二条引擎路线及产品接线 | 对第二条只补与第一条实际不同的入口／产物／观测；随后依据达标路线决定默认入口和 BGS legacy 退役 | 第一条和 Web 不需重写；共用逻辑变化才做跨路线回归。正式 frontend／发布接线必须另获明确授权；不能先默认开放再补品质或费用证据 |

每一步先完成必要的非付费验证；没有新证据不反复重跑昂贵综合矩阵。BGS 公共任务／权限／版本变化回归公共消费者；Web 驱动变化只回归其消费者；BGS 内容变化只回归采用它的链路；引擎入口变化回归该引擎及最近交接消费者。只有交接含义确实变化才要求跨路线回归，不为局部改动重做八领域。

当前文档修订不需要 Migration，不部署、不重启、不调用模型。后续源码若只修适用性通常不需要 Migration；只有真实持久格式变化才评估兼容与迁移。不得删除历史计划、证据、旧项目产物或用户修改来完成纠偏。

## 13. 独立验收标准

合成测试先行；真实模型/资源费用必须另获授权。固定题可作为回归，但保留未见 idea、跨类型和修改/中断样本，不用同一题反复调优后宣称泛化。

| 场景 | 必须观察的证据 |
|---|---|
| 简单完整 idea / 已有 GDD | 允许直接按缺口推进，不强制三选一和八份稿；必需玩法/专业要求仍完整 |
| BGS UI/Scene（仅采用此能力） | 保存的 JSON、空间计算、实际字体/渲染和运行消费一致；不以另画的 HTML 代替 |
| 普通 Web／React（未采用 BGS 内容） | 实际代码 UI／场景与确认要求一致；浏览器操作和该项目构建／工程启动有证据，不要求补 BGS JSON 或引擎 MCP |
| Unity／Godot | Agent 实际通过可用 CLI／MCP 操作原生工程；保存后可运行，规则／UI／反馈在该运行环境核对，可重开并继续修改；不以 HTML 预览替代 |
| 运行与工程对应 | 被测游戏、交付构建和可编辑工程绑定当前来源；Unity／Godot 的 Web 导出不自动证明引擎原生工程已验收 |
| 资源延迟/失败 | 正式引用未就绪不能完成；不相关任务可继续；授权回退不能改核心要求 |
| 局部图标/声音替换 | 实际消费者重绑/回归，无关规则/文档/关卡字节和成功状态保持 |
| 模块内部修改 | 不必改兄弟模块代码；必要消费者回归有可追踪理由 |
| 交接/公共能力变更 | 所有真实消费者及兼容入口被覆盖，不只跑作者自己的测试 |
| 原始必需项被漏登记 | 不因“索引覆盖率100%”通过；对原始要求的独立检查指出缺口或未验证 |
| 伪造 passed / 过期证据 / 驱动失败 | 拒绝无效验收，区分产品失败和测试错误；不让 hash 或 final complete 替代观察 |
| 实现错误 | 依据原始条件的真实反例，修复后核对关联行为；不自动重做全部规划 |
| 用户裁决 | UI 真正收到 Question；拒绝/无答复不批准；过期答复不能应用新版本 |
| 中断/两个 Worker/迟到结果 | 当前写者唯一；核对旧活性；旧 result 不推进新计划；正确产物保留 |
| 外部响应丢失/计费重试 | 操作身份可核查，unknown 不盲重做；usage/outbox 不重复扣费 |
| 明确预算/人工暂停 | 不再派新工作；收尾用量与部分成果；重启不解除人工暂停 |
| 最终交付 | 当前被测工程可下载、安装/启动、玩到结果并重开；资源/依赖/证据齐全 |
| 成本 | 按 task/attempt/request 拆分真实输入/缓存/输出及失败用量；不靠硬轮数截断或删除需求降低数字 |

成功标准由用户目标与独立证据定义，不是“比旧版更好”。成本/耗时先记录合理工程目标和完整分布；单次测试、测试数量或模式切换不是达标证明。不能承诺纯 LLM 自动稳定产出零缺陷、有趣、审美优秀的所有游戏。

## 14. 实施交接指令

> 先依据本文证据核对当前工作树、部署入口和数据库版本。只实现一个经授权的 V3 纵向切片，不改生成项目、原始证据或 Claude Code 原生源码。
>
> 将规划自由与交付责任分开：取消固定八文档业务前提，保留必要设计、该技术路线的实际权威产物、资源和运行证据。Web／React 直接开发；Unity／Godot 通过已可用且获授权的 CLI／MCP 操作原生工程；只有确认采用 BGS 内容能力才生产其 JSON。开发路线不等于发布平台，不将 Web 专项当通用门槛。
>
> 按 §12.2 推进：先归位适用条件，再核对真实引擎与工具，接一条最小业务闭环及局部修改／中断，随后另获授权做真实质量／成本验收，再扩第二条路线。不要重做已正确公共能力，不追加全平台抽象或专项检查清单。正式 frontend、Claude Code 源码和 builtin-tools 不改；页面只用独立 debug。模拟通过不代表真实模型、成本或品质通过；不得自动付费续跑。
>
> 与本文事实不符时，更新审计证据和规范，不默默沿用旧流程或把未实现项目勾为完成。


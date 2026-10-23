# V3 1.30 最小自主接单：调用审计与实施证据

日期：2026-10-11。只改 BGS 集成／独立 debug；不改正式 frontend、Claude Code 核心／builtin-tools，不改真实项目产物，不部署、不执行 SQL、不调用付费模型。

## 结论

已接通「已确认完整目标 → 正常 native Chat → 原生工具／Skills／Question → 检查失败与修复／复查 → 原生结束记录」。不需要手工发布 Task 计划，不生成隐藏 Task，不触发旧阶段自动续跑。受控模型证明接线，不证明真实模型规划或游戏交付合格；发布资格仍关闭。

## 真实调用关系及隐藏耦合

路径均相对集成仓库。正文引用源码行为，不以旧流程作为正确性标准。

| 模块／入口 | 实际输入 → 输出／读写 | 真实依赖／隐藏耦合 | 本轮处理／验证边界 |
|---|---|---|---|
| 正式入口 `app.ts::confirmed-brief` | 原始 brief → 原旧项目请求；保存确认需求／旧 delivery | `buildConfirmedBriefPrompt` 含等待下一里程碑；`sendProjectRequest` 接旧批次及后继调度 | 未切换。正式 frontend 不改；新 debug 入口不走它 |
| 独立 `workflow-v3/debug-client.js` | 用户实际 confirmed brief、项目 Chat、请求身份 → 一次 goal POST | `session/ensure` 恢复所属 Chat，不授予执行；原 debug Task 表单不再是新入口前置 | 新增独立自主接单区；身份只在当前页，显式确认，不自动重试 |
| `workflow-v3/routes.ts::agent/goal` | owner、realpath、所属 Chat、完整 brief → 保存 Run、派发 native goal | 原 V3 API 只收人工 Task；新旧模式保护仍必要，否则落回旧编排 | 新入口无需 Task。保留模式拒绝、身份／工作区／原 Run 校验和相同请求幂等 |
| `confirmed-brief-evidence.ts` | kind、三个独立语言、资源策略 → 宿主事实记录 | 不是任意 idea JSON；简化输入会在真实会话提交前失败 | 复用现有事实字段，显式校验。响应语言按已确认值更新，不能沿用旧 Chat 偏好覆盖用户选择 |
| `workflow-v3/agent-goal.ts` | 完整目标＋原会话 → 一轮普通 `sendWithDisplay` | 新目标不能伪装 `TaskSpec`；单写者与实际退出仍是必要保护 | 无 `directionAuthors/projectTurn/prepareTurn/onTurnReady`、无八文档要求、无 host Review／Repair、无固定轮数限制 |
| `session-manager.ts` | 正常会话、真实原生事件／权限／用量 → transcript、运行快照、账务 outbox | `start` 复用活跃正常 Chat，不刷新语言；必须通过正常 send 显式刷新 | 仅调用既有接口，不改该文件。保留 native conversation 身份，不复制历史给第二个规划器 |
| `native-cli-process-runner.ts` | 普通提示／原生 UUID → stream-json 原生执行 | `nativeAssignmentPrompt` 仅在旧 GDD 标识存在时强插旧 Skill；normal 模式没有此标识 | 源码不改。实跑确认无旧阶段标识；原生 TodoWrite、Skill、Question、Write／Bash／Read／Edit 工作 |
| `native-skill-plugins.ts` | 已有只读 Skills 目录 → 标准原生 plugin flags | Skill 名称必须按实际 plugin 暴露；发现不等于使用 | 真实 CLI 成功加载 `bgs-builtins:gameplay-programmer`，记录 tool 生命周期，不只相信回复 |
| `project-execution-access.ts` | workspace、原生权限 → 项目文件边界／共享工具环境 | 正常 native 启动仍准备 Playwright／Sharp／字体／checker；不是按引擎选择工具 | 保留已有安全边界。本轮未改变这些启动成本，不宣称已优化真实首轮 Token |
| `projectContentAuthority`／`scene-ui-content-authoring.ts` | 真实文档／index／manifest 版本 → BGS Content authoring authority | 仍依赖多文档及真实内容来源；不能给空哈希绕过 | 保留能力；未接到新 goal。纯 layout／资源检查不因此删除，按真实输入使用 |
| `project-asset-command.ts`／旧资源调用者 | 实际资源服务配置 → 项目短期 CLI 入口 | 部分入口在旧阶段 materialization 中创建，不会因为给一个目标就自然可用 | 未全部解耦。下一步核对参数、鉴权与按需发现，不建立新的 Capability Map 框架 |
| `workflow-v3/store.ts`／已有 RPC | 原 Run＋CAS revision＋writer → append-only 快照／事件 | 工作区别名不能竞争写者；会话缺失不证明旧进程已退出 | 复用已有 JSON 存储与 writer 索引，仅增加 native turn 记录；无新表／SQL。新入口远端并发未实测 |
| `workflow-v3/checks.ts`／专项驱动 | 实际指定输入 → 当前检查记录 | 原先按 engine 标签禁止辅助 Bun／Web 检查；这是替 Agent 推断方案 | 移除 engine 禁令。保留驱动覆盖说明、实际文件／版本／边界检查；检查成功不授予引擎或游戏资格 |
| `workflow-v3/execution.ts`／Task API | 历史显式 Task → 原 Task 执行 | 旧 Task 流和自主 goal 混用会重引入宿主编排 | 保留历史／诊断能力，新 goal Run 拒绝 Task 变更／派发；不迁移已有项目、不删产物 |

## 为什么保留这些最小记录

`agentTurns` 不是新的工作流计划：只有请求／native turn 身份、本轮用量、状态和退出证据，没有工种、依赖、产出表、检查表。它解决已确认的重复付费执行、并发写入和未知写者恢复问题。直接调用 native 而不保留这些已有安全事实，会失去原 BGS 中断／并发保证；无须新表、Planner、DAG 或引擎框架。

本轮退出证据只证明宿主 native cleanup 已完成，不证明任意后台／引擎／收费操作成功。未知写者没有退出证据仍保持占用，不能超时解锁。原生 end_turn 记录为 ended；游戏交付仍未验证。

## 回归与独立 debug 证据

- `agent-goal.test.ts`：完整目标、所属 Chat、不同语言、格式拒绝、原 mode 保存故障及同身份恢复、重复请求、并发单写者、native 失败、部分成果保留、暂停／恢复、不明写者及退出证据恢复。
- `capability-scope.test.ts`：Unity／Godot／React 标签不禁止实际声明的辅助脚本；缺少真实输入仍未验证。没有为了引擎名创造空 BGS JSON。
- `agent-goal-native.test.ts` ＋ `agent-goal-browser.mjs`：实际独立浏览器操作 debug，通过正常鉴权调用真实 CLI；本机模型依次返回原生 TodoWrite → Skill → Question → Write → 失败 Bash 测试 → Read → Edit → 通过 Bash 复测 → 原生结束。
- 该受控流程共 9 次本机假模型请求；goal 提示 870 字符。假模型报告 135 Token 是合成计数，不能作为真实模型成本或优化收益。无付费调用。
- 没有 host Task 计划、旧固定批次或原生结束后的追加模型调用。重复点击同一接单身份不重跑；Question 答复送入原生且历史保留；独立 notes 未修改。
- 最终冻结源码：新入口定向回归 11 项通过；完整 V3 回归 240 项通过、0 失败（30 个文件）；TypeScript `bunx tsc --noEmit --pretty false` 通过。首轮测试运行中修改了实现，237 项通过、3 项失败，不作最终通过依据；失败记录保留在配套 JSON，冻结后完整复跑通过。任何专项通过都不能外推为游戏合格。
- [完整验证记录](bgs-v3-agent-intake-2026-10-11.json)包含真实覆盖、未验证边界及核心／正式 frontend 前后哈希。

## 修改影响

| 修改类型 | 本轮范围 | 必要回归 |
|---|---|---|
| 模块内部 | native goal dispatch 与 debug 交互 | goal 正常、失败、幂等、暂停、恢复、语言、Question |
| 交接格式 | Run 增加可选 agentTurns；goal 输入复用 canonical brief | CAS／单写者、模式保护、原 Task API、事件／Question 读取；远端 JSON RPC 待实测 |
| 公共能力 | 撤去按 engine 名称的限制，保留实际驱动 | 真输入／缺输入、构建与版本新鲜度；原 content／runtime／Review／export 专项 |
| 未涉及 | 正式 frontend、Claude Code 核心／builtin-tools、项目产物 | 逐文件 hash 前后核对；没有部署或生产项目写入 |

## 尚未完成

- 让完整目标会话按需发现／调用已有 BGS 资源与 Content 专业入口，核对其真实来源与权限；不在接单时塞入全量八文档／格式。
- 已有普通 Chat 的后续需求变更与中断续作，不以“重新发送同一 goal”实现自动重跑；当前重复 goal 只返回原执行。
- 新入口的远端存储并发／部署验收；当前仅本地存储真实 CLI／浏览器闭环。
- 真实模型自主组织 Review／Revision、游戏试玩／品质、成本与实际工程交付；需单独付费授权。发布资格继续关闭，正式 frontend 不接入。

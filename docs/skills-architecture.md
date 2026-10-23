# BGS Skills 架构与本轮集成

审计/实施日期：2026-10-23；起始版本 `c2b68c17a`。选型证据见 [skills-research.md](skills-research.md)，实测和限制见 [skills-validation.md](skills-validation.md)。

## 当前实际执行链

```text
用户任务 / 已确认 brief / 当前权限
  → workflow-v3 agent-goal + session-manager
  → BgsRuntime（账号隔离、上下文、宿主工具与权限）
  → BGS native app-server（基于 Codex）
      → skills/extraRoots/set（共享目录 + 当前账号导入目录）
      → skills/list（native discovery）
      → 显式 skill 输入或模型按 metadata 选择
      → 按需读取 SKILL.md / references / 使用现有工具
  → 原始工具事件、Preview 观察、host measurement / delivery
```

实际游戏执行端是 [BgsRuntime](../packages/agent-workflow-server/src/bgs/runner.ts) 和 [stdio client](../packages/agent-workflow-server/src/bgs/client.ts) 启动的 branded BGS app-server。当前游戏链路不会因为仓库名或历史代码而改用 Claude Code；模型 provider bridge 与底层 Coding Agent 是不同职责。

共享目录是 [`.beegame/skills/bgs-game-skills`](../.beegame/skills/bgs-game-skills/README.md)，当前 20 个独立 Skill。路径由 [skills store](../packages/beegame-skills-core/src/store.ts) 解析，native 目录注册由 [bgs/skills.ts](../packages/agent-workflow-server/src/bgs/skills.ts) 完成。账号导入文件在账号自己的配置目录中隔离；不把 Skill 正文复制进游戏产物，也不向全局个人 Codex/Claude 配置安装整包。

[官方说明](https://learn.chatgpt.com/docs/build-skills)描述了 metadata → 选中正文 → 按需引用的渐进披露，以及显式和隐式调用两种方式。本仓库实际行为以固定的 native 源码与测试为准，不因最新文档变化自动升级 runtime。

## 谁负责什么

| 层 | 已有职责 | 本轮决策 |
|---|---|---|
| BGS | 用户授权、项目/账号边界、brief 与当前证据、宿主工具、发布与交付责任 | 保留，不增加技能调度框架 |
| Native Coding Agent | catalog 发现、元数据预算、技能选择、正文读取、上下文压缩、工具与子 Agent 执行 | 继续使用原生能力 |
| 专业 Skill | 具体方法、何时适用、需要哪些来源、观察能支持什么结论 | 保留 20 个入口，只拆条件细节 |
| 项目设计与实现 | 八领域决策、实际引擎/资源/代码、按项目规则编写的断言 | 不添加第九份设计文档或第二套布局/任务数据 |
| 人/真实玩家与目标设备 | 审美、理解、趣味、舒适性及目标设备体验证据 | 缺失时明确未验证 |

## Rules、Hooks 与 Commands

Native 读取受信任路径中的 `AGENTS.override.md`/`AGENTS.md` 及自己的配置、规则、Hooks。BGS 的 [project guide](../packages/agent-workflow-server/src/beegame/workflow-v3/project-guide.ts) 提供项目约定；宿主上下文只携带当前指南状态等必要信息，不重新实现 include/parser 或复制全部 Skill。

native 插件 Command 转换属于执行端；当前游戏链路没有另一个 `.claude/commands` 路由器。本轮不添加 Rules、Hooks、Commands、隐藏自动调用或强制技能选择器。共享 catalog 更新不意味着旧项目保存的 `AGENTS.md` 被覆盖：已有指南的保留策略不变。

## 八领域与方法的关联

单一映射已在 [`DESIGN_METHODS`](../packages/agent-workflow/src/design-review-result.ts)，本轮不另存机器配置或更改职责。

| 设计记录 | 当前专业入口 |
|---|---|
| `GDD.md` | creative director、systems designer |
| `LEVEL_SCENE_DESIGN.md` | level designer |
| `BALANCE_DESIGN.md` | balance designer |
| `ART_DIRECTION.md` | art director |
| `UI_UX_SPEC.md` | UI/UX designer；实际 XR 任务使用空间 UX 方法 |
| `AUDIO_DESIGN.md` | audio designer |
| `ASSET_PLAN.md` | content pipeline engineer |
| `TECHNICAL_DESIGN.md` | gameplay programmer、implementation planning |

Game Feel、技术美术、交互契约、试玩和完成证据按当前任务与实际依赖参与，不新增设计文档所有者或固定阶段。文档完整、哈希一致、加载 Skill 都不能证明实现严格符合所有语义要求；仍须从原始要求形成具体预期，再观察实际输入与结果。

## 六个核心方向如何实际使用

| 方向 | 触发与入口 | 实际方法/依赖 | 可验证完成边界 |
|---|---|---|---|
| Game Design | 机制/循环/关卡/数值设计或缺陷；creative/systems/level/balance、design-check | 原始 brief、八领域现有来源、必要计算与规则例子 | 决策、单位、条件、矛盾明确；可执行规则用断言验证，趣味保持单独判断 |
| Art Direction | 新视觉方向或明确构图/风格问题；art director | 选定设计、实际资产、构图/色彩/形状/光照参考 | 比较匹配状态与尺寸的实际画面；不能从 palette、Manifest 或构建成功推出美术合格 |
| UI/UX | HUD、菜单、导航、焦点、可达性或界面反馈；UI/UX / spatial UX | 真实控件/输入、源布局、已提供的 layout/Preview 工具 | 实际文字、几何、状态与操作；几何检查不证明视觉品位或玩家理解 |
| Game Feel | 控制响应、动作节奏、命中/反馈；feel + 对应 gameplay/technical art 方法 | 区分尝试/执行/确认结果，协调动作/画面/音频；必要时 withPlayCapture | 观察同一玩家路径及中断/恢复；短片或数值不能单独证明手感好 |
| Playtest | 请求运行检查、验收或具体性能问题；playtest-performance | 当前 Preview、普通输入、来源明确的预期、运行时诊断 | 断言必须能失败；工具/driver/游戏缺陷分开；范围外不判通过 |
| QA & Delivery | 设计检查、故障定位、执行收尾；design-check、root-cause、plan-execution、evidence-before-completion | 现有构建、资源/绑定、host measurement 与 retained results | 区分实现、观察、版本一致性和体验；不新建固定三轮审核或发布门禁 |

精确 Skill 名称与可点击入口保留在现有 [catalog navigator](../.beegame/skills/bgs-game-skills/README.md)。显式 `$game-playtest-performance` 等输入由 runner 转成 native skill 输入，缺失/禁用时清楚失败；自然语言任务的隐式选择由 native 模型判断，本轮没有验证其稳定性，也没有声称它是确定性路由。

## 引擎与运行环境

[professional context](../packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal.ts) 保留用户选择的引擎和平台。React/Web 的 BGS 编辑需求与 Unity/Godot/Unreal 原生数据分开；BGS 目前没有这些原生引擎的编辑适配器。Canvas2D consumer 是可选的内容消费者，不能推定所有动画/物理/交互已经实现。

方法先依当前任务选中，再使用该引擎、锁定版本和已有项目设施。Pixi、Phaser、Three、Unity 或 Godot 的 API 不互换；专业参考不能授权换引擎、安装服务或生成第二份 Web 内容。本轮验证了跨引擎约束的传递，没有实际编译 Unity/Godot/Unreal、验证 XR 设备或安装它们。

## 本轮已经实现的改动

1. [game-plan-execution](../.beegame/skills/bgs-game-skills/game-plan-execution/SKILL.md) 将 BGS retained evidence 的具体工具参数移至 [retained-evidence.md](../.beegame/skills/bgs-game-skills/game-plan-execution/references/retained-evidence.md)。仅在实现/复跑依赖这些证据时读取，入口保留证据与范围要求。
2. [game-playtest-performance](../.beegame/skills/bgs-game-skills/game-playtest-performance/SKILL.md) 将真实玩家观察步骤移至 [player-observation.md](../.beegame/skills/bgs-game-skills/game-playtest-performance/references/player-observation.md)。运行正确性、玩家理解和体验质量的区别仍在入口；不把真人研究变为所有任务的前置关卡。
3. [skill-play-capture.test.ts](../packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts) 新增正常/受控故障共用断言的合成 2D 路径，使用现有 Preview 和录制工具，没有新增产品协议或测试专用产品入口。

名称、description、权限、八领域映射和 native 加载代码都没有改变。没有新增付费服务、自动评审 Agent、技能镜像、Hook 或自动续跑。

## 维护与上线方式

目录由 native 直接读取；真实 `skills/list` 的账户隔离检查已运行。源代码启动使用当前共享目录；打包环境依照现有 catalog 路径配置提供同一目录，不能只部署 SKILL.md 而漏掉引用/脚本。更新时检查引用闭包和格式，运行对应方法/工具的少量回归；修改 schema/权限/调用链才扩大验证。

这次应用层 `cwd` 修复单独提交并完成空闲核对后的重启。之后的 Skill 内容更新不需要启动项目任务；新 native catalog/读取会看到现有路径的新内容。未验证运行中模型的历史上下文是否会采用新正文，不修改其旧记录来伪装生效。

本轮未增加强制审美分数、全局帧率门槛、必用动画类型、自动覆盖完整性保证或模型调用数量配额。产品质量仍须由匹配的实际证据支持。

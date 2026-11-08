# BGS 游戏设计判断与试玩验证：现状审计

核验日期：2026-10-31。范围：已有 BGS 原生运行时、21 个游戏 Skills、Preview／测量／交付契约。未启动付费模型，不修改生成项目；本文不是游戏品质认证。

## 事实来源与已有能力

| 职责 | 当前入口／来源 | 可复用能力与边界 |
|---|---|---|
| 设计与用户授权 | `workflow-v3/production-workflow.ts`、`agent-goal.ts`、项目 `docs/GDD.md` | 用户 brief 和选定设计约束；设计稿、实现、验收并非同一事实。当前各平台使用自身引擎／原生源码；历史 Scene/UI JSON 和 content IR 适配不是本方案的新依赖。 |
| 核心玩法判断 | `game-systems-designer-expert/SKILL.md`、`game-creative-director-expert/SKILL.md` | 已覆盖目标、行动、规则、主题和循环；缺少将一个具体体验风险转换为可证伪问题的轻量入口。 |
| 玩家引导、关卡体验 | `game-level-designer-expert/SKILL.md`、`game-ui-ux-designer/SKILL.md` | 已有空间、教学、导航和界面层次；应增强已有职责，不能另建玩家引导 Agent 与 UI 争夺事实。 |
| Art / Game Feel | `game-art-director-expert/SKILL.md`、`game-feel-designer/SKILL.md` | 已有构图、相对比例、反馈与动作节奏、必要时读取参考的方法。保留专业判断，不把它们复制进 Game Test。 |
| 测试、玩家研究 | `game-playtest-performance/SKILL.md`、`references/player-observation.md` | 已区分运行正确性与真人体验，已有证据、异常归因、按影响复测；缺少串起假设、证据分层与修订对比的按需方法。 |
| 路由 | `bgs/runner.ts` 的 `configureBgsSkills`、`skills/list`、`nativeSkillReadTargets` | catalog 描述发现，正文按需读取；工具生命周期可记录加载，不证明正确应用。本方案不增加常驻 Agent、模型调用或默认读所有参考。 |
| Preview | `preview-manager.ts`、`preview-test-access.ts`、`preview-test-browser.ts` | 已有隔离 Chromium／CDP、开发与生产预览、普通输入控制；不能把脚本知道路径当成新玩家发现路径。 |
| 证据与媒体 | `preview-test-recording.ts`、`preview-play-capture.mjs`、`game-playtest-performance/references/play-capture.md` | 截图、视频、控制台、网络、环境、输入标记、选定音频节点；采集器本身不判定好玩。复用现有证据目录和 test stdout。 |
| 修改与验收 | `bgs/runner.ts` 的 `editProtectedFileText`、`runtime-acceptance.ts`、`workflow-v3/agent-measurement.ts` | 已有唯一匹配／批量修改、输入版本、保存报告和返修；不得额外建 Game IR、Level IR、质量分数或状态数据库。 |
| 用户可见结论 | `apps/frontend/src/viewModels/displayModels.ts`、协作流与 Artifact 预览 | 继续使用现有证据链接、交付结果和未验证项；不新增前端模式／门禁。 |

路径除 Skill 外均相对 `packages/agent-workflow-server/src/beegame/`；`bgs/runner.ts` 相对 `src/`。Skill 路径相对 `.beegame/skills/bgs-game-skills/`。

## 重复点、风险与最小方案（修改前结论）

不缺新的四段流水线；缺的是专业结论到具体运行观察的连接。四项逻辑能力合并进三个现有入口：系统设计负责体验判断，关卡设计负责场景引导／递进，现有试玩 Skill 负责验证编排。Art、UI、Feel 按所发现的问题调用，不追加逐项打分、全面复审或无限修复。

- 新增三份短的按需引用，各归已有 owner；入口仅替换对应指导段。设计未就绪时只写假设，不触发测试或补齐参数大全。
- 现有 acceptance `requirementChecks` 绑定既有 document/id，`contentChecks` 主要是特定内容运行契约；不能伪造 ID 或给严格 schema 塞建议 JSON。体验问题及事实／推断可写入现有项目测试输出／验证记录并从 `evidencePaths` 引用；必要观察缺失用 `unverified`，工具范围用 `coverageLimitations`，纯主观未委托研究用有依据的 `outsideScope`。
- 没有可运行目标时保留 `not_run`；静态图只能支持画面推断。环境／驱动失败与游戏失败分开。不把 LLM 模拟情绪当真人观察。
- 仓库没有已核验的四品类完整游戏集。本轮新增纯本地、非生产资产的四类小 fixture，借现有隔离浏览器和事务文本编辑验证可执行链路。它们不证明 BGS Agent 已自主改善真实游戏，也不替代真人研究。

## 成本事实

既有 orchard-catch-goal 的停止记录约 16 分 12 秒、50 次请求、5,296,685 tokens，其中 5,040,128 是缓存输入；作者 694 行首稿后又做 20 次编辑。它证明文档自检可以扩大成本，不能归因为试玩新增开销。本轮不会重跑该项目。本方案模型调用增量为零；Skill 使用行为／真实 tokens 的改善没有模型对照，明确未验证。新增引用的实际字节及浏览器样本耗时记录在结果文件，不拿字符估算冒充 API tokens。

## 拟修改文件与验证

- 三个现有 Skill 入口及各自一份按需 reference。
- 本文件、sources 文档、最终 results 文档。
- `src/beegame/fixtures/gameplay-experience.ts` 和同目录外的 `gameplay-experience.browser.test.ts`：四类运行／输入／截图／日志、一个受控缺陷的修订复测。
- 复用 `BEEGAME_TEST_REAL_BROWSER=1`；不新增测试模式、依赖、服务、模型入口、验收 schema 或生产工作流。

Skills 没有统一的独立语义版本字段；本轮以文件 SHA-256、仓库路径和验证时源码为版本事实，不虚构版本号。需要真人裁决的乐趣、理解速度、审美、主观难度不由这些检查自动通过。

## Skill 入口与版本快照

实际 catalog 描述决定发现条件；全部内容哈希见本轮 skill-inventory.json，无独立虚构版本号。

| Skill | 职责／触发摘要 | SHA-256 前 12 位 |
|---|---|---|
| beegame-interaction-contracts | Implement or diagnose player-control mapping and camera-relative movement, or resolve a concrete screen/XR control-feasibility question. Listing GDD inputs alone does not require control implementation. 中文：控制实现与诊断、镜头相对移动、触控与XR输入可行性。 | `3ffacd156e49` |
| bgs-imagegen | Generate or edit raster assets for BGS projects, including reference boards, illustrations, sprites, textures and transparent cutouts, using available ChatGPT image generation or the configured user/platform image API. Use existing editable vector or code assets for tasks better served by those formats. | `336cbf919b57` |
| evidence-before-completion | Match design, revision, fix or delivery claims to actual source versions, checks and observations. Use for completion evidence, not project planning or an automatic review stage. 中文：完成依据、原文核查、修订验证、验收证据。 | `8a1828545a8e` |
| game-art-director-expert | "Establish or repair game art direction: composition, visual style, color, lighting, materials, and VFX. Use for visual quality, not technical import or UI behavior alone. 中文：游戏美术、视觉风格、色彩、光照、特效。" | `33111e0eea57` |
| game-audio-designer | Design or repair game music, sound effects, ambience, dialogue, spatial audio, mixing, and event feedback. 中文：游戏音效、背景音乐、配音、空间音频、混音。 | `fa2978646507` |
| game-balance-designer-expert | Design, diagnose, or tune combat, movement difficulty, progression, rewards, economies, and quantitative game rules. 中文：数值设计、平衡诊断、战斗数值、成长曲线、游戏经济、难度。 | `102f91c740a6` |
| game-content-pipeline-engineer | Author the resources/content chapter in docs/GDD.md and choose resource representations from designed actions, state changes and composition; source, import or debug assets through Scene/UI into the runtime. Use the selected art/audio direction, not a new style. 中文：资源计划、设计行为到资源制法的选择、资源获取与导入、场景解析、运行时消费。 | `5754dd9ee586` |
| game-creative-director-expert | Use for game vision, player fantasy, emotional tone, theme-mechanic alignment, narrative direction, creative cohesion or production priorities. 中文：游戏创意、玩家幻想、主题、叙事、体验定位、制作取舍。 | `8a6b166fab02` |
| game-design-check | Review saved game-design decisions for an assigned design review or a concrete consistency, implementability or evidence question. Routine author self-check alone does not require this Skill. Not runtime acceptance. 中文：受托设计审查、具体设计矛盾与可实施性问题、定向修订核对。 | `1ae1c67505de` |
| game-feel-designer | Design or tune game control response, action rhythm, gameplay feedback and impact through coordinated animation, effects, camera, sound and supported haptics. Use for game feel, hit feedback and moment-to-moment responsiveness, not UI-only navigation or page transitions. 中文：操作手感、动作节奏、游玩反馈、打击感与冲击力。 | `76728b674e2d` |
| game-implementation-planning | Plan an assigned implementation or architecture task, or resolve a concrete module/interface dependency. A general GDD platform choice alone does not require implementation planning. 中文：实现规划、受托技术架构、具体模块与接口依赖。 | `9b019511429b` |
| game-level-designer-expert | Design gameplay spaces, traversal, encounters, mechanic teaching and navigation; diagnose player guidance or level, round and quest progression. 中文：关卡与回合体验、玩家引导、路线与教学、空间可读性。 | `7c4c732e31a6` |
| game-plan-execution | Execute or resume game implementation plans in the existing project, verifying basic correctness and preserving completed work. 中文：执行游戏实现计划、同工程续作、基础运行验证。 | `e5b797d3e7c0` |
| game-playtest-performance | Verify gameplay behavior, diagnose interaction or performance failures, and conduct explicitly requested experience validation with evidence and focused retests. 中文：基础运行验证、交互与性能诊断、受托体验验证与证据驱动复测。 | `b5a46530c35b` |
| game-systems-designer-expert | Design gameplay rules and core loops, or diagnose agency, repetition and learning through testable experience questions. Also covers progression, economy and state transitions when applicable. 中文：玩法系统、核心循环、选择与重复问题、可验证体验假设。 | `1c772b7be19a` |
| game-technical-artist | Prepare and integrate sprite-frame animation from supplied, sourced or AI-produced artwork, or implement and repair real-time game animation, VFX, materials, shaders and camera presentation against art and feedback designs. Use for dynamic visual execution, not art direction or resource loading alone. 中文：技术美术、AI精灵图动画、动画制作、特效实现、材质着色器、镜头表现、动态视觉。 | `c31acd321584` |
| game-ui-ux-designer | Design or repair non-XR game HUDs, menus, interface feedback and motion, navigation, gamepad focus, and input accessibility. For XR interfaces, use spatial UX. 中文：游戏界面、血条、菜单、界面切换与动效、手柄焦点、触屏布局。 | `914141c83bd7` |
| gameplay-programmer | Design gameplay execution/state interfaces, or implement and diagnose movement, collision and update timing. Use for concrete gameplay execution questions, not general GDD authoring. 中文：玩法执行设计、状态接口、运动碰撞与更新时序。 | `14b36194f675` |
| root-cause-debugging | Systematic debugging and root-cause diagnosis for bugs, failed checks, or performance issues. 中文：故障排查、根因定位、测试失败、性能问题。 | `5739fada76ea` |
| spatial-computing-game-expert | Design or diagnose XR, AR, and MR gameplay involving body movement, room constraints, tracking, anchoring, or comfort. For interface layout alone, use spatial UX. 中文：空间计算、体感玩法、房间尺度、VR与AR游戏。 | `16010ed5787a` |
| spatial-computing-ux-designer-expert | Design or fix XR, AR, and MR interfaces involving spatial layout, gaze, gestures, controller focus, and ergonomic legibility. For non-XR screens, use game UI/UX. 中文：空间界面、注视交互、手势、XR界面布局。 | `6323543630a3` |

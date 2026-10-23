# BGS 游戏开发 Skills 选型研究

审计日期：2026-10-23。系统基线：`c2b68c17a`。本轮目标是改进已有游戏开发方法、加载成本和验证能力；不是收集最多的 Skill，也不是另建执行框架。实施架构见 [skills-architecture.md](skills-architecture.md)，实际结果见 [skills-validation.md](skills-validation.md)。

## 结论与证据口径

保留 BGS 当前 20 个专业 Skill。六个核心方向已经有明确入口、参考资料和工具链；候选中的主要方法已被覆盖。本轮没有找到足以抵消许可证、适配、上下文或服务成本的整包替代方案，因此不新增第三方包、执行端、模型服务或引擎依赖。

实际改进是两份现有 Skill 的按需引用，以及一个通过现有 Preview 执行的状态化试玩回归。没有复制第三方脚本。公开资料用于审查方法与适用边界，不能替代游戏实测。

证据分开记录：

- **作者声明**：README 的效果、支持范围、耗时和质量描述。
- **仓库/社区证据**：固定版本源码、提交、测试文件、CI 记录与 issue。测试存在不等于本轮执行通过；issue 是报告，不自动等于当前仍有缺陷。
- **本轮自动化实测**：只包括本仓库的 native catalog、离线 fixture 和浏览器检查。
- **独立品质实测**：相同任务、约束、模型与预算下的产物比较和实际玩家观察。本轮未执行，品质改进全部保持未验证。

### 评分规则

每项 0–2 分：**M** 方法是否具体；**T** 是否有可检查的脚本/示例/测试（0 纯文字，1 可执行示例或脚本，2 有相关测试）；**I** 相对 BGS 现有能力的实际增量；**C** 在本任务边界内的依赖与上下文成本；**E** 证据强度（0 主要作者声明，1 可核对源码/维护/反馈，2 在 BGS 独立实测成功）。总分是采纳便利度，不是游戏品质分数。许可证、架构冲突和零增量可以直接否决高总分候选。

审阅的是下列具体 Skill/工具，不声称对大型仓库全部条目完成逐个行为验收。

| 来源与具体候选 | M/T/I/C/E | 取舍 |
|---|---|---|
| Scenario `scenario-sprite-animation` | 2/2/0/0/1 = 5 | 不安装；依赖 Scenario MCP 与生成调用，已有 BGS 媒体/资源管线覆盖主要方法 |
| Awesome `disciplines/game-feel` | 2/0/0/1/1 = 4 | 不复制；反馈事件、表现/模拟分离已有对应方法 |
| Awesome `disciplines/create-game-assets` | 2/2/0/2/1 = 7 | 不复制工具；图像报告、预览表与本地资源检查重复 |
| Ronnie Basak `game-feel` | 2/0/0/2/0 = 4 | 保留已有概念引用；不采用统一 FPS/延迟门槛 |
| Yuki `game-design-review` | 2/0/0/2/0 = 4 | 不复制；许可证未确认，已有设计检查与证据分级 |
| Yuki `game-image-generation-rules` | 2/1/0/1/0 = 4 | 不复制；许可证未确认，已有精灵/媒体工作流 |
| NVlabs `Skill2Env` 及其 game QA/balance 样本 | 2/2/0/0/1 = 5 | 淘汰集成；属于终端 RL 任务生成框架，不是游戏开发 Skill 执行层 |
| Anthropic `webapp-testing` | 2/1/0/1/1 = 5 | 不引入 Python/server 管理器；复用 BGS Preview |
| Anthropic `frontend-design` | 1/0/0/2/1 = 4 | 不作为游戏美术/UX 的替代；缺少游戏状态与资源契约 |
| Anthropic `skill-creator` | 2/2/1/0/1 = 6 | 采用渐进披露/证据分级原则；不导入反复模型评估流程 |
| PixiJS `pixijs-scene-sprite` / `pixijs-performance` | 2/1/0/1/1 = 5 | 作为对应引擎的参考；不整包安装或把 Pixi API 用于其他 renderer |
| OpenAI 当前 `game-studio` 的 foundations/sprite/playtest 方法 | 2/1/0/0/1 = 4 | 保留研究来源；其架构与资源工具不能直接替代 BGS |
| OpenAI 历史 `develop-web-game` | 2/1/0/1/1 = 5 | 不安装退役版本；已有 Preview 与普通输入观察方法 |

## 必查候选

### Scenario Labs

固定版本：[5429dea302ccc7edbce8ace9d5c1fb6852499540](https://github.com/scenario-labs/skills/tree/5429dea302ccc7edbce8ace9d5c1fb6852499540)，2026-10-22。[MIT 许可证](https://github.com/scenario-labs/skills/blob/5429dea302ccc7edbce8ace9d5c1fb6852499540/LICENSE)允许在满足署名/许可保留等条件下使用及修改源码；服务调用另有账号、权限和费用条件。

[`scenario-sprite-animation`](https://github.com/scenario-labs/skills/blob/5429dea302ccc7edbce8ace9d5c1fb6852499540/skills/scenario-sprite-animation/SKILL.md) 有具体的模型推荐、schema/dry-run、生成、等待、素材获取、帧处理与接触表检查步骤；配套 cycle 脚本和 directional/grid tests 比纯提示词更可审查。维护提交和测试源码是仓库证据，本轮没有运行其脚本、模型或服务，也没有独立生成质量证据。

[issue #49](https://github.com/scenario-labs/skills/issues/49) 与 [#255](https://github.com/scenario-labs/skills/issues/255) 分别提供 sibling 依赖和安装路径方面的社区报告，不据此断定当前版本仍失败。它的单个流程还会展开其他技能/引用，并增加外部等待与潜在费用。

BGS 已有 `assets.mjs`、`media.mjs`、Manifest、图集检查及 [精灵动画方法](../.beegame/skills/bgs-game-skills/game-technical-artist/references/ai-sprite-animation.md)。无需另接 Scenario。可参考像素检查与资源/运行时证据的区分，不能把上游测试通过解释为 BGS 动画或视觉质量通过。

### Awesome Gamedev Agent Skills

固定版本：[38a4c2500eeb5ff9ac084336b8f66108069d2f8d](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/tree/38a4c2500eeb5ff9ac084336b8f66108069d2f8d)，2026-10-22。[Apache-2.0](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/38a4c2500eeb5ff9ac084336b8f66108069d2f8d/LICENSE)及 NOTICE 需要按分发范围保留；不能将条目引用的其他资源自动视为同一许可证。

[`game-feel`](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/blob/38a4c2500eeb5ff9ac084336b8f66108069d2f8d/skills/disciplines/game-feel/SKILL.md) 有事件/反馈/震屏/hit-stop 的方法和引擎示例，但没有自身的行为实验。`create-game-assets` 提供图像报告、预览表脚本及 `tests/test_asset_tools.py`；本轮审阅了源码，没有执行。仓库覆盖多栈的声明不等于各引擎实测。

[issue #2](https://github.com/gamedev-skills/awesome-gamedev-agent-skills/issues/2) 讨论了其 context-library 定位及大量入口的成本。这是社区意见，不是品质基准。BGS 已有对应的资源检查、game feel、设计、关卡和性能方法，整包导入会扩大元数据及维护面。以后仅在已选引擎出现明确方法缺口时，重新评估那个条目及版本。

### Ronnie Basak Game Feel

固定版本：[513da1cc129bd1af1dfbbf2cc651d6e09bf893fd](https://github.com/ronniebasak/game-feel-skill/tree/513da1cc129bd1af1dfbbf2cc651d6e09bf893fd)，2026-08-22。[MIT](https://github.com/ronniebasak/game-feel-skill/blob/513da1cc129bd1af1dfbbf2cc651d6e09bf893fd/LICENSE)。审阅时仅有一条提交，未取得有意义的独立复现或社区效果反馈。

[`game-feel`](https://github.com/ronniebasak/game-feel-skill/blob/513da1cc129bd1af1dfbbf2cc651d6e09bf893fd/skills/game-feel/SKILL.md) 的输入、响应、空间情境、表现等因果区分有用，但没有执行脚本或测试。其统一时间/FPS 阈值是作者启发式，不是 BGS 的验收规则。[BGS control-response](../.beegame/skills/bgs-game-skills/game-feel-designer/references/control-response.md) 已引用并做了适用性限制；没有重复安装的增量。

### Yuki Game Dev Skills

固定版本：[f0885d41a2db45e2a97eede248f6e94a0f786a8b](https://github.com/Yuki001/game-dev-skills/tree/f0885d41a2db45e2a97eede248f6e94a0f786a8b)，2026-09-30。公开递归文件树中未找到 LICENSE/COPYING/NOTICE；本轮没有确认允许复制修改的适用许可，故不复制文件或脚本。公开可读不等于获得开源许可。

[`game-design-review`](https://github.com/Yuki001/game-dev-skills/blob/f0885d41a2db45e2a97eede248f6e94a0f786a8b/skills/game-design-review/SKILL.md) 对事实/假设/未知、问题优先级及最小干预的区分可作为研究参考。`game-image-generation-rules` 的检查、帧/轴点和图集工具与 BGS 现有能力重叠。Unity/toon shader 与 ImageMagick 等特定入口也不能当作 BGS Canvas2D 的能力。本轮没有执行这些工具，未取得独立品质验证。

### NVlabs Skill2Env

固定版本：[507eab4d9952968de2be98f8729d3c66d487285a](https://github.com/NVlabs/Skill2Env/tree/507eab4d9952968de2be98f8729d3c66d487285a)。框架 [Apache-2.0](https://github.com/NVlabs/Skill2Env/blob/507eab4d9952968de2be98f8729d3c66d487285a/LICENSE)，SkillHub 内技能的许可另行记录，不能继承推断。

[README 和源码](https://github.com/NVlabs/Skill2Env/blob/507eab4d9952968de2be98f8729d3c66d487285a/README.md) 面向 Harbor/Linux terminal RL 环境生成，依赖 Docker、Python/uv、Codex 认证及网络。包含 planner/creator、结构检查和 Oracle/NOP 接受流程，检查对象是终端任务包，不是浏览器游戏体验。README 的 20–30 分钟 quickstart 是作者估计，本轮未执行；多模型调用、并行与重试也不符合这次边界。淘汰该框架，而不是为了测试 Skills 再造一个 Agent 平台。

### Anthropic Skills

固定版本：[dbd4588f9e1033efb41dad4bef2f7947c8993d44](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44)。必须逐目录检查许可。[README](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/README.md) 区分开源样例与部分 source-available 文档技能；不把整个仓库称为统一 Apache 授权。

[`webapp-testing`](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/webapp-testing/SKILL.md) 和 `frontend-design` 带各自 Apache-2.0 许可。前者包含 Python Playwright/服务启动工具，后者主要是通用网页视觉方法；BGS 已有受当前任务能力约束的 Preview 与游戏美术/UX，导入会重复服务器和浏览器管理。等待 `networkidle` 也不应被用作所有实时游戏的统一就绪条件。

[`skill-creator`](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/skill-creator/SKILL.md) 的渐进披露、明确断言与记录成本原则有用；其配对 Agent、反复模型执行与 `claude -p` 流程不导入。本轮采用同类简明编写方法，未复制脚本或运行模型 benchmark。[issue #1942](https://github.com/anthropics/skills/issues/1942) 是环境适配方面的社区报告；不是 BGS 实测，也不代表整个仓库质量结论。

## 自主补充来源

### PixiJS 官方技能

固定版本：[83760c6f53462ca9cecd68055041f5a8c94758ce](https://github.com/pixijs/pixijs-skills/tree/83760c6f53462ca9cecd68055041f5a8c94758ce)，2026-10-01，提交说明同步 PixiJS v8.22.0。[MIT](https://github.com/pixijs/pixijs-skills/blob/83760c6f53462ca9cecd68055041f5a8c94758ce/LICENSE)。不能沿用旧搜索缓存中“停留在 v8.19.0”的说法。

`pixijs-scene-sprite` 区分单帧和 AnimatedSprite；`pixijs-performance` 有资源销毁、缓存/批处理/剔除的具体 API 和示例。BGS 现有技术美术参考已包含对应通用方法。当前宿主使用自有 Canvas2D consumer 与 Three.js，不能直接套用 Pixi API；只有实际选用对应 Pixi 版本的项目才适用这些细节。

[issue #4](https://github.com/pixijs/pixijs-skills/issues/4)、[#5](https://github.com/pixijs/pixijs-skills/issues/5) 是 API 准确性的历史报告，[#6](https://github.com/pixijs/pixijs-skills/issues/6) 讨论多入口上下文成本；本轮未确认每项在固定快照中的修复状态。官方身份与持续同步都不能代替针对锁定版本的验证。本轮未执行其示例或性能实验。

### OpenAI 当前与历史游戏技能

当前快照：[openai/plugins@0722921d5542fc593105c27bd52630babd8b8c2a](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a)，2026-10-08。`game-studio` manifest 声明 `0.1.2`、MIT；递归树检查未找到根目录或该插件下的许可证正文。本轮不据单一 manifest 字段复制分发其代码。

其 foundations、sprite-pipeline 和 playtest 方法涉及 Phaser/Three、资源索引、帧准备与浏览器观察。BGS 已有选定引擎/内容权威及 Preview 责任链，不能导入一套默认架构或第二个资源管线。统一底部锚点等处理也必须服从实际姿态，不能抹去跳跃或预期位移。没有在 BGS 独立执行这些脚本。

历史 [`develop-web-game@30444ae`](https://github.com/openai/skills/tree/30444ae/skills/.curated/develop-web-game) 带 Apache-2.0 许可、Playwright 客户端、短输入序列和截图/文本观察；它要求的单 Canvas、`advanceTime` 和 `render_game_to_text` 不是所有 BGS 游戏的接口。该目录在 [11c6438](https://github.com/openai/skills/commit/11c643813b4645ca9f25d49ca180697732e0141a) 删除，之后仓库通过 [778b0e6](https://github.com/openai/skills/commit/778b0e6129cf18cbaee3bf11479f583fadae8d03) 指向 plugins。转载、历史版本与当前插件不能混称“当前官方 Skill”。

## 维护决策

优先维护 BGS 已验证的本地能力与适用方法。重新选型的触发点是明确的当前需求：现有方法无法完成某项已选引擎任务、现有工具缺少必要可观察量，或已证实的执行缺陷；不是来源更新、Stars 增长或宣传质量提高。

新增外部内容时按具体文件复核固定版本、许可、依赖、调用副作用、引用闭包及现有能力重复，再做最小离线验证。无需周期性拉取、自动更新、模型评审流水线或新的 Skill 注册协议。未获真实模型对照与玩家证据前，继续把生成品质、隐式触发稳定性及实际 token/时间收益标为未验证。

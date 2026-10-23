# BGS Skills 实测与未验证范围

日期：2026-10-23；对照基线：`c2b68c17a`。研究与选型见 [skills-research.md](skills-research.md)，实际加载和集成见 [skills-architecture.md](skills-architecture.md)。

## 本轮结论

原生 catalog 发现、账号隔离、显式 Skill 转交、现有浏览器/媒体工具以及新增的正常/受控故障试玩路径均有自动化实测。两份改动的 Skill 入口总字节数减少 14.7%，其方法细节仍可按需读取。

**没有执行真实模型任务、项目自动续跑、外部生成服务或 Skills 开关的游戏生成 A/B。生成品质、隐式选择稳定性、真实任务 token 与耗时收益均未验证。** 本轮验证的是可运行的加载和工具链、断言对失败的敏感性，以及静态内容成本；不把这些结论替换成游戏更好玩或更好看。

## 环境与执行边界

- macOS 27.0，Bun 1.3.14，Node 25.2.1，仓库已有 Playwright Core 1.63.0/Chromium。未安装新依赖或引擎。
- native 测试使用临时 `HOME`/`BGS_HOME`，只初始化、注册 roots 和调用 `skills/list`，没有 `thread/start`、`turn/start` 或模型请求。
- runner 与工作流测试使用现有测试替身；浏览器测试运行本机临时服务、合成场景和受控资源。真实测试项目产物未被修改。
- 先前的工作目录日志修复已单独提交；重启前后核对工作流、资源作业、intake、部署、图像尝试及 runtime 子进程，没有发现正在执行的任务。runtime 与 frontend 重启后四个后端服务的 health 检查通过；没有触发任务或自动续跑。

## 实际自动化结果

本轮共有 **40 个不同测试用例通过**，重复复跑不累加。下表耗时是各次命令的墙钟时间，不能相加当作完整任务耗时；并行、缓存和机器负载也使它们不适合作为性能基准。

| 测试 | 用例 | 本轮执行时间 | 证明的范围 |
|---|---:|---:|---|
| `bgs/skills.test.ts` | 1 | 0.48s | 先注册目录，再清理旧托管链接；保留用户文件与注册失败时的原状态 |
| `bgs/skills.native.test.ts`，`BGS_SANDBOX_TESTS=1` | 1 | 0.80s | 两个临时账号都发现真实共享目录的 20 个 Skill，只发现各自私有 Skill |
| `bgs/runner.test.ts` 的 Skill 相关过滤项 | 3 | 0.99s | catalog 不可用、显式所需 Skill 转交、无关坏条目及必需项缺失的行为；测试替身，不是模型理解 |
| `beegame/skill-audio-tools.test.ts` | 7 | 1.05s | 音符/节拍、PCM、静音/DC/电平/接缝、非法输入与文件边界；没有音色/音乐品味结论 |
| `beegame/workflow-v3/managed-web-boot.integration.test.ts` | 5 | 1.44s | React/Web、Unity/Web、Godot/Mobile、Unreal/PC、Unity/VR-AR 的选择与约束传递；未构建原生引擎 |
| `beegame/workflow-v3/runtime-checks.test.ts` | 15 | 19.48s | 实际浏览器 smoke、输入/viewport、资源子路径、错误、超时恢复、包内容与历史证据失效 |
| `beegame/skill-play-capture.test.ts`，`BGS_PLAY_CAPTURE_BROWSER=1` | 3 | 8.91s | 实际 Preview、截图/录像/音频观察边界、受控失败保留证据及状态化玩家路径 |
| `beegame/game-content-surface-browser.test.ts`，`BGS_LAYOUT_BROWSER=1` | 3 | 4.59s | UI/Scene 的像素、图集、标签、点击、透明度、旋转/镜像/裁剪/零缩放 |
| `beegame/ui-layout-browser.test.ts`，`BGS_LAYOUT_BROWSER=1` | 2 | 2.13s | 原生浏览器分配/字形测量、实际宿主 UI 像素与可报告的溢出；不代表所有文字均适配 |

### 新增试玩路径与受控失败

新增用例位于 [skill-play-capture.test.ts](../packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts)，只使用现有 Preview/`withPlayCapture` 和普通键盘输入。极小 DOM/Canvas 场景的规则直接写在 fixture 源码中：开始、核心动作累积分数、暂停阻断动作、达成胜利、进入失败终态、重试并继续行动。预期来自这些明确规则，不由当前结果反推。

正常与受控故障执行使用同一个状态/分数/像素断言。故障模式故意不设置胜利状态，并产生 console error；driver 因真实断言不符退出，测试检查错误、录像和失败前截图被保留。正常路径生成 6 帧截图，故障路径保留 4 帧；整个捕获测试文件最终复跑为 3 pass、0 fail、56 assertions、8.91s。**受控实现故障与游戏规则中的失败终态是两种不同情况。** 质量字段在正常路径仍为 `unverified`。

这是工具链对行为与失败证据的验证，不是让模型生成游戏的实验，也不是通过测试来证明这个合成场景具有美术或玩法价值。截图/视频在测试临时目录中实际生成、检查后清理；仓库保留可复现的测试源码，不将临时媒体声称为持久交付物。

## 五个目标维度的实际覆盖

| 维度 | 有实测证据的内容 | 尚未验证 |
|---|---|---|
| 视觉质量 | 保存数据到 UI/Scene 的实际像素、布局/字形测量、图集与透明度等行为；合成路径状态颜色断言 | 风格一致性、构图品味、3D 材质/光照质量、真实美术产物的前后改善 |
| Game Feel | 普通键盘输入后 HUD/画面响应、暂停阻断、恢复与重试；录制和音频采样路径 | 真实动作动画、输入到显示延迟分布、节奏/冲击感、触屏/手柄/XR 舒适性及玩家感受 |
| 可玩性 | 明确规则的开始→动作→胜利/失败→重试；共用断言能够捕获缺失胜利状态 | 真实代表性游戏的完整流程、趣味、难度、首次玩家理解与长期体验 |
| 工程质量 | 资源/包/边界、运行错误、超时恢复、截图/录像/失败记录；TypeScript 静态检查 | 真实完整项目构建、设备性能预算、长期稳定性、原生引擎发布及全面设计语义符合性 |
| 执行效率 | Skill 入口/引用的精确字节对照、元数据数量不变、各本地测试时间 | 模型实际 token、触发次数、重复工具调用减少、真实任务总时间/费用及 Skills 开关 A/B |

### 已观察到的限制与失败样本

- 新增受控缺陷稳定触发相同胜利断言失败；成功录制不掩盖 driver/游戏错误。
- 既有捕获测试检查 driver 抛错后仍保留证据，并验证秘密内容不泄露到诊断文本；这不是对所有游戏错误的覆盖保证。
- `ui-layout-browser` 的既有 candidate-font 观察仍记录 `over-title`、`pause-title`、部分 HUD/start/clear 文字的 `exceeds`。该用例验证观测和输入保留，未把所有溢出都当作测试失败。**测试通过不能解释为这些界面没有文字适配问题。** 本轮没有修补测试项目文件，也没有据此推定系统根因。
- 实际模型是否会根据自然语言选对 Skill、是否会读取条件引用、是否能持续遵守方法：未验证。原生发现通过只证明入口可被发现，runner 转交通过只证明输入被正确构造。

## 内容成本对照

以 `c2b68c17a` 中的文件为基线，统计 UTF-8 文件字节。不是 tokenizer 的实际计数，也不是模型上下文峰值。

| 项目 | 改动前 | 改动后 | 说明 |
|---|---:|---:|---|
| Skill 入口数 | 20 | 20 | 不扩大 catalog |
| description 字符合计 | 3,675 | 3,675 | 触发描述未改变；不是完整 native 元数据大小 |
| `game-plan-execution/SKILL.md` | 9,891 B | 7,797 B | 具体 BGS 参数移入条件引用 |
| `game-playtest-performance/SKILL.md` | 7,441 B | 6,981 B | 真人观察步骤移入条件引用 |
| 上述两份入口合计 | 17,332 B | 14,778 B | 减少 2,554 B，约 14.7% |
| 全部 20 份入口合计 | 81,259 B | 78,705 B | 只是文件统计；运行时不会因此全部读取 |
| 本轮新增的两份引用 | 0 B | 3,363 B | 2,732 B + 631 B，按需读取 |

若本次任务不需要新引用，所选入口读取量会减少；若两份引用都读取，相关内容合计反而增加 809 B。不能宣称总目录更小或所有任务 token 都下降。按常见的 4 B/token 粗估，入口差约 639 tokens；中文、路径和实际 tokenizer 会改变结果，故不作为实测收益。

本轮 BGS 真实模型调用为 0，BGS 模型 token 为 0；这是用户明确的执行边界，不能当作新方案更省钱的证据。本聊天的研究、协作和工具执行总成本没有测量。没有自动化 A/B、循环模型评估或付费生成调用。

## 复现与最终检查

在工作树根目录执行，使用现有依赖和本地浏览器：

```sh
bun test packages/agent-workflow-server/src/bgs/skills.test.ts
BGS_SANDBOX_TESTS=1 bun test packages/agent-workflow-server/src/bgs/skills.native.test.ts
bun test packages/agent-workflow-server/src/bgs/runner.test.ts --test-name-pattern='catalog|skill'
bun test packages/agent-workflow-server/src/beegame/skill-audio-tools.test.ts
bun test packages/agent-workflow-server/src/beegame/workflow-v3/managed-web-boot.integration.test.ts
bun test packages/agent-workflow-server/src/beegame/workflow-v3/runtime-checks.test.ts
BGS_PLAY_CAPTURE_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/skill-play-capture.test.ts
BGS_LAYOUT_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/game-content-surface-browser.test.ts packages/agent-workflow-server/src/beegame/ui-layout-browser.test.ts
bun run typecheck
git diff --check
```

根目录 `bun run typecheck` 通过；两份修改 Skill 的格式验证通过；20 个入口的 frontmatter 与基线完全相同。两份修改入口、两份新增引用及三份交付文档中的 28 个相对链接全部可解析，`git diff --check` 通过。无需安装上游候选才能运行这些测试；未执行的上游脚本和真实品质实验不列为通过。

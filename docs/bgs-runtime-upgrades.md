# BGS 源码品牌、构建与升级

BGS 基于 OpenAI Codex。完整品牌转换覆盖源码目录、Cargo 包及导入、类型、CLI、配置目录、环境变量、Skills、插件安装目录和 BGS 自有 API。执行循环、模型推理和原生权限逻辑不因品牌调整重写。

## 仓库与分支

- 主仓库子模块：`vendor/bgs`；Rust 工作区：`vendor/bgs/bgs-rs`。
- Fork：`https://github.com/Phantomxm2021/codex.git`。这是现有真实仓库地址，保留作为来源，不虚构新地址。
- 官方上游：`https://github.com/openai/codex.git`。
- `bgs/source-0.164.0`：保留上游命名的源码维护分支，包含此前已验证的 CLI 品牌、图标、关闭官方二进制自更新及锁文件版本修正。
- `bgs/0.164.0`：从源码维护分支生成的完整 BGS 命名发行分支。主仓库 gitlink 固定发行提交。Rust 工具链由源码固定为 `1.99.1`。
- 完整改名规则在 `scripts/brand-bgs.py`。默认只报告，`--apply` 才写入。只遍历 Git 源码，不遍历用户运行数据。`--host` 仅为本次宿主代码的一次性迁移用途；不要对后续 BGS 宿主源码重复执行，因为兼容读取代码有意保留旧名称。

后续更新在源码维护分支合并上游，再重新生成发行分支，避免对数千个改名文件逐一解决合并冲突。新增上游名称和外部协议仍需要审查；脚本不能保证未来升级无需调整。

## 运行位置

| 内容 | 位置或接口 |
|---|---|
| 二进制及内部 Cargo target | `bgs` |
| Cargo 主包 | `bgs-cli` |
| CLI 配置根 | `BGS_HOME`，默认 `~/.bgs` |
| BGS 每用户配置根 | `.runtime/app/bgs` |
| 内置游戏 Skills | 应用共享目录 `.beegame/skills/bgs-game-skills`，通过 `skills/extraRoots/set` 直接加载，所有 BGS 账户共用、只读 |
| 用户 Skills | 账户 `.runtime/app/skills`，同接口按账户独立加载；不共享用户内容 |
| 运行器系统 Skills | `$BGS_HOME/skills/.system`，由运行器维护 |

模型配置读取及需求分析仅解析内置 Skills 路径，不要求目录已安装。游戏 Agent 启动时才检查目录可用并注册共享 Skills；目录缺失或为空会在启动原生进程和模型请求前报错，不静默跳过内置能力。
| 插件及缓存 | `$BGS_HOME/plugins` |
| 设置 API | `/api/bgs/settings` |
| 自定义二进制路径 | `BEEGAME_BGS_PATH` |
| macOS 管理配置标识 | `com.phantomlab.bgs` |

内置及用户 Skills 的原目录、投影目录只授予读取权限；不因此开放同级 auth.json、会话目录或写权限。

未知模型使用本地 fallback 提示词时启用原生 Skill 使用说明，包括最小适用集合、渐进披露和必要引用的读取。目录只提供发现信息，Skill 正文仍由 Agent 按需读取；不为 BYOK 型号另写专业流程，也不修改已知模型的模板配置。`skills.native.test.ts` 使用真实 BGS 二进制和本机 Responses 替身，检查实际请求中的说明、正文未预加载，以及所选正文经原生工具读取后进入下一次请求。

非 ChatGPT 游戏会话通过原生 `skills.config` 按路径停用 `$BGS_HOME/skills/.system/imagegen/SKILL.md`：当前 BGS provider 不具备原生图像工具的认证条件，shell 也不持有该 Skill 的 CLI fallback 所需 API key。该覆盖只作用于本次运行器进程，不修改系统 Skill 缓存或用户配置，保留用户导入的同名 Skill；ChatGPT 会话沿用原生可用性规则。BGS 自有资源生成入口保持原有行为。

明确保留的例外：真实外部 URL、模型 ID、服务端协议头及认证/额度标识；`bgs app` 所连接的官方桌面应用的签名、安装器和 URL scheme（该命令仍明确标为 upstream Codex Desktop）；第三方插件包中的 `.codex-plugin` 清单格式；LICENSE、NOTICE、来源说明；读取旧会话的兼容标识和迁移别名。安装根已属于 BGS，第三方包格式不会被擅自改写。Git 历史和 Git 自身的旧子模块元数据不做字符串改写。

## Web/React 与 Scene/UI 编辑器解耦

Web/React 项目使用项目自身的 UI、场景代码和数据。初始设计、后续修改和恢复均不再要求创建 BGS Scene/UI JSON 或 `content/index.json`；历史 `creation.editableContent` 只作为保留的创建记录，不能恢复编辑要求。视觉对照要求独立于编辑能力，不能由旧 `bgsVisualEditing:false` 关闭。

宿主根据 Run 中已确认的平台和引擎提供 `scene_ui_editor_available`。Web/React 的产物列表仅保留文档和资源入口，旧编辑器链接不加载编辑器，后端直接保存也返回 `editor-unavailable`。其他目标沿用现有编辑行为。

Web/React 的原生工具不再暴露 `CheckSceneLayouts` / `CheckUiLayouts`，新项目不再生成绑定工具或默认内容运行库；设计读取、资源检查、验证读取、预览和媒体工具保留。已有注册内容仍能获得其运行库，显式注册的数据、资源及设计引用继续接受完整性检查。缺少编辑器索引本身不阻塞测量或发布；实际构建、运行验证、视觉对照和交付证据不因此免除。

共享 `scene-editor` 包还包含资源、字体、布局及历史运行时消费者，其他目标也仍使用编辑器，因此不整体删除该包，不迁移或改写已生成项目。本次不引入 Phaser、Three.js、新编辑器或额外模型回合；离线回归不代表真实生成质量、tokens 或耗时已经改善。

## Workflow 的原生 Goal 生命周期

项目初次接单及明确的 work/change/continue 使用 Codex 原生 Goal。一次授权任务只占用一次 BGS 执行身份和 writer；原生 Goal 自行决定工作顺序、跨 turn 继续及结束。BGS 不按文档派发回合，也不增加自动 turn pump。设计来源统一为 `docs/GDD.md`，使用已有或一份精简进度记录保存当前工作、未解决依赖和实际验证；Skills 按相关章节和实际依赖提供专业方法。

- 新任务创建 Goal；同一任务继续保留原 thread、Goal 和累计用量。显式换上下文时只保留剩余 Goal 预算。普通 message/discuss 仍按用户原文执行一次，不自动唤醒旧 Goal。
- 暂停时保留原生暂停响应中结算后的 Goal 用量，保证会话统计准确。离线真实二进制测试覆盖工具运行中暂停后的最终用量进入 BGS 会话记录。仅当原生 Goal 原已明确设置预算时，focused 继续保留其剩余额度与记账约束；没有预算的任务不受此限制。
- 冷恢复先暂停持久化的 active Goal，再加载 thread、注入当前运行上下文和用户消息，最后激活，避免旧目标抢先运行。新任务复用 thread 时清除旧 Goal 后创建，避免沿用上一任务的计数。
- Goal 的终态通知可能早于当前原生 turn 的最后输出；BGS 等待该 turn 结束才结算，不按统一 token 阈值强制终止当前执行。暂停／退出仍等待进程及工具清理，不凭 Goal 状态提前释放 writer。原生 turn 身份用于工具授权，BGS 外层执行身份跨原生回合保持不变。
- `complete` 表示原生任务结束，不能作为游戏品质或交付验收证明；`deliveryEligible` 和实际验证证据保持独立。预算耗尽、阻塞、取消及失败不自动重派。

BGS 初次接单和后续实现任务的 Goal 明确以已确认行为、必要技术检查和交给用户试玩为结束边界，保留完整需求并复用未变化行为的有效证据。技术检查是否充分仍由 Agent 根据要求判断；BGS 不把最后一个检查通过自动等同于任务完成，也不要求 Agent 代替用户判断乐趣。

BGS 不为游戏任务自动设置 token 上限，也不为历史无上限任务追加限制。任务体量由已确认需求决定；用量继续用于统计与计费，不能作为任务完成的替代标准。成本优化集中于复用有效证据、正确刷新预览以及及时交给用户试玩，不按固定 tokens 截断合理工作。原生 Goal 的显式预算能力保留，只有原已明确配置的预算才继续沿用。

Preview 的 `--help` 和 `--client` 共用当前工具约定。BGS 托管 Vite 在 macOS Seatbelt 内使用 Vite 内置 polling watcher，使修改过的源码和导入内容在新页面请求时更新；普通运行沿用 Vite 默认监听。真实沙箱离线复现中，默认监听返回旧模块，直接运行与 polling 对照均能更新；`hmr:false` 本身不会禁用模块失效，根因是沙箱内目录监听不可用。服务器常驻代码或配置变更仍使用已有 `/preview/restart`；production 只服务已有构建，不自动重建。此修复增加仅托管开发预览期间的文件轮询，不修改 native CLI 权限或游戏源码。

生成的截图/观察文件仍放在既有 `reports/` 证据目录或捕获工具输出目录，测试脚本与输入夹具属于源码。没有扩大指纹排除范围或自动重试。失败后的必要定向复测和已确认分辨率/状态覆盖继续保留。

正式实现交付可通过当前 `measure.mjs --finish --requirements <revision> [--measurement <id>]` 提交既有 `.beegame/delivery/acceptance.json`。读取 handoff/inspect、保存报告或某个检查通过都不会自动结束。提交必须匹配当前需求和 writer；报告声明须有效，当前版本的最新测量须绑定报告、产物及有效输入，已知失败不能被跳过。初次 build brief 及其显式 interrupted continuation 必须走这条经当前输入验证的 `--finish` 链；后续泛化的 design/work 不从历史创建模式推断 delivery scope。没有静态 Web 测量时，可以使用报告实际引用、已由既有校验器验证的成功 Preview 执行回执；任意日志和当前文件哈希不能冒充执行证据。普通公开源码身份扫描不要求 Node 包配置，`package.json` 前提仍只由实际 Web 构建入口检查，不要求更换引擎。

显式提交保留作者说明与证据指纹，通过现有原生 `thread/goal/set` API 记录真实 complete，再关闭当前执行及所属进程，无需额外模型总结。BGS 保留 writer 直到清理确认，并复查提交时的来源、报告和产物；清理失败、用户暂停或结束过程中输入改变不会结算为成功。自然调用 `update_goal(complete)` 的现有路径仍等待最后输出。提交只表示代理声明完成且现有证据校验通过，`quality: unverified`、`deliveryEligible: false` 保持独立；缺失的语义覆盖和实际体验不会由宿主推断成通过。

Preview 的 `--request <stable-id> --run <script> [args...]` 复用现有测量工具的请求幂等约定：请求身份限定在当前 run/attempt，记录脚本、完整 argv、超时与已有来源/工具身份。同一请求只预约并执行一次，重复读取已保存回执；相同 key 携带改变的输入报冲突，失败、中断或未完成记录不自动重放。预约以一次性独占创建保存，并发失败方不会启动第二个检查。新 attempt、新检查或明确重新采样可使用新请求；旧的无 key `--run` 保持每次实际执行。返回 `reused` 是历史观察，不是重新验证浏览器当前状态，也不证明稳定性。

验证边界：这些改动不检测任意 Shell 命令，也不保证代理主动提交交付。无 key、新 key 或新的检查仍可能重复；重复调用即使复用回执，模型调用本身的 tokens 也不会因此消失。没有正式提交时，原有无预算、单次 native turn 三次相同成功检查仍 active 的反例继续成立，不用 token/次数/时间阈值替代完成依据。离线真实链使用 shipped BGS binary、真实 Node 适配器、同一请求两次检查及显式提交，验证一次实际检查、一次脚本化 Responses 请求、无额外总结请求、完整需求保留和 writer/进程清理；不评价真实模型质量或实际节省比例。

离线回归位于 `src/bgs/goals.native.test.ts`、`goal-runtime.native.test.ts`、`runner.test.ts` 和 `src/beegame/workflow-v3/agent-goal.test.ts`（相对 `packages/agent-workflow-server`）。原生测试只连接本机脚本化 Responses 服务；验证生命周期、上下文、跨回合权限与用量；包含真实 BGS executor → SessionManager → 原生 Goal 的无预算创建、完成和暂停记账。不评价真实模型产物质量或实际节省比例。CLI、前端和压缩实现不在此改造范围内。

## 单 GDD 设计来源

BGS 的设计来源统一为 `docs/GDD.md`。写作按当前章节展开：读取对应专业 Skill 及当前决定需要的引用，把规则与边界、空间/交互、视听表现、资源表示和技术接口写到足以指导当前部分制作，再推进其他章节。章节顺序由实际依赖决定，已在上下文中的指导继续复用，不因完整游戏任务而预读全部生产 Skills，也不预设八份文件或固定大阶段。同一事实在所属章节定义，其他章节引用；未生产输入保留计划状态，实际输入变化时修订相关设计。

选定的设计图为资源和 Scene/UI 制作提供主体、构图、比例及状态差异。资源章将当前画面的必要表现转成可独立控制的资源或已选程序化表示，UI 使用这些输入制作，并在现有运行时检查中对照相同状态的设计图。完整参考板不是运行时 UI，沿用配色或通过 JSON/几何检查也不证明还原了设计。此约束不新增审批阶段、机器索引或固定资产制作方式。

当前设计问题和实现结果使用已有计划/进度记录表达，记录所属章节、未决依赖及剩余完整目标。先完成影响下一步的推导、计算和落盘，再开始依赖它的生产；不新增章节状态机、逐章审批或独立任务库。授权设计工作中，选定图片、资源表示和文字决定在所属 GDD 章节收敛；纯参考图任务仍保留原设计，图片瑕疵不授权修改确认需求。截断的来源和观察结果应读取已保存内容补全，不能把片段当作全部输入，也不为找遗漏文本盲目重跑。

现有交付报告支持 `verification.visualComparisons`（request/非编辑内容可选，editable Scene/UI delivery PASS 必需）：每条记录 `state`、`sourcePath`、`observationPaths`、`status`（`matched`/`different`/`unverified`）和 `differences`。源设计与观察必须分别引用现有 `evidencePaths` 中的不同文件，复用原证据路径、哈希与测量绑定。`matched` 要有观察且无声明差异；`different` 要有观察和差异；`unverified` 可无观察但须写明缺口。delivery 的 PASS 不能带有已声明的差异或未验证项，request 报告可保留局部未完成结果。未要求视觉交付的读取仍兼容缺省此字段的旧报告，缺省不等于视觉已验证。宿主只结构校验文件路径及扩展名、状态、差异声明和证据绑定，不判断画面语义或像素级一致；完整行为与视觉覆盖仍需实际观察。

离线原生链回归复用真实 CLI、Preview 回执与显式交付入口：分别提交含视觉差异和缺少观察的合成报告，确认均被拒绝；再确认无差异记录经过 CLI 保留且 `quality` 仍为 `unverified`，交付结束后不追加 Responses 请求。该夹具验证字段传递和交付判定，不验证真实模型能按章节推导或还原画面，也不修改测试项目产物。

共享文档身份、审查反馈、交接、实现读取、UI/Scene 来源、计算溯源、权限保护和发布简介均使用 GDD。删除八文档写作顺序、兄弟文档齐备判断及技术文档收口分支。普通 GDD 不需要机器索引；已有可选索引的完整性检查继续保留。Manifest、实际 Scene/UI 内容与进度记录仍承担各自职责。

此改造不自动转换或删除已有项目文档，不重写已有项目 `AGENTS.md`。历史项目继续使用前需要通过正常授权的项目流程确认其当前 GDD，不能将系统代码改动视为已迁移历史产物。离线契约和集成检查用于验证系统链路，不能替代真实设计质量、资产听感或游戏试玩验证。

## 本地构建和验证

```sh
git submodule update --init vendor/bgs
bun run bgs:build
bun run bgs:check
bun run bgs:verify
python3 scripts/test_brand_bgs.py
python3 scripts/verify-bgs-source.py bgs/source-0.164.0
bun run typecheck
bun test scripts/migrate-bgs-home.test.ts
BGS_SANDBOX_TESTS=1 bun test packages/agent-workflow-server/src/bgs
```

首次准备依赖可执行 `cargo fetch --locked --manifest-path vendor/bgs/bgs-rs/Cargo.toml`。正常构建使用离线锁定依赖；本地测试使用脚本化 Responses 服务，不向真实模型提交任务。macOS 权限测试需要可运行 Seatbelt 的宿主环境。

产物是 `dist/bgs-runtime/bgs`、`build.json`、LICENSE、NOTICE 和修改说明。构建信息记录源码 SHA、上游 tag、dirty 状态及平台架构。发布构建 `bun run bgs:build --release` 拒绝未提交的源码。缺少品牌二进制时不回退到官方 npm 包。

## 0.164.0 本地验证（2026-10-23）

- 源码维护提交：`3db5fa466`；品牌发行提交：`816a6982b`，基于官方 `rust-v0.164.0`。现有产品补丁保留；源码生成复现检查覆盖 9,439 个文件，无差异。
- macOS arm64 打包版本为 `bgs 0.164.0`，构建记录 `dirty: false`。CLI、配置目录、插件本地安装和禁用官方二进制自更新检查通过。
- BGS／供应商接入测试的失败项经定位均为过期测试文案、空 Skills 夹具和旧的单次用量写入假设；修正测试后相关检查通过。累计用量／outbox 专项检查通过，未修改实际供应商适配或计费逻辑。
- 使用本机模拟 Responses 服务，验证 0.163.0 创建的会话在同一 BGS_HOME 由 0.164.0 恢复，线程身份与历史消息保留。
- 上游压缩失败后历史恢复测试及后台压缩回退／取消测试共 12 项通过。运行 Rust 测试须沿用上游 justfile／CI 的 `RUST_MIN_STACK=8388608`，否则测试线程可能栈溢出。
- 宿主 TypeScript 检查通过。验证未调用真实模型、真实计费接口或操作测试项目产物；Linux／Windows 包未在此次验证范围内。

切换前通过本机认证会话列表确认 `turnStatus: idle`，并确认后端没有运行时子进程。运行时包替换到默认路径后，新任务按需启动新版；后端无需重启。原 0.163.0 包单独保留供回退。发布这些本地分支后，才能提交并推送主仓库的新 gitlink。

## 旧配置迁移

先停止使用目标账号目录的全部服务，再迁移该目录。不要迁移本机仍供官方 Codex 桌面应用使用的 `~/.codex`；BGS 的每用户目录与其独立。

```sh
# 先只查看计划；这里的父目录要替换成目标用户实际的 .runtime/app。
bun scripts/migrate-bgs-home.ts --from /OWNER/.runtime/app/codex --to /OWNER/.runtime/app/bgs
# 确认服务停用后应用：
bun scripts/migrate-bgs-home.ts --from /OWNER/.runtime/app/codex --to /OWNER/.runtime/app/bgs --apply
```

工具检查打开的文件，拒绝已有目标、合并、覆盖以及不明状态；用同一文件系统目录重命名保留原数据和权限，再保留旧路径符号链接，使历史记录中的绝对路径继续有效。它不改写配置正文、原始日志、SQLite、项目内容或游戏产物。新启动使用 BGS_HOME，新目录采用 BGS 名称。重复执行识别已迁移状态。不要在旧别名仍被历史引用时删除它。

含旧 CODEX_* 环境变量的运维配置、显式旧路径和单机 keychain 凭据不能靠改目录自动翻译：按新的 BGS_* 名称核对环境，显式旧路径可暂由别名承接。BGS 服务使用的文件型 auth.json 会原样保留；独立 CLI 的旧系统 keychain 登录可能需要重新登录。Windows 尚无已验证的打开文件检查，工具拒绝自动迁移。

如果旧目录还未迁移，BGS 会说明迁移方法，不会悄悄创建第二套空账号配置。历史 `runtime: codex` 事件继续可读，新事件写 `bgs`。

## 同步官方版本

保持工作树干净，在同一个子模块中使用两条分支。以下 NEW_VERSION 是选定的官方版本：

```sh
git -C vendor/bgs switch bgs/source-0.164.0
git -C vendor/bgs switch -c bgs/source-NEW_VERSION
git -C vendor/bgs fetch upstream tag rust-vNEW_VERSION
git -C vendor/bgs merge --no-ff rust-vNEW_VERSION
# 审查并解决少量产品补丁冲突，提交；保留此源码维护分支。
git -C vendor/bgs switch -c bgs/NEW_VERSION
python3 scripts/brand-bgs.py vendor/bgs --report /tmp/bgs-brand-plan.json
python3 scripts/brand-bgs.py vendor/bgs --apply
# 编译和上述验证通过后提交生成结果。
git -C vendor/bgs add -A
git -C vendor/bgs commit -m 'brand: generate BGS distribution for NEW_VERSION'
```

如果源码 checkout 还原后保留了 ignored 的旧 `bgs-rs/target`，先将该构建缓存移到工作区外；转换遇到已有目标会拒绝覆盖。不要用 reset --hard、自动 ours/theirs 或覆盖目录解决冲突。主仓库宿主 API 已是 BGS，不随上游重复改名。

先推送源码维护分支与发行分支，再记录主仓库 gitlink。可用 GitHub Desktop 推送，也可用已登录的 Git：

```sh
git -C vendor/bgs push origin bgs/source-NEW_VERSION bgs/NEW_VERSION
git add vendor/bgs .gitmodules
```

仅提交本次工作文件，不将主工作区其他改动混入。升级测试必须覆盖版本/帮助、配置位置、Skills 实际读取与拒绝、插件本地安装、会话恢复、usage 和停止。新平台须本机编译验证；macOS 包不能进入 Linux Docker 镜像。Alpine 需要匹配架构的 musl 构建。

## 回退

保留前一版完整二进制和源码提交。停用新服务后，恢复对应代码与构建；旧路径别名可供旧版访问同一数据，但不得让两个版本同时写账号目录。不要通过重写会话日志、删除项目或改游戏产物回退。


## 模型任务的 writer 恢复（2026-10-26）

`Run.writer` 是 BGS 对同一工作区的任务／编辑器保存预留，以及旧结果的版本隔离；它不是 CLI 的原生线程写锁。CLI 负责原生执行、取消、连接关闭与线程写锁。

当前单 BGS 服务拥有工作区的部署中，服务重启后的旧 Agent writer 可以通过现有 `recover-writer` 接口收尾：保留权限、Run 版本、attempt/fence/worker 绑定及本服务活跃检查；当前 executor 清理失败仍保留占用。已有有效退出回执或原宿主观察仍用于保留真实退出和用量事实。没有退出回执时，只将旧请求记为 `interrupted`，释放 BGS 预留并保持 `paused`，不写入 `quiescedAt`、不补造 `notStarted` 或用量，也不自动续跑。缺失会话允许收尾，但不允许凭空恢复对话。

恢复仅在执行身份、会话与工作区完全匹配，且已有 nativeSubmitted 记录时保留快照中的原生会话 ID。后续明确续作仍校验保存的对话并传递原生会话 ID；缺少退出证明时不能改走 focused 新上下文。编辑器文件保存由 BGS 自己执行，继续使用原有收尾保护。

此恢复条件依赖一个工作区由一个 BGS 服务管理；它不证明另一个独立 BGS 实例或遗留进程已停止，也不是跨主机工作区互斥协议。CLI 的锁只保护同一原生线程。不要将本服务无活跃记录解释为多实例部署下的全局空闲。


## 模型请求重试与手动恢复（2026-10-26）

BGS 不再将自定义模型提供商的 `request_max_retries`／`stream_max_retries` 设为 0，使用 CLI 原生默认策略处理请求及流恢复。`error.willRetry` 仍是当前原生回合内的进度；只有最终失败才进入 BGS 失败状态。前端已删除 10 秒倒计时、一次自动续作状态和按错误文案决定重试的分类器，不再由 UI 另发模型回合。

原错误提示的手动按钮沿用 `agent/messages`，发送 `intent: continue`、空文本和当前失败 attempt 的 `continuationOf`，保留权限、暂停恢复、旧 writer 收尾、会话历史、版本及重复请求检查。空继续必须指向最后一个已失败／中断的 BGS 回合，不能切换 focused 上下文。普通回合恢复同一 CLI thread 后以 `turn/start` 的空 input 继续原生历史，不追加“继续任务”等用户提示词；这是新原生 turn 边界，不是原 turn ID 重放。原 assignment 使用 Goal 时，经现有 `thread/goal/get`／`thread/goal/set` 恢复原 Goal，不重建 objective 或重置预算、用量，已完成或预算／用量受限的 Goal 保持不可恢复。普通 Chat／设计回合不会激活同线程的旧 Goal。恢复只刷新当前宿主能力与事实；不会重发完整生产 assignment。

验证使用假 app-server、临时工作区和前端模拟，覆盖无自动派发、同线程空输入、Goal 状态／预算保留、旧 Goal 隔离、过期请求与重复点击。未调用真实模型，未续跑测试项目；这些检查不证明实际提供商网络故障的恢复成功率。


## 验收诊断、执行目录与中断用量归属（2026-10-26）

> 后续撤销（2026-10-26）：按用户要求撤销本节涉及的两处原生源码改动及对应测试：local unified_exec 目录诊断、非分页 metadata-only 冷恢复用量补发。下文保留实施历史，不代表当前原生行为。BGS 的普通及 Goal 延迟恢复入口改用原生已有的 `excludeTurns: false`，以历史恢复路径接收用量通知；代价是冷恢复响应包含历史。BGS 验收诊断、用量归属与去重仍保留。已于 2026-10-26 14:34（Asia/Shanghai）确认空闲后完成撤销版运行包替换及宿主优雅重载，原启动配置与其他服务保持不变。93 项宿主恢复／计费回归、类型检查及撤销版真实 CLI 的离线恢复验证通过；完整恢复返回 1 条已归属用量，轻量恢复不补发。未调用真实模型或启动测试项目任务。撤销备份与加载记录保存在 `/private/tmp/bgs-native-rollback-20261026`。

本轮先确认现有源码已保留原生命令的工作目录、将 `willRetry` 作为同次执行的进度、采用增量输出落盘，并提供原生手动恢复路径；不重复建立重试、日志或续跑机制。它们是否在活动进程中生效仍取决于实际加载的宿主与原生版本。

交付验收继续使用原 schema 和判定条件。缺失 `verification.observation` 与显式 `simulation` 分别说明缺项或不满足目标运行环境要求，返回字段路径、当前值、合法值和现有 `--design acceptance --help` 入口。同一报告中已可直接判定的 target、observation、knownIssues、unverified 和 visualComparisons 问题一次返回，保留第一项诊断类别与原顺序；后续来源、文件和执行回执检查仍沿用原流程。没有增加项目专用规则，也不把报告通过当作实际品质证明。

本地 unified_exec 启动失败后才检查已解析的 cwd，区分目录缺失、非目录和程序无法解析，并保留 cwd、程序名及原始错误。不输出命令参数，不修改 cwd、不自动回退或重试。远程执行入口不检查本机目录。

中断后冷恢复仍使用 `thread/resume { excludeTurns: true }`。非分页历史现在也从已经读入的记录恢复最后一个 TokenCount 所属的显式原生 turn ID，响应仍不附带 turns；通知在 resume 响应后发送。归属沿用 ThreadHistoryBuilder，无法确认显式身份的历史不猜测归属。已加载线程的 warm resume 行为不变。

宿主透传原生 turn ID，按历史 accounting epoch 和原生 turn 匹配恢复计数的 BGS 回合、计费来源及 baseline-only 性质。累计计数的新增部分按执行归属汇总，重复或倒序通知不会再次增加用量；恢复的旧增量不计入新请求。带有无法匹配的原生 ID 时只保留未归属观察，不对新请求收费。转换协议的原生 baseline 不能冒充供应商 receipt，协议或连接切换也不能改变历史计数的性质。

恢复观察追加到现有事件流，保留原始记录及旧 Run 的闭合结算事实；本轮没有回写历史账目或修复测试项目数据。此前缺失的供应商 receipt 仍属于证据缺口，不能据原生 counter 补造。新行为需要宿主和原生运行时同时更新，不能只替换其中一层后宣称完整修复。

验证覆盖验收正常与多项失败报告、本地真实进程的不存在 cwd/合法 cwd 对照、非分页冷恢复协议、原生身份传递、重复/倒序计数、未知归属、跨接入方式恢复及历史记录前缀保持。使用临时夹具、假 app-server 与本地原生测试；类型检查通过，未调用真实模型或续跑测试项目。初次源码修复验证结束时仍有活动任务，当时未重启宿主或替换默认运行时包。随后经用户授权检查并确认空闲，于 2026-10-26 14:19（Asia/Shanghai）完成离线原生构建和默认运行包替换，并以原参数、目录和环境优雅重启 Bun 宿主。原生运行时按需启动，后续启动使用新包；已有预览进程未被终止。加载后的只读检查确认 runtime、billing、skills、resources 健康正常，活动回合、writer、作业队列及待结算用量为空，工作流记录未变化。没有调用模型或重跑测试项目。旧运行包保留在 `/private/tmp/bgs-audit-fixes-20261026/activation/previous-runtime`，加载结果记录在同目录的 `load-result.json`。


## 历史大记录读取与 BGS 层恢复方案（2026-10-26）

本节描述撤销原生补丁后的当前方案。系统调整限定在 BGS 宿主；本轮不修改或构建 `bgs-codex-cli`，也不修改测试项目、原始日志或历史账目。

已证实的阻断来自宿主 journal：一条历史 Shell `tool.completed` 序列化后为 4,618,046 字节，超过 4 MiB 单记录限制。原 `hostTranscriptFact` 需要先完整解析记录才能删除 `payload.output`，因此项目 runtime-state 的磁盘读取和同步会话恢复都会在删除之前失败。Agent 输出还承载后台任务用量身份，不能通用地丢弃所有工具正文。

现在仅对超限的 Shell `tool.completed`／`tool.failed`，在读盘时用 256 KiB 块扫描并省略直接 `payload.output` 字符串，剩余记录仍受原 4 MiB 限制。扫描器只保留根对象与直接子对象的定位信息，深层内容保留原字节；完整解析剩余 JSON 后再次确认事件类型与工具名。省略字符串的转义也必须合法；重复的 payload/output/type/toolName、非 Shell 输出、非字符串 output 或其他字段超限均拒绝读取。所有生命周期、命令与 cwd、退出码、耗时、身份及未知元数据保留。同步恢复和异步状态读取使用同一投影；显示分页仍独立遵守原限制。原日志不重写，不增加存储协议、后台迁移或依赖。

替代已撤销原生改动的评估与实施边界：

- **旧用量恢复**：保留撤销流程已落在 BGS `runner.ts` 的普通恢复和 Goal 延迟恢复两处 `excludeTurns: false`。使用原生已有的完整历史恢复路径，Host 只消费 thread ID，不把返回 turns 再注入模型；用量继续沿用原生 turn ID、历史 epoch 和既有去重归属。缺少可靠身份时保留未归属观察，不补造供应商 receipt。撤销时的离线 fixture 已证明完整恢复返回旧用量、轻量恢复在该 fixture 中没有返回；这不等于所有 paginated thread 的轻量恢复都无法补发。原生 paginated history 已支持完整恢复兼容分支，但该分支 deprecated，响应成本随历史增长。Host 当前整行 JSON.parse，RPC 默认 30 秒；可能的内存／超时成本尚未实测为故障，不能把历史响应字节等同于新增模型 tokens。本轮保留现方案，不新增分页回退、缓存或额外 resume；只有出现可复现的容量故障，才评估已有 `initialTurnsPage`／turns-list／items-list 接口及用量归属取舍。Goal 激活可能立即启动原生回合，继续保留现有先暂停、延迟 resume、注入当前上下文再激活的顺序；本轮不执行真实 resume。
- **cwd 诊断**：BGS 外层仍使用已授权 workspace root 启动 native client；内层命令如果已有原生 commandExecution item，现有事件已保留实际 command/cwd、error、exitCode 和 duration。没有证据表明需要增加 wrapper、目录预检、自动 fallback 或重试。工具 item 创建前的原生失败不能通过改写 host log 变成模型可见的 tool result，也不能据此伪造失败回执。只有出现独立可复现的 BGS 启动边界缺陷，才在该宿主边界补充有来源的错误说明；不恢复原生目录补丁。

离线验证覆盖读写游标、超大 completed/failed、字段保留、UTF-8／跨块转义、损坏正文和重复身份键拒绝、Agent／权限／大 input 保护，以及同步恢复、重启后的 runtime-state 和历史分页；38 项通过，无模型调用。实际保留的 483,012,055 字节 journal 已只读验证：两种读取获得一致的 18,863 条 facts，原超限事件的完整元数据保留，SHA-256 前后相同。该检查证明历史读取缺陷已修复，不证明项目交付质量或真实模型续作成功；真实会话恢复仅用临时 fixture 验证。

加载确认：2026-10-26 15:04（Asia/Shanghai）再次确认宿主、writer、工作流、资源／部署／intake／native 队列空闲后，沿用原参数、目录和环境，仅优雅重载 Bun 宿主（59499 → 65957）。原失败的项目 runtime-state 由 HTTP 400 恢复为 200；运行态为 idle，持久化工作流仍为 blocked，不能据运行态空闲判定任务完成。维护脚本曾错误预期 paused 而中止结果核对，随后只读核对持久化状态，未再次重启或为满足断言修改系统。15:06 的最终检查确认四个服务健康，原始 journal 哈希、全部工作流记录、撤销后的 CLI 源码与运行包、其他服务和预览进程均未变化，活动回合和 writer 均为 0。未调用模型或重跑任务。备份、增量补丁、离线和加载记录见 `/private/tmp/bgs-host-log-recovery-20261026`。


## 宿主请求取消、诊断与观测事实（2026-10-26）

BGS 在收到服务端请求时立即登记当前连接内的 request ID 和取消信号，随后仍等待前序通知完成，以保留 Goal 的回合准入顺序。`serverRequest/resolved`、对应原生回合结束、下一回合开始和连接关闭会取消失效请求；动态工具取消不保证发送 `serverRequest/resolved`，因此不能只依赖这一通知。子任务终态也会清理该子任务的等待。现有审批队列按取消信号移除请求、写入 `permission.resolved: cancelled`；迟到批准不再写文件或发送原生响应，正常决策会移除监听器。

子线程的历史归属保留用于展示和复用，授权另外要求它仍活跃并属于当前已绑定回合。child listener 可能在初始回合开始后才附着，因此允许第一个活跃请求提供回合 ID，不强制先看到 `turn/started`；当前运行期内保留已观察结束的子回合 ID，任何已结束回合都不能凭后续 `sendInput` 恢复授权；这些记录不持久化。对于此前从未观察到的回合 ID，现有协议不能提供额外的新旧证明，本次不修改 CLI 或引入新的会话协议。

启动在真实 `spawn` 事件确认后才发送 `initialize`。宿主错误以 `BgsClientError` 保留安全的失败阶段、真实 OS 错误码、RPC 方法、可执行文件 basename、cwd 类型、退出码／信号及超时时间，并写入现有 `turn.failed` 事实。不记录原始 stderr、敏感 argv、完整 cwd 或提供商响应，不猜测 ENOENT、不改变工作目录或增加重试。

runtime-state 不再将工具生命周期事件数当作 `memory_hits`；没有检索证据时省略此可选字段。既有 `counters.toolUseCount` 为兼容名称，仍统计 `tool.*` 事件而非调用次数。快照不可用时复用已有角色用量推导，未证实部分保留 `unattributed`，不默认归给主 Agent。输入与缓存字段口径不变，也未更改计费账目。

资源检查仅补充完整 RIFF/WAVE PCM16 单／双声道的物理事实：编码、采样率、声道数、帧数和毫秒时长。损坏或不支持的格式继续保持未知；这些事实不证明音质、循环语义或运行时消费，不改变交付判定。依赖哈希、历史恢复策略、writer 恢复和其他未获证优化保持原行为。


## 普通消息的实现入口与测量成本修正（2026-10-26）

普通聊天的 `message` 表示传递用户原文，不再被实现入口一律当作禁止工作的讨论。消息仍不自动创建或恢复 Goal；Agent 判断当前请求确实授权实现时，可调用既有 `workflow.mjs --implement`。宿主复用现有 handoff、来源身份检查、清理与续发链，在同一会话开启该请求的 implementation Goal。咨询和纯设计可以直接结束。普通消息不能直接 `--advance` 或 `--finish`；后者会明确指出现有实现入口。实现交付仍须通过当前测量、需求版本和来源验证，原生 Goal 完成声明本身不等于交付。

这条路径使用现有 CLI 的 `thread/goal/get`、`thread/goal/clear`、`thread/inject_items` 和 `thread/goal/set`，没有新增协议或语义分类调用。普通消息提交的实现 handoff 是当前请求的新 assignment；需要保留原 Goal 及其预算、用量的续作仍使用已有 `intent: continue` 与 `continuationOf`。BGS 不从“继续”等关键词自动推断两者。自然语言是否授权实现仍依赖 Agent 正确理解并选择工具；离线回归只验证选择后的执行契约，不证明真实模型总能正确选择。

`workflow.mjs` 与现有 measure/handoff 一样，每次从 `BEEGAME_MEASUREMENT_CAPABILITY_FILE` 读取当前地址，并校验 workspace、session、executionId 和本机 URL。由本版本生成的旧目录 helper 可在同 workspace/session 的后续执行中使用当前能力；跨项目、跨会话或撤销的能力不能调用。此修正不改写历史项目中已生成的旧脚本。

字体消费测量复用已有源输入规则，在构建前识别本次所选探针缺少字体绑定等静态错误；不要求为未选择节点、文档或 viewport 补齐探针。字形覆盖、打包字节和浏览器观察仍由构建后的既有驱动判断，静态检查不生成运行通过结论。字体驱动接收 runtime-checks 已有的 registered/selected 范围参数，独立 Task 的 registered 覆盖要求保持原状。失败回执保留在原有测量记录中，同 key 的读取不自动重建。

默认 measurement 摘要聚焦检查状态、失败或未验证条目，并以计数呈现无问题的已验证资源，去除重复的限制说明。完整资源证据和原始观察继续保留在既有记录及 `--details` 中。这里的已验证资源计数只表示结构检查结果，不表示游戏内资源消费、玩法或视觉质量已验证。

已有 `coveredDesigns` 足以合并实质上已覆盖的专业方向，本轮没有新增设计阶段。用量审计未证明需要增加计费账本或历史回填；原生累计与 provider 回执的历史缺口仍保持缺口，不补零、不补造 receipt。本轮仅修改 BGS 后端与文档，CLI/vendor 和 frontend 保持修改前内容；验证使用离线模拟及临时 fixture，未续跑测试项目或调用真实模型。


## 原生流程工具与生成协议类型收敛（2026-10-26）

新建原生线程在当前任务具备 workflow capability 时，通过已有 `thread/start.dynamicTools` 注册 `BgsWorkflow`。`status`、`advance`、`implement` 直接调用当前 BGS 回合的宿主闭包，复用原有 writer、暂停检查、handoff 来源绑定与 CAS；不增加工作流状态或模型调用。SessionManager 将 callback 从 `prepareTurn` 传给 start/submit，复用 runner 时也使用当前 submit 的 callback，不持久化函数。

原生请求必须属于当前父线程及有效回合；子线程不能使用父线程的 handoff 权限。已取消或已撤销的 capability 拒绝新请求。已经进入事务的回调仍由原有 writer/CAS 约束，清理会等待它结束；请求随后取消不回滚已提交的 handoff，也不把迟到响应发回原生线程。该边界不依赖模型正确理解取消。

原生 `thread/resume` 没有替换 dynamicTools 的参数，工具目录随原生会话持久化。已有会话缺少 `BgsWorkflow` 时继续使用 `workflow.mjs`；两个入口调用同一闭包。没有为旧项目新建会话、改写历史或回填脚本。工具入口简化不能保证模型一定会选择它，也不证明减少了实际模型 tokens。

测量和最终 `measure.mjs --finish` 保留原入口。finish 会将 Goal 置为 complete 并关闭 native 连接；若把它直接放进等待响应的 `item/tool/call`，当前 dynamic tool 会被未结束工具检查拦截，关闭连接也会使响应丢失。本轮不为迁移 finish 增加两阶段结束协议；已有测量、预览和外部 helper 仍需要其服务。

稳定的 model/account/config/skills、Goal 和 history injection 共 9 个方法，改用 `BgsClient.requestNative`，参数与响应类型直接引用 vendor 内由 Rust 生成的 TypeScript 类型。此方法沿用现有 stdio、超时、错误与取消机制，不新增 RPC 传输层。含实验字段的 thread/turn 调用、initialize 和测试扩展保留原 request，避免为了符合稳定生成类型而删掉既有字段；没有修改 CLI 或生成文件。


ChatGPT 文字／结构化 intake 的原生 ephemeral 迁移经源码核对后未落地。本轮试接已移除，保留现有 direct Responses 路径。`environments: []` 仍会从 BGS_HOME/HOME 等根目录发现并加载 host Skills；ApplyPatch/TestSync 等工具注册取决于模型能力，接到 item 通知后关闭连接不能证明工具从未暴露。`:read-only` 提供真实的文件系统／网络限制，但不等于无 Skills、无工具的单次生成。迁移还会使请求绕过 BGS 现有 outbound 审批与 pinned fetch，改由 native provider routing 处理。当前没有验证这三项契约等价，因此不靠更多 flags、事后拦截或另一套执行循环强行替换。`maxTokens` 在原订阅路径本来就不发送，不能把它误列为此次回归；图片生成也保留现有契约。

动态工具定义同时复用生成的 `DynamicToolSpec`，确保数组统一使用 canonical `type: "function"` 格式。原生协议明确拒绝 canonical 与 legacy 混合，离线注册回归检查这一契约。


验证使用临时工作区与假 app-server，覆盖 native 新建／恢复注册、当前 callback 传递、父子权限、过期与取消请求、helper 撤销和两轮清理。既有 runner 的 81 项回归、稳定调用方的 16 项回归及相关 workflow/lifecycle 定向检查通过，后端 TypeScript 检查通过。未执行真实模型、未续跑测试项目、未重启服务；前端与 CLI/vendor 内容按实施前快照核对。


## 测量与终止提交直接接入原生工具（2026-10-26，后续）

新建会话的剩余测量与交付入口改为 `BgsMeasurement` 和 `BgsFinishDelivery`，与前述 `BgsWorkflow` 一起由原生 dynamicTools 调用当前宿主 capability。测量、保存回执读取、handoff、执行输入和设计检查复用原 HTTP 分支的同一处理函数及校验；完整 probe 说明通过 `help:true` 按需读取，不把全部 probe schema 重复塞入每轮工具目录。旧 native thread 无法通过 resume 追加工具，仍使用原 helper。既有 MCP／外部入口继续兼容，没有人工改写项目历史脚本。

测量增加的是每次请求的取消信号，与原任务取消信号合并后交给已有构建／浏览器驱动。单次取消停止并等待该次工作结束，保留失败或中断回执；同一 request key 继续只读原记录，不重跑。取消单次测量不撤销整个任务的其他 capability，整体退出仍统一关闭并等待工作。

最终提交采用明确的终止式语义，更新前节“finish 保留 helper”的实现决定。普通动态工具返回成功响应和“立即终止任务且不再调用模型”不能混为一件事；这里选择后者。runner 仅在处理当前父线程的 `BgsFinishDelivery` 时绑定该调用的原生 turn ID、call ID 和取消信号。完成检查只允许这一项仍在执行，其他命令、动态工具、子任务和审批仍阻止完成。请求取消或回合过期不能借该例外提交。

完整链路为：现有报告／需求／测量／源身份校验 → 宿主记录 delivery_submission → 原生 thread/goal/set complete → 原生连接和进程清理 → 现有交付来源复核与任务结算。终止会关闭正在等待的工具调用；原生历史可能将它记录为取消，BGS 不伪造 tool.completed 或普通成功响应，交付结果由真实宿主回执及清理后的复核决定。该工具不需要回复之后再调度第二个阶段，不启动额外模型总结，不新增持久化工作流状态。没有修改 CLI。

离线验证覆盖原生正常终止、其他命令／动态工具／子任务阻止完成、请求取消、SessionManager 回执与清理顺序；真实临时构建覆盖单次取消、保留回执和不重跑；真实报告校验覆盖 native/helper 两个入口的一致性、重复提交、过期报告／需求、缺失测量绑定及清理期间源变化。原生部分使用假 app-server，不能据此声称已做真实模型验收。前端、CLI、测试项目产物均不修改；服务不重启。

ChatGPT 重复接入本轮只分析，未修改调用路径。它不会自动把一次生成变成两次生成或双倍模型 tokens；当前多出的维护面是认证文件适配、HTTP/SSE 和错误处理与原生实现分别演进。具体已确认的兼容差异是 BGS 固定 `chatgpt.com/backend-api/codex/responses`，没有消费原生 `account/read.workspaceRouting` 的 backendOrigin/accountRoutingOverride；需要 workspace 路由的账号可能不兼容，未确认普通账号已发生此故障。

更小的下一步是保留无工具的单次 Responses 请求，认证刷新继续交给 CLI，读取 CLI 已解析的账号／workspaceRouting，在同一 owner/account 边界内生成实际请求地址及路由头，然后通过现有出站校验、DNS 固定和禁止重定向的 fetch。文字与图片消费者须一起检查，不能只替换 URL 而绕开当前网络策略。该路由字段在本版本属于实验 API，需要离线验证字段缺失、普通／路由账号、账号不一致和目标拒绝；不能假设稳定生成类型已包含它。token 文件读取与 SSE 仍是必要的薄适配，现有接口并不能彻底替代为一个隔离的原生单次生成 API。


## BYOK 本地模型目录

BGS 从当前 CLI 的 `debug models --bundled` 读取完整内置目录，通过现有 provider bridge 的鉴权 GET 地址交给 `model_providers.bgs.model_catalog_url`。目录和推理请求复用监听器、会话 capability 与清理流程；目录请求不访问供应商、不产生模型用量。ChatGPT 订阅入口不注入此目录。

内置条目保持原样。未收录的当前模型使用 BGS 包内的 `fallback-model.json`，它镜像当前 0.164.0 的未知模型默认描述，不代表已验证的供应商能力；上下文仍为 272000、有效比例 95%。升级 CLI 时用本地 native catalog 回归核对默认描述、Skill 指引、工具和提示词。不使用 `model_catalog_json`，也不在 BGS 中裁剪原生提示词。


## 2026-10-27：验收结果与执行停止分离

`BgsFinishDelivery` 与兼容的 `measure.mjs --finish` 共用现有报告读取及提交路径。有效 `passed` 报告继续要求当前需求、构建／运行证据、资源与可编辑内容检查及清理后的来源一致性；被校验拒绝的 PASS 不能自动转换成停止请求。显式 delivery 范围的 `blocked`／`failed` 报告可以提交并将原生 Goal 设为 `blocked`，无需为了说明阻塞再构建或制造成功证据。报告须保留阻塞原因、剩余范围及所需外部行动；宿主仍等待所有任务和工具清理、核对提交字节，释放 writer 后保留 blocked 原因，不自动重派、不标记完成。无效报告、错误需求版本、取消请求、未退出的子任务仍拒绝提交。

报告的 `knownIssues` 与 `unverified` 继续阻断 PASS。`coverageLimitations` 保存工具覆盖边界；若边界导致必需观察缺失，缺失项仍须保留在 `unverified`。既有 `outsideScope` 保存范围外工作和交付后的主观试玩问题。视觉 `different` 默认仍阻断；仅在已有实际观察且不违反确认需求时可附 `nonBlockingReason`，保留差异及范围依据。这个字段不抵消其他缺陷、缺失证据或失败检查，也不代表宿主认证了语义判断；错误分类仍是代理判断风险。

实现目标、生产任务、项目指南和执行 Skill 使用相同结束边界：按确认范围实现，复用未变化输入的有效证据，在已有进度记录保存完成项和证据路径，只重验受影响行为与集成。没有新增阶段、审查调用、重试或自动 token 上限。验证使用离线合成输入；未以现有生成项目的通过或改写证明修复。


### GDD 工作文档任务（2026-10-28）

初次 GDD 以一个无 Goal 的文档任务覆盖玩法、关卡、数值、美术、UI、音频、资源和技术八个方向，沿用配置中的模型和对应专业 Skills。当前主代理通过已有 `WriteProjectFile`／`EditProjectFile` 维护固定的 `docs/GDD.md`，最终只提交 `status: ready|blocked` 与 `summary`。不重复回传完整文档，工作文档写入协议本身不增加模型调用或流程阶段；独立审计的额外调用见下文。Shell 和其他项目文件仍只读，不开放生产、预览或测量能力。

写入复用既有文件权限、复核及原子替换，并在文件操作前检查当前 Run、attempt、worker、fence、暂停和执行退出状态；只允许当前父线程及原生回合，拒绝子代理、旧回合和失效能力。工作文档可能在中断或失败后保留并被现有读者看到，不提供上一个已提交版本的隔离或回滚。草稿存在不等于任务完成。

提交时 BGS 从固定路径读取有效 UTF-8、非空白、无 NUL 的普通文件，绑定实际字节的哈希，拒绝路径链接；清理后重新核对来源并结算任务，不自动进入视觉或实现。哈希只证明来源一致，不认证文档质量、语义时效或需求覆盖。缺失／无效文档、blocked／无效结果、执行失败／中断及提交后字节变化均不能完成交付。已存未完成设计任务恢复时刷新当前写入能力与小结果约定；普通后续消息沿用原入口，已存视觉／资源任务沿用既有交接。

初次 GDD 及其失败／中断恢复继续接收用户所选平台／引擎的保留要求和适用的 BGS 可编辑数据约束；文档写入机制不以某个平台或引擎为前提。平台与引擎由项目确认时的设置传入，确认后固定；后续聊天不能更换这两个字段。

本次本地夹具验证权限、中断、恢复、文本校验和提交链路；不重启服务、不调用真实模型、不修改测试项目产物。取消完整文档的最终重复输出只消除一项确定的协议开销，实际 tokens／时间收益尚未测量。


## 2026-10-28：历史可编辑标记不覆盖当前平台和引擎

`requiresBgsEditableContent` 与创建入口使用同一适用边界：仅当历史记录允许可编辑内容、当前结构化设置为 Web/React 且未显式关闭 `bgsVisualEditing` 时，要求 BGS Scene/UI JSON。缺少平台或引擎、其他目标或明确关闭时，不再因旧 `creation.editableContent=true` 而强制 Web 内容。该共享判断覆盖 GDD、普通后续任务、内容检查、验收和发布检查；保留历史创建记录，不自动迁移项目或创建内容。

本地回归覆盖旧标记与当前设置不一致的真实路由／会话提交链，以及正常 Web/React 的保留行为。真实历史样本本身选择了 Web/React，其原生上下文与选择一致；不能据此宣称原生引擎实测通过。按已确认的产品边界，平台与引擎一旦在设置中确认即固定；聊天中提出其他目标不构成设置变更。此前把“不随聊天更新 settings/constraints”列为缺陷的结论撤回，不增加目标迁移接口或聊天选项。


### 平台／引擎固定边界（2026-10-28 澄清）

沿用现有设置 → confirmed brief → requirements.constraints → 会话上下文的传入链。消息接口保持严格字段契约，不接受 targetSettings；重复初始化不能覆盖已确认的 brief。现有共享上下文明确告知 Agent：聊天和设计修改不能更换平台或引擎，遇到冲突应说明限制并保留已确认目标。普通需求正文仍原样保留，不用关键词解析或静默删改请求。

本地路由回归确认初始 GDD、后续 message/change 的设置与上下文一致，额外目标字段及不同设置的重复初始化被拒绝。字段保留由程序验证；Agent 是否正确解释并遵循该边界仍属语义行为，本次未进行真实模型测试。此前目标迁移候选只存在于隔离副本，现已撤回，未应用到运行源码。


### GDD 工具交接说明同步（2026-10-28）

原生 BgsWorkflow 描述与兼容 workflow.mjs 帮助仍残留“最终结果提交完整文档”的旧说明，和当前工作文档契约矛盾。删除这两处重复的输出格式要求，统一指向当前任务已有的 final-result 契约；GDD 仍不使用通用 advance。当前初始 GDD 不暴露 BgsWorkflow 或 workflow.mjs，因此最新样本的重复读取和语义遗漏不能归因于这两处说明。修改作用于后续新注册的工具描述与新生成的帮助，已持久化的原生工具目录和项目历史脚本不回写。未改变流程、权限或模型调用。


### Responses 流中断的用量完整性（2026-10-28）

本地真实 BGS app-server、假 Responses 服务、SessionManager、持久化快照和假计费后端共同复现：响应体断开、缺少终态的 EOF 或用户取消后，Responses 透传分支未记录缺失用量回执；重连成功时已知 tokens 被误标为完整最终用量。转换协议已有自己的回执记录，不受此缺口影响。

在现有 bridge 中复用同一有大小上限的 SSE 解码器，仅在转发每个原始数据块前观察原生可消费的终态用量回执。EOF、错误或取消仍无有效回执时，通过已有 onUsage 记录一次零增量和 incomplete；不估算未知 tokens，不另算终态数值，不改变原始字节、原生重试或任务结束流程。正常收到终态后取消读取不会被误标。原生负责实际 tokens，既有会话持久化和计费链保留已知下限；/compact JSON 路径保持原行为。

回归覆盖网络中断、提前 EOF、用户取消、正常终态后取消，以及之后原生恢复的去重、冷读取和计费元数据；另验 UTF-8/CRLF 分块、伪终态文本、非法用量与字节透传。回执判断只检查原生及 bgsUsage 所需字段和缓存子项边界，不重复校验 total 算术或 reasoning 上界；预期的外部 SSE 解析错误记录缺失回执并继续透传，意外内部异常不在观察器中吞掉。content_filter 和 response.failed 的用量在当前原生解析器中不会作为计数回执消费，因此不能仅因字段存在而抑制缺失标志。供应商提供错误或缺失的账单用量仍无法由宿主补全。未调用真实模型、改动 CLI/前端/测试项目或重启现有服务。


### GDD 独立内容审计（2026-10-28）

作者完成候选 GDD 后提交原有 ready/blocked 小结果。ready 现在是申请审计，不再直接交接：宿主等作者原生回合结束后，在同一个 app-server 内启动独立 thread，传入当前已确认需求和宿主计算的文件路径、哈希。独立 thread 不继承作者历史、推导、摘要或作者的专业 Skill 正文，沿用用户选定模型及推理设置、原生基础上下文和项目只读沙箱。禁用 MCP、网页搜索、Goal 和多 agent 工具，不注册项目写入工具；审计指令限制为需求、GDD 及只读计算。审计期间拒绝旧作者回合的迟到写入。原生基础上下文及项目读取权限仍存在，不将指令层的阅读范围描述成逐文件读取隔离。

审计聚焦已确认要求、关键规则和推导、实现必需的设计前提，不要求提前完成后续视觉、资源、实现职责。2026-10-28 实测后取消报告中的 blocking/advisory 二选一：正式 findings 只列必须处理的实质缺陷，每项都阻止交接；措辞和可选改进不进入报告。审计给出定义、反例和影响，不代写替换正文或推荐答案。数值反例需要来源、作用对象和条件，不能以模型判断充当证明。

有发现时回到原作者一次。作者保留现有 WriteProjectFile/EditProjectFile 工作文档能力，核实定义、计算适用关系，集中修改受影响内容；最终小结果只增加 reviewResponses，按初审发现的 1-based 序号逐项给出 corrected/rejected/unresolved 和证据。接受和驳回均需要依据，笼统的“全部核验”不再足够。宿主检查对应关系完整、没有重复或未知序号；作者仍有 unresolved 时直接保留草稿，不浪费一次复核。其余情况复用同一个审计 thread，传逐项依据而非作者总括摘要，核对当前文档与受影响关系。复核逐项返回 resolutions，必须覆盖所有原发现；原发现可以被证据推翻，不能靠下一份报告中消失就视为解决。修订引入的实质缺陷也列入 findings。初审发现只使用原数组序号，不引入跨任务问题跟踪器。

宿主将报告、原生 thread/turn ID、起止时间、文档哈希、作者摘要及逐项响应保存在当前 agent turn 的 designReviews，通过既有 Agent 工具事件展示活动。最终交接要求来源匹配、原发现有完整处置与复核记录、没有遗留发现或 unresolved。限制仍为一次完整审计、一次集中修订、至多一次定向复核；报告无效、版本变化、失败或取消时保留草稿，不自动重试。历史收据不改写或补跑；新契约用于新执行的设计任务及未完成设计的恢复，普通后续编辑入口保持不变。

方案审计撤回了“一次性最终返回全文、宿主保存正文及批量补丁”的提案。该方式会丢失完整响应前的草稿保存机会，放大输出中断后的恢复成本，且不能约束一次模型响应内部的重复推理。继续保留边写边存、原子编辑、暂停后的草稿及原生会话恢复；最终结果不接收 document 正文。成本约束通过收窄工作职责实现：写作时就检查所属决策并保存必要推导，完整候选稿就绪即交审计，避免再逐章自审；修订仅处理列出的缺陷及依赖关系，使用已有批量编辑，不增加硬性写入次数、工具调用配额或强制终止机制。重复工作的实际减少尚未验证，不将这些指令当作确定性预算保证。

本地验证使用合成临时项目、模拟 app-server 及真实原生 app-server 连接本地假 Responses/Chat Completions 服务。核查实质缺陷不能按 advisory 放行、逐项响应与复核不能缺项、误报可被有证据地驳回、修订新缺陷不能放行、上下文隔离、只读权限、回合身份、用量，以及暂停／失败后保留草稿并恢复。未调用付费模型、改动真实测试项目、前端或原生 CLI，也未重启现有服务；运行后端需按空闲检查规则重启后加载。沿用现有用量统计，不新增账本或预算框架。

宿主只保证报告契约、执行与版本事实，无法程序化证明自然语言证据、缺陷范围或处置结论正确。模型仍可能漏检、给出虚假依据或错误宣称已修正；删除严重度开关和补齐逐项响应不能消除这些语义风险。本地模拟不证明真实发现能力、误报率、修订质量或 tokens／耗时收益，后续需另行授权的有限真实验证。


## Host execution boundaries (2026-10-28)

BGS supplies authorized scope, confirmed target, current capabilities and delivery contracts. The native CLI owns execution, continuation and Skill discovery; the Agent selects professional methods. The GDD assignment still covers all eight design responsibilities, but no longer invokes a fixed set of nine Skills. Native explicit user Skill requests remain supported. Implementation retains its existing execution Skill.

The project guide now owns durable source/evidence conventions; current final-result and delivery operations stay in task and tool contracts. Shared parallel guidance retains write ownership and cleanup boundaries without prescribing a detailed delegation procedure. Resource sourcing and visual production follow explicit user preferences, rights, selected designs and budget; no universal library/public/AI sequence, image-generation-only board or blanket procedural-art ban is imposed. Inspectable visual designs, required artwork and actual runtime evidence remain required where applicable.

Independent GDD review remains read-only and source-bound, with at most one author revision and one targeted follow-up. Unsupported findings can be rejected with evidence and independently checked without changing the document. Unresolved findings still block handoff; the final error now includes the findings, reviewer resolutions and author responses for a concrete decision, rather than only a summary. No automatic override, extra reviewer or retry is added. Structural validation cannot prove semantic correctness; this change does not claim to eliminate model mistakes.

Existing project AGENTS.md files and generated artifacts are not rewritten. The shorter guide applies to new initialization; existing native histories may retain prior guidance. No service restart or paid run is part of this adjustment. Offline and scripted native tests validate contracts and loading behavior, not live quality, latency or monetary savings.

# BGS 源码品牌、构建与升级

BGS 基于选定的官方 Codex 版本。原生执行、Goal 计数、历史恢复、模型元数据与协议以官方为准；只保留 BGS 的命令展示、独立配置根和必要打包适配。源码目录、Cargo 包名、内部类型与协议标识沿用官方，不再全局替换字符串。原生行为偏离必须先说明依据、范围与维护成本并取得用户明确授权，详见 AGENTS.md。

## 仓库与分支

- 主仓库子模块：`vendor/bgs`；Rust 工作区：`vendor/bgs/codex-rs`。
- Fork：`https://github.com/Phantomxm2021/codex.git`。这是现有真实仓库地址，保留作为来源，不虚构新地址。
- 官方上游：`https://github.com/openai/codex.git`。
- `bgs/source-0.167.0`：上游命名的维护分支，仅保留 CLI 展示／图标、禁止官方二进制覆盖源码包的打包保护及 workspace 锁文件版本修正；三个非品牌行为补丁已撤除。
- `bgs/0.167.0`：由维护分支加受限配置根／文档转换生成；保留官方内部名称及协议。主仓库 gitlink 固定发行提交。Rust 工具链沿用上游固定的 `1.95.0`。
- 受限转换在 `scripts/brand-bgs.py`：默认只报告，`--apply` 才写入；只处理受 Git 管理的源码，不重命名文件／类型／协议，不处理宿主或用户运行数据。原生配置根使用 BGS_HOME／.bgs，项目配置与其沙箱保护一致使用 .bgs，系统配置和管理域属于 BGS；其他内部实现沿用官方。

后续更新在维护分支合并选定的官方版本，先审阅相对官方的全部差异，再生成发行分支并核对。不得自动延续非品牌行为补丁，也不得将自写测试断言作为偏离官方的依据；机械可复现不等于语义正确或外部兼容性已验证。

## 运行位置

| 内容 | 位置或接口 |
|---|---|
| 对外二进制／内部 Cargo target | `bgs`／`codex` |
| Cargo 主包 | `codex-cli` |
| 原生伴随程序 | `codex-code-mode-host` |
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

未知／BYOK 模型沿用官方 fallback 元数据，不再强制开启 include_skills_usage_instructions。共享／用户 Skill 仍通过官方 extraRoots 接口发现，显式选择与原生工具读取沿用官方机制；不得通过额外宿主提示补回已撤除的原生补丁。本机模拟可验证实际请求和读取链路，不能证明真实模型选择或产物质量。

系统 `imagegen/SKILL.md` 保留原文并参与原生发现，用户显式停用设置仍生效。原生 `image_gen` 继续遵守 CLI 的连接能力与认证条件；允许使用已配置生图服务的当前任务，通过既有资源命令的 MCP 入口获得 `generate_image`，复用报价、计费、参考图、文件保存与恢复。它不冒充原生工具，不改写系统 Skill，也不要求 Shell 持有供应商 API key。

官方协议保持原名，包括 codexErrorInfo、codex/imageDetail、codex/encryptedContent、Product::Codex、Realtime 参数及官方 Apps 工具标识。真实外部 URL、模型 ID、服务端协议头及认证/额度标识保留；`bgs app` 所连接的官方桌面应用的签名、安装器和 URL scheme（该命令仍明确标为 upstream Codex Desktop）；第三方插件包中的 `.codex-plugin` 清单格式；LICENSE、NOTICE、来源说明；读取旧会话的兼容标识和迁移别名。安装根已属于 BGS，第三方包格式不会被擅自改写。Git 历史和 Git 自身的旧子模块元数据不做字符串改写。

## Scene/UI 编辑契约退出所有平台

所有目标使用所选引擎或框架的原生场景、UI、代码与资源。普通任务、设计任务及恢复上下文不再注入 BGS 编辑器要求，也不默认提供内容检查、绑定、消费者安装适配器或 MCP 布局编辑诊断。React 项目的 Phaser/Three.js 库选择仍仅由确认的 2D/3D 决定。

宿主对所有平台声明 `scene_ui_editor_available:false`；历史内容读取始终只读，直接保存入口返回 `editor-unavailable`，不申请 writer。历史编辑记录、退出证明和恢复清理能力保留，不重放旧保存。

`CheckResourcesAndBindings {}` 独立核验 Manifest 需求与真实资源。旧内容格式只有被显式请求检查或报告明确声明对应检查时才参与历史数据核验；GDD 中的路径、目录或 `content/index.json` 的存在本身不会启用旧合同。实际构建、运行、资源、设计版本与视觉交付校验继续保留，共享资源／字体／媒体实现和历史运行库不整体删除。

测量、执行回执、交付及重新发布构建统一使用既有排除清单，将 `reports/` 和 `docs/TASKS.md` 作为非运行输入；它们不进入实际构建副本。旧构建仍按原回执保存的清单核验，显式引用的证据仍独立校验哈希；源码、测试、资源与需求变化继续使相应证据失效。

## Workflow 执行与历史 Goal 生命周期

新建完整游戏直接进入普通原生实现任务。Agent 在同一任务内按实际需要设计、选图、生产资源、实现和验证；独立 GDD、视觉复核和全量资源阶段不是前置条件。单独的文档、视觉或资源委托按其授权范围执行；历史已保存的待办交接仍按现有分派恢复，不重写已有项目。

普通任务结束以原生回合完成和进程清理为准，不要求 `measure.mjs`、Preview 测试回执、固定验收报告或显式提交。Agent 的结束说明保留实际结果、已做检查及未解决或未验证部分；执行完成不表示宿主已判定游戏品质合格。用户预览和发布使用各自现有入口及校验，历史测量、报告和发布记录仍可读取。

发布在一次性私有副本中复用现有离线构建沙箱；安装依赖只读，构建缓存限于副本。普通发布不要求可编辑源码导出、完整 Manifest 或作者验收报告，不因未使用的浏览器工具链接、缓存或纯 workflow 元数据变化失败。构建真正读取的项目文件仍保留，最终静态产物拒绝符号链接／越界并执行页面加载检查。上传期间校验冻结产物，以及 owner、当前任务修改轮次、需求版本和活跃 writer；历史源码导出与测量校验不变。

- 新任务和普通消息不自动创建或唤醒 Goal；同任务恢复沿用原 thread，不重放原任务。
- 历史 Goal 冷恢复先暂停持久化的 active Goal，再加载 thread、注入当前运行上下文并激活。保留原目标、累计用量，以及原已明确配置的剩余预算；不向历史无预算任务补设上限。
- Goal 终态通知可能早于当前原生 turn 的最后输出；BGS 等待回合结束及进程、工具清理后结算。清理失败不提前释放 writer，取消、失败和阻塞不自动重派。
- 用量用于统计和计费；`complete` 是执行状态，不能代替实际画面、玩法和用户体验证据。

BGS 托管 Vite 在 macOS Seatbelt 内使用 Vite 内置 polling watcher，使编辑后的源码和导入内容在新页面请求时更新；其他环境沿用 Vite 默认监听。服务器常驻代码或配置变更仍使用已有 `/preview/restart`；production 只服务已有构建，不自动重建。该兼容仅覆盖 BGS 托管开发预览，不会改写 Agent 自启服务器配置或扩大原生权限。

## 单 GDD 设计来源

项目需要保存设计时，现有 GDD 来源为 `docs/GDD.md`；内容、结构和深度由当前任务决定。完整游戏不必先生成 GDD。明确的 GDD 委托继续使用现有只读审核与返修；审核复核只接收当前正文、有效需求、待解决问题和作者回应，不继承前轮审核推理历史。

选定图片的实际路径和哈希通过现有选图／交接记录保留，不要求回写 GDD，也不把参考图登记成运行资源。实际资源沿用 Manifest 的文件、来源和依赖记录。已有 GDD 和选图用于实现；只有真实设计矛盾或用户授权变更才修订设计，不能靠回写设计接受实现偏差。

普通 GDD 不需要机器索引；已有版本、可选索引和历史交接仍按原格式读取并校验。系统更新不覆盖已有项目文档或 `AGENTS.md`，也不把代码检查、模型声明或单次测试通过当作真实游戏验收。

## 本地构建和验证

```sh
git submodule update --init vendor/bgs
bun run bgs:build
bun run bgs:check
bun run bgs:verify
python3 scripts/test_brand_bgs.py
python3 scripts/verify-bgs-source.py bgs/source-0.167.0
bun run typecheck
bun test scripts/migrate-bgs-home.test.ts
BGS_SANDBOX_TESTS=1 bun test packages/agent-workflow-server/src/bgs
```

首次准备依赖可执行 `cargo fetch --locked --manifest-path vendor/bgs/codex-rs/Cargo.toml`。正常构建使用离线锁定依赖；本地测试使用脚本化 Responses 服务，不向真实模型提交任务。macOS 权限测试需要可运行 Seatbelt 的宿主环境。

产物是 `dist/bgs-runtime/bgs`、匹配的 `codex-code-mode-host`、`build.json`、LICENSE、NOTICE 和修改说明。构建信息记录源码 SHA、上游 tag、dirty 状态及平台架构。发布构建 `bun run bgs:build --release` 拒绝未提交的源码。缺少品牌二进制时不回退到官方 npm 包。

## 撤除非品牌补丁并恢复官方协议（2026-11-06）

已按用户指令撤除可信应用上下文恢复去重、未知模型 Skill 指令和 Goal 等待用量三个原生补丁，停止全局改名，恢复官方源码目录、内部包名、类型和外部协议。维护提交 `2eb9e51d6e`，最终发行提交 `89e2d1dc91`；均以 rust-v0.167.0 为基线。宿主只适配原生 codexErrorInfo 读取、schema 路径和伴随程序打包，不改任务流程或补回已撤除的行为。

保留的非展示差异仅用于打包：BGS_HOME／默认 ~/.bgs、官方二进制自更新覆盖保护、workspace 锁文件版本及对外 bgs 文件名；内部 target 与伴随程序保持 codex／codex-code-mode-host。BGS 用户／项目配置统一使用 .bgs，系统配置使用 /etc/bgs、macOS 管理域使用 com.phantomlab.bgs，与 Codex 配置隔离；外部协议和服务标识保持官方。没有重写已有会话、配置文件、原始日志、项目产物或账目。AGENTS.md 已明确此边界。

源码复现覆盖 9,817 个文件零差异；Goal、模型元数据、上下文与历史实现同官方逐字节一致；协议字段及 MCP 元数据保留官方标识，仅将配置路径值与目录保护适配为 BGS 名称。全部额外差异按品牌／配置隔离／打包核对。5 项品牌、197 项 runner/client、62 项配置／供应商单测、40 项用量／打包回归通过；18 条相关原生回归分批通过，另用旧 BGS 包生成合成会话并由新包恢复通过。宿主类型检查及默认 CLI 冒烟通过。图像夹具仍有一条 PNG 输入断言失败，已在旧包同样复现；保留其他工作的断言与实现，不混入本轮处理。测试仅使用本机模拟，无真实模型调用；原测试名中的 pre-branding 不作为本次样本来源声明，此次旧包实际为先前 BGS 发行 439e71ad9f。

候选包独立构建；第一阶段于 UTC 2026-11-06T07:40:51.914Z 在 idle 窗口切换并仅优雅重载 runtime（26045 → 65194）。用户随后明确 BGS 配置应保持 .bgs：拟添加的宿主 .codex 只读项已全部撤回，原生项目／系统配置及其目录保护统一回 BGS 名称，外部协议不变。最终包于 UTC 2026-11-06T08:05:35.908Z 再次确认 idle、无原生任务后原子发布，没有再次重启服务；四服务 health 均 200，runtime-status idle，既有服务和预览 PID 均保持不变。最终 4 项原生配置／直接工具／Code Mode 检查通过，实际默认包的 .bgs 隔离检查及 CLI 冒烟通过。没有中断在执行的任务，没有迁移或改写已有真实会话；默认 CLI／伴随程序哈希与最终候选一致。审计、原始失败记录及回退包保存在 claude-code-main/backups/bgs-official-alignment-20261106/。源码与发行分支及主仓库仅作本地提交；远端推送因本次仅授权 Git 提交而未获自动审批，不通过其他途径推送。分享或推送主仓库更新前仍需先发布子模块分支。

## Goal 计数补丁历史记录（2026-11-06，现已撤除）

以下仅保留当时实施与测试记录，不是现行方案，也不证明官方实现存在 bug。测试由本代理编写，计数边界尚未通过官方契约及官方发行包独立复现确认。

- 根因：流式 `update_goal` 可先于其响应的终态 usage 执行，原实现当即清除 Goal 归属，导致回执确认 48 tokens 而完成结果与持久化计数为 0。
- 在 Goal 扩展内部复用已有模型请求拦截接口；`create_goal`／`update_goal` 等待当前请求的 usage 已被 core 记账后，再沿用原有起算／结算逻辑。完成响应的用量计入 Goal，后续最终答复排除在该 Goal 外；创建请求计入新 Goal 起点以前的工作。失败、取消与缺失 usage 各自结束等待；缺失 usage 保留已知计数，不虚构数据。等待期间通过已有 `expected_goal_id` 契约防止操作替换后的新目标。未改供应商适配、宿主计费或权限策略。
- 源码维护提交 `fab1d725b0`（包含 `5b232ae363`）；品牌发行提交 `439e71ad9f`（包含 `ba722db371`）。均已发布到现有 Fork，发行结果从维护源码生成，9,817 个文件复现零差异；上游基线与版本仍为 `rust-v0.167.0`／`bgs 0.167.0`。
- 三条新增／加强的原生回归在旧包均失败、修复包通过：晚到 usage 的冷恢复回执和持久化计数均为 48，EOF／取消不误标 complete。全部 8 条原生 Goal／任务测试、7 条账本与 31 条扩展后端 Rust 测试通过；后端回归覆盖两种到达顺序、直接／Code Mode 调用、完成／暂停／阻塞、失败／取消／缺失回执和目标替换。
- 89 项用量／结算检查及 5 项供应商回归通过，Clippy、宿主类型检查和 4 项品牌检查通过。验证只用现有本机模拟与原生运行包；未新增测试环境、生产入口或真实模型调用。Linux／Windows、真实供应商和真实钱包扣款未实测；其他 6 项既有回归失败不在本轮修复范围。
- 已在空闲窗口发布已验证的候选包（UTC `2026-11-06T06:43:12.258Z`），来源 `439e71ad9f`；切换前真实任务活跃时暂缓发布，未中断任务或重启服务。运行包沿用既有 host 优先、二进制和元数据原子替换顺序，默认二进制哈希与通过回归的候选包一致。安装后 CLI 冒烟检查通过，四个服务 health 均为 200，runtime-status 为 idle。

候选包、回退包、根因证据、检查结果和发布状态保存在 `claude-code-main/backups/bgs-goal-counter-fix-20261106/`。本轮使用 `CARGO_INCREMENTAL=0`；发布后已清理 `target` 构建缓存，按磁盘占用统计约 13.7 GiB，默认运行包、候选证据和回退包独立保留。

## 0.167.0 本地验证与切换（2026-11-06）

- 基于官方 `rust-v0.167.0`，源码维护提交 `14a7da397`，品牌发行提交 `446d5a73d`。保留品牌、自更新禁用、可信应用上下文来源／恢复去重和未知/BYOK 模型 Skill 指引。合并上游上下文统计接口，继续以可信来源恢复上下文；适配模型元数据字段移除和新版登录界面。锁文件内部包统一为 `0.167.0`，Rust 工具链仍为 `1.95.0`。
- macOS arm64 的 CLI 和 code-mode-host 均已离线锁定构建，运行包为 `bgs 0.167.0`、`dirty: false`。品牌生成复现覆盖 9,817 个文件，零差异。品牌检查 4 项、目录迁移 2 项、可信上下文 Rust 检查 3 项、失败／缺失 usage 的上下文计数检查 2 项、未知模型 Skill 指引检查 1 项、code-mode 输出边界检查 6 项及宿主类型检查通过。
- 全量本地 BGS／供应商模拟检查首次为 427 项通过、1 项跳过、15 项失败。稳定复现的 10 项失败均在保留的 `0.166.0` 包上复现，涉及子任务容量断言、隔离验证结果、工具输出预算、图像夹具、工具拒绝后的目录断言、重试次数和供应商累计用量；未将旧包行为作为正确性标准，也未修改生产行为来迎合断言。工作区同期有其他编辑，4 项方法选择断言随后在新版定向检查通过。历史 Goal 新目标计数首次为 0，新版两次单项复测和旧版定向检查均通过，原因仍未查明，不能宣称全量回归通过。
- 复用现有跨版本迁移测试，为其补齐当前契约要求的最小 Skills 夹具；`0.166.0` 创建的会话由 `0.167.0` 恢复，线程身份及历史保留。未新增测试环境、模式或入口；未修改前端或真实项目产物，未调用真实模型。Linux／Windows、真实供应商和终端交互新功能未实测。
- 2026-11-06 11:56–11:58（Asia/Shanghai）确认后端空闲、无待处理权限、writer、用量 outbox 或原生任务后，按现有脚本替换默认运行包及 code-mode-host。版本／帮助、默认和显式 BGS_HOME、命令补全、本地插件安装／卸载及安全更新入口检查通过；切换后四个服务 health 均为 200，runtime-status 为 idle，未重启服务。源码维护和发行分支已发布到现有 Fork；主仓库通过本次 Git 提交固定发行引用，遵守先发布子模块分支再提交主仓库的顺序。

本轮使用 `CARGO_INCREMENTAL=0` 构建；打包和验证后清理 Rust `target` 缓存，按磁盘占用统计移除约 28.1 GiB（Cargo 报告逻辑大小 29.6 GiB），默认运行包与 `0.166.0` 回退包独立保留。备份、检查日志、未通过项分析和切换状态保存在 `claude-code-main/backups/bgs-upgrade-0.167.0-20261106/`。上游变化见 [官方 0.167.0 发布说明](https://github.com/openai/codex/releases/tag/rust-v0.167.0)。

## 0.166.0 本地验证与切换（2026-10-30）

- 基于官方 `rust-v0.166.0`，源码维护提交 `555f92bdc`，品牌发行提交 `416ac2b4e`。保留原有品牌、自更新禁用和可信应用上下文来源／恢复去重补丁；将此前仅在发行分支上的未知/BYOK 模型 Skill 指引同步回维护分支。
- 适配上游新增的不可信上下文工具输出表示，继续仅依据持久化的可信来源标记恢复应用上下文，不把用户或客户端伪造的 developer 文本视为可信输入。四个新增内部包的锁版本由 `0.0.0` 同步到工作区 `0.166.0`，未改变外部依赖版本。
- 沿用上游 Rust `1.95.0` 完成离线锁定构建。macOS arm64 运行包为 `bgs 0.166.0`，构建来源 `dirty: false`。维护分支重新生成的 9,733 个文件零差异；现有品牌检查 4 项、目录迁移 2 项、可信来源／冷恢复去重 Rust 检查 3 项以及宿主类型检查通过。
- 现有 BGS／供应商接入检查为 293 项通过、1 项跳过、9 项失败。通过路径包括 Goal 创建／续作／暂停、冷恢复、压缩、Skills 读取与拒绝、权限、模型目录、用量和 outbox。9 项失败均已用升级前保留的 `0.164.0` 包定向复现；源码核对发现夹具／断言没有跟上当前准备阶段 JSON、运行上下文框架、推理事件、累计供应商用量与原生 baseline、默认流重试等契约。原有未通过项保留，未把旧包行为当作正确性标准，也未修改宿主行为迁就断言。
- 2026-10-30 09:41–09:42（Asia/Shanghai）确认后端空闲、writer 与待结算用量均为 0，且无默认运行包的 app-server 进程后，按既有构建脚本原子替换默认运行包。版本／帮助、默认和显式 BGS_HOME、命令补全、本地插件安装／卸载及安全更新入口检查通过。切换后 runtime、billing、skills、resources 的 health 均为 200，runtime-status 仍为 idle；未重启服务或停止原有预览。
- 本轮没有新增测试环境、测试代码或模式，没有修改前端或测试项目产物，没有真实模型调用。Linux／Windows 与真实供应商运行未验证。源码维护与发行分支已发布到现有 Fork；主仓库通过本次 Git 提交固定发行引用，遵守先发布子模块分支再提交主仓库的顺序。

备份、构建日志、原有失败分析与切换前后状态保存在 `claude-code-main/backups/bgs-upgrade-0.166.0-20261030/`；其中 `validation-analysis.json` 记录未通过项，`runtime-0.164.0/` 保留切换前完整运行包。

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

旧运维配置中只有配置根环境变量 CODEX_HOME 需要核对为 BGS_HOME，其他 CODEX_* 保持官方名称；显式旧路径和单机 keychain 凭据不能靠改目录自动翻译：显式旧路径可暂由别名承接。BGS 服务使用的文件型 auth.json 会原样保留；独立 CLI 的旧系统 keychain 登录可能需要重新登录。Windows 尚无已验证的打开文件检查，工具拒绝自动迁移。

如果旧目录还未迁移，BGS 会说明迁移方法，不会悄悄创建第二套空账号配置。历史 `runtime: codex` 事件继续可读，新事件写 `bgs`。

## 同步官方版本

保持工作树干净，在同一个子模块中使用两条分支。部分克隆若在合并时缺少上游对象，先用 `git -C vendor/bgs fetch --refetch --no-filter upstream tag rust-vNEW_VERSION` 补齐所选版本，再继续合并；不要用覆盖文件绕过缺失对象。

以下 NEW_VERSION 是选定的官方版本：

```sh
git -C vendor/bgs switch bgs/source-0.167.0
git -C vendor/bgs switch -c bgs/source-NEW_VERSION
git -C vendor/bgs fetch upstream tag rust-vNEW_VERSION
git -C vendor/bgs merge --no-ff rust-vNEW_VERSION
# 逐项审阅相对官方的差异，只保留经确认的品牌与打包适配，提交维护分支。
git -C vendor/bgs switch -c bgs/NEW_VERSION
python3 scripts/brand-bgs.py vendor/bgs --report /tmp/bgs-brand-plan.json
python3 scripts/brand-bgs.py vendor/bgs --apply
# 编译和上述验证通过后提交生成结果。
git -C vendor/bgs add -A
git -C vendor/bgs commit -m 'brand: generate BGS distribution for NEW_VERSION'
```

当前转换不重命名目录；旧 bgs-rs/target 不作为源码或新构建输入。不要用 reset --hard、自动 ours/theirs 或覆盖目录解决冲突。宿主源码不随上游重复改名。

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

只透传当前选定模型的真实内置条目，不改写元数据或提示词。未收录模型返回空目录，明确选定的模型 ID 仍传给原生线程，由当前 CLI 自行解析未知模型默认描述；BGS 不保存基础提示词副本，也不把默认容量或能力伪装成已核实的目录条目。原生审批找不到专用审核模型时仍按原有规则使用父模型。升级 CLI 时用本地 native catalog 回归核对默认描述、Skill 指引、工具、审批与冷恢复。不使用 `model_catalog_json`，不裁剪原生提示词或图片历史，也不改写自动压缩阈值。


## 2026-10-27：验收结果与执行停止分离

`BgsFinishDelivery` 与兼容的 `measure.mjs --finish` 共用现有报告读取及提交路径。有效 `passed` 报告继续要求当前需求、构建／运行证据、资源与可编辑内容检查及清理后的来源一致性；被校验拒绝的 PASS 不能自动转换成停止请求。显式 delivery 范围的 `blocked`／`failed` 报告可以提交并将原生 Goal 设为 `blocked`，无需为了说明阻塞再构建或制造成功证据。报告须保留阻塞原因、剩余范围及所需外部行动；宿主仍等待所有任务和工具清理、核对提交字节，释放 writer 后保留 blocked 原因，不自动重派、不标记完成。无效报告、错误需求版本、取消请求、未退出的子任务仍拒绝提交。

报告的 `knownIssues` 与 `unverified` 继续阻断 PASS。`coverageLimitations` 保存工具覆盖边界；若边界导致必需观察缺失，缺失项仍须保留在 `unverified`。既有 `outsideScope` 保存范围外工作和交付后的主观试玩问题。视觉 `different` 一律阻断交付 PASS；历史 `nonBlockingReason` 只保留原文，不再具有自行豁免效力。比较目标是选定设计与用户明确授权的变更，不是逐像素一致；保留设计意图的真实文字和响应式适配可以判为 matched，未解决偏差不能靠改标签或回写 GDD 消除。同主题、信息齐备或回写 GDD 不足以解释构图退化、形体失真与空间关系错误；这些属于待修复实现问题，不能归为个人偏好。已有视觉交接的图片路径与哈希同时用于测量预检、只读验收和终端提交；GDD 当前版本只证明证据新鲜度，不批准更换选定图片。用户明确的文字变更沿用现有需求授权；仅在授权替换选定图片时，沿用原视觉交接保存新来源，不要求为文字变更重新生图。未记录视觉交接的历史项目不凭当前文件补造来源。宿主仍不认证 matched 的语义判断；漏报或错误分类仍是代理判断风险。

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

生成职责按完整决策归属：影响行为的数值、单位、条件和例外关系保留在同一所属定义中；数值设计计算和调整该定义，技术设计引用它并补充实现决策。其他章节只补充自身决策，示例是派生用途，不另立规则。八项设计职责保留，不要求八套独立正文；使用现有单个 Markdown GDD、保存和原子编辑工具，不新增参数文件、规则 ID 或依赖图。

审计聚焦已确认要求、关键规则和推导、实现必需的设计前提，不要求提前完成后续视觉、资源、实现职责。在同一次完整阅读及定向核查中，将定义、用途和推导一起检查，先确认输入关系一致，再执行能够检验关键结论的最小计算。定义导向不同行为时报告冲突，仅暂停依赖该输入的计算，继续其他独立检查；示例结果相同不能消除规则冲突。2026-10-28 实测后取消报告中的 blocking/advisory 二选一：正式 findings 只列必须处理的实质缺陷，每项都阻止交接；措辞和可选改进不进入报告。审计给出定义、反例和影响，不代写替换正文或推荐答案。数值反例需要来源、作用对象和条件，不能以模型判断充当证明。

有发现时回到原作者，在同一个设计任务内继续定向修订。作者保留现有 WriteProjectFile/EditProjectFile 工作文档能力，计算前核对受影响的所属定义及用途，在定义源头修正并同步依赖引用和结论，使用原有原子工具集中修改；最终小结果只增加 reviewResponses，按当前修订清单的 1-based 序号逐项给出 corrected/rejected/unresolved 和证据。接受和驳回均需要依据，笼统的“全部核验”不再足够。宿主检查对应关系完整、没有重复或未知序号；作者明确返回 blocked 才按缺少输入或决策保留草稿；ready 中的逐项 unresolved 仍交独立复核，避免把作者的不确定直接当成阻塞。复用同一个审计 thread，传逐项依据而非作者总括摘要，沿用先核对定义再计算的方法，核对当前文档与受影响关系。复核逐项返回 resolutions，必须覆盖当前清单；原发现可以被证据推翻，不能靠下一份报告中消失就视为解决。复核 findings 只列新增实质缺陷，原问题是否解决由 resolutions 表达；宿主将 unresolved 与新增 findings 合为下一份清单并重新编号，不引入跨任务问题跟踪器。

宿主将报告、原生 thread/turn ID、起止时间、文档哈希、作者摘要及逐项响应保存在当前 agent turn 的 designReviews，通过既有 Agent 工具事件展示活动。最终交接要求来源匹配、原发现有完整处置与复核记录、没有遗留发现或复核 unresolved。不再限制一次修订：首次完整审查后复用同一作者和审查线程做定向修订／复核。以历次最少待解决数量为进展基线，连续两次复核未改善基线才阻塞；允许修好旧问题后出现新问题并继续，数量来回波动不能重置基线。文件哈希变化、措辞变化或作者自称修正不计作进展。此规则是有限成本边界，不是语义进展证明；报告无效、版本变化、失败或取消时保留草稿，不自动重试。历史收据不改写或补跑；新契约用于新执行的设计任务及未完成设计的恢复，普通后续编辑入口保持不变。

方案审计撤回了“一次性最终返回全文、宿主保存正文及批量补丁”的提案。该方式会丢失完整响应前的草稿保存机会，放大输出中断后的恢复成本，且不能约束一次模型响应内部的重复推理。继续保留边写边存、原子编辑、暂停后的草稿及原生会话恢复；最终结果不接收 document 正文。2026-10-29 澄清作者自查责任：在当前任务内核对已确认需求（含平台和引擎）、关键定义及用途、推导所依据的证据，修正实际缺陷并保存后再返回 ready；独立审查不能替代作者自查。保存必要推导，结论不超出证据，未验证项明确标注；复用有效证据，编辑后检查受影响的定义和用途。职责与必要检查完成后交审，不因可选扩写或措辞润色继续延长任务。独立审查后的修订仍围绕发现及依赖关系，使用已有批量编辑；不新增阶段、检查报告、调用配额或强制终止机制。是否减少重复工作、改善设计质量尚未验证，不将这些指令当作语义正确性或预算保证。

本地验证使用合成临时项目、模拟 app-server 及真实原生 app-server 连接本地假 Responses/Chat Completions 服务。核查实质缺陷不能按 advisory 放行、逐项响应与复核不能缺项、误报可被有证据地驳回、修订新缺陷不能放行、上下文隔离、只读权限、回合身份、用量，以及暂停／失败后保留草稿并恢复。未调用付费模型、改动真实测试项目、前端或原生 CLI，也未重启现有服务；运行后端需按空闲检查规则重启后加载。沿用现有用量统计，不新增账本或预算框架。

宿主只保证报告契约、执行与版本事实，无法程序化证明自然语言证据、缺陷范围或处置结论正确。`nonBlockingReason` 的作者豁免已取消，历史声明保留；这关闭已声明偏差的放行路径，但不能防止作者漏报或错误标为 matched。本轮没有增加关键词过滤、额外审核或像素一致门禁，实际语义判断可靠性仍未解决。模型仍可能重复定义、漏读用途、漏检、给出虚假依据或错误宣称已修正；收缩生成职责和调整计算顺序旨在减少冲突机会与无效复算，实际效果尚未验证；删除严重度开关和补齐逐项响应也不能消除这些语义风险。2026-10-28 的本次调整替换现有契约，没有增加报告字段或引用解析器；初始任务、未完成设计的恢复、独立初审与同线程复核沿用共享契约。正在运行的进程及已有原生历史不会因源码修改自动刷新，真实测试项目及其历史产物不改写。本地模拟不证明真实发现能力、误报率、修订质量或 tokens／耗时收益，后续需另行授权的有限真实验证。


## Host execution boundaries (2026-10-28)

BGS supplies authorized scope, confirmed target, current capabilities and delivery contracts. The native CLI owns execution, continuation and Skill discovery; the Agent selects professional methods. The GDD assignment still covers all eight design responsibilities, but no longer invokes a fixed set of nine Skills. Native explicit user Skill requests remain supported. Implementation retains its existing execution Skill.

The project guide now owns durable source/evidence conventions; current final-result and delivery operations stay in task and tool contracts. Shared parallel guidance retains write ownership and cleanup boundaries without prescribing a detailed delegation procedure. Resource sourcing and visual production follow explicit user preferences, rights, selected designs and budget; no universal library/public/AI sequence, image-generation-only board or blanket procedural-art ban is imposed. Inspectable visual designs, required artwork and actual runtime evidence remain required where applicable.

Independent GDD review remains read-only and source-bound. Unsupported findings can be rejected with evidence and independently checked without changing the document. Remaining and new findings return to the same author while the outstanding count improves; two consecutive rechecks without improving the best count end as a preparation blocker. Detailed findings, resolutions and author responses stay in designReviews and native history, not in a runtime-error message. Structural validation cannot prove semantic correctness or detect a false claim of resolution.

Existing project AGENTS.md files and generated artifacts are not rewritten. The shorter guide applies to new initialization; existing native histories may retain prior guidance. No service restart or paid run is part of this adjustment. Offline and scripted native tests validate contracts and loading behavior, not live quality, latency or monetary savings.


### GDD revision continuation and context cost (2026-10-28)

Expected preparation blockers (explicitly declared missing input or decision, or repeated lack of net review progress) use ProductionBlockedError. Session execution ends with turn.completed / production_blocked; the workflow remains blocked, preserves its draft and reason, and releases the writer after cleanup. Invalid reports, source races, provider failures and cancellations retain their failure/interruption paths. No stage advances with outstanding findings; no new model call is scheduled after blocking.

Reasoning settings retain their original behavior for all stages. The proposed GDD-only low default was removed at the user's request; explicit settings and provider defaults are not changed to reduce tokens. Existing evidence showed 6,913,220 tokens including 6,397,312 cached inputs, with 32 model requests after the first full save. These historical counts do not measure savings from source changes.

The review assignment carries the saved source path and SHA-256, not the GDD body. The unbounded full-text injection was removed after review: a body added once is replayed as native conversation history on later requests, and the first request had no document-size/context boundary. Complete-source transfer tests with synthetic usage do not prove context affordability. Native loopback reproduction confirmed the original large source remained in every inspected review request even after the saved file had become short. The tool.started event also retained that full prompt; the source-pointer prompt avoids this extra event copy.

Review continues through existing read-only tools and their output limit, with the complete candidate read in bounded ranges and affected definitions revisited as needed. This does not certify that a live model will avoid redundant reads. The reviewer still disables its unused native Skills catalog; the author catalog and reasoning settings remain unchanged. No new cache, tokenizer estimate, pagination tool, forced compaction or provider-history stripping was added.

The additional EditProjectFile self-check sentences were removed. They changed prompt wording only; no evidence established that missing tool wording caused the observed repeated self-checks or that the addition reduced calls. The original atomic edit contract remains. Repeated author self-review remains unresolved: observed post-save work mixes real corrections and wording/formatting passes. Do not claim it has been fixed, remove necessary verification, or add another checklist/quota without a demonstrated cause.

Regression coverage includes second/new-defect revisions, three improving revisions, count oscillation, retained unresolved findings, current-list coverage, expected blockers versus failures, and local native Responses/Chat Completions continuations. Real model quality, false findings, actual token savings and long-run latency remain unverified. This change does not restart services or alter historical test projects.


Local context-cost review validation checks that large GDD content stays out of initial and follow-up user prompts and Agent event inputs; bounded file reads still work; source version checks, reviewer isolation, unchanged reasoning settings and multi-round revision behavior remain intact. Earlier full-source transfer assertions were replaced rather than used as a cost acceptance criterion. No service restart, paid rerun or generated-project edit was performed.


## 模型请求耗时诊断

现有 provider bridge 为每个已鉴权推理请求输出单行 `[model-request]` JSON，覆盖原生 Responses（含 compact）及 Chat Completions、Anthropic、Gemini 转换入口。`requestId` 关联 received、upstream-started、upstream-headers、finished；可选 `sessionHash` 是 BGS sessionId 的 SHA-256，便于与已知会话对应而不输出原始身份。目录读取和鉴权拒绝不生成推理记录。

`startedAt` 是桥接处理器接纳请求的 UTC 时间，时间偏移均以该时刻的单调时钟计为毫秒：`bodyParsedMs` 包含接收请求体和 JSON 解析，`upstreamStartMs - bodyParsedMs` 包含准备、协议转换和序列化，`upstreamHeadersMs - upstreamStartMs` 包含上游请求传输、网络和服务端等待。`requestBytes` 为实际交给传输层的 JSON UTF-8 字节数，排除 HTTP 头、压缩和网络封装；只计数一次，不另存正文或再次序列化。Native 发起到桥接处理器接纳之间的耗时不在此计时范围。响应头前等待不能直接解释为模型推理、排队或上传耗时，仍需结合上游证据。

finished 保留最终 elapsedMs、已有阶段字段、取消信号和结束原因（body-ended、body-error、cancelled、request-error、no-body），在同一请求清理路径上只记录一次；未到达的阶段不填零。body-ended 仅表示桥接输出流读至 EOF，可能包含 HTTP 错误或协议内 response.failed，不代表模型任务成功、用量完整或内容验收。关闭桥接与取消沿用原有行为，不新增重试、后台任务或模型调用。记录固定字段，不输出模型名、URL、凭据、原始响应头、错误正文、提示词、图片或推理内容；HTTP 错误的脱敏字段见下节。ChatGPT 订阅直连不经过该桥接层，因此不在覆盖范围。

本地脚本化供应商测试核对 Unicode 请求的实际字节数、延迟响应头与未结束流的分界、原生透传及协议转换、HTTP/解析失败和取消的记录与清理。该诊断补丁补足归因证据，不声称已经降低真实 tokens 或耗时；生产证据需在加载补丁后的正常获授权运行中取得。


## 模型 HTTP 错误诊断（2026-10-29）

HTTP 失败现在在同一条 `[model-request]` finished 记录内增加 `error`：覆盖 Chat Completions、Anthropic、Gemini 转换入口及原生 Responses（含 compact）。本轮补足实际 429 路径丢失错误原因的诊断缺口，不修改重试次数、恢复策略或模型选择。

保留的信息有明确来源：

- `type/code/param`：从嵌套 `error` 或 OpenCode 顶层错误对象读取已知协议标识，包括 GoUsageLimitError、insufficient_quota、rate_limit_exceeded、invalid_request_error。未知值不复制。
- `messageCode/messageReason`：只从已知错误前缀提取允许列表中的代码或固定原因标签，如 weekly_usage_limit、output_token_rate_limit、endpoint_unavailable。它们是供应商文字证据，不是自动决策，也不确定限制属于用户账户还是供应商账户。完整 message、其中的 URL、账户和请求内容不会记录。
- `error.requestId`：仅接受 x-request-id / request-id 或正文 request_id 的 UUID、req_ 格式关联 ID；外层 requestId 仍是 BGS 本次桥接 ID。
- `retryAfter`：Retry-After 中的整数秒数或规范 HTTP 日期。`rateLimits` 仅接受 x-ratelimit 的 requests/tokens limit、remaining 数值及受限 reset 时间格式。其他响应头、Cookie、凭据不记录。
- `bodyStatus`：parsed、empty、invalid、too-large、incomplete，说明是否取得可解析的完整错误对象。parsed 不等于已经知道原因；只有 429 或 inference_failed 时，仍不能判断额度、速率或容量限制。

转换入口保留原有 16 KiB 读取上限和 2 秒诊断期限；即使正文损坏、超大或中断，安全响应头仍可记录。原生 Responses 仅在既有输出流中观察最多 16 KiB，不克隆响应或新增等待，原始字节、响应头和原生错误处理保持原样；这里的脱敏约束针对新增宿主日志，不声称改写了原生执行器自己的日志。此节只覆盖 HTTP 失败，不扩展 HTTP 200 内的 SSE 错误处理，也不覆盖 ChatGPT 订阅直连。

本地验证：71 项协议／安全／桥接回归及 4 项原生执行器接本地模拟供应商的回归通过；核对错误原因、日志脱敏、读取中断与上限、Responses 透传以及每次失败仅有一个上游请求。没有真实模型调用、重跑项目、修改项目产物或重启运行中的服务。未保留的历史错误正文无法由该修改补回；新字段需在加载本版代码后的请求中产生。


## 启动前失败后的新请求（2026-10-28）

宿主接单并记录 turn.started/user.message 后，Git 或运行配置检查仍可能在进入原生 runner 前失败。SessionManager 在进入 runner 前通知该次原始调用方；executor 只在未越过这个边界且自有能力清理完成后记录 notStarted。宿主 turnId 不再被误当作原生已经执行的证明；无原生用量和不可改写的退出事实约束保留。进入 runner 后的错误不能被归类为未启动，缺少 ID 或零用量也不是判据。

未启动请求之后的新消息不重放旧请求。存在原生基线时校验并继续该基线；明确 focused 的新工作只要求上次工作已结束且确认退出，不要求一个旧原生 ID。若此前明确选择 focused、执行失败且尚未绑定原生 ID，下一条普通用户消息保留这个尚未完成的上下文选择；显式 resume 不被覆盖。既有失败记录不补造 notStarted，也不改写会话 ID。跨项目历史、旧会话基线丢失、活跃 writer、清理失败、过期授权和重复请求的保护继续生效。

针对首次启动、已有会话、focused 和旧版缺少 notStarted 的失败记录做隔离回归；模拟 Git 故障修复后，普通 Chat 新消息可以执行，失败历史不变、重复请求不重复执行。云端迁移暂缓；工作流存储位置、前端和 CLI 未改。


## 游戏视觉方法与实现边界（2026-10-28）

共享项目指导、美术/UI/资源 Skills 和 GDD 职责描述现在要求从玩家活动、感知、输入及美术方向推导画面，说明初始布局和资源表示法的依据，区分作者提案与确认要求。UI 可以支持世界，也可以承担主要玩法；不规定场景占比、面板数量或按类型套用布局。

视觉方法以具体游戏局面中的构图、造型、字体、图标、材质与关键状态为对象，复用适合的设计或实际创作。原有将 HTML/CSS 并列为常规视觉起点的引导已替换；代码或目标引擎原型用于当前授权范围内明确的输入、时序、镜头或空间问题。美术完成度、交互证据与运行验证分别判断。已有 HTML 观察入口、参数、诊断和 quality: unverified 语义保留，工具帮助只解释如何观察已有设计/原型。Web/React 运行时指引明确以实现授权为前提，不决定美术风格。

普通消息、阶段任务和 focused 执行继续走原有原生项目指导/Skill 目录及工具上下文链，不新增提示注入层、审美审查 Agent、自动评分或付费重试。项目指导模板只用于新建文件，已有 AGENTS.md 和 GDD 不自动覆盖；旧会话已经读入的内容也不会被文件修改追溯替换。更新后的服务上下文和重新读取的 Skill 才能提供新指引。此修改不改变平台/引擎选择、交付 schema、前端或测试项目产物，也没有重启服务或发起真实模型任务。

验证使用现有本地回归、原生 CLI 的模拟 Responses 服务、临时合成项目与浏览器。它们能验证指导传递和接口行为，不能证明真实生成的审美、玩法或成本已改善；仍需后续独立授权的实际观察。


## GDD 改进提议审计后的收窄（2026-10-29）

本地 GDD 的定义冲突、情境与规则脱节、估算越界支持改进质量，但不能证明专业章节组织就是根因，也不能由混合流程版本、完成状态和后续修订的样本计算当前系统缺陷率。公共设计资料用于选择合适的方法，不构成固定目录、篇幅、配图或原型阶段的依据。

本次替换既有指导中的三处表述：设计任务要求说明体验、范围和代表性局面，阅读次序与深度由当前游戏和任务决定；任务和共享项目指南一致限定延后细节的边界，当前定义或判断约定行为所必需的细节不能仅按专业或阶段推迟；数值 Skill 允许限定或移除无依据的结论，同时保留其背后的要求与证据缺口。作者自查、完整规则、按需图表、已有独立审查和交接校验继续沿用，不增加提示层、流程、字段、固定检查表或付费实验。

主任务指导覆盖新设计与未完成设计的恢复；共享项目指南模板只影响新建指南，不覆盖已有项目文件，数值 Skill 在后续实际读取时生效。验收关注确认需求、同一情境下行为是否一致、例子与结论的依据、下游是否需猜测关键决定，并结合实际耗时和用量；篇幅、目录、单元测试或模型审查通过均不单独证明改进有效。修改只澄清方法及边界，真实生成质量和成本效果仍未验证。


## 已完成准备任务后的当前契约刷新（2026-10-29）

实际项目中，普通后续消息已进入新回合，确认需求快照也包含用户明确进入下一项工作的请求，宿主没有重新绑定 GDD finalOutput。新回合的文件权限已恢复到普通任务范围，但原生历史保留了准备任务的开发者指令；此前刷新仅包含 systemContext，遗漏了独立于该字段的文件写入说明，也没有明确清除准备任务的 JSON 返回要求。模型因此仍返回旧状态对象，并援引初始的单次任务范围拒绝后续显式授权。单独“继续”不足以推断扩展范围；明确的新工作请求应按当前授权处理。

适配层将任务范围解释、文件写入说明、当前工具/任务上下文和最终结果要求统一放进已有 bgsRuntime 分片。新建会话基线、普通恢复和 Goal 恢复注入复用同一构造函数；普通后续任务明确无准备任务 JSON 契约，准备任务保留自己的 schema。确认简报是用户要求及后续请求的记录，较晚的显式请求可以改变当前工作范围，原任务停止点不永久禁止新任务；无关要求及固定平台/引擎约束仍保留。沿用现有历史、权限与交接机制，不清空会话、不自动推进阶段、不修改项目状态或重发失败请求。

原生回归改为同时核查实际供应商输入中的当前契约、同一会话恢复及真实文件权限，避免只用假模型预设的普通答案证明切换成功。补丁前 Responses 和 Chat Completions 两项均因当前契约缺少写入说明失败；补丁后两项通过，并验证新任务可写普通文件而 Shell 仍不能越过宿主改写 GDD。另有232项已有 runner/workflow 本地回归通过。测试使用临时合成项目、本地原生运行时和脚本化 localhost 假模型，无付费调用；真实项目后续生成行为尚未重跑验证。


## 生产任务绑定与阶段会话（2026-10-29）

两条实际失败路径分别是：普通视觉请求经 implement 入口被宿主直接派发为实现；后续普通 message 没有 production，却复用了已进入实现的原生会话并直接写工程。仅调整交接函数无法覆盖第二条路径。

对于 intake 已标识的新建生产项目，宿主根据已结束、已清理的 GDD／视觉／资源来源交接决定下一阶段。visual、resources、implement 入口表达本次请求终点，缺少的准备阶段先执行；视觉交接进入资源，资源交接进入实现。请求只到视觉或资源时在该阶段停止。已有／导入项目的局部实现不强套新建顺序。终点仍依赖 Agent 正确表达用户授权，宿主不通过关键词猜测自然语言意图。

后续普通消息在启动运行器前关联现有生产任务及有效阶段，通过现有宿主事实传递，不再以 message 类型清空阶段。普通消息保留用户原文，不附加生产指令、不自动启动 Goal，也不强制提交准备任务 JSON；没有来源交接就没有阶段推进。原生恢复保留其原始回合类型。正式生产入口、阶段或任务改变时使用现有新上下文能力；同任务同阶段的续接保留原生会话。跨阶段保留原始需求和已完成阶段的实际文件指针，不携带助手对执行范围的概括。旧的越阶段记录仅用于诊断，新回合绑定缺失阶段并保守停在该阶段，不重写历史或自动重跑。

复用现有 production、交接、CAS、暂停、清理和来源哈希机制，只有任务终点增加可选 stopAfter 字段；未增加分类／复核模型、通用提示词、Shell 权限规则、前端入口或项目专用逻辑。已有工具说明同步 action 合约。验证覆盖原生与脚本入口、零阶段工具调用的普通续作、旧实现会话隔离、同阶段中断恢复、普通问答以及交接受阻／变化／暂停；使用临时合成项目和本地假运行器，真实模型行为与内容质量未作复测。阶段绑定和来源交接不等于对模型所有文件操作的强制类型检查。

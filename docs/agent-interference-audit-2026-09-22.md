# Claude Code 执行干预审计

范围：BGS 的两条启动链路（session runner / native file agent）、权限回调、worker 提示、阶段调度、原生工具注册与终态、Chat 投影；对照 mushroom-flag-dash--fa5e09356acf 的 transcript。下表是本次核实的证据，不把静态风险当作已发生故障，也不声称穷尽上游 CLI 所有行为。

原则：BGS 规定目标、数据契约、权限和验收事实；Agent 决定调查深度、工具、委派和执行顺序。系统缺陷在系统修，不改测试项目，不调用付费模型。

## A. 已证实缺陷，本轮修复

| 标记 | 证据 / 根因 | 修复与边界 |
| --- | --- | --- |
| A1 权限误拒绝 | `session-manager.ts/workflowFileMutationAuthority` 把 session scratch 目录当精确文件路径匹配；其子文件被拒绝 | 按目录授权自己的 scratch；继续拒绝别的 session scratch、保护文件和符号链接逃逸。离线权限回归覆盖 |
| A2 提示矛盾 / 代替决策 | `delivery-workflow/worker-prompts.ts` 要求临时文件也只能进最终产物目录，并要求先完成逻辑再处理非阻断问题 | 明确使用已提供的 TMPDIR；去掉强制修复顺序。局部修复不再禁止 Agent 自选影响分析委派，也不要求另建分析阶段 |
| A3 环境污染 | `agent-workflow/src/native-file-agent.ts/SAFE_INHERITED` 仍转发宿主 NODE_ENV；general runner 已隔离，另一条链路遗漏 | 两条路径都不继承平台 NODE_ENV，避免平台 production 改变项目依赖安装；不是强制游戏使用 development |
| A4 展示反向中断执行 | `native-file-agent.ts` 的 onProgress 异常进入 observation_failed 并终止子进程 | 展示回调失败只告警一次并停止该回调；继续读取执行结果。计费 onMessage、持久化与协议错误不在此处吞掉。故障注入验证成功结果仍收到 |
| A5 Chat 丢终态 | `session-manager.ts/WORKFLOW_WORKER_CHAT_EVENTS` 只镜像思考/工具，不镜像 turn.completed/failed、session.stopped 等 | 实时与历史使用同一终态集合；保留原 worker/turn 身份。前端结算该 worker，不能把它的完成误当整个项目完成 |
| A6 依赖提示文案识别身份 | `readWorkflowWorkerChatHistoryFromDisk` 仅匹配 `BeeGame delivery worker:`；精简 PROJECT_CHANGE 提示无此文案 | session.started 持久化 worker 元数据；历史优先元数据，旧 transcript 才退回旧标记。普通聊天不会因此被当 worker |

以上不是新增引擎、调度协议或超时重试机制。

## B. 自主性限制及处理状态

| 标记 | 具体证据 | 判断与下一步 |
| --- | --- | --- |
| B1 Checklist 工具白名单（已移除） | 原 `delivery-worker-session-port.ts` 仅给 checklist `['Write','Edit']`；原 document-stage 设置 projectReadScope=empty | 冻结输入放入私有任务目录，复用现有 native-task-access；Read/Bash/Agent 与中间文件可用，只收回 checklist.md 候选，再走原验收。没有在共享项目放开 shell。历史请求字段只保留解码，不参与执行 |
| B2 两条权限链不一致 | session-manager 对文件工具限制路径，但其它 workflow 工具（含 Bash）直接允许；native-task-access 对 Bash 使用 OS sandbox | 文件路径回调不等于 shell 安全边界。不能宣称前者已全面隔离，也不能用继续堆工具禁令修补。后续按执行环境统一文件/网络边界，不改变工具集合 |
| B3 native file 阶段固定封网 | `native-task-access.ts`：allowedDomains=[]、allowLocalBinding=false、allowUnsandboxedCommands=false | 当前文档隔离任务生效；会影响需联网或开浏览器的任务，不能将它当通用运行/验收环境。本项目 implementation 使用另一条链路，不能归咎于此 |
| B4 原生配置被隔离 | 同文件：disableAllHooks、setting-sources空、strict-mcp-config | 防止读取宿主私有配置有必要，但也排除获授权的项目能力。应区分宿主配置和任务显式能力；本轮不恢复用户个人 hooks/密钥/MCP |
| B5 未知工具一律拒绝 | `native-task-access.ts/permission` 无 handler 即 deny | 对新增原生工具是兼容风险；没有本项目因此拒绝 TodoWrite 的日志证据。不能直接改为全部 allow（网络/MCP也有权限影响）；应核实权限请求类别后处理 |
| B6 资源来源顺序被强制（已移除） | 原 worker-prompts/resource-planner 要求库→网络→AI→程序绘制，失败也要求追溯全部前置来源 | 改为依据适配度、质量、成本和用户明确要求自主选择；鼓励合适的已有资源复用，不要求逐组走完来源阶梯。保留真实出处、许可、质量及费用边界，不伪造搜索记录 |
| B7 观察/计费/证据共用失败出口 | `native-file-agent.ts` 多处 observation_failed，包括 onMessage（实际承载 usage）和日志写入 | 本轮仅拆开纯进度展示。不能把 usage/协议/磁盘失败全部吞掉；剩余需分别保留可诊断原因，而非一概取消或重试 Agent |
| B8 完成/隔离语义限制 | reviewer 使用 BEEGAME_STRUCTURED_OUTPUT_IS_TERMINAL；file runner 收到成功 result 后终止子进程，禁会话持久化 | 属于一次性文件任务结果协议，但意味着不能当通用长会话/后台任务宿主。需要保留明确的任务作用域，不泛化到普通 Chat |
| B9 遗留硬编码（已删除） | 原 src/tools.ts 旧 worker 返回空工具；QueryEngine.ts 旧 reviewer 特判；foundationRevisionPathGuard.ts 单 staged 文件限制 | 删除旧分支、Read/Edit 特判及废弃测试，补正常工具注册回归。当前生产启动未找到启用这些旧 worker 值，不能把遗留风险冒充本次故障根因；真实任务沙箱仍保留 |
| B10 上下文与措辞约束（部分精简） | 完整 worker 注入 contract/坐标契约；reviewer 提示禁止枚举检查清单；语言同时出现在 system append 与每轮输入 | PROJECT_CHANGE 已改为原需求+按需能力；Checklist 改为读取一份 authority.md，不再重复注入完整冻结输入、全局 brief 和旧任务提示。其余仍可精简。语言是用户偏好，不后处理伪造思考 |
| B11 Mac 系统 Python 依赖（未解决） | 本地假模型驱动真实 CLI：/usr/bin/python3 在隔离任务中先被拒读 /var/select/developer_dir；探查后还依赖 Xcode bundle、缓存与许可状态 | 宿主 Python 可启动，隔离运行出现许可提示不等于宿主未接受许可。逐条放宽系统路径没有形成可靠修复，试探性权限修改全部撤回。当前通过的是 Bun 执行链，不声称已解决 Python/Xcode 兼容性 |

## C. 保留的必要边界，不算应删除的“干扰”

- 明确 cwd、隔离租户/任务文件、阻止符号链接逃逸、隐藏宿主/provider 密钥。
- 用户确认需求及保护文件、真实资源出处、Scene/UI 数据接口、付费和停止授权。
- 区分局部修复与整项目交付，不将模型自报 PASS 等同真实运行验收。
- 不强制 Tilemap，但必须让资源与内容契约提供 TileSet/格子能力；不让 Agent 修改有效内容来掩盖平台 bug。

## 项目日志证据（只读）

位置：项目 `transcripts/`，文件前缀均为 `mushroom-flag-dash-fa5e09356acf__`。

| 文件后缀 / 事件 ID | 原始事实 | 分类 |
| --- | --- | --- |
| `6c8adc97.jsonl` / 294 | Grep BGS 服务源码，被 project_workspace_boundary 拒绝 | C 项目边界；若需要接口说明应公开契约，不能迫使 Agent 猜源码 |
| 同文件 / 449 | Read BGS Scene Editor sprite-sheet.ts，被同边界拒绝 | C 同上 |
| 同文件 / 2065 | Write `/tmp/claude/gen_content.ts` 被 workflow_workspace_boundary 拒绝 | 临时路径不一致；与 A1 相关但不是 A1 同一触发条件 |
| `851d25dc.jsonl` / 767 | Read `/private/tmp/claude/lib-inspect/onebit.png` 被项目边界拒绝 | 临时路径不一致；提供项目内 scratch，不开放共享 tmp |
| `88608639.jsonl` / 1397→1398 | tool.progress 后已有 turn.failed（21:43:58Z），Chat 却仍运行 | A5 直接运行证据 |
| `1a05f9bd.jsonl` / 12662 | implementation 已有 session.stopped | A5；并非需要再等模型 |
| `4b9009fa.jsonl` / 27841→27842 | 主会话最后镜像的是工具进度，随后只有主会话自己的 stopped | 主会话停止不能替代 worker 的原始终态 |
| `9e32ad31.jsonl` / 共1603条 | 旧影响分析任务确实运行过 | 历史调度开销；此前已移除新请求强制分析入口，不删除历史证据 |

本项目共找到4条 permission.resolved deny；所检查 implementation transcript 中为0。不能据此认定所有失败都来自权限，也不能用“未拒绝”证明渲染/验收正确。当前两条 launcher 都明确传 cwd，未发现本次是“未指定工作目录”。

## 验证和剩余工作

- 离线模拟器验证：scratch 子文件、保护文件、跨 session 和链接逃逸；实时镜像/历史恢复/worker 身份；NODE_ENV；进度回调抛错仍收到成功结果。
- 前端验证：worker 终态只结束自己的活动，不结束并行 workflow；思考/工具历史回放及流身份保持一致。
- 不因该审计自动运行完整 workflow、生图或付费复测；项目源码/Scene/UI 产物不改。
- B1/B6/B9 已处理；B2 只完成 Checklist 复用既有私有任务边界，普通项目会话的 shell 与文件权限差异仍在。B3–B5、B7–B8、B10–B11 不宣称全部消除，无需新增通用框架。

本轮结果：30项系统回归、2项 file-agent 流/异常注入、51项前端回归通过，前后端类型检查通过。重启后真实项目 Chat 尾部不再 Running tools，改为“1 次工具调用 · 1 次失败”，思考块结束，workflow 仍 stopped。未调用模型、未修改项目产物。资源后台队列仍未启动，避免无费用验收意外触发付费作业。

后续推进：重建后的原生 CLI + 本地假模型验证了 Read、Bash、Agent 子任务执行，中间文件可写、冻结输入和项目外文件不可改；取消任务不收集半成品，只收指定候选文件。相关 72 项回归通过，0 失败。没有调用外部模型或修改测试项目，也未运行新项目付费生成；不据此推算耗时节省比例。

发布检查：agent-workflow-server 与 agent-workflow 类型检查、diff whitespace 检查通过。按已有授权使用根目录 env 重启 frontend/runtime/billing/skills，runtime health=ok；resources 未启动，测试 workflow 保持 stopped。这是系统上线检查，不是新项目端到端验收。

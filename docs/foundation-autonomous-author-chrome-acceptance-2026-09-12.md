# 自主 Author 新项目 Chrome 实验验收

日期：2026-09-12。状态：按用户要求停止，转为问题诊断；整条验收未通过，Revision 未启动。

## 授权与范围

用户要求从新项目开始，经过 Author、Reviewer，直到 Revision 完成；允许本次真实模型调用。旧项目不复用、不修改，不进入游戏实现、素材生产或发布。

- 已重启当前工作树的本地开发栈，重新构建原生 CLI 并加载新 Author。前端端口 62173，runtime 62174。
- 根目录 `.env.local` 为服务环境及验收账号配置来源，文档不记录凭据。
- Chrome 首次提交期间出现登录弹窗，随后登录恢复且原提交继续成功；没有再次点击生成，也没有重复新建。

## 新项目身份

- 需求名称：《花蜜冲刺》
- 项目：`nectar-dash-classic--4d74979e0b9f`
- Run：`ceefbd91-263d-491c-9212-1cdf1c55ae4e`
- Author handle：`79e69a24-e401-48e4-b506-3191ce921f2a`
- Author 版本：`autonomous.v1`
- 首次原生 attempt：`a6b322f3-27f4-4cf6-9f59-2c0ad94687f3`
- 开始时间：`2026-09-12T05:45:18.303Z`
- 八份正式文档初始 baseline 均为 null，证明不是旧文档重放。

需求：手机竖屏、左右拖动小蜜蜂、60 秒内收集 10 份花蜜、雨滴碰撞扣生命、3 点生命、输赢后重开、2D 扁平美术、单指操作，无登录/排行榜/付费玩法；本次只验收完整八文档及独立审修流程。

## 初步观察

- Chrome 显示一个 `Foundation documents` 编写任务，而非宿主八个按依赖调度的独立作者。
- 原生 Author 自主使用 Bash、Read；已读取确认需求与交付参考。
- 参考文档读取结果较大时，原生工具曾指向候选目录外的临时工具结果文件，其读取被权限边界拒绝。Agent 随后自行改为分段读取原参考文件，继续执行。该现象待纳入最终验收结论，不放宽权限掩盖。
- UI 同时显示“执行中”和“等待中”，但后端运行状态为 `thinking: working`。记录为展示一致性待核实项；验收期间未改代码。

后续补充 Author 交付、Reviewer、Revision、复审及费用结算证据。

## Author 中途行为证据

- 八份文档在同一个原生 attempt 内逐份生成，至 06:09 UTC 已全部出现在私有候选目录；当时尚未发布正式文档。
- Agent 自主使用 TodoWrite 维护计划，随后调用 Bash、Grep 检查，再用 Edit 修改美术方向、关卡和 UI/UX 文件。
- 06:11:48 和 06:13:33 UTC 自主调用 Agent 工具；两次工具响应均未报错，中间使用 TaskOutput 获取子任务进度。该行为不是宿主创建的八作者调度。
- 截至 06:13:34 UTC 共 44 次原生工具调用，5 次工具错误（4 次 Bash、1 次越界 Read），任务仍在自行推进。错误不得描述成全部工具无故障；也不因此伪造宿主重试或质量通过结论。
- “等待中”展示已定位到 `workflow-stage-card-history.ts` 的 `workflowThinking`：仍以旧 `activeDispatch` 判定，未识别正在执行的公有 Author。此时真实 run 的 `thinking` 是 `working`。

## 用户要求停止后的实际结果

用户指出不应持续等待，要求停止并结合日志分析。通过 Chrome 的 Stop task 操作停止。处理停止的窗口内 Author 恰好完成，工作流自动交接 Reviewer；停止最终作用于 Reviewer。

- Author：05:45:18.303 → 06:31:49.611 UTC，**46 分 31 秒**，同一个 attempt，已生成公有八文档结果。
- Author result：`fb795464e8004814a9449e246ba198b370331461515a5ac553a16d2cdb955bb6`。
- Reviewer handle：`2cbd0edb-6c5b-4072-a38c-ab4b7ff0d1b7`，约运行 6 秒后停止，费用状态 settled。
- 当前：`stopped / DOCUMENT_REVIEW / FOUNDATION_REVIEW`，原因 `user stopped workflow`。
- Revision 完成数 0，未启动 Revision；没有实现、素材生产或发布。候选与正式文档均保留。
- Author 原生进程已经退出、stdout 已排空。退出码 143 是接收正常终态后主动关闭原生 CLI 的既有机制，不能据此误判 Author 失败。

## 日志诊断

### 时间分布与策略失控

| 时间段（UTC） | 实际行为 | 耗时 |
| --- | --- | --- |
| 05:45:18 → 06:08:16 | 上下文读取、计划、依次写出八份初稿 | 约 22 分 59 秒 |
| 06:08:16 → 06:31:49 | 自检、修改、子任务委派、等待、再次审查、最终提交 | 约 23 分 33 秒 |

原生事件记录共 95 个模型响应 ID、117 次工具调用：Read 44、Bash 25、TodoWrite 10、Write 8、Edit 9、Agent 8、TaskOutput 4、SendMessage 2、Sleep 3、Grep 3、StructuredOutput 1。Agent 8 次调用不等价于 8 个独立子 Agent；当前安全日志未记录 Agent 的 resume/任务绑定，不能混淆。

八份初稿写齐后，出现多轮全量回读。最终摘要还明确称内部实施了“独立代理对抗审查”、处理 PASS_WITH_NITS 后再复审至 PASS。这是 Author 自行展开的内部流程，不是公有 Reviewer 的通过结论；正式 Reviewer 在此之前尚未启动。可见耗时主要在生成和内部审修，并非宿主在重试八作者调度、等待文件锁或等待计费。

当前 Author 提示允许自行规划、验证、修改和委派，只笼统说明独立审查随后进行；缺少清晰的阶段职责与有界完成标准。允许自主工具并不意味着要在 Author 内再运行一个审查收敛流程。其调用 Sleep/反复等待也与原生 Agent 工具对后台任务“不主动睡眠、轮询”的指导不一致。

### 实际运行时缺陷：Bash 转义

候选目录 `.native-tmp/claude-501/` 留下的三份 Python 脚本，分别含有 `c\!=hdr`、`a\!=b` 等损坏的比较运算。另有对应改为 `not c==hdr` / `not a==b` 的后续脚本，说明 Agent 在绕过此问题。

已进行不调用模型、不修改项目的最小复现：同一段 `python3 - <<'PY'` heredoc，直接交给 zsh 正常输出 True；经过 `shell-quote.quote([command])` 包装后变成 `print(1 \!= 2)`，Python 以 SyntaxError 退出。macOS sandbox-runtime 的命令包装确实使用该 quote 层。这是具体兼容缺陷，不应全部归因于模型写错脚本；但当前事件日志没有保存每次 Bash 的安全错误类别，无法将全部 6 次 Bash 错误一一归因。

### 参考文件的读取边界不匹配

`authoring-reference.json` 为 49,123 字节。大结果被原生 Read 工具外置到候选目录外的运行时 tool-results 路径，后续 Read 被宿主正确拒绝，两次发生相同行为。Agent 最终用分段读取绕过，但增加了额外交互。应让工具结果的只读通道与沙箱边界兼容，而不是宽泛放开项目外访问。

### 用量与可观测性

原生终态 `modelUsage`（含委派）记录：输入 538,596 tokens、输出 111,217 tokens、缓存读取 7,474,976 tokens，合计 8,124,789 tokens。Author outbox 的同一 attempt 已 sealed/submitted，计数一致。缓存 tokens 不等价于等价数量的普通输入费用；不以原生 costUSD 估计值冒充真实账单。

安全日志只有工具名、路径、isError、进度和用量，未记录安全错误类别、委派任务 ID/父子关系或 TaskOutput 的 retrieval_status。TaskOutput 返回非 error 仍可能代表 timeout，因此此前将其概括为“成功返回”不能证明子任务已经完成。此处限制了逐个诊断等待循环的精度。

展示还有两项不足：公有 Author 被历史投影标成等待中；Author 本次调用时间未提供，但已存在可信 attempt 时间。两者会降低现场判断效率，但并非 46 分钟耗时的直接根因。

## 后续建议（未实施）

1. 先修 Bash 命令包装的字节保持性，加入 `!=`、`!`、引号、heredoc 的原生沙箱回归；修复只读工具结果路径对接。不削弱沙箱。
2. 明确 Author 只交付可审查的完整稿，可做必要自检，不要求自行跑到内部 PASS；保留自主顺序、工具和合理委派，不退回固定八作者 DAG。
3. 引入可配置的时间/用量预算及无实质进展暂停，超限应保留现场并 needs_action，不能制造通过结果；正式 Reviewer/Revision 继续承担审修收敛。
4. 补齐安全诊断元数据（父子任务绑定、委派状态、等待原因、错误类别、累计用量/耗时），修复 UI 状态投影，再进行新一轮受控真实验收。

本轮仅停止、读取日志、做最小复现和记录诊断，没有修改生产执行逻辑，也没有恢复模型调用。此前验收方式只检查活动是否持续，未及时评估重复工作的收益，应改为关注阶段目标进展和预算。

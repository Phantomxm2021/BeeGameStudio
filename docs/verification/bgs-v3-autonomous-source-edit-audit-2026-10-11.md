# V3 1.42：自主 Scene／UI 编辑与重测审计

日期：2026-10-11（Asia/Shanghai）。依据实施规范 §7.1 B 后续；只修改 BGS 服务、独立 debug 与合成回归，不恢复付费样本。

## 已查证的根因与修正

| 根因／边界 | 本轮落地 |
|---|---|
| contentView 以旧 Task 的 contentOwners 计算保存范围；saveContent 拒绝自主 Run；版本校验不接受初始 planRevision=0 | 自主 Run 改为正常项目编辑授权，仅限实际登记的 Scene/UI。允许真实的 0 版本，不创建 Task、计划或伪 AgentTurn；旧模式保留真实所有者 |
| 主机数据保存要参与单写者和中断恢复，不能直接绕过后台写文件 | 复用原 createV3Executor.edit、CAS、writer、原稿归档及原子替换。Run.sourceEdits 只保存主机编辑事实；暂停、恢复、退出核实仍走现有控制入口，无新执行服务、表或 SQL |
| 仅凭当前字节，编辑后恢复原文可能让旧测量重新有效 | AgentMeasurement 增加可选 sourceEditId，和来源/需求/产物指纹一并核对；新保存后必须新测量。无变化保存不新增记录、不撤销原资格 |
| 保存响应可能丢失，重复点击不能再次写入 | 自主保存要求稳定 requestKey；相同内容只核对原结果。不同内容、历史/失败记录、过期需求不复用。debug 保留不确定请求身份，不自动重试或默默刷新草稿 |
| 原生会话看不到编辑器在回合间修改过哪些文件 | 后续正常消息只附前一原生回合后的路径/保存状态，按文件合并，不注入整个 JSON/历史。保存本身不启动原生回合、构建或收费 |
| 归档目录若含链接，递归 mkdir 可能在检查前建立项目外子目录 | 复用归档路径，逐级检查真实目录后再进入；反例确认别名目标未新增文件/目录。保存预约返回期间的暂停也在写入前核对 |

职责没有改变：用户通过数据编辑授权具体源变更，Agent 在后续明确消息中协调设计及消费者；程序记录可证事实，不据此宣布趣味、审美或游戏交付合格。没有新增作者、Reviewer、阶段或硬轮数限制。

## 实际调用链

`独立 debug 保存 → 原 game-content API → 项目权限/当前 Run → 原编辑执行器 → CAS 占用 writer → 原稿归档/原子替换 → 持久退出记录 → 保存结算`

保存后旧测量失效。只有用户明确发送后续消息，才进入已有原生会话并按需重建/测量；新测量绑定最后一次编辑记录。Preview 与工程导出共同使用该测量选择器。确认需求不因保存 JSON 自动改写；普通需求变更消息仍使用原有追加历史。

新增 sourceEdits 是必需的编辑事实，不是第二套设计或任务框架：自主模式禁止混入 attempts/tasks，且恢复、重复请求和“改回原字节不能复活旧验收”均需要持久身份。复用现有 Run JSON 与 RPC，不另建数据库对象。

## 回归与实际观察

最终受影响回归 **12 文件，96 pass / 0 fail，1,089 expects，49.29 秒**。根 `bunx tsc --noEmit --pretty false` 退出 0；`git diff --check` 退出 0。不是全仓所有测试。

- 临时工程验证 UI/Scene 保存、原稿字节保留、无变化保存、重复请求、错误请求身份、过期版本/指纹、文档身份、路径/链接、权限及未授权项目。
- 并发 CAS 只允许一个保存占用；保存结算失败保留 writer 和已退出证据，显式恢复不接受成果、不重做；缺退出证据不解锁。预约期间暂停不继续写入，未知写者不会凭缺失 session 释放。
- 源文件改回原始字节后旧 measurement 仍被拒绝；历史原生回合和测量未被改写，旧 Task 所有者/无关结果保留。
- 独立 debug 使用真实 CLI、本机固定假模型与真实隔离浏览器：先测原构建，在界面保存 UI 高度 64、Scene 横坐标 30；未派模型前旧测量已失效；明确同工程消息后执行源码副本构建和测量，浏览器实际 fetch 新 JSON，显示新尺寸/坐标，导出当前已测工程。之后中断/续作仍沿用同一 native UUID。
- 此固定流程仍为五原生回合、25 次本机假模型请求；新增两个保存没有追加模型请求。假模型 usage 是固定合成数值，不用于估算真实 Token 降幅或品质。

最终原始回归输出：[本轮日志](bgs-v3-autonomous-source-edit-regression-2026-10-11.log)。

命令：

```text
BEEGAME_TEST_REAL_BROWSER=1 bun test packages/agent-workflow-server/src/beegame/workflow-v3/changes.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/content-view.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal-native.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/agent-measurement.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/debug-browser.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/debug-page.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/workflow-v3.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/control.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/recovery.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/measured-preview.test.ts packages/agent-workflow-server/src/beegame/workflow-v3/editable-project.test.ts
bunx tsc --noEmit --pretty false
git diff --check
```

### 过程中出现的失败

- 首次增加测试后 TypeScript 提示两个测试直接读取联合返回类型的可选字段；改用匹配对象断言后通过，没有放宽生产类型。
- 首次完整回归为 95 pass / 1 fail（44.62 秒）：旧 debug 测试用“暂停”制造版本变化，断言先返回 revision-conflict；现保存先返回 run-paused。补成暂停拒写、明确恢复后仍拒绝旧版本两个连续断言，且草稿保留/不自动重试。单独重验通过，最终完整集通过。没有为过测试撤掉暂停或版本保护。
- 日志中的项目外链接拒绝、缺报告、结算失败均有对应反例；不是被吞掉的成功声明。

## 文档与修改边界

- 正式规范版本 1.41 → 1.42；§3.3、§7.1、§9.12 更新实际状态。1.41 在相邻 verification 目录按字节归档，修订前 cmp 退出 0；旧 §9.11 未勾选项保留为当轮历史。
- 正式 frontend（839 文件）、Claude Code src（2,445 文件）、builtin-tools（383 文件）整树指纹与开始前一致；工作区既存修改未回滚。
- 未改“磁轨调度”等任何真实工程及原始 transcript；未重启正常服务/当前暂停付费服务，没有模型或图片付费调用。
- 保存多了必要的存储/文件操作，不增加模型回合或读入整份文档。后续消息仅含去重文件路径和状态；不把固定假模型用量当真实节省。

## 尚未验证／下一步

1. 新自主编辑路径在真实远端数据库与独立部署服务的完整闭环尚未验收；本轮为本地持久 store，不能拿既往远端原生回合验收代替。现有远端适配器同样调用 assertCommit，但不等于远端已部署本版。
2. 仅保存现存登记 Scene/UI，不自动创建登记、迁移旧源码工程或补造文档/Manifest 版本。Unity/Godot 原生工程不套这套 Web JSON。
3. 真实模型是否正确运用专业 Skills、设计是否具体完整、美术/音频/资源是否达标、实际 Token 收益，仍待明确授权的真实验收。deliveryEligible 仍为 false。
4. 真实样本继续或迁移不能靠系统开发者手修。下一步按规范先核对独立部署与真实存储，再在授权后验证真实交付；不因本地通过新增自动收费循环。

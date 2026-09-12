# Reviewer-only 边界与 Chrome 真实验收

日期：2026-09-11（Asia/Shanghai）。本次用户要求从 Chrome 运行一次 Reviewer，并明确不设积分上限；随后批准先补齐“审查完成后停止”边界。沿用当前默认模型，不启用 r1，不启动 Revision 或 Checklist，不触碰系统 Claude Code。

**结果：停止边界已实现并通过离线测试；本次 Chrome 真实运行在 12 分钟时超时，没有报告、没有可观察用量，结算仍待处理。没有重跑或进入修订，不能宣布真实验收通过。**

## 实施范围

- 历史项目操作菜单增加“审查完成后停止（不修订）”勾选项，默认不勾选，保留原完整工作流行为。
- 选中时通过原有创建审查副本接口传递 `stopAfterReview: true`，在新副本的编排状态中持久化，不进入模型提示、工具 schema 或 Reviewer 公共请求字段。
- 初次 Reviewer 的公开结果必须完成绑定校验且正式结算，才持久化 `reviewOnlyComplete: true` 并停止。报告通过或发现问题均不启动后继阶段，也不将“发现问题”伪装成审查通过。
- 刷新、恢复观察、普通“继续”和重复“停止”均不能越过此边界；原文不被修订，原报告保留在公开 outcome 中。未增加模型轮数、重试或语义规则。

## 工程验证

- 项目默认 CLI 的 Reviewer 主链路：216 passed / 0 failed，24 文件，1670 断言，37.90 秒。
- 副本、路由与交接定向测试：37 passed / 0 failed，3 文件，317 断言。包含上述主链路中的重叠用例，不累加成独立覆盖数。
- 前端适配与历史项目界面：92 passed / 0 failed，2 文件。验证显式勾选后请求携带停止策略，未勾选保持旧行为。
- `scripts/reviewer-reliability/tsconfig.json` 类型检查及 `git diff --check` 通过。
- 定向覆盖“通过/发现问题”、待结算不提前完成、持久化重载与继续不启动新阶段、策略伪造拒绝，以及原文件不变。

## 本地环境与运行前核验

源码来自 `bee-game-studio/.worktrees/game-ir-isolation-recovery`；环境显式加载 **`bee-game-studio/.env.local` 根目录文件**，没有修改或复制密钥。后端原 PID 68982 无子进程，23 份工作流均非 running；两个已停止的历史记录仍含旧 activeDispatch 字段，未当作活动任务或改写清理。备份并核验 23 份状态后，原配置重启后端为 PID 83112，旧状态摘要全部未变。

前端原端口未监听。首次恢复时漏带根目录环境，页面显示登录弹窗；更正为通过项目原有 `buildBeeGameDevPlan` 加载根目录环境后，原账号自动恢复。此前“登录过期”的初步判断撤回，无需用户重新登录，没有使用替代登录凭据或改变认证策略。

项目 CLI 继续使用已安装的非 r1 解耦构建，SHA-256：`e75e4c1e35fab0bbdac561333b144da549b58f417a579572823c1289fdfb0b87`。本轮修改编排与前端，不重建或清空 CLI dist。

Chrome 页面只读核实默认 Fast/Balanced/Strong 均为 `ark-code-latest`，目的地为既有火山 Coding 端点，未点击保存或更改配置。此别名不证明本次具体底层模型身份。积分不设新增上限；原有 400,000 token、12 分钟及 12 轮保护未改动，不将“积分无上限”解释为无限重试。

## 单次真实运行

启动由 Chrome 实际点击完成，勾选框在启动前明确为选中状态；没有用脚本或模拟请求代替浏览器启动。

- 源项目：`fixed-route-tower-defense--ba6cac9c5ea1`，ID `project_1788956193150_muysxd`。
- 采用源项目已完成作者产物 `bee34e123b973073213ac6d669ad82fb0d3f8ca252e92a2732f4352deec12b33`；八文档与上次 `review-copy--5fe49a21-5a7f-4cd2-9c1b-3960ea79690f` 的根文档逐字节一致，需求摘要一致。
- 新副本：`review-copy--b2f3a0ce-ba29-4448-9403-7e0be32b0959`。
- runId：`bf37d05f-2935-4719-95c1-39d30880585e`。
- Reviewer handle：`6c9d2177-6f93-450e-ad12-27c5be9448a9`。
- 首次 claim：2026-09-11 02:35:36.746（Asia/Shanghai）。
- 启动后持久状态为 `DOCUMENT_REVIEW` / `reviewer` / sequence 0，`stopAfterReview=true`。请求内八文档及副本根文档摘要已逐项核验。

## 真实终态与费用边界

- 封存时间：2026-09-11 02:47:37.021（Asia/Shanghai）；单个原生 turn 耗时 **720,269ms**，触发原有 12 分钟保护。
- 工作流与 Reviewer 均为 `needs_action`，持久原因：`usage_unavailable [budget_exhausted]`。没有发布 pass 或问题报告。
- 不可变记录中 `modelMessages=0`、结构化输出调用为 0、工具条目为 0，`usageObserved=false`。这些值只表示客户端没有观察到可用消息/用量，不证明供应商没有执行或计费。
- `billingStatus=pending`，结算回执为 0 份。Chrome 项目信息显示输入/缓存输入/输出/Credit 均为 0，但这些不是可证明的实际零成本；**实际积分暂记未知，不生成零用量结算来关闭问题**。
- Chrome 实际显示新副本、“基础文档审计 / 需要处理 / Foundation Reviewer 审计失败”，计时 `00:12:02`；没有点击“重试”。
- Reviewer 子进程 PID 83459 已退出，后端无子进程；sequence 仍为 0，未出现 Revision 请求或候选，也未进入 Checklist。
- 14 份冻结源码和项目 CLI 摘要未变；原作者冻结导出、上次副本根文档、新副本根文档的八份内容逐项一致，源项目运行快照未变。

`stopAfterReview=true` 已经从 Chrome 正确传入并持久化；但本次没有产生“报告完成且结算成功”的终态，`reviewOnlyComplete` 未被置位。因此“报告完成后自动停止”已通过离线通过/发现问题两类测试，**尚不能宣称这一路径已获本次真实运行验证**。本轮也无法评价模型报告的语义质量，既有语义门槛与旧协议退役门槛不变。

本轮没有捕获完整供应商 HTTP/SSE，现有记录只能定位到“执行时限耗尽且未观察到模型消息/用量”，不能进一步确定是供应商响应、传输等待或其他初始化路径的问题。未追加模型请求、延长时限、切换模型、恢复执行或修改被审计输入。若后续诊断，应保持这个失败记录，不把新运行覆盖成原运行成功。

## 持久证据

目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/output/reviewer-only-chrome-20260911`。

51 个文件（包含摘要清单）：`result.json`、`manifest.json`、工作流与 Reviewer 请求/不可变日志、八文档、14 份冻结源码及启动/观察方法。逐文件复制与 SHA-256 核验完成；没有归档密钥、环境文件或原生运行配置。临时目录 `/private/tmp/reviewer-only-chrome-ipKSLw` 保留重启前旧状态备份与执行记录，没有删除或覆盖旧批次。

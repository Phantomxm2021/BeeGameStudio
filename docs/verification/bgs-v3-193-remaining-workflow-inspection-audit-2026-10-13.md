# 剩余 Workflow 核对与历史测量读取修正（1.93，离线）

## 当前剩余项

| 项目 | 当前判断 | 本轮处理 |
| --- | --- | --- |
| 动态接单、同工程对话／变更、Question、退出事实恢复、数据编辑、按需测量／历史／Preview／导出 | 已有接线及限定回归、部署证据，不因历史章节未勾选就重做 | 继续检查当前真实调用链和负例；修复下述已复现交接问题 |
| 八领域具体决定／Skills实际应用、完整Scene/UI消费、资源成品、玩家流程及玩法／视觉／声音品质 | 真实游戏尚未全部通过；离线接线不等于模型实际采用或品质 | 不手修磁轨调度、不付费，保留未验证状态 |
| 无可信退出记录、未知远端收费／MCP结果 | 部分恢复依赖事实；没有事实仍安全拒绝，不能靠超时或新模型推断 | 不清历史隔离锁、不自动重试，不新增恢复框架 |
| Unity／Godot实际工程操作 | 用户暂跳过，许可／安装前置条件仍未验证 | 不安装、不选择技术路线、不改变沙箱 |
| 正式frontend／产品发布接线 | 当前授权外 | 不改 |
| 长有效上下文／压缩及真实净成本改善 | 仍未证实，按用户要求最后处理 | 不开展成本专项，不限制Agent |

## 已证实缺陷：当前输入核验失败，阻断了读取已保存事实

调用链：原生 `measure.mjs --inspect` 或 `handoff.mjs` → 活动回合能力 → `createAgentMeasurement.inspect/handoff` → `inspectAgentMeasurementInputs` → 当前源目录枚举／哈希。正常历史 GET 和 Preview／导出选择也复用最后一个函数。

- 首轮两份全新合成工程实际构建并保存 build／smoke 后，分别加入指向同工程README的别名和取消 `src` 目录读取权限。最终回归另将别名指向工程外合成文件，核对其内容没有进入反馈。
- 修复前反例实际观测：直接 inspect 抛 `project-alias` 或 `EACCES`，没有返回保存的检查内容。原 `context()` 已单独兜底，而 inspect／handoff 没有，导致同一事实在不同入口行为不一致。
- 路由代码另显示：GET 历史对 WorkflowError 可保留回执，但 EACCES 等普通错误会落入通用 500；这项修复前 HTTP 结果是代码归因，不冒充首轮实录。修复后的实际 HTTP 负例确认 200 返回历史＋负面鲜度。
- 根因不是模型判断、游戏JSON格式或职责范围，而是 BGS 把“核验当前输入是否仍匹配”失败当成“已保存历史不可读取”。保存事实与当前资格被混在了一个异常通路中。

## 修正及边界审计

仅在既有 `inspectAgentMeasurementInputs` 的当前文件检查部分捕获失败，返回 `current=false`、`measurement-inspection-failed` 和原具体原因；不生成新检查、不变更历史记录、不访问别名目标、不放宽路径规则。成功、来源变化、未完成、旧驱动及 superseded 判定保持原逻辑。

- inspect／handoff 和正常历史 GET 返回原检查事实，但不是当前资格。原生适配器仍非零退出，HTTP 200 只表示有权历史读取成功。
- Preview／导出仍经现有选择器拒绝，不能靠旧 PASS 或历史可读继续交付。
- 身份／项目归属／活动写者检查在该捕获范围外；未授权读取仍拒绝，存储／权限错误不被包成成功。
- 核验中断时不伪造完整 changed-files 列表；先报告无法核验及具体原因。恢复文件权限或排除不安全路径后由正常流程处理，不自动修文件或重跑。
- 可观察兼容变化：输入读取异常统一为负面鲜度 `measurement-inspection-failed`；原来的别名原因和路径仍在 reason 中，普通读取错误不再使有权历史 GET 丢回执。调用者不得把历史GET的HTTP200当验收通过。
- 没有新工具、协议、阶段、Prompt／Review、Agent限额或技术方案。单处修正共用核验函数，比给多个入口分别补兜底更简单。

## 回归及保护

最终64项通过、0失败、0跳过、686个Bun断言，typecheck／diff check通过。见同名 JSON 与 `/private/tmp/bgs-v3-193-final-regression.log`；覆盖直接 inspect／handoff、实际 Bun 适配器、正常HTTP历史、归属拒绝、Preview／导出、真实选定消费及正常原生固定响应闭环。新增反例确认保存 checks 未改、Run未增版本、无重建或模型派发；工程外合成内容未出现在反馈中。最终正常原生夹具为 `bgs-v3-native-measurement-2fEVea`（完整路径见JSON），9次本机固定响应、外部付费0；其原始模型输入与测量保留。其他重复定向回归不再次计数。旧Review兼容测试不意味着恢复默认Review流程。

首轮两个红灯保留在 `/private/tmp/bgs-v3-193-unreadable-reproduction.log`。新增 HTTP 测试第一次写错 SessionManager 构造参数，类型检查与测试均报错，改为既有构造形式并配置不可派发的 runner；该测试错误不是生产bug，日志 `/private/tmp/bgs-v3-193-targeted-regression.log`、`bgs-v3-193-typecheck.log` 保留。

磁轨调度201个选定文件及正式frontend/src／Claude Code/src／builtin-tools/src／根env3207个选定文件哈希不变；正式40个Run仍同三条历史锁，runtime健康、无新活动Agent。本轮没有浏览器界面改动、服务重启、生产env修改或付费重跑。合成测试使用自身临时目录并按既有夹具清理；原始失败日志保留，不称所有临时工程文件都归档。

## 未验证

新修正尚未部署，正式runtime仍1.91。离线负例不证明真实模型能正确选取／采用完整检查，也不认证游戏品质、未知远端结果、引擎操作、正式产品接线或Token改善。不为凑文档完成继续新增机制。

# 1.91 部署及独立 Debug 测量交接验收（1.92 记录）

## 结论

正式 runtime 已部署 1.91，新诊断交接不是只在测试源码里存在：Chrome 使用既有 HttpOnly 登录态，从正式 62174 的只读测量接口读取旧失败回执，响应首字段为逐探针 `diagnostics`，包含真实文档、节点、视口、状态与原因。旧结果保持 `measurement-superseded`，quality 仍为 `unverified`、deliveryEligible 仍为 false。未恢复、重跑或修改磁轨调度。

独立 Debug 的真实 CLI／正常 HTTP 闭环符合预期。它采用本地 store、合成 owner、本机固定响应，不是生产付费原生回合或真实模型判断，不能证明游戏品质。

## 本轮证据

| 核对项 | 实际结果 |
| --- | --- |
| 部署 | runtime PID 57757；1.91；六份部署源码指纹一致；UI 驱动保持 `.5` |
| 其他服务 | 四服务未重启；五服务健康检查均 200；不重建 frontend／CLI |
| 正式历史读取 | `e38ed843-ec73-4061-9204-7b10ffff2136` 的六项诊断前置；原失败状态保留；旧结果不授予当前资格 |
| 独立执行 | 一次原生启动、9 次本机固定响应、2 份真实测量；没有宿主 Task／Plan |
| 诊断进入下一请求 | 五项批次完整保存；隐藏祖先、裁切计数、坏选择器原因进入实际模型输入 |
| 新旧结果 | 新测量 current=true；旧测量 superseded 但仍可读；新结果也不认证品质 |
| 权限失效 | 真实回合 ended／quiesced 后能力文件撤销，旧 bridge 不可访问；未登录查历史返回 401 |
| 不重复执行 | 历史查询、交接、导出、重复同身份接单不增加启动／模型请求／Run 版本 |
| 保护范围 | 磁轨调度 201 个选定文件、正式 frontend/src／Claude Code/src／builtin-tools/src／根 env 共 3207 个选定文件哈希未变 |
| 正式运行状态 | 40 个 Run 的同三条历史隔离锁及版本未变；磁轨调度版本 121、暂停、writerLiveness=none；未清锁或派发 |

## 回归与失败记录

- 测量／工具回归 26 项通过、1 项既有可选 consumer 用例跳过；正常原生闭环及拒绝真实 billing 配置两项通过。共 **28 个不同用例通过、1 跳过、0 失败、400 个 Bun 断言**；typecheck、diff check 通过。Chrome 重复验证同一夹具不另计用例。
- 新增能力撤销观察第一次错误地读取外层 sessionRunner 的 env；该 env 要到 native runner 内部才填充，测试在启动前失败、usage=0。改为按已有 workspace/session 身份只读实际已发布能力，不新增生产能力或修改 native runner。失败日志保留，不将测试观察错误归为系统缺陷。
- 两次成功合成执行（回归、Chrome）共 **18 次本机固定 /messages 响应，外部付费请求 0**。不是“模型调用 0”，不以虚拟 usage 声称降耗。
- 只有测试夹具及断言增量，没有新增生产代码、prompt、Review、轮数限制、框架或技术路线要求。测试服务 PID 58396 已关闭，正式 runtime 留运行，证据保留。

## 原始记录

- 正式部署日志：`/private/tmp/bgs-v3-191-deployed-runtime.log`
- 正式接口实际响应：`/private/tmp/bgs-v3-192-live-historical-receipt.json`（只读浏览器结果，不含登录凭据）
- Chrome 原始结果与截图：`/private/tmp/bgs-v3-192-debug-proof.json`、`/private/tmp/bgs-v3-192-debug-proof.jpg`
- Chrome 合成原始目录：`/private/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-native-measurement-3hA1qA`，内含 saved measurements、native JSONL、`transport-model-inputs.json`、`native-measurement-evidence.json` 及导出 ZIP。
- 回归合成原始目录：`/private/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-native-measurement-exBjdV`
- 日志：`/private/tmp/bgs-v3-192-native-boundary-regression.log`（观察位置错误）、`bgs-v3-192-native-boundary-regression-final.log`、`bgs-v3-192-feedback-boundary-regression.log`、`bgs-v3-192-typecheck.log`、`bgs-v3-192-native-debug.log`。
- 同名 JSON 保存部署指纹、逐项事实、保护范围、限制及证据路径。

## 未验证边界

正式服务采用新摘要已由正常登录、真实数据库的历史 GET 响应证实；原生执行与权限撤销则在隔离正常 HTTP 服务验证，不能称“真实模型／远端部署原生回合全部通过”。任意巨大批次详细输出仍可能截断。本轮没有八领域设计、完整 Scene/UI／资源、玩家流程、美术／音频品质或引擎验收；正式产品入口不改，成本优化最后，不自动追加付费。

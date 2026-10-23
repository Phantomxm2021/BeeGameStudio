# 原生任务收尾与证据修正

## 已确认根因

雾港项目 `foggy-harbor-chart-run--a554208387ef` 的实现 transcript
`foggy-harbor-chart-run-a554208387ef__7a48099f.jsonl` 显示：2026-09-19 10:45:53 UTC，
子代理 `a21c4adbf5645b996` 第一次完成；10:49:49 同 ID 经 SendMessage 再次启动。
10:53:41 父代理输出“等待复核结果中。”，BGS 随即进入交付并停止会话，未等到第二次子代理终态。

宿主存在三个独立错误：

1. Runner 收到任意 result 就解除当前回调；会话层另用 Agent 工具回执和旧 transcript 尾部推断完成，遗漏同 ID 的再次启动。
2. Worker port 等待会话结束后仍使用等待前的 events 快照，忽略最后结果或失败。
3. 将成功写过的路径填入 verifiedArtifacts，并在交付收据无依据地声称已运行检查。

## 最小修正

- 生命周期只由 BGS 原生进程接收层跟踪：SDK task_started/terminal，支持同 ID 再次启动和结构化/旧 XML 通知。旧 activation 的不同 tool_use_id 通知不能关闭新 activation。
- 有尚未结束的短期 Agent 任务时保留当前 submit 与消息回调，接收原生后续工作及父代理最终 result。不追加提示、不规定审计轮数、不修改原生引擎。
- 不把 local_bash 开发服务器、长期 teammate 当作必须结束的子代理。用户停止、进程退出或原生明确 idle 却没有父代理最终结果时，不交付等待消息。
- 删除会话层第二套完成推断与轮询。transcript usage 仅作计量，不作完成信号。
- 收尾重新读取事件；changedPaths 不再充当 verifiedArtifacts。交付收据明确只确认 artifact-handoff，runtimeVerification 为 not-assessed-by-host。

## 边界

宿主交付确认不是游戏质量通过；本修正不使旧项目自动获得浏览器验证，也不修复旧游戏代码。
真实验收仍要观察新 Web React 项目的生产包、UI/场景布局、资源加载与编辑后生效情况。
不通过解析自然语言中的“完成”“等待”“通过”推导结果，不恢复固定逐项 PASS 协议或第二轮模型验收。

## 回归覆盖

同 ID 恢复、迟到旧通知、父代理自动继续、未注入新 prompt、后台服务器、不完整 idle、EOF、用户停止；
等待期间新增失败/最终结果/文件修改；结构化及 XML 通知；无依据的已验证路径和运行检查声明。

## 本轮执行记录

- 93 项针对性测试通过（native runner、通知解析、worker port、交付确认、恢复与停止）；服务端 TypeScript 检查通过。
- 本地五项服务已重启，沿用现有启动器使用的 `bee-game-studio/.env.local`，没有修改原生引擎源码。
- Chrome 已填写全新 Web React 项目《纸灯温室巡游》，重点覆盖单场景、独立嵌套 UI、VFX 与 Content 编辑。
- 尚未启动模型生成：产品弹窗说明按实际 Token 扣除 Credit，与此前“不扣钱测试”的授权前提不同，继续操作被安全检查阻止。未绕过弹窗，待用户确认这一具体额度消耗。
- 因此本轮不能声明新项目坐标、视觉或生产包验收通过。

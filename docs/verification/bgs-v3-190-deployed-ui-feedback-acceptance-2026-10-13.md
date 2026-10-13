# 1.89 部署与独立 Debug UI反馈验收（1.90记录）

日期：2026-10-13。仅验证系统修复，游戏品质／完整Workflow仍未通过。本轮模型及付费调用0。

## 部署与保护范围

使用根目录既有env，仅重启runtime：PID54803、启动器54788。UI版本`v3-ui-dom-consumption.5`与部署清单的六份相关源码哈希一致；不重建CLI/frontend，不重启其他服务，不开放settings/hooks或改变沙箱。五服务及已有独立debug入口均HTTP200，资源后台处理状态保持关闭。

部署前后只读核对40个Run，仅同三条既有隔离锁、版本未变；无活动原生Agent或runtime子进程。不解锁、续作或重发任务。磁轨调度201个选定文件、正式frontend/src／Claude Code/src／builtin-tools/src及根env共3207个选定文件哈希无变化。

## 独立 Chrome 页面一次执行

临时Debug页面显式点击发起，与部署源码清单一致的生产UI驱动在独立合成工程中运行。不是生产测量HTTP请求／原生Agent回合，不替Agent选择真正游戏的实现路线。

| 案例 | 实际结果 | 反馈／证据 |
|---|---|---|
| 正常窗口／缩放逻辑根（2项） | passed | 原始几何、扰动和还原符合源JSON，正常文字适配保留 |
| 隐藏祖先，窗口／缩放（2项） | unverified | 明确返回ancestor is hidden；不凭正尺寸给PASS |
| 祖先文字裁切，窗口／缩放（2项） | unverified | textFit未验证、clippedCount非零；不把框内文字裁切漏掉 |
| 合法 → 错误选择器 → 合法（1项） | 整批unverified | 三个探针全部保存，状态passed/unverified/passed；坏输入包含源路径、节点、视口及选择器错误，前后结果不丢 |
| 真实文字溢出（1项） | failed | Visible text exceeds node bounds at baseline；没有放宽检查 |

共8项符合预期，合成源JSON及打包源字节均不变。负例未验证／失败是本轮正确结果，不将全部改为通过。原始几何、裁切计数、各阶段观察和指纹保留在JSON与临时目录证据中。

## 回归、失败记录与收尾

- 部署后针对版本、隐藏／裁切／坏选择器和正常测量交接导出的7项回归通过、0失败、114断言；根typecheck、MJS语法及diff检查通过。本轮不把上轮125项重复加总。
- 初次页面长POST被临时Bun服务默认10秒idleTimeout截断，页面显示Failed to fetch；宿主日志明确此原因，八项仍完成并保存一次。只读刷新通过GET获取最终结果，**没有重新点击、重跑或追加付费**。这是临时验收脚本的HTTP等待问题，不归因于UI检查器或游戏，不隐去失败。
- 临时Debug服务PID54832于验收后关闭，原始合成目录、日志、截图保留；正式runtime及其他服务继续运行。

部署日志`/private/tmp/bgs-v3-189-deployed-runtime.log`；原始证据`/private/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-190-debug-zeMOTb/evidence.json`；Debug日志`/private/tmp/bgs-v3-190-debug-acceptance.log`；回归`/private/tmp/bgs-v3-190-deployed-boundary-regression.log`、类型`/private/tmp/bgs-v3-190-typecheck.log`；前后只读Run核对`bgs-v3-190-preflight-before/after.log`，保护核对`bgs-v3-189-protected-file-check.json`。

## 未验证边界

本轮证明这三项系统修复在相同部署源码的独立宿主驱动中符合预期，正常测量／交接／导出由离线合成回归核对；不证明真实Agent采用完整探针或生产测量HTTP的原生回合已验收。真实八领域设计、完整Scene/UI与资源消费、玩法／画面／听感、未知外部结果、引擎及正式产品接线仍未完成。成本优化最后，不增加Review、代理限额或技术路线要求。

![独立 Debug 最终结果](/private/tmp/bgs-v3-190-debug-proof.jpg)

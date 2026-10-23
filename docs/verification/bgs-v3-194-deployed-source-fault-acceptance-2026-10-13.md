# 1.93部署与来源故障独立Debug验收（1.94记录）

正式runtime已从1.91重启至1.93，PID60667；使用根env，仅重启runtime，其他四服务不动，不重建正式frontend或CLI。包含新修正measured-build.ts在内的七份部署指纹与独立验收所用源码一致，UI驱动保持v3-ui-dom-consumption.5。五服务健康检查200；部署前无活动Agent，40个正式Run的同三条历史隔离锁及版本未变，未清锁或派发。

## 实际独立Debug结果

Chrome显式启动一次正常HTTP／真实CLI／本机固定响应闭环。新独立工程正常保存两份实际测量并结束原生回合后，仅在该合成工程注入故障。正常接口不替换或模拟响应：

| 场景 | 历史回执 | 已开Preview | 新开Preview | 静态／工程导出 |
| --- | --- | --- | --- | --- |
| content目录不可读（chmod 0） | 200，原检查不变，current=false，inspection-failed并含EACCES具体路径 | 409；随后旧能力404 | 409 inspection-failed | 两者409 inspection-failed |
| 工程内新增指向工程外合成文件的别名 | 200，原检查不变，current=false，inspection-failed并定位foreign-link.txt | 409；随后旧能力404 | 409 inspection-failed | 两者409 inspection-failed |

- 故障前确有Preview200，其HTTP响应字节等于已测HTML；不是把从未可用的Preview误记为拒绝正确。Preview实际HTTP请求使用已签发虚拟主机，在本机监听地址路由，不依赖系统wildcard-localhost DNS，也不跳过应用权限／验证。
- 读取与故障观察没有改变Run、测量内容或版本，没有重建／重测／派发；共一次原生启动、9次本机固定/messages、两份测量，外部付费0。
- 负例的quality仍unverified、deliveryEligible=false；工程外合成内容没有进入回执。每项故障在finally恢复合成目录原权限／移除本轮合成别名；来源恢复后原测量鲜度重新可核对，没有重测，不改真实游戏。
- 原始检查、逐项HTTP结果及实际模型输入保留。临时服务PID60679验收后关闭，正式runtime继续运行。

## 回归／保护

部署后测量历史／Preview／导出51个不同用例通过、0失败、0跳过、511个Bun断言；typecheck／diff通过。独立Chrome两项故障不与这些用例累计为更多自动回归。旧Review兼容用例不表示恢复默认Review流程。本轮未新增生产代码或修补测试游戏，只建立临时隔离验收入口及保存记录。

磁轨调度201个选定文件及frontend/src／Claude Code/src／builtin-tools/src／根env3207个选定文件哈希未变。资源服务PID51656保持，无活动正式Agent，生产写锁不变。合成夹具不加载根env，billing必须disabled，正常Agent只连本机固定provider；这不代表真实模型调用零次，也不证明Token净改善。

## 证据与未验证边界

- 部署：`/private/tmp/bgs-v3-193-deployed-runtime.log`
- 新合成工程原始证据：`/private/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-native-measurement-A9QQqJ`；含`fault-debug-evidence.json`、两份`*-history.json`、`native-measurement-evidence.json`、`transport-model-inputs.json`及原生JSONL。
- Chrome页面：`/private/tmp/bgs-v3-194-debug-visible-result.json`；截图：`/private/tmp/bgs-v3-194-debug-proof.jpg`
- 回归：`/private/tmp/bgs-v3-194-deployed-boundary-regression.log`、`bgs-v3-194-typecheck.log`；debug：`bgs-v3-194-fault-debug.log`。
- 同名JSON保存完整结果、部署指纹、保护范围及边界。

**部署指纹与当前代码核对通过；故障运行在独立正常HTTP服务、本地store和合成owner，不是给正式服务／Supabase／磁轨调度注入故障。** 不扩大为远端部署全组合、真实模型判断、八领域设计完整性、游戏品质、引擎或正式产品接线通过。成本优化仍最后，不自动付费重跑、不替Agent指定技术方案。

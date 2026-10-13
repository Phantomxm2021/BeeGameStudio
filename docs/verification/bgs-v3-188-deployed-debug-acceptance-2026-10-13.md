# 1.87 系统修复部署与独立 Debug 验收

日期：2026-10-13。本记录编号1.88，部署源码基线1.87，不是游戏验收通过。

## 已完成

- 部署前只读检查40个Run，仅3条既有隔离锁、版本未变；没有活动原生Agent。不解锁、不重发任务。
- 仅重启runtime与resources：PID51655/51656，启动器PID51640，使用根目录既有env。frontend/billing/skills未重启，CLI/frontend未构建，资源后台处理仍关闭，五服务200；原独立`/debug/workflow-v3`返回200。
- 本轮独立页面从Chrome真实点击发起，页面位于临时服务，不在正式frontend。资源连接实际部署的只读服务；UI在独立合成工程调用与部署清单同SHA的生产检查器，不指定真实Agent实现路线。
- **资源8项符合预期**：CLI的未知query、formats错类型、limit错位置退出1且各自网络请求0；实际API的对应3类请求返回400及字段说明；合法limit=1返回1包（全库25包），nextCursor下一页仍1包且身份不同。实际部署核对的是Pack接口；elements在本轮离线回归中覆盖，不伪称已另做线上验证。
- **UI7项符合预期**：保存逻辑尺寸1024×576，窗口1024×576原尺度与800×600等比信盒均通过；后者根框0,75–800,525、scale=.78125，真实框321.875,276.5625–478.125,323.4375还原为保存逻辑框412,258–612,318。position/size扰动后按源预期变化并还原。错误偏移公式、忽略JSON、文字溢出及未选择逻辑根却直接用窗口比较均failed；以被测节点作根unverified。负例得到失败才是验收符合预期，不把所有结果改成passed。
- UI证据本轮首次真实执行完成；修正资源鉴权脚本后按同源哈希复用该已完成UI结果，不再重复运行。原始UI结果及鉴权失败目录保留。
- 本轮离线46项通过、0失败、479断言（45项边界/资源/坐标＋1项正常测量交接导出），根typecheck、diff通过。日志`/private/tmp/bgs-v3-188-deployed-boundary-regression.log`、`bgs-v3-188-measure-handoff-regression.log`、`bgs-v3-188-typecheck.log`。
- 磁轨调度201文件SHA不变；受保护frontend/src/Claude Code/src/builtin-tools/src及root-env共3207个选定文件不变。没有正常Agent/模型启动或费用实验，没有手修、采购、settings/hooks、安全策略或技术路线改动。成本优化未开展。

## 初始失败与鉴权边界

初次Debug脚本错误地将服务匹配/解析凭据用于目录浏览，实际被401阻断，未得到参数校验结果。保留失败，不归罪于参数修复。未扩大服务token权限；通过已有HttpOnly会话鉴权接口处理浏览器正常请求，刷新/访问凭据留宿主，不写到页面、CLI、日志或模型。随后正常用户权限下取得实际400与分页结果。独立脚本初次猜依赖路径导致导入失败，改用既有package resolver；未安装依赖或修改生产代码。

## 未验证边界

这些证据证明部署资源参数反馈与特定DOM坐标检查条件有效，不证明真实Agent会选用新coordinateRoot，也不证明动态workflow的完整游戏交付。UI调用的是独立宿主中的同源生产检查器，并非真实原生Agent回合或生产测量HTTP调用；正常测量/交接/导出由合成离线回归核对。画面品位、听音、玩法趣味、任意Scene/UI编辑、旋转/滚动/Canvas UI及引擎仍未通过。原游戏星级遮挡、结果页R及音频承诺问题未由本轮关闭。

## 证据与收尾

部署：`/private/tmp/bgs-v3-187-deployed-services.log`。原失败/UI结果：`/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-188-debug-uVIswE/evidence.json`；正常鉴权后的合并结果：`/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-188-debug-JwkTAd/evidence.json`。同名JSON记录部署源码指纹、具体错误与范围，不含凭据。

验收结束关闭本轮临时Debug服务PID51728/52126，保留原始目录、日志与截图；正式服务继续运行。不删除真实项目、隔离锁或原始证据。后续正常Agent或付费实验须另行授权。

![独立Debug资源参数反馈](/private/tmp/bgs-v3-188-debug-resource-proof.jpg)

![独立Debug UI检查证据](/private/tmp/bgs-v3-188-debug-ui-proof.jpg)

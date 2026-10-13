# 正常 Agent 测量／反馈／交接闭环（1.91，独立Debug，未部署）

日期：2026-10-13。按主文档§4–5／§7核对正常调用关系，不恢复固定Review、不选游戏技术路线。本轮外部付费请求0；实际CLI连接本机固定响应，不将固定响应视为真实模型判断或游戏品质。

## 实际调用与已证实根因

正常HTTP接单 → agent-goal.execute → openAgentTools／createAgentMeasurement → 原生Bash调用measure.mjs → 当前writer绑定的HTTP能力 → 构建／UI驱动 → 已保存测量 → inspect／handoff → 原生模型下一次请求 → 原生Read/Edit修订 → 新测量 → 正常API读历史／导出 → 真实退出／宿主收尾。

首次独立CLI复现中，Run保存完整5个探针，状态为passed/unverified/unverified/unverified/passed；但inspect --details的失败命令输出进入下次模型请求后缺少“ancestor is hidden”。不是宿主未保存，也不是LLM主动忽略：原生Bash对非零退出抛ShellError，`src/utils/toolErrors.ts:formatError`在超过10000字符时保留前后各5000字符，中段被截掉。原始结果中分别有802／4772字符截断标记；原因位于被截中段。

这是BGS回执生产与正常工具错误通路的衔接缺陷，**不改Claude Code截断器**，也不把该原生保护定性为bug。默认失败回执不应先塞全量几何再让Agent猜缺失原因。

## 最小修复与兼容边界

- 在现有measurementSummary前置diagnostics：逐探针保存原身份、视口、状态、原因、未观察属性及文字适配／裁切计数；只投影检查器实际事实，不计算新结论，不丢掉合法探针。
- 默认失败UI observation改为紧凑的同形探针观察，省去几何框及溢出矩形明细；--details仍返回原保存observation，宿主历史及来源字节不改。普通准备错误／不认识的观察格式仍原样返回，不吞失败。没有新增工具、Task、Prompt、Review或Agent限制。
- 调整的是回执呈现，UI判定仍为v3-ui-dom-consumption.5，鲜度／writer／历史替代与交付权限不放宽。默认输出中不再承诺完整几何明细，依赖明细的调用者须显式--details；正常API详细读取及导出仍保留原证据。
- 显式详细输出仍可能被原生截断；本轮证明五个探针的关键原因位于保留头部，不保证任意规模批次都能在一次模型请求里完整承载。完整材料始终保留，不把原因前置当作语义／品质保障或净成本下降证明。

## 正常入口证据

Chrome独立页面显式启动一次：正常本机HTTP项目／Chat／goal入口，实际原生CLI，正常一次性权限API，仅对已知合成Bash/Read/Edit响应；没有关闭沙箱或改全局权限。使用新临时工程、合成owner和local store，不碰真实生产身份／磁轨调度／远端数据库。

- 1次原生启动、9次本机固定响应；两份测量按真实执行产生，未创建宿主Task/Plan/Attempt。
- 原失败批次5项完整保留；默认测量、显式inspect与handoff中的关键诊断均进入实际模型请求。原生Read/Edit仅修合成CSS，再执行新测量；不是开发代理手修真实案例。
- 新测量current=true；旧测量measurement-superseded，历史观察仍可读，不退回旧成功。quality=unverified、deliveryEligible=false。
- 正常HTTP工程导出16164字节。只读查询、导出及相同request身份的重复接单未新增模型请求／原生启动，Run保持同版本；JSON及独立notes字节不变，原生退出和quiesced事实真实保存。
- 正式runtime未重启，仍1.89；本轮修复只在新建独立app及离线回归生效，不能宣称正式服务已采用。

完整Debug证据：`/private/var/folders/77/bcfcrwjj1yg90qkfj3pbnyr00000gn/T/bgs-v3-native-measurement-KCDiUF/native-measurement-evidence.json`；每次下一请求的工具结果单独保存在同目录transport-model-inputs.json。正常API端口56539、独立页面56541，进程56897于验收后关闭，目录／原始JSONL／ZIP／截图保留。

## 回归与失败记录

测量／消费／工具／导出兼容4文件50项通过、1项既有可选consumer跳过、0失败、612断言；正常HTTP实际CLI新用例1项通过、8断言；离线夹具遇真实billing配置即在启动前拒绝1项通过、1断言。**52个不同用例通过、1跳过、0失败、621断言**，相同native用例的重复验证不累计。根typecheck、diff通过。正常旧Review/Repair兼容测试不是恢复固定流程。

首次真实截断反例保留FKtuiE目录与日志；之后测试曾误假设公开summary checks含version，实际版本在保存record中，改为核对保存证据，不为此改生产API。单元测试初次相对import写错一级以及可选字段类型错误已修，原失败日志保留，不掩盖或算为系统bug。最终正常HTTP回归LKfzg5、Chrome Debug KCDiUF均通过。

本轮共5组独立CLI运行／45次本机固定响应（复现、断言修正、成功复核与Chrome验收均列明），外部付费请求0；不是“模型调用0”。夹具不加载生产env，billing模式核对为disabled，并已加入非disabled时启动前拒绝。临时app的合成用量因缺定价留在自身usage outbox，未删除或伪装结算；不写生产账单，也不将虚拟135 Token作为真实费用／降耗数据。

日志：`/private/tmp/bgs-v3-191-native-measurement-reproduction.log`、`bgs-v3-191-native-measurement-regression.log`、`bgs-v3-191-native-measurement-regression-final.log`、`bgs-v3-191-native-http-regression.log`、`bgs-v3-191-measure-handoff-regression.log`、`bgs-v3-191-billing-guard-regression.log`、`bgs-v3-191-typecheck-final-complete.log`。原失败formatter／测试类型日志保留，不覆盖。

## 保护范围与未完成项

磁轨调度201个选定文件和正式frontend/src／Claude Code/src／builtin-tools/src／根env共3207个选定文件哈希不变。只读40个正式Run仍同三条既有隔离锁，不解锁、不派发。新增为现有BGS回执呈现与针对测试／独立夹具，没有技术路线框架。

正常代码通路、真实CLI与工具结果传递现有受控证据；真正模型是否正确选择检查／采用反馈、实际用户登录／远端数据库部署组合、专业设计深度、资源、完整Scene/UI／玩家流程和视觉／声音品质仍未通过。外部不确定结果、引擎、授权外正式产品接线保留，成本优化最后。下一步新修复部署须另据明确授权，不自动付费重跑。

![正常 Agent 独立 Debug 闭环](/private/tmp/bgs-v3-191-native-debug-proof.jpg)

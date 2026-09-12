# Foundation 契约修订：实现与离线验证

## 范围与状态

本报告覆盖已批准方案的首批修复及后续契约实现：稳定语义 ID、显式 N/A、材料证据、问题依据、数值／公式适配、条件化音频交付，以及 Author 服务端结构装配。

保持 Author → Reviewer → Revision 私有候选 → 最终全量 Reviewer 架构。未启动新的付费生成、未重启现用服务、未修改已停止项目的八份公开文档、未提交 Git。离线通过不等于真实模型或 Chrome 验收通过。

## 本次完成的契约实现

### 1. Author 结构装配与输入责任

- 新派发持久化 `foundation-author-body.v2`。模型输出 title、executiveSummary、按固定 ID 标识的 sections/materials；服务端校验封闭字段、完整 ID 集合、重复字段／ID、内容边界，然后按契约顺序装配 Markdown。标题和协议标记由服务端生成，不再依赖模型完整复刻标题序列。
- 不静默丢弃未知字段、额外章节或越界标题；不把材料格式／语义质量检查搬成另一条审查轨道。Reviewer 仍负责内容、材料质量和最终验收。
- 未标记版本的旧请求保持原 Markdown 路径；旧持久化字段仍可读取。停止、恢复、单文档重试、计费与发布生命周期保留。
- 各 Author 获得私有 factIdentityContract，明确 ID、displayLabel、runtimeCode 分离、N/A 声明、材料事实不重复抄写。
- Audio 现在等待 Technical 的 data_content 决策，读取已提交 audioDeliveryMode。这增加一层依赖顺序，不增加文档生成次数；共享审查图和 Revision 冻结写权限不变。
- 对历史 checkpoint／接受记录保留精确的旧 Audio 三项上游清单读取规则，仅适用于无新版标记的记录；v2 必须使用包含 Technical 的四项清单。兼容读取不修改记录、不改变新派发契约。

### 2. 事实身份、适用性及多来源证据

- 显式 actionId、entityId、resourceId 等语义列优先于展示标签；不通过翻译、同义词或运行时代码猜测对应关系。
- 允许声明过的 owner 材料承载事实，主 owner 不变；provenance 保存语义标签、材料的章节范围和字节摘要。模型不决定持久化来源元数据。
- 入场校验验证允许来源、完整块范围、摘要、ID 与值的关系；显式展示标签必须确实出现在所引用的身份表中。材料变更会触发对应事实及消费者重算；未变材料仅在原字节摘要相同时重定位行号。
- 新事实包使用 `foundation-fact-results.v2`。列表事实（game.states 除外）可用 owner 中精确的 N/A 行或三列表声明返回 not_applicable，并绑定原理由和来源。N/A 不是空数组、缺失值或自动 PASS；上下游适用性冲突仍产生 Issue。
- 源文档缺失、owner 块缺失和非法身份表分别为类型化操作错误，不伪装为 absent 或 N/A；无法机械提取的合法内容继续进入显式未决提取流程。
- 新 Reviewer 交接结果为 protocolVersion 2，携带新版元数据；Revision 保留 v1 接收及原约束摘要。新约束目录 v4，旧 v3 修订契约不被追溯改写。

### 3. Reviewer 问题依据与 Revision 权限

- 语义审查清单更新至 v7，仍为十项检查；领域责任区分 GDD 行为、Level 几何／内容、Balance 数值、Technical 能力、Audio 政策、Art／UI 表现。
- 新 Issue basis 明确 ownerEvidence、conflictingEvidence、repairTargets、事实／章节依赖和带原文引用的 assumptions。所有修订目标必须被引用；假设引用必须来自已引用块。服务端生成和校验元数据，拒绝模型伪造 owner 或扩大修订范围。
- 假设仍须由源审查和独立确认判断是否成立。引用存在不等于逻辑正确；定向复核明确以当前内容重新评估旧依据。
- Revision 模型投影分为 writeTargets、readOnlyEvidence、requiredFacts。补充事实和来源不扩大原 sectionIds 写权限；v2 中显式 N/A 也会投影为适用性状态。
- 结构失败给出缺失、重复、额外章节、顺序、块外正文和协议／工具标记等封闭反馈；不通过删除越权输出接受修订。每次重试仍基于不可变原文；连续两次相同无效输出进入 needs_action，并保留计费。
- 缺失事实使用 FACT_MISSING:<catalog key> 跨语言归并；不同冲突、修订目标或支持证据不合并。完整候选仍须通过最终全量复审，局部 PASS 不能遮蔽新问题。

### 4. 数值与音频证据

- 数值适配器 v3 支持明确参数列、列顺序、逻辑像素／秒等单位、显式实体 ID／标签映射及波次表。歧义绑定和不支持的模型保持 unsupported。
- 新增有界公式解释器：结构化参数／公式表、变量依赖、四则／幂／有限函数、单位维度和转换；拒绝循环、缺失变量、重复 ID、除零、溢出及不受支持语法。设有行数、表达式、深度和运算预算，不执行任意代码。
- 结果按公式区分 computed／unsupported，整体可为 partial；所有计算均保留未验证的设计假设。算术成立不等于玩法可行或整个检查 PASS。
- audioDeliveryMode 分 codeSynth、managedProgrammatic、fileAudio，分别要求对应的明确能力证据。代码合成不自动承担托管 JSON 清单或音频文件义务；声明支持不等于真实运行时已验证。
- 数值、公式、音频和适用性证据随选中源块绑定到语义 packet identity，并进入模型投影。

## 旧真实请求只读回放

真实失败的 Asset 修订请求在本次最终实现中可重新准备，冻结 packet digest 仍为：

`8d6da93044791192717f7c548f7ecfb45df1437e8dd1a18a374151116719f21b`

唯一可写块仍是 Asset Inventory。Asset 格式块、Audio 事件矩阵、Level 内容矩阵是只读证据；asset.formats、asset.inventory_ids、audio.event_ids、level.required_assets 已进入模型投影。旧源中未提取的 asset.covered_level_requirements 仍是 not_extracted，没有补造事实，也没有用新版 N/A 规则重解释 v1。

## 验证记录

- 首轮扩大范围的全量回归：138 文件、749 测试，733 通过、16 失败，520.87 秒。
- 原因及处理：五项旧夹具未满足新证据引用／材料闭包；五项最终全量复审超过旧 25 秒测试窗口；五项 macOS 进程身份读取被运行沙箱拒绝，独立重跑六项身份测试全部通过；一项运行中新增的重复 JSON 字段测试命中已加载旧模块。
- 已更新证据夹具与测试等待窗口；业务超时和重试规则未放宽。新增负向用例验证伪造来源标签、非法身份表、伪造 Issue 引用／owner／写范围、缺失／重复 Author 块和重复 JSON 字段。
- 完整重跑：138 文件、750 测试，750 通过、0 失败，9349 次断言，536.17 秒。原来超时的最终全量复审用例实际用时约 28～33 秒，扩大测试窗口后通过；允许原生进程身份读取后，该组测试也通过。
- 全量启动后另补了旧 Audio 接受记录／checkpoint 的只读兼容边界；该改动只涉及 Author，已将 Author 整个 private 范围单独重跑：21 文件、138 测试，138 通过、0 失败，3438 次断言，6.01 秒。该数字与上述 750 项重叠，不能相加当成独立用例数。
- 最终 TypeScript `tsc --noEmit --pretty false` 和 `git diff --check` 均通过。其余专项包括 N/A 日志回放、材料来源防伪、Issue 依据负向验证、公式／单位计算、音频能力分支、Revision 写权限隔离和旧真实请求摘要回放。

## 尚待真实验收

离线实现覆盖不承诺任意自然语言公式、任意游戏模型或任意音频能力都可计算。未被适配器明确支持的输入继续保持 unsupported／未验证。

下一阶段是新项目 Chrome 端到端验收：观察新版 Author 真实输出、完整初审、私有修订、定向验证及最终全量复审，并核对成本与产物。此报告不是该阶段已通过的证明。

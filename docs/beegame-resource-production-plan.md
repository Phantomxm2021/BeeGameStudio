# BeeGame Resource Production 单轨替换实施方案

## 1. 文档权威与替换目标

本文是 Resource Production 的唯一实施权威，字段合同由
[BeeGame 资源与内容描述合同](./beegame-resource-content-contract.md) 补充。其他文档只能引用，不能另建资源阶段、资源状态机、恢复协议或兼容合同。

本方案物理替换此前的单体资源处理逻辑，不在其外围增加调度层。最终系统只允许：

```text
已批准的 Foundation 文档与 Gameplay Checklist
  -> RESOURCE_PREPARATION
       1. 资源需求与生产计划
       2. 完整资源库存
       3. JSON/YAML 内容描述
       4. 确定性资源门禁
  -> Comprehensive Review
  -> Atomic Task Planning
  -> Implementation
```

三个 Agent 任务严格串行，仍属于同一个 `RESOURCE_PREPARATION` phase。任务边界用于缩小上下文、权限和失败范围，不产生第二条 Workflow。

## 2. 唯一事实源

项目只维护三类资源事实：

1. `assets/asset-manifest.json` 及其唯一引用的 `assets/manifest/**` 模块：需求、目标能力和项目实际拥有的资源文件；
2. `assets/content/**/*.json`：资源映射、实体、UI、音频、事件、波次和数值；
3. `assets/content/**/*.yaml`：世界、场景、层级、transform 和实例摆放。

Workflow snapshot 只保存当前 phase、当前 task、dispatch 和 gate receipt。receipt 只证明某个 canonical revision 是否完成，不复制 requirement、resource、content 或场景数据。重启后服务必须重新读取上述项目事实并确定下一任务，不能根据聊天消息、Worker prose、历史失败或次数计数推断进度。

禁止新增第二选择账本、机械职责槽位、中间组装领域对象、候选队列、未匹配表、修复反馈队列、影子状态、聚合 Manifest 副本或旧 Manifest reader。模块集合是一个逻辑 Manifest，每项事实只存在于一个模块；服务端可以在内存中投影聚合视图，但不得把该投影再次持久化。

### 2.1 Manifest v8 模块集合

`assets/asset-manifest.json` 是紧凑根索引，只保存 `version`、`project_target` 与模块路径。requirements 与每个 resource record 分别保存在内容寻址模块中，根索引列出当前有效记录路径。资源记录不得同时出现在根索引、requirements 或其他 resource 文件中。

```text
assets/asset-manifest.json
assets/manifest/requirements/<content-digest>.json
assets/manifest/resources/<identity-digest>-<content-digest>.json
```

根索引、requirements 与 resource records 合称唯一 canonical Manifest v8。服务先写不可变模块，再最后原子替换根索引；新增或替换资源不会改写其他 resource record。提交后删除不再被根索引引用的模块；中断遗留的未注册模块由 Gate 报告。不存在旧单文件兼容读取、自动迁移或双写。

## 3. 类人团队模式的系统化表达

人类团队通常先由策划和美术确定资源需求，再由资源人员取得或制作原料，随后由场景/内容人员编排，最后由工具链门禁检查。BeeGame 采用相同依赖关系，但不模拟会议、职位审批或人工交接文档。

| 人类职责 | 系统任务 | 唯一交付物 | 明确禁止 |
| --- | --- | --- | --- |
| 资源策划 | `RESOURCE_PLAN` | Manifest 的 `project_target` 与 `requirements` | Catalog、下载、placeholder、内容文件 |
| 资源获取/制作 | `RESOURCE_INVENTORY` | Manifest 的 `resources` 与本地独立文件 | 改需求、写场景、写玩法代码 |
| 场景与内容编排 | `RESOURCE_CONTENT` | JSON/YAML 内容文件 | 搜索/创作资源、重做资源计划、写玩法代码 |
| 工具链审核 | `RESOURCE_GATE` | 当前 revision 的 pass/fail receipt | LLM 补写、猜测语义、修改项目 |

Agent 保留判断 Pack 风格、候选适用性、复用方式、placeholder 形态和场景组织的自主权；服务只控制任务顺序、工具权限、文件边界与确定性不变量。

## 4. Task 1：资源需求与生产计划

`resource-planner` 只读取已批准的 `docs/ASSET_PLAN.md`、`docs/ART_DIRECTION.md`、`docs/TECHNICAL_DESIGN.md` 和确认简报，然后一次提交 canonical Manifest plan。Foundation Review 必须在进入资源阶段前保证 Asset Plan 已覆盖其他 owner 批准的全部资源职责；Planner 不重新审计八份文档，也不读取模糊的“可能相关”全文。

规则：

- 只开放 `Read` 与只含 `submit_resource_plan` 的 `AssetManifest`；
- `resource_library_usage`、三个项目根目录和 Manifest version 由服务写入；
- Agent 只提交目标能力和完整 requirements；
- 写入成功即形成 task terminal，当前 dispatch 必须结束；
- 已存在且通过 schema 的 plan 不再重新生成；恢复直接进入库存任务；
- plan 变更只能来自上游文档形成的新 document revision，不能由资源失败反向改写。

服务端在接受提交前完整解析，再原子替换 Manifest。禁止先写半份文件再依靠下一 Worker 修补。

## 5. Task 2：完整资源库存

`resource-curator` 读取 canonical plan 和必要的美术/技术约束，使用唯一 Resource Library 工具取得真实原料；找不到适用资源时，直接创作独立、可加载、可替换的 provisional 文件。

### 5.1 Catalog 合同

Catalog 只允许以下 Pack-first 单一路径：

1. `list_packs`：返回紧凑 Pack 摘要、稳定 `pack_id`、版本、客观分类、维度、格式能力和元素计数；
2. `inspect_pack`：只返回已选 Pack 的元素摘要、准确 `element_id`、依赖与技术事实；
3. `import_resources`：只导入本 dispatch 已观察到的准确 Pack version 与 element；
4. 导入服务负责依赖闭包、下载、hash、路径校验和 Manifest 登记。

`list_packs` 与 `inspect_pack` 使用 schema 枚举和 cursor，不使用名称关键词、正则或项目类型硬编码。结果只返回选择所需的客观字段，不重复完整文档、历史查询、长描述或无关元素元数据。不得保留扁平全库查询、别名或兼容 handler。

### 5.2 库内资源与 placeholder

- Agent 可以用一个 Pack 或一个资源满足多个项目职责，不按 requirement 机械填 Slot；
- Library 资源必须保留 Pack、版本、element、依赖、本地文件和 hash；
- 没有适用候选时不停止项目，创建普通 provisional 资源文件并登记到同一 Manifest；
- provisional 与正式资源使用相同 resource ID 和内容引用方式；
- placeholder 生成能力由目标的 format capability/adapter 提供，共享层不能固定 Web、Unity、Godot、Prefab、TSX 或某一媒体格式集合；
- placeholder 不能写在玩法源码内，也不能启用第二 loader；后期可替换文件或 Manifest 路径而不改玩法逻辑。

每次成功导入或创作都必须先完成文件写入、hash 与 Manifest 原子登记，才算 durable progress。库存 Worker 最终提交结构化覆盖声明；服务只验证声明中的 requirement ID 全部来自 plan、resource ID 全部真实存在且 verified。该 terminal 是当前库存 task 的 checkpoint 证明，不成为项目事实，也不供 Reviewer 或实现阶段消费；最终语义覆盖仍只由 canonical JSON/YAML 拥有。

## 6. Task 3：JSON/YAML 内容描述

`resource-content-author` 只读取当前 Manifest、必要 Foundation 文档和 Gameplay Checklist；只写 `assets/content/**/*.json|yaml`。它不能调用 Resource Library、不能提交资源计划，也不能修改玩法代码。

JSON 与 YAML 的归属严格遵循内容合同：

- JSON：资源映射、实体、UI、音频 cue、事件、波次、数值与机器稳定配置；
- YAML：世界、场景、层级、transform 与实例摆放；
- 不使用中间组装对象、Prefab 或特定引擎对象作为共享领域模型；
- 内容只能引用 Manifest 中已登记的 resource ID；
- 所有文件边界、content ID、owner 和交叉引用先一次规划，再并行写入互不冲突的文件；
- 具体写入失败只重做失败文件，不重新读取全量 Catalog，也不重建资源库存。

若编排时证明库存遗漏了必要原料，Content Author 只能提交结构化缺口，不能创建、下载或登记资源。服务必须用当前 Manifest、库存 binding 与文件审计独立证明对应 requirement 确实没有 verified resource 后，才使当前库存 checkpoint 失效并从唯一 `RESOURCE_INVENTORY` task 继续；仅有“资源尚未被 Content 引用”、写权限冲突或 Worker 自述时必须拒绝回退。Curator 必须导入资源或创建 placeholder，随后再恢复 Content task。缺口不写项目文件、不形成队列，也不产生第二条资源处理路径。

Content task 的保护路径必须从当前确定性问题和 accepted resource finding 的精确 subject 派生。局部文件错误只解锁受影响文件；无法归属到单一路径的跨文件引用错误必须解锁当前 canonical content 集合，由同一个 Content Author 在一次受控修订中恢复一致性。不得一边要求修复跨文件错误，一边把全部候选 owner 文件列入 `protectedPaths`。

## 7. Task 4：确定性资源门禁

Gate 不使用 LLM，不修改文件，只对当前 canonical revision 执行：

- Manifest schema、唯一 ID、根目录、相对路径和格式能力；
- Library provenance、依赖闭包、本地文件、非空内容与 hash；
- provisional 文件独立存在并可由目标 adapter 加载或构建；
- JSON/YAML 安全解析、无重复 key、content ID 唯一；
- required requirement 被内容公共头覆盖；
- 所有 content resource 引用存在且 verified；
- 资源无孤立、内容事实 owner 不重复、三个根目录不重叠；
- `preferred`/`required` 策略对应真实 Catalog observation 与导入事实；
- 不存在中间组装对象、机械职责槽位、源码内 placeholder 或第二资源库存。

失败项必须指向 canonical path/ID 和确定性不变量。资源 phase 保持 `needs_action`，继续时由 artifact resolver 派生唯一未完成 task；不生成 feedback 文档、不复制错误列表、不重放已经通过的任务。

## 8. 恢复、长任务与 Token 原则

Resource Production 不设置业务 token 上限、wall-clock 上限、工具调用次数上限、自动执行次数或“重复读取次数”上限。不同 Idea、网络和模型响应时间不能用固定数值判断失败。

唯一恢复规则：

- active session 存在：恢复同一 dispatch 与事件订阅；
- session 因 transport 丢失：从最近一次已原子提交的 artifact 继续当前 task；
- plan 已提交：绝不重新规划；
- 已登记资源：绝不重复下载；
- content 文件已原子提交：绝不重复生成；
- gate passed：直接进入只允许 resource finding 的 Comprehensive Review；Foundation 与 Checklist 均为冻结输入。

Token 与时间仍按真实 usage 全量累计并展示，但只作为可观测指标，不能改变资源业务状态。Provider 自身拒绝或网络错误按真实 transport failure 暴露；系统不能把 token 计量伪装成 idle timeout，也不能因存在任意文件变更就自动启动一个全上下文 Worker。

为避免无边界消耗，依靠的是任务能力收窄、Catalog 两级读取、紧凑结果、原子 checkpoint 和 artifact-derived continuation，而不是放宽或提高固定 limit。

## 9. Workflow 与前端投影

Workflow Card 的资源阶段显示固定四项：

1. 资源需求与生产计划；
2. 完整资源库存；
3. JSON/YAML 内容描述；
4. 资源与内容门禁。

状态只能来自服务端 task resolver：`pending`、`running`、`completed`、`failed/stopped`。当前 task 的 Worker、动作和错误可以展示；Worker prose、原始 JSON 和历史失败不能成为状态。phase index 仍按完整 Delivery Workflow 计算，内部 task 数不能冒充 phase 数。

## 10. 必须物理删除的当前实现

切换时必须同时删除以下生产逻辑及其正向测试，不允许保留替代入口：

- 通吃计划、Catalog、导入、placeholder 和内容写入的单体 Worker；
- 无真实入口可以完成的旧计划检查点与派生状态；
- 以 token、时间、工具调用次数或自动执行次数终止资源任务的业务门禁；
- 把计量事件伪装成空闲超时的事件映射；
- 扁平全库大结果 action、等价 action 别名和旧 parser；
- 以历史失败、聊天文案或“发生过 durable progress”为依据的自动重派；
- Resource Production 中并列的修复队列、旧 snapshot 读取转换和第二套 UI 状态投影。

非法旧快照可以在拒绝测试中以内联对象出现，但生产常量、生产类型和用户可见文案不得继续声明旧协议。

## 11. 实施顺序与逐任务偏离审计

每个任务完成后必须先对照本文审计，再开始下一项；发现偏离时只修正当前 task，不能自由扩建共享层。

### A. 固化合同

- 更新 Resource worker/task 类型、terminal schema 与 artifact-derived resolver；
- 为四个 task 建立表驱动状态转换和恢复测试；
- 明确旧 snapshot 直接拒绝并要求新建 Workflow，不提供迁移器。
- cutover 前停止所有服务与 active Worker session，再一次性切换 schema；不得让旧 session 占用新 Workflow。

完成判据：同一组 artifacts 在启动、重启和继续时始终派生同一个下一 task。

### B. 切分 Worker 能力

- 新建 `resource-planner`、`resource-curator`、`resource-content-author`；
- 为每种 Worker 建立独立 prompt、tool allowlist、allowed paths 和 terminal；
- 移除单体资源 Worker 的类型、prompt、工具装配和 session 特判。

完成判据：Planner 无 Catalog，Curator 无内容 Write，Content Author 无 Catalog，三者均无玩法代码写权限。

### C. 替换 Resource Library 工具合同

- Catalog 只提供 `list_packs`、`inspect_pack`、`import_resources`；
- 收窄 wire payload，只保留客观选择事实；
- 导入和 Manifest 登记保持一个事务边界；
- 删除旧 action、旧 evidence 解析和旧测试。

完成判据：Agent 不能导入未在当前 dispatch inspect 的 element；重启后已登记文件不会再次下载。

### D. 替换调度与恢复

- Controller 只调用 artifact resolver 派发唯一 task；
- 每个 canonical commit 后结束当前 dispatch；
- 删除 token/time/tool/attempt 控制和 budget-yield 自动重派；
- Gate 通过后唯一转入 Comprehensive Review。
- Checklist 在进入 Resource Production 前已经完成独立 Review/Closure 并封存；Comprehensive 不再拥有 checklist mutation 或 remediation target。
- inventory checkpoint 只绑定 Manifest plan、resource records 与本地文件，不绑定无关 Checklist/文档的全量摘要。
- Content 的 `needs_inventory` 由服务端验证真实缺料；不能用它逃离内容写入或权限错误。

完成判据：任意服务重启点都不会重做已完成 task，也不会产生并发 Resource Worker。

### E. 收口 UI 与残留

- Workflow Card 投影四个 task 的真实状态；
- 删除旧资源状态文案、旧错误和旧前端推断；
- 对生产源码执行旧符号、feedback、fallback、compat、shadow 和中间组装状态残留扫描。

完成判据：生产包中不存在第 10 节列出的符号或行为。

## 12. 可行性、风险与控制

该方案可直接建立在现有 Resource repository 的 Pack summary、`getPack`、`listElements`、`getElement` 和依赖解析能力上；两级 Catalog 是收窄现有事实的 Agent 合同，不需要新数据库、第二资源服务或语义搜索器。Manifest 只接受模块化 v8，Content 继续使用 v1；不保留旧 reader、迁移器或双写。主要改动集中在 Manifest 持久化、Workflow task/terminal、工具权限和 Catalog wire contract。

主要风险只有：

- Asset Plan 遗漏：由 Foundation Review 在进入资源阶段前阻塞，Planner 不自行补造需求；
- Curator 错选：由内容门禁检查引用完整性，由 Comprehensive Review 判断语义和美术适用性；
- Content 发现缺料：只失效同一库存 checkpoint，Curator 必须用真实导入或 placeholder 补齐，不增加处理队列；
- cutover 中存在旧 active session：先停止全部服务与 session，再切换 schema；不迁移旧运行；
- 三次 Agent 启动有固定开销：通过每次只携带 owner 输入、稳定缓存前缀和紧凑 Catalog payload，换取不重复数十次 Catalog 与全量文档的确定性收益。

性能只测量、不作为业务门禁。每个 task 记录 duration、input、cache read、cache creation、output、Catalog payload bytes、调用类型与 canonical mutation 数；与改造前资源阶段日志比较。不能在未跑真实新项目之前承诺固定百分比，也不能把测量结果重新变成 limit。

## 13. 验证矩阵

自动验证必须覆盖：

- Manifest/Content schema、原子写入和失败不污染；
- 四个 task 的正常、停止、transport 恢复与服务重启；
- plan 一旦完成绝不重跑；
- Catalog 两级观察后才允许精确导入；
- 无匹配时创建独立 placeholder 并继续；
- Content 只能引用已登记资源；
- Gate 失败后只派生唯一未完成 task；
- Resource phase 不存在 token、时间、工具次数和自动 attempt 终止；
- 前后端 task、phase index、计时和错误投影一致；
- 生产源码无旧协议、双轨、feedback、fallback、compat、shadow、机械职责槽位或中间组装状态残留。

端到端验证按一个项目一次串行执行，至少覆盖：

1. 有合适 Library 资源并成功导入；
2. 部分无匹配并生成 placeholder；
3. 资源阶段中途重启后继续且不重复规划/下载；
4. JSON/YAML、Comprehensive Review、实现和运行验收完整通过；
5. 使用系统 Chrome 验证 Workflow Card 与最终游戏；
6. 测试结束后停止全部服务。

任何自动测试通过都不能替代真实新项目端到端结果。上述验收全部完成前，不得宣布替换方案已经完全落地。

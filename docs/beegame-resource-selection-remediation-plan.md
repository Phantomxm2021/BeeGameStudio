# BeeGame 资源选择错误根治方案

## 1. 目的

本文定义 BeeGame Delivery Workflow 在 `RESOURCE_PREPARATION` 阶段的资源检索、选择、导入和无匹配收敛方案。

目标不是通过增加检索次数规避错误，而是让每个 canonical asset requirement 最终只能进入一种明确、持久且可审计的结果：

1. 导入经过验证的 Resource Library 资源；或
2. 基于完整检索证据记录 Asset Plan 已批准的 no-match 结果。

系统不得把“检索预算耗尽”“只检查了部分资源包”或“Worker 没有完成选择”视为 no-match，也不得在需求尚未收敛时进入游戏实现阶段。

## 2. 当前问题与根因

### 2.1 Pack 检索存在跨元素假阳性

当前 Pack 级过滤可能由 Pack 内不同元素分别满足 category、format、asset kind、capability 等条件。这样返回的 Pack 不一定存在一个同时满足全部约束的元素。

这会形成无效调用链：

```text
browse Pack -> inspect Pack -> index elements -> 零结果 -> 切换 Pack
```

Pack 只有在至少一个可导入元素同时满足全部精确技术约束时，才能被判定为匹配。

### 2.2 缺少跨 Pack 的元素级精确查询

Manifest 提供的是资源约束而不是 Pack ID，但现有元素查询必须先指定 Pack。Worker 因此需要先猜测 Pack，再逐个 inspect 和 index，导致查询次数与资源包数量线性增长。

### 2.3 单次 selection dispatch 范围过大

一次 dispatch 可能同时收到 3D、2D UI、图标、SFX、环境音和音乐等全部 unresolved requirements。固定 catalog read budget 与 selection plan 的复杂度无关，无法保证工作闭环。

依靠 Prompt 要求模型自行分批不是可靠的调度边界。控制器必须决定当前 dispatch 唯一负责的 selection group。

### 2.4 查询预算可能被无效请求消耗

当前预算在 catalog 应用调用前递增，因此 stale cursor、服务校验失败或其他未取得 catalog 数据的请求也可能消耗预算。预算耗尽只代表调用受限，不代表资源不存在。

### 2.5 缺少正式的 no-match 操作

Workflow 要求 Worker 在无可用资源时记录 approved no-match，但 Resource Library 没有对应的结构化操作。直接使用通用文件工具编辑 Manifest 会形成第二条写入路径，破坏 provenance 和审计一致性。

### 2.6 Manifest 可能声明不可验证或非必要的硬约束

资源检索约束必须同时满足：

- 产品结果确实需要；
- Resource Library metadata 可以客观验证；
- 目标运行时确实支持。

可以由实现阶段完成的表现行为，不应自动变成资源库的硬筛选条件。

### 2.7 Dispatch 完成与业务完成混淆

Worker 进程正常结束只表示 dispatch terminal，不表示当前资源组或整个资源阶段已经完成。零导入、零 no-match 且仍有 unresolved requirements 的 dispatch 必须是失败或需要操作，不能表达为资源准备完成。

### 2.8 现有系统已经具备但尚未闭环的能力

当前 canonical manifest 已经定义 `source_decision.basis=catalog-no-match` 和 `discovery_receipt`，Readiness 也会校验 receipt 的候选、Pack 覆盖与 decision-ready 状态。因此本方案不得再创建第二套 receipt、旁路 evidence 文件或独立 no-match 数据模型。

真正缺少的是：

- 由精确候选查询产生现有 canonical receipt 所需的客观事实；
- 使用该 receipt 原子完成 source decision 的正式 Resource Library 动作；
- 让控制器按 bounded group 调度并判定业务完成。

## 3. 方案审计结论

### 3.1 正确性

方案方向正确，因为它把职责放回资源阶段的三个真实所有者：Resource Library 负责客观候选事实，Resource Worker 负责语义和美术判断，Workflow 控制器负责调度和收敛。Readiness Gate 继续只验证确定性事实，不参与选择，也不通过降低验收标准掩盖上游失败。

正确性成立还必须满足：

- `query_candidates` 只执行结构化精确匹配，不能变成关键词、正则、文件名猜测或服务端语义推荐；
- `record_no_match` 复用现有 canonical `discovery_receipt`，不能创建平行证据模型；
- Pack coherence 只用于候选分组和风格上下文，不能代替同一元素满足全部硬约束的证明；
- catalog budget、Worker terminal 和 no-match 保持为三个不同概念；
- `required` policy 下的阻塞结果保持阻塞，不能转换成成功的非库 fallback。

### 3.2 可行性

方案可以在现有分层内实现，不要求重写 Resource Library：

1. Resource Core 已有规范化 filters、元素摘要、分页和精确 element matching，可复用为全库候选查询核心。
2. Resource Server 已有 service-token catalog 边界，可增加元素级查询路由而不暴露存储实现。
3. Workflow 已能从 canonical manifest 派生 selection groups，只需改变派发粒度和稳定顺序。
4. Manifest 已有 no-match source decision 和 discovery receipt schema，只需增加原子生成与落盘动作。
5. `import_elements` 已拥有下载、provenance、依赖闭包和 Manifest binding 的原子写入职责，不需要第二条导入路径。

主要实施风险是 Supabase Pack catalog 只保存聚合字段，无法证明字段共现。落地时必须使用元素级索引或保留共现关系的 projection，不能继续利用聚合数组拼接判断。

### 3.3 适用度

方案适用于所有使用 canonical Asset Manifest 和 Resource Library 的新项目，覆盖 2D、3D、音频、UI 及混合媒体资源。它不依赖游戏名、项目名、固定 fixture、特定引擎或特定平台。

它不负责管理员资源库 UI 的自由浏览、资源包发布与归档、存储迁移，以及实现阶段的运行时组装和最终视觉/音频验收。因此，Workflow 的旧选择动作应在 `query_candidates` 完成替代后从 resource-preparer 工具面删除，但管理端仍在使用的 Pack 浏览接口不能因为名称相似而被误删。

## 4. 唯一目标流程

```text
创建并验证 canonical Asset Manifest
  -> 控制器选择一个 unresolved selection group
  -> 对该组执行全库元素级精确查询
  -> Worker 判断候选的语义和美术适用性
  -> 导入小批量候选，或记录带证据的 approved no-match
  -> 服务端原子更新 canonical Manifest
  -> 重新计算 unresolved selection groups
  -> 全部收敛后执行资源完整性审计
  -> 审计通过后进入游戏实现阶段
```

这是一条单轨流程。禁止保留旧版 fallback、通用文件写入旁路、feedback 补偿或兼容性双轨。

## 5. 方案设计

### 5.1 修复 Pack 匹配语义

Pack 匹配必须基于元素级合取条件：存在同一个 ready、依赖闭包完整的元素，同时满足当前 selection group 的全部约束。

预聚合 Pack catalog 不得只存储互相独立的字段集合后进行组合判断。可选择：

- 从元素索引执行 `exists` 查询；或
- 建立能够保留字段共现关系的元素级 catalog projection。

不得基于名称、路径、词组、正则或特定平台推断资源用途。

### 5.2 增加全库元素级候选查询

Resource Library 增加唯一的结构化候选查询能力，例如 `query_candidates`。输入是一个 selection group 的规范化精确约束：

```json
{
  "group_id": "<stable-group-id>",
  "constraints": {
    "dimensions": ["2D"],
    "categories": ["environment"],
    "asset_kinds": ["texture"],
    "capabilities": ["tileable"],
    "formats": ["png"]
  },
  "cursor": null,
  "limit": 16
}
```

API 必须保证返回的每个元素自身满足全部结构化约束，并返回：

- element、Pack ID 和固定版本；
- usage tags、格式、能力和技术事实；
- 预览与依赖闭包状态；
- 按 Pack 汇总的匹配数量；
- catalog revision；
- 规范化查询条件；
- 分页信息和生成现有 canonical `discovery_receipt` 所需的客观字段。

服务端只执行确定性的 metadata 匹配，不替 Worker 判断艺术风格、游戏语义或最终适用性。

### 5.3 逐组调度 SelectionPlan

控制器从 canonical Manifest 派生所有 unresolved groups，但每次只派发一个 bounded group。

分组依据包括：

- dimension；
- category；
- asset kind；
- capabilities；
- accepted formats；
- no-match policy；
- 可由同一资源真实复用的 responsibilities。

3D、2D UI、音频等不同媒体领域不得放入同一 selection dispatch。服务端按稳定顺序选择下一组，不能要求模型面对完整列表后自行决定优先级。

### 5.4 找到候选后立即形成持久检查点

Worker 应在当前组发现一批已经证明适用的候选后立即调用 `import_elements`，结束当前 dispatch。不得继续检查大量其他 Pack 后再统一导入。

成功导入必须原子完成：

- 下载固定 Pack 版本的资源及依赖闭包；
- 写入 import provenance；
- 写入复制文件清单；
- 绑定所有真实满足的 requirement IDs；
- 更新 source decision；
- 保存查询和选择证据。

一个元素可以绑定多个 requirement，但必须逐项满足其格式和资源约束。

已经导入的 inventory 在重试、继续和服务重启后必须原样保留，不重新选择、替换或下载。

### 5.5 增加唯一的 `record_no_match` 操作

Resource Library 增加服务端拥有的原子操作 `record_no_match`。它至少接收：

- selection group ID；
- requirement IDs；
- catalog revision；
- normalized constraints；
- query receipt ID；
- 候选数量；
- 对候选不适用的结构化理由；
- Asset Plan 已批准的 no-match source type；
- 非空 reasons。

合法结果只能来自 requirement 已声明的 no-match policy：`runtime-generated`、`authored-asset`、`system-provided`、`silent` 或 `blocked`。其中 `blocked` 落盘为 `source_decision.type=unavailable` 且 requirement status 必须为 `blocked`。

该操作必须复用并生成当前 manifest 已定义的 `BeeGameRequirementDiscoveryReceipt`，不得引入第二套 receipt schema。它由服务端原子更新 canonical Manifest。Resource Worker 不得通过 Write、Edit 或其他通用文件工具手写 source decision。

### 5.6 建立可审计的零结果证明

全库精确查询返回零项时，API 应返回类似以下证据：

```json
{
  "result": "no_exact_candidates",
  "catalog_revision": "<revision>",
  "normalized_constraints": {},
  "total_examined": 0,
  "matching_count": 0,
  "constraint_diagnostics": {},
  "receipt_id": "<receipt-id>"
}
```

`record_no_match` 必须引用由查询事实形成的有效 canonical receipt。这样才能区分：

- 全库确实没有技术匹配；
- 有技术匹配但 Worker 判定语义不适用；
- 只检索了部分范围；
- 查询预算耗尽；
- 查询本身失败。

后面三种情况不得记录 no-match。

### 5.7 修复 Cursor 契约

Cursor 必须绑定：

- catalog revision；
- 查询动作；
- Pack ID（如适用）；
- normalized constraints hash；
- 最后一个元素 ID。

过滤条件变化时不得复用旧 cursor。工具应在请求发出前拒绝不匹配 cursor，并提示从无 cursor 的新查询开始。

### 5.8 调整查询预算

预算作用域改为当前 bounded selection group，并遵循：

- 只有成功返回 catalog 数据的读取才计数；
- schema 校验失败不计数；
- stale cursor 不计数；
- transport failure 不计入业务查询预算；
- turn gate 拒绝的调用不计数；
- import 或 approved no-match 完成后立即结束当前组。

预算是防止无限探索的保护，不是资源存在性的证明。禁止仅通过提高固定次数掩盖任务切分问题。

### 5.9 明确状态语义

状态至少区分：

- `dispatch_completed`：本次 Worker 已正常终止；
- `group_resolved`：当前组已导入或记录合法 no-match；
- `resource_preparation_completed`：全部 requirements 已解决且审计通过。

Worker 正常退出但未解决当前组时，应表达为 `group_failed` 或 `needs_action`。不得让 UI、日志或 evidence 将其显示为资源阶段完成。

## 6. Manifest Planning 约束

Asset Manifest Planning 必须遵循：

1. 只声明产品明确要求的能力；
2. 只声明 Resource Library 能够客观验证的 metadata；
3. 只接受目标运行时支持的格式；
4. 不把实现阶段可完成的行为自动转换为资源筛选硬条件；
5. requirement、group 和进度数量全部从 canonical Manifest 派生；
6. 文档、Prompt、运行状态不得分别维护独立计数。

例如，只有产品确实要求并且库中能够验证时，才声明 `tileable`、`nine-slice` 或 `loop-points` 等能力。

## 7. 需要删除的污染与双轨

落地时必须删除，而不是保留兼容路径：

- 一次 dispatch 传递全部 selection groups 的逻辑；
- 依赖 Prompt 让模型自行拆分完整资源列表的逻辑；
- Pack 聚合字段跨元素拼接匹配；
- Worker 直接编辑 Manifest source decision 的路径；
- 无效或未执行请求仍扣预算的逻辑；
- 通过提高固定预算延缓失败的补偿逻辑；
- dispatch 完成即暗示资源阶段完成的状态逻辑；
- 基于名称、路径、词组或正则猜测语义的逻辑；
- 针对旧版 Workflow 资源选择流程的 fallback、feedback 和兼容分支。

以下能力不是资源选择双轨，不在本次无条件删除范围内：

- reviewer 发起的显式 repair/reselection；
- 已导入资源的客观 metadata refresh；
- 本地开发认证；
- 管理端 Pack 浏览；
- 尚未完成数据迁移的存储和依赖读取路径。

这些能力只能在 canonical 替代路径落地、当前数据完成迁移并通过调用审计后删除。不得为了清除名称中出现的 legacy 或 fallback 而破坏当前系统。

最终只保留：

```text
Manifest
  -> 单组调度
  -> 精确候选查询
  -> import 或 record_no_match
  -> 重新计算
  -> 完整审计
```

## 8. 实施顺序

1. 修复 Pack 跨元素假阳性。
2. 增加全库元素级 `query_candidates` 和查询 receipt。
3. 将 selection dispatch 改为逐组调度。
4. 增加唯一的原子 `record_no_match` 操作。
5. 修复 cursor、预算计数和状态语义。
6. 删除旧检索、旁路写入、补偿和兼容逻辑。
7. 完成单元、集成和真实新项目端到端验证。

## 9. 验收标准

修复完成后必须满足：

1. Pack 只有在同一个元素满足全部条件时才被判定为匹配。
2. 全库元素查询不会要求 Worker 先猜 Pack。
3. 一个 selection dispatch 只负责一个 bounded group。
4. 资源存在时产生真实本地文件、provenance 和 Manifest binding。
5. 一个资源可以在真实满足约束时绑定多个 requirement。
6. 资源不存在时产生引用有效 receipt 的 approved no-match。
7. 查询预算耗尽不能被当作 no-match。
8. stale cursor、校验失败和 transport failure 不消耗业务查询预算。
9. 已导入资源在重试、继续和服务重启后不会重新下载。
10. unresolved requirements 全部收敛前不能进入游戏实现阶段。
11. 全部收敛并通过资源审计后不会继续停留在资源准备阶段。
12. 状态、日志和 UI 能区分 dispatch 结束、group 收敛和阶段完成。
13. 测试不得依赖固定项目名、游戏名、日志文本或 fixture 文案。
14. 实现不得绑定 Web、Unity、Godot 或其他特定平台。
15. 使用 Chrome 完整验证真实依赖 Resource Library 的新项目，覆盖导入、实现、Reviewer 和最终验收。

## 10. 非目标

本方案不引入：

- 自由文本模糊搜索；
- 正则或关键词用途判断；
- 服务端自动艺术选择；
- 特定平台资源规则；
- 旧版兼容或双轨运行；
- 通过无限提高查询预算解决调度问题。

Resource Library 负责提供精确、完整、可审计的客观候选事实；Worker 负责语义和美术判断；Workflow 控制器负责让每个选择单元确定性闭环。

## 11. 落地状态（2026-07-31）

已完成：

- Pack 匹配改为同一元素满足完整合取约束；
- 增加跨 Pack 的精确 `query_candidates`，返回规范化过滤条件和 catalog revision；
- cursor 同时绑定查询动作、过滤条件、作用域与 catalog revision；
- selection dispatch 按稳定顺序每次只派发一个 group；
- `import_elements` 只接受当前精确查询实际观察到的元素 ID；
- 增加复用 canonical discovery receipt 的原子 `record_no_match`；
- 只有当前 group 真实解决后 dispatch 才能完成；
- 查询预算只在成功返回 catalog 数据后计数；
- Resource Preparer 的旧 Pack 浏览、Pack 检查、批量索引、路径反查、通用 Manifest 写入入口已删除；
- 工作流、资源核心、资源服务的类型检查与自动化测试已通过。

尚待人工前置条件：使用 Chrome 创建真实新项目的完整端到端验收。2026-07-31 的 Chrome smoke 已验证前端可加载且登录门禁正常，但当前 Chrome 会话在生成项目时要求重新登录，因此未产生可用于导入、实现、Reviewer 与最终验收的真实项目证据。

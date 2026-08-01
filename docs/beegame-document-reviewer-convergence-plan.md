# BeeGame Document Reviewer 单轨收敛方案

## 1. 目标

Document Reviewer 在实现前发现跨文档、资源与内容描述之间的真实矛盾，并通过有限、可追溯的修订收敛。Reviewer 只审计，不修改；Workflow 只路由结构化 finding，不解释游戏语义。

本方案只有一套 review state、finding、owner、revision 和终态。禁止全文循环重审、自然语言状态推断、兼容 reader、feedback、shadow finding 或第二修复队列。

## 2. 审计时序

```text
六份 Foundation 文档
  -> Foundation Initial Review
  -> 按 owner 批量修订
  -> Foundation Closure Review
  -> Gameplay Checklist
  -> Resource Production（Manifest + 资源文件 + JSON/YAML 内容描述）
  -> Comprehensive Initial Review
  -> 按 owner 批量修订
  -> Comprehensive Closure Review
  -> Atomic Task Planning
  -> Implementation
```

Foundation Review 不得要求尚未创建的 Checklist、Manifest、资源或运行证据。Comprehensive Review 可以审计当前 Manifest 与 `assets/content/**/*.json|yaml` 的语义适配，但不能要求尚未实现的代码、构建或运行证据。

## 3. 固定审计集合

### 3.1 Foundation checks

- `brief_alignment`
- `cross_document_consistency`
- `gameplay_completeness`
- `technical_feasibility`
- `art_direction_coherence`
- `ui_audio_consistency`
- `acceptance_observability`

### 3.2 Comprehensive additions

- `checklist_traceability`
- `resource_semantic_fitness`
- `content_structure_fitness`
- `resource_content_consistency`
- `implementation_readiness`

Comprehensive 的固定集合不是替换 Foundation，而是严格并集：

```text
COMPREHENSIVE_CHECKS = FOUNDATION_CHECKS + COMPREHENSIVE_ADDITIONS
```

因此 Foundation 固定为 7 项，Comprehensive 固定为 12 项。不得重命名、替换、拆分或按案例新增顶层 check；新发现的审计规则必须归入已有 check 的职责。

### 3.3 Check 职责边界

| Check | 负责 | 不负责 |
| --- | --- | --- |
| `brief_alignment` | 确认简报、范围与语言合同一致 | 自行扩大产品范围 |
| `cross_document_consistency` | 跨文档事实、ID 与权威归属一致 | 选择一个冲突文档作为默认权威 |
| `gameplay_completeness` | 完整玩家循环、状态、机制与结果 | 实现代码与运行证明 |
| `technical_feasibility` | 目标约束、确定性规则和单一资源加载路径可实现 | 指定框架内部实现或引擎专用对象 |
| `art_direction_coherence` | 视觉职责、风格和可读性要求一致 | 选择具体 Catalog 资源 |
| `ui_audio_consistency` | UI、交互与音频职责跨文档一致 | 要求尚未存在的运行录屏 |
| `acceptance_observability` | 每项批准行为都有可观察结果 | Foundation 阶段要求 Checklist 已存在 |
| `checklist_traceability` | Checklist 逐项追踪批准行为与证据 | 发明新玩法要求 |
| `resource_semantic_fitness` | 现有资源语义足以承担批准职责 | 替 Resource Agent 选 Pack |
| `content_structure_fitness` | JSON/YAML 权属、结构和稳定 ID 正确 | 要求每个 requirement 一个文件 |
| `resource_content_consistency` | Manifest、资源与内容引用一致且只有一条加载路径 | 接受运行时或源码替代分支 |
| `implementation_readiness` | 当前合同足以生成唯一、可执行的实现计划 | 要求尚未实现的构建或运行结果 |

每个 required check 必须返回 conclusion、artifact anchors 和必要的 finding。不得根据项目名、游戏类型、关键词或正则动态增删 check。

涉及系统交付边界的 check 必须在 evidence 中引用 `systemDeliveryContract` 的精确 JSON Pointer：Foundation 与 Comprehensive 的 `cross_document_consistency`、`technical_feasibility`，以及 Comprehensive 的 `content_structure_fitness`、`resource_content_consistency`。该引用只证明 Reviewer 实际核对了固定权威；finding 的 subject 仍必须指向需要修订的项目 artifact，不能把只读合同列为修复对象。

## 4. 单一输入合同

Reviewer 同时服从三层不可互相替代的权威：

1. **Confirmed Brief**：产品目标、范围、目标设置与语言权威；
2. **System Delivery Contract**：系统唯一交付格式、根目录、Schema、内容权属和资源加载规则；
3. **Project Artifacts**：当前游戏的玩法、视觉、交互、音频、资源职责与验收事实。

项目文档即使彼此一致，只要违反 Confirmed Brief 或 System Delivery Contract，仍然必须产生 blocking finding。Reviewer 不得用“跨文档一致”替代“整体符合权威”。

Reviewer 只接收服务端生成的当前 revision 投影：

- 确认简报与语言合同；
- 当前固定 System Delivery Contract；
- 当前阶段允许审计的完整文档；
- Foundation 或 Comprehensive 固定 check set；
- prior findings、当前 repair batch 和 server diff；
- Comprehensive 阶段的 canonical v7 Manifest；
- 从内容文件安全解析出的 `schema`、`id`、`kind`、`fulfills`、`resources` 与文件路径；
- 当前 Catalog provenance 和确定性资源门禁结果。

投影是 request view，不落盘、不成为第二份合同。它不得截断语义 ID，不保存候选搜索历史，不包含 Agent 自报验证结论，也不包含构建日志或运行验收事实。

Durable review state 只保存 revision、artifact digest、finding ledger、repair owner、changed paths、check evidence digest 与最终 evidence。Closure 的 server diff 由修复前后的 digest 计算，只传路径及前后 digest；不得保存完整文档副本、完整 Reviewer request 或第二份可恢复正文。

### 4.1 System Delivery Contract

System Delivery Contract 由服务端当前常量结构化生成，是只读 request view，不写入项目、不由 Agent 修改，也不允许项目文档重新定义。至少包含：

- 唯一 Manifest：`assets/asset-manifest.json`；
- Manifest 版本：canonical v7；
- runtime asset root：`assets/runtime`；
- content root：`assets/content`；
- generated adapter root：`assets/generated`；
- 内容 Schema：`beegame-content-v1`；
- 每个内容文件必须包含 `schema`、`id`、`kind`、`fulfills`、`resources`、`data`；
- JSON kinds：`resource-registry`、`entity-definitions`、`ui-configuration`、`audio-configuration`、`event-definitions`、`wave-definitions`、`numeric-configuration`；
- YAML kinds：`world-definition`、`scene-definitions`、`hierarchy-definition`、`placement-definitions`；
- JSON/YAML 同一事实不得双写；
- 资源文件、placeholder 和最终媒体只通过 canonical Manifest 与内容引用加载；
- 禁止第二 Manifest、第二内容根、第二 Schema、运行时/源码媒体替代和第二加载器分支。

这些是引擎中立的 BeeGame 交付边界，不规定 React、Unity、Godot 或其他引擎内部对象。目标实现可以在消费边界之后选择最简单的引擎原生加载方式，但不能改变项目交付合同。

## 5. Finding 合同

每个 finding 至少包含：

- 稳定 `findingId`；
- `checkId`；
- `owner`：`foundation`、`checklist` 或 `resource`；
- 当前合法 artifact subject；
- 精确位置或稳定语义 ID；
- 可观察冲突；
- 为什么阻塞当前门禁；
- closure condition。

Foundation subject 只能引用六份基础文档；Checklist subject 只能引用验收清单；Resource subject 只能引用 Manifest requirement/resource ID 或内容文件 ID。Reviewer 若引用不存在的 ID，terminal 无效，不能把格式错误伪装成业务 finding。

提交工具必须按当前 scope 与 mode 生成唯一 Schema：Foundation 只暴露 `owner: foundation` 和文档 `path/anchor`；Comprehensive 才暴露 checklist/resource owner 与资源语义 ID；Initial 不暴露 `regressionPaths`；Closure 才允许它引用 server 提供的 changed paths。禁止用一份宽松 Schema 同时承载四种协议后再靠提示词约束。

## 6. 审计原则

### 6.1 Requirement 与资源

Requirement 来自批准文档，不是 Catalog query 或 slot。Reviewer 判断现有资源与内容描述是否足以承担需求，但不替 Resource Agent 选 Pack，也不从文件名推断含义。

### 6.2 Placeholder

找不到合适库内资源时，独立、可替换、位于正常资源目录的 placeholder 是合法资源。它与正式资源使用同一 resource ID 和同一 JSON/YAML 引用方式。Reviewer 可以因 placeholder 不满足已批准的质量、结构或可加载要求提出 finding，但不能仅因其为 provisional 而阻塞。

### 6.3 内容描述

- JSON 拥有稳定映射、实体定义、UI/音频映射、事件、波次、数值和其他机器数据；
- YAML 只拥有世界、场景、层级和实例摆放；
- 同一事实不得双写；
- 一个内容文件可以覆盖多个 requirement；
- 不要求每个 requirement 生成一个文件；
- 不接受 `cmp-*`、assembly status、member binding 或第二资源身份。

### 6.4 引擎中立

Reviewer 审计可观察需求、资源引用与内容结构，不得要求 Prefab、TSX、WOFF2、特定 Scene 格式或某个平台专用加载方式。目标格式适配由项目目标与实现负责。

引擎中立不等于允许项目自建另一套 Manifest、内容根或 Schema。System Delivery Contract 是 BeeGame 项目交付边界；引擎适配发生在该边界之后。

## 7. 收敛算法

1. Initial Review 对当前 scope 执行一次完整审计。
2. 服务端验证 terminal、check coverage、anchors 和 subjects。
3. findings 按 `foundation -> checklist -> resource` 分组；每次只派发当前最上游 owner 的完整 batch。
4. Owner 一次性修复该 batch，并提交变更后的 artifact revision。
5. Closure Review 只复核 prior findings、server diff、固定受影响 checks 和直接 regression。
6. 已关闭 finding 不得在同一 revision 以新 ID 重新提出，除非 diff 产生了可证明的新冲突。
7. 上游变更确定性失效受影响的下游 approval；不重新开放无关全文审计。
8. 自动修订达到上限后进入 `needs_action`，保留真实 findings 和累计时间。

修复必须提升相应文档 PATCH 版本；资源或内容修复提升 Manifest revision。版本变化用于证据失效，不等同于自动通过。

## 8. 状态与界面

Workflow Card 的阶段、task 与 icon 必须来自 durable review 状态：

- Initial Review：`正在审计完整文档基线`；
- Repair：`正在修订审计发现`，逐项显示 finding closure；
- Closure Review：`正在复核本轮修订`；
- READY：任务完成 icon；
- failed / needs_action：错误 icon 与真实错误 popover，计时停止；
- retry / continue 恢复同一 durable dispatch，不重置累计运行时长。

不得沿用“撰写文档”task 表示 Reviewer，也不得从聊天文案推断状态。

## 9. 删除清单

- Composition Review 和 Composition Assembly 前置条件；
- Manifest `compositions` 投影；
- `cmp-*` subject、finding 和 task；
- open-ended re-review loop；
- keyword/regex owner routing；
- reviewer prose parser；
- finding feedback/shadow store；
- legacy terminal、fallback reader、双写状态与兼容测试。

## 10. 验收

必须用全新项目完成以下链路：Foundation Drafting、Initial Review、批量修订、Closure、Checklist、Resource Production、Comprehensive Review、Implementation、Audit、Runtime Acceptance 和 Delivery。

验收同时确认：

1. Review task/icon 随真实子状态变化；
2. JSON/YAML 与 Manifest 只存在一个 owner；
3. placeholder 不会因库内无匹配而停止项目；
4. invalid terminal 不会变成业务 finding；
5. 修订次数有界，重启和继续不重置；
6. 没有 Composition phase、`cmp-*`、双轨、feedback、fallback 或兼容 reader；
7. 系统 Chrome 能打开交付项目并按 Checklist 完成真实玩家路径。

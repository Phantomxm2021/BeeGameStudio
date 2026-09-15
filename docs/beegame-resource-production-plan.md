# BeeGame Resource Delivery 单轨实施计划

状态：P1 已落地。旧 Planner → Curator → Content Author 固定多 Agent 方案已移除；Resource Delivery 只负责真实资源与 Asset Manifest。

## 1. 位置

```text
已发布 Game IR
  -> Resource Delivery
  -> 已发布 Asset Manifest
  -> Game Content Package
  -> Target Implementation
```

Resource Delivery 是 Game IR 后的第一个生产阶段。Scene、UI、VFX、角色、动画、玩法配置及目标引擎代码都不属于本阶段。

## 2. 一次直接 CLI 任务

Workflow 向一次正常的直接 CLI Agent 任务提供：

- 当前已发布 Game IR，重点包含 `resource-realization` 需求；
- 已确认目标平台、运行时与资源格式能力；
- Resource Library 的实际可用能力和当前项目已有资源；
- 唯一可写范围 `assets/**`。

Agent 自主决定如何搜索互联网、检查 Resource Library、选择、下载、制作或组合资源。Workflow 不规定搜索词、工具顺序、候选数量、Subagent、Skill、重试轮数、时间墙或 tokens 上限。

## 3. 唯一产物

### 3.1 真实资源

```text
assets/runtime/**
assets/generated/**
```

- `runtime` 保存项目实际运行使用的资源；
- `generated` 只保存可重新生成的转换产物；
- 不允许用随意 placeholder 冒充满足 IR 的资源；
- Web 来源必须保留直接下载地址、来源页、许可证与获取时间；
- Resource Library 来源必须保留真实 Pack、版本、element 与依赖事实；
- Agent 自制资源必须说明原因并可被目标运行时真实加载。

### 3.2 Asset Manifest

```text
assets/asset-manifest.json
assets/manifest/requirements/*.json
assets/manifest/resources/*.json
```

Manifest 是唯一资源权威，必须保存：

- IR requirement；
- 实际 resource；
- requirement→resource 绑定；
- 本地路径与文件 hash；
- source/provenance/license；
- verified、available 或 failed 状态；
- 一资源多文件与依赖闭包。

旧 `assets/content/**`、resource-registry Content 文件和 `CommitResourceContent` 不再承担绑定职责，也不能作为 Resource Delivery 通过条件。

## 4. Agent 与宿主边界

Agent 负责语义判断：

- 资源是否符合 Art Direction 和具体使用场景；
- 选择一个资源包还是多个资源；
- 是否搜索互联网、使用资源库或自行创作；
- 如何处理 Sprite、Spritesheet、模型、材质、音频及其依赖。

宿主只做确定性校验：

- Manifest schema、ID 和 revision；
- requirement 是否来自当前 IR；
- 每个 required requirement 是否绑定至少一个真实 resource；
- 文件是否存在、非空、路径未越界且 hash 一致；
- verified resource 是否满足绑定 requirement 的维度、种类与必要能力；
- provenance 与许可证必填事实是否存在；
- 不存在第二份 Manifest、旧 Content registry 或未登记资源旁路。

宿主不做审美选择，不替 Agent 搜索资源，不从文件名推断用途，也不自动追加修订轮次。

## 5. 已完成的代码修订

1. 将 requirement→resource binding 移入唯一 Manifest 合同；
2. 从 `project_target` 删除旧 `content_root` 资源职责；
3. 让资源 revision 只覆盖 Manifest 与实际资源文件；
4. 让 Resource readiness 不再调用旧 Content audit；
5. Resource Prompt 删除 Scene/UI/VFX/Gameplay 配置和 minimal registry 要求；
6. 删除旧 `content-contracts.ts`、`assets/content` reader/writer、相关 terminal/tool 与只服务旧轨的测试；
7. 保留并更新 IR→Manifest 精确字段与覆盖验证；
8. 扫描生产可达性，确认没有 fallback、feature flag、双写或第二入口。

## 6. 验收

使用一个固定的已发布 IR fixture，独立运行 Resource Delivery：

1. Agent 只修改 `assets/**`；
2. 每项 required requirement 都有真实绑定；
3. Manifest、文件与 provenance 校验通过；
4. 项目中不存在 `assets/content/**`；
5. 不生成 Scene、UI 或目标引擎源码；
6. 资源替换保持稳定 resource ID 时，下游可继续通过同一 ID 引用；
7. 记录模型生成、工具执行、等待、调度和 tokens，但不以这些指标截断任务。

Resource Delivery 通过并发布 Manifest revision 后，Workflow 才允许启动 [Game Content Package](./engine-neutral-content-package-practice-plan-2026-09-15.md) 的 Scene/UI 阶段。

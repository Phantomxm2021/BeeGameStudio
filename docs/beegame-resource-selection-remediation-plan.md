# BeeGame 资源与内容交付实施方案

## 1. 唯一方案

资源系统只维护三类项目事实：

1. `assets/asset-manifest.json`：项目实际拥有的资源文件；
2. `assets/content/**/*.json`：稳定映射与数据定义；
3. `assets/content/**/*.yaml`：世界、场景、层级与实例摆放。

Workflow evidence 只证明某个 revision 是否通过审计，不复制项目事实。目标工具生成的缓存或导入产物位于 `generated_asset_root`，可以删除重建。

详细字段以 [BeeGame 资源与内容描述合同](./beegame-resource-content-contract.md) 为准。

## 2. 交付流程

```text
八份 Foundation 文档
  -> Foundation Review
  -> Gameplay Checklist
  -> Resource & Content Preparation
       - 检索 Resource Library
       - 下载适用资源
       - 创作缺失的独立 placeholder 文件
       - 编写 JSON 映射和数据
       - 编写 YAML 世界、场景、层级和实例摆放
  -> Resource & Content Gate
  -> Comprehensive Review
  -> Atomic Task Planning
  -> Implementation
  -> Implementation Audit
  -> Runtime Acceptance
  -> Delivery
```

资源阶段结束后才能实现。实现阶段只消费已验证的 resource ID 与 content ID，不下载资源、不修改清单、不在源码内创建替代媒体。

## 3. Manifest v7

```json
{
  "version": 7,
  "project_target": {
    "runtime_asset_root": "assets/runtime",
    "content_root": "assets/content",
    "generated_asset_root": "assets/generated",
    "asset_format_capabilities": ["png", "glb", "wav", "json", "yaml"],
    "resource_library_usage": "required"
  },
  "requirements": [
    { "id": "visual.player", "required": true }
  ],
  "resources": []
}
```

规则：

- 三个根目录由系统固定写入，Agent 无权另设路径；
- `resource_library_usage` 来自确认简报并由 Workflow 写入，Agent 无权改变；
- requirement 只描述职责，不保存派生状态；
- resource 对应一个可独立替换的本地文件根；
- Library 资源保存 Pack、版本、element、依赖和本地哈希；
- Agent 创作资源保存来源、原因和 `provisional`；
- Manifest 不保存场景布局、事件、工具连接或运行结果。

## 4. JSON 与 YAML 分工

JSON 负责稳定机器数据，例如实体到资源的引用、动画状态、UI、音频 cue、事件、触发器、波次和玩法参数。YAML 只负责世界、场景、层级、transform 和实例摆放。

每个文件都有同一个最小头：

```yaml
schema: beegame-content-v1
id: main-scene
kind: scene
fulfills: [visual.arena]
resources: [arena-model]
data: {}
```

`fulfills` 和 `resources` 只引用 Manifest 中的稳定 ID。物理路径只由 Manifest 拥有；JSON 和 YAML 不重复记录。同一事实只能有一个 owner。

## 5. Placeholder 与替换

资源库没有合适结果时，Agent 继续工作并创作可加载的 placeholder：

- placeholder 是普通独立文件，放在 `runtime_asset_root`；
- 与正式资源使用相同的 resource ID 和 content 引用方式；
- 不写入玩法源码，不触发第二套 loader；
- 替换时修改该资源文件或执行明确的资源替换操作；
- 场景、事件和玩法代码不因来源变化而改变。

程序生成的音频、图形或其他资源也遵守同一规则：生成描述或媒体必须是独立资源文件，并可由目标工具加载或构建。

## 6. Resource Library 行为

Agent 先浏览结构化 Catalog，再导入本次会话已观察到的准确 element。服务只负责检索、下载、依赖闭包、校验和登记，不猜测项目语义。

一次资源阶段的顺序固定为：

1. 读取已审核的资源需求；
2. 进行有限且不重复的 Catalog 浏览；
3. 导入适用资源；
4. 对剩余需求创作 placeholder；
5. 登记全部资源；
6. 编写 JSON/YAML；
7. 提交当前 resource/content IDs。

服务重启后根据 Manifest 和本地哈希识别已下载资源，不重复下载。

## 7. 确定性门禁

Gate 必须同时验证：

- Manifest v7 字段、ID、路径、格式和本地哈希；
- Library 来源与依赖闭包；
- Agent 资源确实是独立文件；
- JSON/YAML 可安全解析且无重复 key；
- content ID 唯一；
- requirement 全部被 `fulfills` 覆盖；
- resource 引用存在、已验证且没有孤立资源；
- 三个根目录互不重叠。

Gate 失败时只返回当前事实产生的明确问题；修复原文件后重新计算。Gate 通过后直接进入 Comprehensive Review。

## 8. Reviewer 与实现

Reviewer 只审核当前 revision 的九份项目文档（八份 Foundation 文档与 Gameplay Checklist）、Manifest 和内容文件。资源 finding 必须引用现有 requirement、resource 或 content ID。Closure Review 只复查原 finding 与服务冻结的改动，不重新开放全文审计。

Atomic Task Planner 为任务声明只读的 `resourceIds` 和 `contentIds`。Implementation Agent 通过这些 ID 加载资源和内容；目标引擎的对象、导入器或构建规则留在项目实现或 target adapter 内，共享合同不规定 Web、Unity、Godot、Unreal 或其他引擎结构。

## 9. 代码收口

必须只有一条生产路径：Manifest v7、Content v1、一个资源阶段、一个门禁。旧中间对象、旧阶段、旧 worker、旧 API/UI 投影、兼容 reader、迁移器、shadow/feedback 修复队列和第二份资源事实均应物理删除。

运行时提示不得提议已删除的模型。拒绝测试可以提交非法旧字段，以证明解析器不会接受它们。

## 10. 验收

自动验证：

- 前后端类型检查；
- 资源 core/server 测试；
- Workflow 单元与集成测试；
- 前端测试；
- 生产源码残留扫描。

全新项目验证：

1. 文档与 Checklist 按顺序完成；
2. 实际浏览 Resource Library；
3. 下载至少一个适用资源；
4. 对无匹配需求创建独立 placeholder；
5. JSON 和 YAML 均真实落盘；
6. Gate 与 Comprehensive Review 通过；
7. 实现通过 resource/content ID 消费资源；
8. 在系统 Chrome 中完成实际运行交互；
9. acceptance 与 delivery 通过；
10. 测试结束后停止全部服务。

上述任一项未通过，都不能宣布方案完成。

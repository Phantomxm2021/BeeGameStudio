# BeeGame 资源与 Game Content Package 合同

坐标、锚点和父子变换的当前统一语义见 [Content 坐标约定](./content-coordinate-contract-2026-09-20.md)。文中的引擎类比不覆盖该约定。

状态：Resource Delivery、Manifest 绑定及 Scene2D/UI Content Authoring 已接入生产 Workflow。VFX、角色、动画、音频和玩法配置仍明确留在后续阶段。

## 1. 唯一流程

```text
已发布 Game IR
  -> Resource Agent 获取或制作真实资源
  -> Asset Manifest 发布资源事实
  -> Content Agent 生成 Game Content Package
  -> 目标实现 Agent 消费 Content Package 与 Manifest
  -> 目标运行时验收
```

Resource 和 Content 是两个独立阶段。资源阶段不写 Scene、UI 或玩法配置；Content 阶段不下载资源、不修改 Manifest、不写目标引擎代码。

完整实施顺序与验收计划见[引擎中立 Game Content Package 实践方案](./engine-neutral-content-package-practice-plan-2026-09-15.md)。

## 2. 权威边界

### 2.1 Asset Manifest

Asset Manifest 只记录：

- Game IR 声明的逻辑资源需求；
- 项目实际拥有的本地资源；
- 文件路径、hash、来源、许可证、依赖与验证状态；
- 资源需求到真实资源的绑定。

Manifest 不记录场景层级、位置、UI、事件、动画状态或目标引擎对象。

资源文件仍位于：

```text
assets/runtime/**
assets/generated/**
assets/asset-manifest.json
assets/manifest/**
```

旧 `assets/content/**` 不再是目标合同。生产接线切换时必须删除其 reader、writer、Prompt 和测试，不保留兼容入口。

### 2.2 Game Content Package

Content Package 位于独立根目录：

```text
content/
  index.json
  scenes/*.scene.json
  ui/*.ui.json
```

第一阶段只接受 `scene-2d`、`ui-screen`、`ui-hud` 和 `ui-flow`。未实现的 VFX、角色等类型不得以任意 `data` 冒充已支持。

这些文件不是目标引擎代码的临时输入副本，而是 Scene/UI Editor 直接加载、修改和保存的唯一可编辑权威。目标实现也直接消费同一 Package；禁止再派生第二套持久化 Scene/UI 配置。Game IR 保留规则和需求，不重复拥有完整节点树。

## 3. 根索引

`content/index.json` 使用固定 schema：

```json
{
  "schema": "beegame-content-package.v1",
  "id": "game-content",
  "dimension": "2d",
  "irRevision": "<published-ir-revision>",
  "assetManifestRevision": "<published-manifest-revision>",
  "entryScene": "scene.main",
  "files": [
    "scenes/main.scene.json",
    "ui/hud.ui.json"
  ]
}
```

根索引是唯一 package 入口。它必须列出全部叶子文件，并绑定同一项目的 IR 与 Manifest revision。不得存在未注册叶子文件或第二份索引。

## 4. 公共叶子头

所有叶子文件使用 JSON 和相同公共头：

```json
{
  "schema": "beegame-content.v1",
  "id": "scene.main",
  "kind": "scene-2d",
  "irRefs": ["world.main"],
  "assetRefs": ["asset.background"],
  "data": {}
}
```

- `irRefs` 必须解析到绑定 revision 的真实 IR node；
- `assetRefs` 必须解析到绑定 Manifest 中的 verified resource；
- `data` 只能通过 `assetRef` 使用资源，不能写资源路径、URL 或 data URI；
- 一个事实只保留一个 owner，不把完整 IR node 或 Manifest record 复制到叶子文件。

## 5. Scene2D

Scene 与 UI 永远分离。`scene-2d` 保存世界空间节点：

```json
{
  "schema": "beegame-content.v1",
  "id": "scene.main",
  "kind": "scene-2d",
  "irRefs": ["world.main"],
  "assetRefs": ["asset.background"],
  "data": {
    "cameraNodeId": "camera.main",
    "nodes": [
      { "id": "world", "kind": "group" },
      {
        "id": "background",
        "parentId": "world",
        "kind": "sprite",
        "layer": "background",
        "zIndex": 0,
        "assetRef": "asset.background",
        "transform": { "position": [0, 0], "scale": [1, 1] }
      },
      {
        "id": "camera.main",
        "parentId": "world",
        "kind": "camera",
        "transform": { "position": [0, 0] }
      }
    ]
  }
}
```

第一阶段验证：节点 ID 唯一、parent 引用闭合、层级无循环、camera 引用存在、节点资源已在公共头声明。

编辑器稳定字段为 `transform`、`assetRef` 与 `components`；移动、旋转、缩放和资源替换直接更新这些字段。

`kind` 和 `data` 表达引擎中立语义，不允许出现 React component、Unity GameObject、Godot Node 或 Unreal Actor 等目标实现类型。

## 6. UI

UI 保存屏幕空间结构，不写入 Scene 文件：

```json
{
  "schema": "beegame-content.v1",
  "id": "ui.hud",
  "kind": "ui-hud",
  "irRefs": ["presentation.hud"],
  "assetRefs": [],
  "data": {
    "rootId": "hud.root",
    "nodes": [
      { "id": "hud.root", "role": "hud" },
      {
        "id": "score",
        "parentId": "hud.root",
        "role": "status-text",
        "text": "0",
        "layout": {
          "anchor": "top-right",
          "position": [-24, 24],
          "size": [220, 48]
        },
        "bindings": { "text": "game.score.formatted" },
        "actions": { "click": "score.details.open" }
      }
    ]
  }
}
```

第一阶段验证：唯一根节点存在且无 parent、其他节点均有 parent、parent 引用闭合、层级无循环、资源引用已声明。

编辑器稳定字段为 `layout`、`assetRef`、`bindings`、`actions` 与 `style`；锚点、位置、尺寸、缩放、资源、状态绑定和动作修改直接写回这些字段。

UI 与 Scene 只能通过稳定状态、事件或锚点 ID 关联，不能互相嵌入完整节点树。

## 7. Workflow 职责

当前实现的上下文交付、预览错误处理与验收边界见 [交付耗时与正确性调整](delivery-cost-correctness-adjustment-2026-09-20.md)。早期章节中的独立 IR 前置假设不适用于当前直接文档 → 资源 → Content 流程。

实现期间的问题记录与定向修复以 [implementation-issue-repair-plan-2026-09-20.md](implementation-issue-repair-plan-2026-09-20.md) 为准：非阻塞缺陷先记后修，素材交资源修复任务，代码缺陷由实现任务处理。一次原生 CLI 任务可协调这些修复，不增加阶段或自动审计循环；资源事实与哈希仍归 Manifest，最终证据必须对应修复后的产物。

Workflow 只做：

- 向一次直接 CLI Content 任务提供已接受文档、Manifest 路径及版本；格式契约落盘后按需读取，不重复内嵌完整 Manifest；
- Content 职责为编写 `content/**`，不增加原生工具拦截；
- 保存 Content Package revision 和 digest；
- 执行 JSON、ID、版本、引用、层级和路径旁路校验；
- 将同一 Content Package 交给目标实现 Agent。

Workflow 不做：

- 固定 Agent 工具或文件操作步骤；
- 规定 Subagent、Skill 或搜索方式；
- 根据节点数量、时间或 tokens 判断内容质量；
- 自动追加审计、修订或完善轮次；
- 生成引擎对象或维护 Engine Adapter。

## 8. 正确实施顺序与完成标准

### 8.1 Resource Delivery 前置阶段

1. Resource Agent 只消费已发布 Game IR；
2. 自主搜索、选择或制作真实资源；
3. Manifest 独立保存 requirement→resource 绑定；
4. 资源通过不再依赖旧 `assets/content`；
5. 删除资源阶段的 Scene/UI 配置职责和旧 Content reader/writer。

Resource Delivery 未完成时，Content Authoring 不得启动。

### 8.2 Scene/UI Content 阶段

1. `content/index.json`、Scene2D、UI schema 与读取审计通过；
2. IR node、verified asset、入口 Scene 和节点层级引用可确定性验证；
3. Scene 与 UI 分文件、分职责；
4. 资源路径旁路被拒绝；
5. VFX 等未实现类型被明确拒绝；
6. 只接入一次直接 CLI Content Authoring 调用，不启动整游戏实现。

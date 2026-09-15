# 引擎中立 Game Content Package 实践方案

日期：2026-09-15  
状态：Scene2D/UI 唯一可编辑格式、生产 Workflow 消费、无界面读写闭环及项目 API 已实现；Scene Editor 已接入 Scene2D，UI Editor 尚未接入。

执行进度（2026-09-16）：Scene2D/UI Content Package schema、引用/层级/资源旁路校验、直接 CLI Content Authoring、生产阶段接线及下游消费均已落盘。项目 API 明确区分 `awaiting_ir`、`awaiting_assets`、`awaiting_content`、`ready` 与 `draft`，因此仅有 IR 时不会呈现一个伪造的空 Scene。Scene Editor 直接加载入口 Scene、读取同一 Manifest 中已验证且登记的图片资源，并以 revision 检查原子保存回同一份 Scene 文件；没有本地副本或第二套资源注册表。UI Editor、Spritesheet/Atlas frame 与 clip 的稳定可编辑字段，以及 VFX、角色等内容类型仍未实施。

## 1. 结论

BeeGame Studio 后续只保留一条交付主线：

```text
八文档
  -> 独立审计与修订
  -> 直接 CLI 生成 Game IR
  -> 直接 CLI 获取/制作资源并发布 Asset Manifest
  -> 直接 CLI 生成 Game Content Package
  -> 直接 CLI 按目标引擎实现
  -> 目标运行时验收
```

新增的唯一必要环节是 **Game Content Package**：它像 Unity Scene/Prefab 一样，以引擎中立配置表达场景、UI、VFX、角色、动画、音频和玩法装配关系。最终实现 Agent 读取这份配置与真实资源，在 Web React、Unity、Godot、Unreal 或其他引擎中落地。

不建设通用 Engine Adapter，不重构一个新 Agent，不规定 Agent 如何选择工具、Skill、Subagent 或代码结构。Workflow 只负责交接版本、调用直接 CLI、保存产物和做确定性校验。

## 2. 当前问题与修订范围

当前 Game IR 已能表达六个领域，但从 IR 到最终游戏仍缺少独立的、可检查的“装配规格”。Implementation Agent 目前同时承担：

1. 理解 IR；
2. 决定资源如何组合；
3. 临场设计 Scene/UI/VFX 等配置；
4. 选择目标引擎实现；
5. 编写和验证代码。

这导致三个真实问题：

- IR 是否被正确消费无法独立验证；
- 相同 IR 换一个引擎时，场景与 UI 语义可能被重新解释；
- 资源虽已进入 Manifest，代码仍可能绕过 Manifest/Registry 直接引用路径。

现有 [资源与内容描述合同](./beegame-resource-content-contract.md) 中“真实资源 + 内容描述”的方向可复用，但以下旧方案不再保留：

- 把内容配置放入 Resource Production phase；
- Resource Planner / Curator / Content Author 三个固定串行角色；
- `CommitResourceContent` 专用提交工具；
- JSON 与 YAML 按职责硬拆两套格式；
- `assets/content` 与资源目录混合；
- 由目标适配器生成游戏语义。

实施时应直接替换这些可达逻辑与文档，不保留兼容开关或双轨 reader。

## 3. 五类权威及边界

| 权威 | 回答的问题 | 不负责 |
| --- | --- | --- |
| 八文档 | 游戏应该是什么 | 文件路径、引擎对象 |
| Game IR | 文档中的玩法、世界、表现、资源需求及验收语义是什么 | 已获取资源、具体引擎实现 |
| Asset Manifest | 项目实际拥有哪些资源、文件在哪里、来源和完整性如何 | 场景布局、UI 结构、玩法流程 |
| Game Content Package | 这些玩法语义和真实资源如何装配成游戏内容 | React/Unity/Godot/Unreal 代码结构 |
| 目标实现 | 如何在指定引擎运行上述内容 | 重新发明产品语义或第二套资源身份 |

同一事实只允许一个 owner。叶子配置通过稳定 `irRefs` 引用 Game IR，通过稳定 `assetRefs` 引用 Asset Manifest，不复制完整 IR 节点或资源记录。

### 3.1 唯一可编辑权威

Game IR 只拥有玩法规则、约束、需求和验收语义；它不得再保存一份完整 Scene/UI 节点树。Game Content Package 中的 `scenes/*.scene.json` 与 `ui/*.ui.json` 是用户和 Agent 共同编辑的唯一 Scene/UI 源文件：Scene Editor、UI Editor 与目标实现读取同一份文件，编辑器保存也直接写回它们。目标实现不得再生成或维护第二份 Scene/UI 配置。

编辑器内部允许建立临时 ViewModel，但它不是持久化权威。加载返回文档 revision；保存要求该 revision 未被其他用户或 Agent 改写，并以原子替换写回，同时返回新的 Content Package revision。保存只保存编辑结果，不启动 Agent。用户明确发布该 Package revision 后，Workflow 接受新版本；已完成的实现继续有效，运行时重新加载同一份 JSON，只清除并重跑 Acceptance。仅当目标运行时尚未实现所需 schema 能力时，才由用户另行发起实现修改；不得自动重新运行 Implementation 或 Content Author。Undo/Redo 复用相同保存能力提交先前快照，不新增 changeset 协议。纯位置、缩放、布局和资源引用修改不反写八文档；越出既有规则的修改由后续影响提示交给用户决定是否修订文档。

## 4. 为什么资源在 Content Package 之前

Game IR 只声明逻辑资源需求；Resource Agent 据此搜索互联网、使用资源库或创作缺失资源，并发布真实文件与 Manifest。Content Agent 随后同时读取已发布 IR 和 Manifest，才能正确填写：

- Sprite/Atlas 的真实尺寸、frame rect、trim、pivot；
- 模型、材质、骨骼和动画 clip 的真实名称；
- 音频时长、loop point 与 cue 映射；
- 可用字体、九宫格和 UI 套件成员；
- 资源实际可支持的 Scene/VFX 组合。

资源不满足 IR 时，Resource 阶段明确报告缺口；Content Agent 不伪造路径、不自行下载替代资源，也不修改 Manifest。

## 5. Game Content Package 最小结构

第一版统一使用 JSON。采用单一格式是为了减少解析、校验和 Agent 输出分歧；这里学习 Unity 的“内容先配置、引擎后实现”思想，不复制 Unity YAML。

```text
content/
  index.json
  scenes/*.scene.json
  ui/*.ui.json
  vfx/*.vfx.json
  prefabs/*.prefab.json
  animations/*.animation.json      # 项目需要时
  gameplay/*.gameplay.json         # 项目需要时
  audio/*.audio.json               # 项目需要时
  tilemaps/*.tilemap.json          # 2D 项目需要时
```

目录按实际项目能力生成，不要求每个项目凑齐所有类型。`Scene` 与 `UI` 永远分离：Scene 负责世界空间，UI 负责屏幕空间、导航和 HUD；二者只通过稳定事件、状态或锚点 ID 关联。

### 5.1 根索引

`content/index.json` 是唯一包入口，保存：

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
    "ui/hud.ui.json",
    "vfx/player-hit.vfx.json"
  ]
}
```

版本绑定只写在根索引，叶子文件不重复。

### 5.2 叶子文件公共头

```json
{
  "schema": "beegame-content.v1",
  "id": "scene.main",
  "kind": "scene-2d",
  "irRefs": ["<world-scene node id>"],
  "assetRefs": ["asset.background", "asset.player.atlas"],
  "data": {}
}
```

公共合同只固定身份、类型、引用和数据边界。`data` 表达游戏内容语义，不暴露 React component、Unity GameObject、Godot Node 或 Unreal Actor 等引擎类型。

第一阶段把编辑器必须稳定理解的字段提升为公共结构，而不是全部塞进任意 `data`：Scene 节点明确提供 `transform`、`assetRef` 与 `components`；UI 节点明确提供 `layout`、`assetRef`、`bindings`、`actions` 与 `style`。项目特有扩展仍可留在 `data`，编辑器必须无损保留。

Scene Sprite 使用整张图片时只写 `assetRef`；使用 Spritesheet/Atlas 子区域时再写 `frameRef`。`frameRef` 必须解析到该 Manifest resource 的 `content_profile.components` 中一个 `sprite-frame` 或 `atlas-region`，其 `specs` 由 Manifest 唯一保存 `x`、`y`、`width`、`height` 像素事实。Scene 不复制这些坐标，目标实现和编辑器均通过同一引用解析。

## 6. 内容类型

### 6.1 共同类型

- `scene-2d` / `scene-3d`：世界层级、实例、空间关系、相机、灯光或图层引用；
- `prefab` / `character`：可复用实体、部件、碰撞、表现与行为挂点；
- `ui-screen` / `ui-hud` / `ui-flow`：界面树、布局、导航、状态绑定和交互事件；
- `vfx-2d` / `vfx-3d`：触发条件、时间线、发射器、材质或 Sprite 序列；
- `animation`：clip、状态、过渡、速度、循环与事件；
- `gameplay`：关卡实例所需的波次、事件、触发器和参数引用；
- `audio`：BGM、SFX、环境声、空间规则与 cue；
- `camera`、`input`、`rendering`：只在文档和 IR 明确需要时出现。

这些是内容语义，不是强制组件清单。Agent 可根据项目需要组织 `data`，宿主不替它设计游戏。

### 6.2 2D 必须可表达

2D 不是 3D schema 的删减版，第一轮 Web React 验收必须覆盖：

- Scene2D 的位置、旋转、缩放、z-order、layer、parallax、camera 和 collision；
- Sprite 的 pivot、设计尺寸或 pixels-per-unit、trim、nine-slice 和 blend；
- Spritesheet/Atlas 的 frame rect、旋转、trim、source size、pivot 和命名；
- Sprite Animation 的 frame 顺序、FPS/时长、loop、事件和状态过渡；
- Tilemap/Tileset 的网格、层、tile 引用、碰撞和装饰层；
- VFX2D 的 Sprite 序列或粒子、生命周期、颜色/尺寸曲线、混合与排序；
- 角色朝向、受击、移动、攻击等表现状态与 Gameplay 事件的连接；
- UI 的独立屏幕空间结构、HUD、弹窗、导航和状态绑定。

Atlas/Spritesheet 的二进制文件和 provenance 属于 Manifest；frame 与 clip 的使用方式属于 Content Package。

### 6.3 3D 必须可扩展

3D 至少可表达 hierarchy、transform3d、model/material、camera/light、collider、animation、audio 与 VFX 引用。第一阶段不预建完整 Unity/Unreal/Godot 类型系统；只有真实项目需求证明共享语义不足时，才扩展公共内容类型。

## 7. 各阶段的直接 CLI 工作方式

每个阶段只有一次清晰任务和一个权威产物。Prompt 使用自然语言说明目标、输入、输出目录和不可越界的所有权；不指定工具调用顺序，不强制 Subagent，不把审计 Checklist 伪装成 Agent 推理步骤，也不自动追加“继续完善”。

### 7.1 Game IR

输入：已接纳的八文档。  
任务：忠实生成精简、可追溯的六域 IR。  
输出：一个已发布 IR revision。  
边界：不获取资源、不写 Content Package、不写引擎代码。

### 7.2 Resource Delivery

输入：已发布 IR 的资源需求。  
任务：自主搜索互联网、使用资源库或创作资源，落盘真实文件，写唯一 Asset Manifest/Registry。  
输出：一个已发布 Manifest revision。  
边界：不写 Scene/UI/VFX/Gameplay 配置，不写游戏源码。

### 7.3 Content Authoring

输入：同一项目的已发布 IR + Manifest。  
任务：像游戏内容设计师一样生成完整 `content/**`，让目标引擎实现者无需重新推断装配关系。  
输出：一个已发布 Content Package revision。  
边界：不获取资源、不修改 IR/Manifest、不写目标引擎代码。

### 7.4 Target Implementation

输入：目标引擎简报 + 冻结 Content Package + 冻结 Manifest；完整 IR 仅作为只读追溯依据。  
任务：自主选择适合该引擎的工程结构、库和实现方式，完成可运行实现。  
输出：目标游戏源码。实现任务和 Acceptance evidence 直接记录其消费的 Content ID 与 Asset ID，不再新增一份 `implementation-map.json`，避免制造第二份映射权威。

### 7.5 Runtime Acceptance

输入：目标运行时、同版本 Content/Manifest/IR 和实现映射。  
任务：运行并观察真实 Scene、UI、VFX、动画、音频、交互和资源加载。  
边界：验收不修改产品文档或内容配置；发现真实问题后报告给其唯一 owner。

## 8. 宿主只做确定性校验

Workflow 允许拒绝以下客观错误：

1. JSON 或 schema 无法解析；
2. `id` 重复；
3. `content/index.json` 指向的文件不存在；
4. `irRefs` 未在绑定的 IR revision 中解析；
5. `assetRefs` 未在绑定的 Manifest revision 中解析或资源未验证；
6. Content Package、IR 和 Manifest 版本混用；
7. 内容配置绕过资源 ID 写本地路径、远程 URL 或 data URI；
8. Implementation 或 Acceptance 使用的 Content ID 与已接受 receipt 不一致。

Workflow 不判断审美、不规定节点数量、不替 Agent 选择组件、不重写 Prompt、不按关键词推断完成，也不设置 token、时间墙、修订轮数或“足够复杂”上限。用量和耗时只记录，不作为业务正确性门禁。

## 9. 最小落地步骤

### P0：冻结单轨合同

- 以本文替换旧 `assets/content` 所有权、双格式和固定三 Agent 方案；
- 冻结 `content/index.json` 与叶子公共头；
- 明确 Scene/UI 分离和 2D 首验范围；
- 审计生产可达代码，列出要删除的旧 reader、prompt、tool 和测试。

完成标准：仓库只描述一条目标流程，不把旧实现当兼容方案保留。

### P1：先修正 Resource Delivery（已完成）

- Resource Prompt 只负责根据已发布 IR 自主搜索、选择或制作真实资源；
- Asset Manifest 独立保存 requirement、真实 resource、provenance、hash、验证状态及 requirement→resource 绑定；
- 从资源阶段删除 Scene/UI/VFX/Gameplay 配置职责、旧 `assets/content`、资源内容 reader 和 `CommitResourceContent`；
- 资源通过标准只依赖 IR、Manifest 与真实文件，不再要求 Content 文件先存在；
- 删除只服务旧资源内容轨道的生产代码和测试，不保留 fallback 或兼容开关。

完成标准：给定固定 IR，Resource Agent 能独立发布包含真实资源绑定的有效 Manifest；项目中不存在可达的资源阶段 Content 写入路径。

### P2：实现 Scene/UI Content Package 独立阶段（已完成）

- 只有 P1 发布有效 Manifest 后，才允许启动 Content Authoring；
- 在现有阶段框架中增加一个 `GAME_CONTENT` 阶段，位置固定为 Resource Delivery 之后、Implementation 之前；
- 一次直接 CLI 调用读取冻结 IR + Manifest，只写 `content/**`；
- 第一批只生成 `scene-2d`、`ui-screen`、`ui-hud` 和 `ui-flow`；
- 接入已经落盘的 schema、引用校验、revision/digest receipt 和只读 consumer；
- 阶段内部只保留调用、结果发布、停止和错误透传，不引入专用 Agent runtime、原子任务规划器或 Engine Adapter。

完成标准：给定同版本 IR 与 Manifest，可单独生成、验证、发布并重新读取同一 Scene/UI Content Package；资源引用全部指向 verified Manifest resource。

### P3：切换下游消费者（已完成）

- Implementation Prompt 以 Content Package 为主要装配依据，以 Manifest 为唯一资源事实；
- 目标运行时启动时直接读取 `content/index.json` 及其 Scene/UI 叶子文件，不把可编辑值复制进源码或第二份生成配置；
- Acceptance 对同一批 Content ID 与 Asset ID 逐项记录运行证据；
- 更新 IR 接入计划和交付架构文档，避免文档继续指向旧阶段；
- 扫描并删除所有 fallback、feature flag、双写和第二入口。

完成标准：实现阶段无法在缺少有效 Content receipt 时启动，也没有路径可以绕过新阶段或恢复旧 Content 轨道。

### P4：Web React 2D 小测试

用全新项目，只构建一个 Scene + 一个独立 UI + 一个 VFX 小案例，不扩张成完整游戏：

- 场景包含背景/层级、角色或交互物、相机与碰撞；
- 至少一个真实 Sprite 或 Spritesheet，经 Manifest 注册；
- 至少一个 Sprite Animation 或 VFX2D 时间线；
- UI 独立于 Scene 文件并订阅一个游戏状态；
- React 实现通过 Registry 加载资源，不硬编码路径；
- Chrome 中观察视觉、层级、动画、交互和网络/控制台错误。

逐阶段记录：总耗时、模型生成时间、等待时间、调度时间、输入/输出 tokens、工具行为和产物摘要。禁止用时间或 tokens 上限提前终止。

完成标准：IR → Manifest → Content Package → React 实现的引用链可逐项追溯；运行结果与 Content Package 一致，资源无旁路，视觉不是任意 placeholder。

### P5：跨引擎能力证明

不立即建设第二套完整游戏。先用同一份 2D Content Package 做一次第二目标的实现可行性审查；另做一个最小 3D schema fixture。只有真实差异无法由实现 Agent 消化时，才补充引擎中立字段。

完成标准：任何新增公共字段都能指出一个已复现的跨引擎语义缺口，不能只是为了预留能力。

## 10. 验收指标

### 结构正确性

- 所有引用闭合且绑定同一版本；
- Scene、UI、VFX、资源和实现职责没有互相写入；
- 项目中不存在第二套 Manifest/Registry 或可达旧 Content 流程；
- Content 配置中不存在资源路径旁路。

### 语义与产物质量

- Content Package 能独立回答“场景中有什么、如何摆放、何时触发、使用什么资源”；
- 2D Sprite/Spritesheet/Animation/VFX/Tilemap 能按项目实际需求表达；
- Implementation Agent 无需重新从八文档猜测 Scene/UI/VFX 装配；
- 浏览器结果在构图、层级、动效、交互和 UI 可读性上符合八文档，而非只达到可运行。

### Agent 自主性

- Prompt 只给目标、权威输入、产物和所有权边界；
- Workflow 不指定 Agent 的思考过程、工具、搜索顺序或代码架构；
- 没有自动审计—修订循环、固定 finding 分类或隐式续跑；
- 失败日志能区分模型生成、工具执行、等待、调度和授权问题。

## 11. 明确不做

- 不制作 Unity/Godot/Unreal/Web 的通用 Engine Adapter；
- 不用 schema 复刻任何引擎的完整对象模型；
- 不建立新的多 Agent 编排框架；
- 不为每种资源或每个 IR node 创建一个任务；
- 不同时保留旧 `assets/content` 与新 `content`；
- 不把 Content Package 变成第二份八文档或第二份 Game IR；
- 不在首轮测试中构建完整玩法和完整工程；
- 不以旧流程的行为或测试数量作为正确性标准。

## 12. 最终完成定义

本方案只有在以下条件全部满足时才算落地：

1. 单轨生产代码、合同和文档一致；
2. 旧 Content 生产和 Engine Adapter 残留已删除；
3. 新 Web React 2D 小项目完整跑通；
4. Scene、UI、VFX、Sprite/Spritesheet 等配置确实由直接 CLI 从 IR + Manifest 生成；
5. 实现代码确实消费 Content Package 与 Registry，而非绕过；
6. Chrome 运行验收通过，并有时间、tokens、等待、调度和资源 provenance 证据；
7. 未通过的质量问题被如实记录，不用 schema 通过或测试绿替代真实视觉与行为质量。

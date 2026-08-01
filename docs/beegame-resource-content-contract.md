# BeeGame 资源与内容描述合同

## 1. 目的

BeeGame 按人类游戏开发者的常规方式处理资源：先获得真实资源文件，再用少量 JSON/YAML 描述这些资源如何被游戏使用，最后由目标运行时加载或构建。

系统不把“组装过程”提升为持久化领域对象，不创建 `cmp-*` 身份，也不存在一个 requirement 对应一个 Composition 的中间层。

唯一流程是：

```text
基础文档审计
  -> 下载或创作真实资源文件
  -> 编写 JSON 资源映射、事件与波次，以及 YAML 世界/场景描述
  -> 资源与内容门禁
  -> 实现玩法并消费语义 ID
  -> 目标运行时验收
```

## 2. 权威文件

### 2.1 `assets/asset-manifest.json`

Asset Manifest 只记录项目实际拥有的资源，不描述场景布局、事件流程或玩法行为。

```json
{
  "version": 7,
  "project_target": {
    "runtime_asset_root": "assets/runtime",
    "content_root": "assets/content",
    "generated_asset_root": "assets/generated",
    "resource_library_usage": "required",
    "asset_format_capabilities": ["png", "svg", "glb", "wav", "json", "yaml"]
  },
  "requirements": [],
  "resources": []
}
```

Manifest 不包含：

- `compositions`；
- `imports`、slots、selection receipt、no-match 或 fallback；
- 场景位置、旋转、缩放或事件逻辑；
- 构建步骤、目标引擎对象或运行时验收状态；
- Agent 自述式验证文字。

这三个根目录和 `resource_library_usage` 都由 Workflow 根据系统合同与确认简报写入，Agent 不能提交、改写或降级它们。

### 2.2 `assets/content/**/*.json`

JSON 用于机器稳定读取的资源映射和数据定义，例如：

- 实体与资源映射；
- 动画状态映射；
- UI、字体和音频 cue 映射；
- 事件、触发器与波次；
- 玩法参数表；
- 资源尺寸、pivot、骨骼、动画、循环点等适配信息。

合法 `kind` 只有：`resource-registry`、`entity-definitions`、`ui-configuration`、`audio-configuration`、`event-definitions`、`wave-definitions`、`numeric-configuration`。

### 2.3 `assets/content/**/*.yaml`

YAML 用于更适合人类与 Agent 编排的结构：

- 世界与场景结构；
- 场景实例、层级、位置、旋转和缩放；
- 场景对象的空间组织。

合法 `kind` 只有：`world-definition`、`scene-definitions`、`hierarchy-definition`、`placement-definitions`。

JSON 与 YAML 不保存同一事实。每项数据必须只有一个 owner；禁止为兼容而同时维护两份映射。

### 2.4 `assets/generated/**`

仅存放目标构建工具生成的资源，例如字体编译结果、音频转码结果、图集或引擎导入产物。该目录可删除并重建，不是权威输入，也不产生第二套资源身份。

## 3. 内容文件公共头

每个内容文件包含最小公共头，业务数据位于 `data`：

```yaml
schema: beegame-content-v1
id: main-scene
kind: scene-definitions
fulfills:
  - IMG.SCENE.COAST_NIGHT
resources:
  - coast-background
  - lighthouse-model
data:
  instances: []
```

```json
{
  "schema": "beegame-content-v1",
  "id": "game-audio",
  "kind": "audio-configuration",
  "fulfills": ["SFX.WEAPON.HIT", "BGM.PHASE"],
  "resources": ["weapon-audio-bank", "phase-music-bank"],
  "data": {}
}
```

公共头只提供确定性审计所需的身份和引用。`data` 的具体结构由项目文档与目标运行时决定，不能在共享合同中绑定 Web、Unity、Godot、Unreal 或其他引擎概念。

同一内容文件应表达一个完整、可消费的领域单元。禁止按 requirement 机械拆成一文件一职责；一个文件可以覆盖多个 requirements，一个资源也可以被多个内容文件复用。

## 4. 资源模型

资源是项目本地一个独立、可替换的真实文件根，可以来自 Resource Library，也可以由 Agent 创作。

### 4.1 Resource Library 资源

必须保留 Pack ID、版本、element ID、依赖闭包、本地路径与完整性信息。

### 4.2 Agent 创作资源

必须：

- 位于 `runtime_asset_root` 或 `generated_asset_root`；
- 是独立文件，不隐藏在玩法源码中；
- 标记 `provisional: true` 时仍然可被目标工具加载或构建；
- 与正式资源使用相同的语义 ID 和内容描述接口。

程序资源可以存在，但必须是独立文件，并由目标资源构建器产生普通媒体或引擎可加载产物。构建器不是 Composition Worker，也不创建持久化 `cmp-*` 记录。

## 5. 替换规则

资源替换优先保持语义资源 ID 不变。可以：

1. 直接替换同一路径文件；或
2. 修改 Asset Manifest 中该资源的文件路径；
3. 当尺寸、pivot、单位、骨骼、动画名、循环点等发生变化时，只修改对应 JSON/YAML 描述；
4. 重新执行资源门禁和目标运行时验收。

仅替换兼容资源时，玩法代码不得变化。

## 6. Workflow 所有权

### Resource Agent

- 浏览资源库并选择、下载真实资源；
- 为缺失内容创建独立 provisional 文件；
- 编写或修订 `assets/content/**/*.json|yaml`；
- 调用目标资源构建器生成必要的可丢弃产物；
- 不写玩法代码。

### Resource service

- 提供 Catalog、精确下载、依赖、provenance、路径和完整性事实；
- 不选择美术适用性，不自动绑定 requirement。

### Workflow service

- 是 Asset Manifest 的唯一写入边界；
- 确定性解析 JSON/YAML 公共头；
- 验证 requirement 覆盖、资源引用、路径和格式；
- 不创建中间 Composition 状态机。

### Implementation Agent

- 读取内容描述并通过语义 ID 消费资源；
- 编写目标运行时加载器、玩法、表现与交互；
- 不下载资源、不修改 Asset Manifest、不生成替代媒体。

### Validator

- 在真实目标运行时验证资源加载、场景、事件、动画、音频和玩法；
- 验收事实属于当前运行 evidence，不回写为另一套资源状态。

## 7. 资源与内容门禁

进入实现前必须满足：

1. 每个 required requirement 至少被一个内容文件公共头覆盖；
2. 每个内容文件引用的 resource ID 都存在且 verified；
3. 每个保留 resource 至少被一个内容文件引用；
4. 所有资源文件与依赖真实存在，路径不越界；
5. JSON 可解析，YAML 使用安全 schema 且禁止重复键；
6. 内容文件 ID 唯一，资源 ID 唯一，requirement ID 唯一；
7. provisional 与正式资源采用相同引用方式；
8. 不存在源码内嵌的可替换媒体；
9. 不存在 `cmp-*`、Composition Manifest、第二资源库存或兼容 reader；
10. Resource Library 为 required 时，至少存在一项真实、完整 provenance 的导入资源。

门禁只验证结构事实。美术适配、场景合理性和事件一致性由 Reviewer 审计，真实加载与行为由 Runtime Acceptance 验证。

## 8. 引擎中立性

共享合同只认识资源文件、JSON/YAML 内容描述和可丢弃生成目录。

- Web 可以读取 JSON/YAML 后生成模块或运行时对象；
- Unity 可以由 Editor importer 生成 Scene、Prefab 或 ScriptableObject；
- Godot 可以生成 `.tscn`、`.tres` 或运行时节点；
- Unreal 可以生成 Level、Blueprint 或 Data Asset；
- 自研引擎可以生成自己的资源包。

这些输出属于目标适配器，不进入共享 Manifest schema。

## 9. 明确删除

- Manifest `compositions`；
- `COMPOSITION_ASSEMBLY` phase；
- `composition-assembler` worker；
- `composition-stage.ts`；
- `cmp-*` 任务和前端展示；
- composition output、member、status、evidence 与 replacement graph；
- Implementation 的 composition ID/output binding；
- 描述性 `composition.json`；
- 固定 WOFF2、TSX、Prefab 或特定引擎输出的共享层规则；
- 旧版 reader、migration、feedback、shadow、fallback 与双轨测试。

本项目处于开发阶段，不保留旧 Manifest 的运行时兼容。

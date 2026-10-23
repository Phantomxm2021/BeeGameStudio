# BeeGame 资源与 Scene/UI 数据合同

2026-09-21 修订。替代早期 IR 前置、Scene node.kind 和 Content v1 索引示例，不做猜测式兼容或自动项目迁移。

## 职责

**BGS 定义数据并提供编辑器；Agent 选择技术，编写数据加载、解析及游戏代码。不是 BGS 游戏引擎。**

- Resource：素材文件、图集/Tile 定义、Manifest 的来源、引用、hash 与状态。
- Content：Scene/UI/VFX 的组成、实例布局和配置。
- Scene/UI Editor：同一数据的编辑、保存、撤销；编辑器渲染实现不成为游戏依赖。
- Implementation：读取同一 Content 和资源；允许可重建的目标技术产物，不维护第二份独立布局。
- Workflow：提供上下文、检查结构与引用、记录产物版本。不增加阶段或限制 Agent 工具、创意、引擎选择。

当前输入是已接受设计文档 → Resource → Content → Implementation，不要求旧版独立 IR 前置。

## 文件与版本

只用 JSON，不同时维护 YAML。沿用现有入口：

- `assets/asset-manifest.json` 与 `assets/manifest/{requirements,resources}/*.json`：Manifest v9。
- `assets/runtime/**`、`assets/generated/**`：素材和资源定义。
- `content/index.json`：`beegame-content-package.v2`，`sceneModel: "game-object-v2"`。
- 叶子：`beegame-content.v1`；kind 为 `scene-2d|scene-3d|ui-screen|ui-hud|ui-flow|vfx`，分别放在 scenes/ui/vfx 目录。

索引声明 `id, dimension, documentRevision, assetManifestRevision, entryScene, files, sceneModel`；files 是 content 相对路径。revision 对应接受的文档和资源版本。

叶子声明 `schema,id,kind,assetRefs,data`。引用指向 Manifest 中 verified 的资源；多文件资源使用明确 member。路径必须登记且在项目内，不用 URL、绝对路径或内嵌字节绕过资源身份。

## Scene 与 UI

Scene 使用稳定节点 ID、parentId、父局部 Transform 和具有稳定 ID 的组件。组件类型来自实际 schema 的闭集，不把树、HUD、警觉槽等业务名称当渲染器。自定义行为说明保留在既有 node.data.behaviors。

UI 保留当前 UI role、layout、style、bindings、actions，不为名称像 Unity 而重写。根为 screen-root/hud-root/flow-root，不能使用旧 status-text/hud 示例角色。精确词汇见生成的 authoring format。

坐标、单位、旋转、pivot、UI anchor 的唯一解释见[坐标约定](./content-coordinate-contract-2026-09-20.md)。2D +Y 向下、逻辑像素；3D +Y 向上、米。父变换继承一次；图集矩形使用图片像素，显示尺寸不等于图片分辨率。

## 矩形 Tilemap

借鉴 Unity 的 Grid/Tile/Tilemap 职责，不复制 Unity YAML 或内部对象。首批仅正交矩形 2D；不包含等距、六边形、规则自动铺设。

| 所属 | 必填 | 可选与默认 |
| --- | --- | --- |
| Grid data | schema=`grid.v1`、cellSize=[正数,正数] | cellGap=[0,0]；enabled=true |
| Tilemap data | schema=`tilemap.v1`、gridNodeId、cells | tileAnchor=[.5,.5]；collisionEnabled=false；member=资源 root_path；enabled=true |
| TilemapRenderer data | schema=`tilemap-renderer.v1` | sortingOrder=0（整数，越大越前）；enabled=true |
| TileSet 资源 JSON | schema=`beegame-tileset.v1`、tiles（tileId→定义） | 空集合有效 |
| 每个 Tile | sprite、size=[正数,正数] | pivot=[.5,.5]；offset=[0,0]；collision 无 |
| sprite | assetRef、member=已登记图片的完整项目相对路径 | atlasMember 与 frame 必须同时提供 |

Tilemap.assetRef 引用 TileSet；同节点必须有 TilemapRenderer。gridNodeId 明确指向自身或祖先 Grid。严格版本化，拒绝未定义字段、重复格子、缺失 Tile/帧，不静默解释旧 Tilemap。

- cells 是稀疏列表，例如 `[{x:-1,y:0,tileId:"ground"}]`。整数可为负，同层坐标唯一；空格省略，不创建大量 Sprite 节点。
- 不同层用不同 Tilemap 节点；同层按 y、x 升序绘制。格子在 Tilemap 局部空间，Grid 提供规格。
- Tile pivot 位置 = cell × (cellSize + cellGap) + cellSize × tileAnchor + offset。
- Tile 左上角 = pivot 位置 − size × pivot。size 为逻辑像素，树冠可以大于格子。
- atlasMember 属于 sprite.assetRef 的同一资源，frame 指定命名帧。格式：`frames: {ground:{frame:{x:0,y:0,w:32,h:32}}}`。拒绝 rotated/trimmed，不猜文件名。
- collision 可包含 points（至少 3 个相对 Tile pivot 的二维点）、mode（solid/trigger/one-way）；one-way 还要求非零 normal。collisionEnabled=true 才启用。Agent 决定目标物理实现；编辑器仅显示轮廓。
- TileSet 是既有 Manifest 的 data 资源，不新增注册库，也不保存 Scene 格子布局。普通图片不增加 JSON 包装。

字段示例由 `tilemap-authoring-contract.ts` 同时提供给资源与内容任务，并由测试验证。Implementation 自行映射目标技术，无需导入 BGS 包。

重复网格环境优先评估 Tilemap，是否采用由 Agent 判断；角色、自由装饰、机关、非网格背景不强制使用。

## 编辑器图片加载

- Tilemap 加载链：Scene 的 Tilemap.assetRef → Manifest 的 TileSet JSON → tiles[tileId].sprite.assetRef/member → 图片；使用图集时再按 atlasMember/frame 取精确矩形。独立图片不需要图集 JSON；TileSet 可以跨图片资源复用 Tile。
- 地图保存的是 cells 与 Tile 引用，不是一张空白大图上的像素，也不为每格创建独立 Sprite 节点。Tilemap 属于 Scene；UI 图标、面板通过自己的 image/member/frame 引用图片。
- Scene/UI 均支持完整图片路径；同名文件不互相覆盖。已有短 member 只在资源内无歧义时解析。普通 Sprite/UI 现有图集规则是同目录、同文件名的 JSON，Tilemap 使用显式 atlasMember，不猜名称。
- TileSet 的间接图片/图集缺失或请求失败会阻止 Scene 以“加载成功”状态打开；报错指出具体 Tile 与路径。图片解码/帧越界仍需实际图像验证。
- 资源/内容 Agent 已获得同一 authoring contract；Implementation 的实际 dispatch 会交接该合同路径。游戏侧由 Agent 使用所选技术加载同一数据，不自动获得 BGS 编辑器的渲染代码。

## 验证和限制

- 现有资源/内容验收检查结构、资源身份、路径、图集和格子引用。
- 编辑器提供 Tile Palette：Active Target 指定 Tilemap，选择真实图集帧；支持 Paint（B）、Erase（D）、Pick（I，拾取后回到 Paint）、Box Fill（U）。拖动先预览，松手整笔提交一次 Undo/Redo；Escape、失焦、切换目标取消未提交笔画。保存仍只修改 Tilemap.cells，不改资源或生成游戏引擎代码。
- 这是 Unity Tile Palette 工作方式的矩形网格子集，不是 Unity 文件格式/全功能兼容；尚无多格印章、Flood Fill、Tile 选区移动、旋转/翻转及 Rule Tile。
- PNG 图集边界可由后端读头部检查；其他格式仍需解码验证。编辑器检查实际图片尺寸，结构检查不能代替视觉验收。
- 静态 Scene PNG 工具支持矩形 2D Tilemap，按图片/命名帧、Grid、Tile 锚点和父级变换绘制；缺失或无法解码的资源明确失败。它只是诊断快照，不是游戏运行时或玩法验收，不应要求 Agent 为预览限制改坏合法 Content。
- 结构通过不代表玩法、性能或游戏交付通过；新项目测试由用户安排，付费复测暂缓。

实施与验证进度见[落地方案](./scene-ui-data-contract-plan-2026-09-21.md)。不改已有示例项目，不引入游戏 renderer、game loop、物理或运行时资源管理模块。

# 贪吃蛇 技术设计文档（TECHNICAL_DESIGN）

- 版本：v1.0（经统一评审修订，为实现与验收基线）
- 作者：Bee Game Studio
- 日期：2026-09-30
- 目标平台：Web（React，2D，风格化美术）
- 文档语言：中文
- 上游基线：`docs/GDD.md`（玩法权威）、`.beegame/delivery/content-format.json`（内容数据契约权威）

---

## 1. 目的与范围

本文规定贪吃蛇首发版本的运行时技术选型、模块职责、数据流、内容数据消费方式、布局取景适配与工程约束，作为后续 UI_UX_SPEC、ASSET_PLP（美术/音频内容管线）与实现计划的技术接口基线。

本文不重复 GDD 的玩法论证，不替代数值平衡，也不把尚未决定的产品决策提前固化。文中所有"建议"均可在不改变既定行为的前提下由实现阶段调整；标注为"已定"的参数与约定不得改动。

## 2. 已确定的技术基线（不得改动）

| 类别 | 参数 |
|---|---|
| 网格 | 20×20 正方形正交网格；`cellSize = [32, 32]` 逻辑像素，`cellGap = [0, 0]`；棋盘参考尺寸 640×640 |
| 初始蛇形 | 3 节水平排列：蛇头格坐标 (10,8)，身体 (9,8)、(8,8)；初始朝右 |
| 步进节奏 | `stepsPerSec = min(6 + 0.25 * n, 14)`，n = 本局已吃食物数；进食后下一步起生效 |
| 计分 | 每个食物固定 10 分；持久化历史最高分与静音开关到浏览器 localStorage |
| 相机 | 正交；`coordinateSpace = logical-pixels`；`orthographicSize = 320`；参考 viewport 640×640；`framing = letterbox` |
| 取景（设计态已验证） | 游戏视图 1280×656 → 正方形视图 656×656，宿主内 x=312；游戏视图 390×784 → 390×390，y=197 |
| HUD 预留 | 顶条高度桌面约 64px、竖屏约 60px，最终以 UI_UX_SPEC 为准 |
| 输入 | 键盘/鼠标 + 触控（滑动手势与屏幕按钮并存，细节待定） |
| 内容契约 | `content/index.json`（schema `beegame-content-package.v2`，`sceneModel = game-object-v2`）；场景 kind `scene-2d` |

坐标约定（摘自内容契约，运行时必须遵守）：

- 2D 场景：左上角原点，+X 向右、+Y 向下，距离为逻辑像素；Z 仅表示深度/绘制先后。
- Transform 为父节点局部坐标，层级变换只组合一次（parent * translation * rotation * scale）；旋转角为弧度，2D 平面内正值为顺时针。
- Sprite pivot 只偏移渲染几何体，不偏移 GameObject 及其子节点/碰撞体。
- UI：屏幕空间左上角逻辑像素；根节点的 referenceResolution 是设计参考而非宿主窗口尺寸，屏幕根按实际 viewport 解析；anchor/pivot 为归一化 [x,y]，`layout.position` 是相对 anchor 的父级局部偏移；子节点 pivot 默认与 anchor 相同。
- 相机适配只改变呈现，不改变作者态世界布局；屏幕 UI 适配与世界相机取景相互独立。

## 3. 运行时技术选型与模块职责

### 3.1 技术形态

- 应用框架：React（负责装配、界面流转、界面控件）。
- 世界渲染：建议使用命令式渲染器（canvas2d 或 WebGL 封装均可）驱动蛇/食物/棋盘，渲染器实例通过 React ref 持有；避免把每步变化的蛇身 transform 放入 React state 引发高频 reconciliation。
- React 组件树只承载：启动/加载/错误外壳、HUD、开始/暂停/结算覆盖层、屏幕按钮与触控层。
- 不引入重型游戏引擎、不自建"框架层"；允许使用内容契约提供的可选解析/取景 helper，但数据语义不以 helper 存在为前提。

### 3.2 模块划分

| 模块 | 职责 | 不允许做的事 |
|---|---|---|
| ContentLoader | 加载 `content/index.json`；按 documents 注册表先取 startup、按需取 on-demand；解析场景/UI/VFX 文档；加载 `assets/asset-manifest.json` 并解析资源 | 不得猜测未注册路径；不得把解析出的字段丢弃 |
| InputManager | 键盘/鼠标、滑动手势、屏幕按钮统一转成意图（Intent）；负责按键映射、手势识别、preventDefault | 不直接移动蛇；不自行裁决方向合法性 |
| GameStore | 持有全部局内/局外状态（见 5.1）；提供显式状态转换入口；不依赖模块初始化顺序 | 不包含 DOM/timer 逻辑 |
| RuleEvaluator | 纯函数式步进裁决，严格按 GDD 5.3 顺序执行；产出事件（进食、死亡、填满、新纪录） | 不读取输入设备、不直接播放音频 |
| StepClock | requestAnimationFrame + 累积时钟驱动离散固定步长；暂停冻结；后台标签保护 | 不做玩法判断 |
| ScenePresenter | 消费场景文档（层级、transform、组件、相机、Tilemap）构建世界；按状态驱动蛇/食物节点 transform；执行相机取景 | 不维护第二套布局常量 |
| UIPresenter | 消费 UI 文档，按 anchor/container/响应式变体在屏幕空间布局；绑定状态到文本/可见性；把控件交互回传为意图 | 不用 CSS/引擎布局替换作者态布局 |
| AudioManager | 订阅玩法/界面事件，按事件播放音频；处理浏览器自动播放策略 | 不在未解锁时强行播放 |
| Persistence | 历史最高分与静音开关读写及降级（见第 8 节） | 不持久化任何局内状态 |

### 3.3 信息流

```
键盘/鼠标/触控
      │ 原始事件
      ▼
InputManager ── Intent(Turn:Up/Down/Left/Right | Command:Start/Pause/Resume/Restart/Quit)
      │
      ▼
GameStore（按当前 phase 决定是否接受：非 playing 的转向一律不入队）
      │  playing 时
      ▼
StepClock（rAF + 累积时钟，间隔 = 1/stepsPerSec）
      │ 每个步进时刻
      ▼
RuleEvaluator（GDD 5.3 顺序：朝向→目标格→食物判定→碰撞→提交移动/计分/刷食物/重估节奏→填满判定）
      │ 新状态 + 事件(ate/died/board-full/new-record/ui-*)
      ├──────────────► GameStore（状态提交，唯一写入点）
      ├──────────────► ScenePresenter（状态→节点 transform/可见性）
      ├──────────────► UIPresenter（分数、面板、破纪录标识）
      └──────────────► AudioManager（事件化音效）

启动/重开/退出命令：GameStore → 同步通知 ScenePresenter / UIPresenter / StepClock / Persistence，
所有通知按显式调用顺序发出（见第 10 节），不存在"靠 mount 顺序碰巧生效"的路径。
```

## 4. 内容数据：谁加载、如何消费

### 4.1 索引与加载责任

1. 应用引导时只发起一个关键请求：`content/index.json`。其 `documents` 数组是运行时加载注册表：
   - `entryScene` 指向的场景文档与首屏交互所需 UI 文档标记为 `startup`，最先并行加载；
   - 其余界面/特效标记为 `on-demand`，仅在进入对应流程时加载。
2. 每个 `index.files` 条目必须在 `documents` 中恰好注册一次；路径相对 `content/`。
3. 文档与资源之间通过 `assetRef` 关联，`assetRef` 必须在文档 `assetRefs` 中列出且解析到 Manifest 中 `status: verified` 的资源；多文件资源用 `data.member` 指定精确文件；图集帧用 `data.frame` 指定大小写精确的帧名。
4. 派生物（编译/打包产物）允许存在，但源数据变更经重建后必须传播；派生物不是可编辑权威。

### 4.2 作者态决策如何被运行时消费

- 节点层级、`parentId`、`enabled`、`transform`（position/rotation/scale）、`zIndex`/`layer`、组件类型与 data，均由 ScenePresenter 原样消费；UI 的 anchor/stretch/container/responsive/style 均由 UIPresenter 按契约公式解析。
- 运行时可以更新状态与 transform，但不得替换作者态默认值；若作者数据无法表达目标布局，应回到内容数据中修正，而不是在代码里静默忽略布局字段。
- 代码中禁止出现与作者数据重复的布局常量（棋盘尺寸、格距、节点位置、配色尺寸、面板大小等）。玩法数值（20×20、初始蛇形、节奏曲线、分值）允许且仅允许放在**一个项目自有的共享调参 JSON** 中（内容契约 rules 允许 content/ 之外的项目自有 JSON），由运行时加载；`cellSize/cellGap` 属于场景 Grid 组件的作者态数据，不在该文件中重复。

### 4.3 建议的 2D 场景节点构成

建议场景文档（id 由后续批次确定，下称 arena 场景）包含：

1. **Camera 节点**：`camera` 组件，`orthographic: true`、`coordinateSpace: "logical-pixels"`、`orthographicSize: 320`、`viewport: {width:640, height:640}`、`framing: "letterbox"`。建议 `pixelsPerUnit = 1`，使逻辑像素与单位一一对应（可见高 = 2×320 = 640）。相机位置/朝向按引擎导入约定摆放，使 640×640 取景恰好覆盖棋盘 0..640。
2. **Board 根节点**：作者态 transform 定位棋盘（建议 [0,0,0]）；其下或本节点挂 **Grid 组件**（`schema: grid.v1`，cellSize [32,32]、cellGap [0,0]）。若使用 Tilemap，该节点即为 `gridNodeId` 指向的节点。
3. **背景棋盘层**：
   - 建议方案：**Tilemap 节点 + 同节点 tilemap-renderer**，`gridNodeId` 指向 Grid 节点，cells 为 20×20 稠密格（两种 tileId 组成棋盘格），TileSet（`beegame-tileset.v1`）注册为 Manifest 数据资源，瓦片 sprite 走资源 + 图集帧映射。理由：棋盘是契约明确建议使用 Tilemap 的重复性网格环境，单元格改色/改图只需改作者数据。
   - 边界墙视觉可用同一 Tilemap 的墙 tileId（x=-1、x=20、y=-1、y=20 环带，负坐标契约允许）或独立边框 sprite 节点；两种方式均合规，由 ASSET_PLP 与美术方向决定。
   - 备选方案：单张 640×640 棋盘背景 sprite。若最终美术为整幅手绘底板而非重复瓦片，则该方案更直接；Tilemap 是"Agent decides"项，不使用时需在实现说明中记录原因，但不构成契约偏离。
4. **食物节点**：GameObject + `sprite-renderer`（assetRef/frame 指向食物图），`semantic: ["food"]`，作者态放在任意合法格作为默认值；开局/每步刷新由运行时写 transform。
5. **蛇节点**：
   - 蛇头节点：`semantic: ["snake-head","player"]` + sprite-renderer；
   - 两个初始蛇身节点：`semantic: ["snake-body"]` + sprite-renderer；
   - 作者态位置与初始状态一致（格心像素 = cell×(cellSize+cellGap) + cellSize×0.5）：蛇头 (336,272)、身体 (304,272)、(272,272)。
   - 增长时由运行时**克隆作者态蛇身节点**（组件、assetRef、frame、pivot 全部继承）生成新节，置于动态层父节点下；重开时销毁/回收超出初始 2 节的克隆体。克隆是运行时实例化行为，不是第二份作者布局。
6. 绘制先后：棋盘（zIndex 0）＜ 食物（10）＜ 蛇身（20）＜ 蛇头（30）；同层按文档顺序。
7. 玩法标识只用 `node.semantic`；运行时玩法元数据（若需要）放 `node.data.behaviors`（稳定 id/kind/config）；禁止 script 类组件。

### 4.4 状态到 transform 的绑定

- ScenePresenter 每次状态提交后，将逻辑格坐标映射为动态层父节点下的局部位置：
  `p = [gx*(cellSize+cellGap) + cellSize/2, gy*(cellSize+cellGap) + cellSize/2, z]`
  其中 cellSize/cellGap 从场景 Grid 组件数据读取；pivot 仅偏移渲染几何。蛇头朝向不通过旋转表达时，可直接使用四方向对应帧（由 UI_UX/美术约定）；若使用旋转表达，需按 y-down 平面弧度约定。
- 蛇身各节按 GameStore 的节序数组逐节定位；逻辑格位严格离散。呈现层允许对相邻格做不跨越步进裁决时刻的短补间（规则与边界见第 13 节）；暂停或死亡瞬间立即吸附到当前逻辑格。
- 节点 enabled 与作者态默认一致：暂停覆盖、结算面板等通过 UI 文档节点的 enabled 子树控制；禁用节点压制整棵子树。

### 4.5 UI 文档与绑定契约（建议命名，后续批次沿用）

- 建议文档构成（id/loadPhase 由 UI_UX_SPEC 最终确定）：开始界面（ui-screen 或 ui-flow 的 flow-screen）、HUD（ui-hud）、暂停覆盖层、游戏结束覆盖层。体量小，可全部 startup；若拆分则覆盖层可 on-demand。
- 绑定键（`bindings`）建议：`score`、`highScore`、`newRecord`、`phase`、`endReason`（wall/self/board-full）。
- 动作名（`actions`）建议：`start`、`pause`、`resume`、`restart`、`quit`、`turn-up`、`turn-down`、`turn-left`、`turn-right`。
- UI 角色只用 `uiVocabulary.roles` 闭集；根角色与文档 kind 对应；assetBacked 角色必须带 node.assetRef。
- UI 树中需有一个可测量的**游戏视图区域节点/宿主元素**（HUD 顶条之下），ScenePresenter 的相机取景以该区域的实际矩形为输入（见第 7 节）。

## 5. 游戏状态与步进裁决

### 5.1 状态机（对齐 GDD 第 6 节）

GameStore 的 phase 闭集：`loading → start → playing ↔ paused → settling → gameover`（外加 `error`）。

- `loading`：内容与关键资源加载，只接受加载完成/失败。
- `start`：开始界面；Start → 初始化一局 → `playing`。
- `playing`：接受转向（入缓存）与暂停；步进可致死亡/填满。
- `paused`：继续回 `playing`；退出回 `start`；步进时钟完全冻结。
- `settling`：死亡/填满后的过渡门控态。该态下忽略一切转向与重开；演出时长取自共享调参 JSON，发布值：死亡 **500ms**、棋盘填满 **800ms**，到时再置结算可交互标志。该数值为手感目标，列入运行时试玩检查项，不作为已验证结论。
- `gameover`：结算可交互后，重开 → 初始化一局 → `playing`；返回开始界面 → `start`。
- 刷新/关闭页面后恒为 `start`，不恢复局内进度。

局内状态结构（不依赖字段声明顺序，初始化由单一工厂函数 `createInitialMatchState()` 产出）：

```
snake: [{x,y}, ...]   // 节序数组，索引 0 为蛇头
direction: 0|1|2|3    // 当前实际朝向（右/下/左/上，映射见实现）
turnQueue: [dir]      // 至多 1 个待执行转向（GDD 5.2 两级含当前朝向）
food: {x,y}
score: number
eaten: number         // n
stepsPerSec: number   // 由 eaten 按曲线重估
endReason: null | 'wall' | 'self' | 'board-full'
newRecord: boolean
```

### 5.2 步进裁决（顺序必须与 GDD 5.3 完全一致）

`step(state)` 为纯函数，按下列固定顺序执行，外部观察到的是裁决后的稳定结果：

1. **确定本步实际朝向**：从 turnQueue 取出一个相对当前朝向合法（非 180° 反向）的转向并应用；非法项不出现在队列中（入队时已校验，见 5.3）；队列空则保持当前朝向。
2. **确定目标格**：`target = head + directionVec(direction)`。
3. **判定食物**：`willEat = (target == food)`。
4. **碰撞判定**（以步进后格位占用为准）：
   - target 越出 20×20 边界 → `endReason='wall'`，死亡；
   - target 被蛇身占据 → 死亡（`endReason='self'`）；**尾格例外**：当 `willEat === false` 且 target 正是当前尾节格时，尾节本步先让出，不判撞身；
   - `willEat === true` 的一步尾节不让出，进入当前尾格一律按撞身处理。
5. **未死亡才提交移动**：
   - 有食物：头入 target、尾保留（长度 +1）；`score += 10`；`eaten += 1`；按 `min(6+0.25*n, 14)` 重估 stepsPerSec（下一步生效）；在当前空格集合中均匀随机刷新食物；
   - 无食物：头入 target、尾节收缩（长度不变）。
6. **填满判定**：进食后若已无空格可放新食物 → `endReason='board-full'`，按 GDD 3.3 走填满结束（不放置食物）。

死亡/结束一经裁决，本步不再执行第 5 步的任何提交（死亡步蛇形不发生半截移动）。

### 5.3 转向缓存（GDD 5.2）

- 入队时机：仅 `playing` 态接受转向；每个转向相对于"它实际执行时的前一朝向"校验合法性。实现上：入队时以"队尾朝向（无则当前朝向）"为基准做 180° 校验，非法直接忽略。
- 队列容量为 1（即"下一步朝向 + 一个再下一步朝向"两级）；超出容量的更早输入丢弃：队列满时新输入忽略，不做覆盖。
- 每个步进时刻至多消费 1 个转向。
- 进入暂停时清空 turnQueue；暂停期间的转向不进入缓存；继续后为空队列。
- 结算/开始/加载态的转向一律不入队。

### 5.4 食物生成

- 重置一局时与每次进食后，先依据提交后的蛇身占用构造空格列表，再以均匀随机（`Math.random`，满足"不可利用的规律"；不暴露种子、不需要确定性）取一格。
- 棋盘至多 400 格，构造空集为 O(400)，无性能问题；占用查询用整数键 Set（如 `y*20+x`）。

### 5.5 节奏时钟

- 单一 rAF 循环 + 固定步长累积器：

  ```
  interval = 1 / stepsPerSec
  acc += clamp(dt, 0, frameDeltaCap)   // frameDeltaCap 建议 ≤ interval，防止后台回前台补步
  steps = 0
  while (acc >= interval && steps < maxCatchUp) {
      acc -= interval
      RuleEvaluator.step(state)
      steps += 1
  }
  ```

- `maxCatchUp` 设小上限（如 3~5），极端掉帧时宁可丢步不做死亡螺旋；常规情况下 14 步/秒相对 60fps 余量充足，不触发上限。
- `paused` 态不累加 dt；`paused → playing` 时以当前时间重置时钟锚点，acc 保持不变 → 剩余步进间隔不受暂停时长影响（GDD 5.4）。
- stepsPerSec 变化只影响后续 interval 计算，不改动当前 acc。
- 标签页切到后台：rAF 自动暂停，期间不产生步进；回到前台时 `visibilitychange`（或首帧大 dt 检测）触发时钟锚点重置，杜绝一次性补发几十步导致"回来即死"。是否在回前台时额外叠加暂停覆盖层属于 UI_UX 未决项，v1 默认不改 phase。
- 重开时：取消结算定时器、acc 清零、interval 回到初始值；rAF 循环本身为应用级单例，不随局重建，避免重复注册。

## 6. 输入

- InputManager 在应用挂载时注册一次根级监听，应用卸载时移除；不为每一局重复挂载。
- 键盘：方向键与 W/A/S/D → turn 意图；空格/回车/P → 按当前 phase 映射 start / pause / resume / restart；暂停界面的退出按键 → quit。具体键位以交互契约文档为准，本文只锁定"意图名 + phase 门控"。对方向键、空格调用 preventDefault 阻止页面滚动。
- 鼠标：仅承担界面点击（与 UI 文档控件的 actions 对接），不用于指向移动。
- 触控滑动：在棋盘区域记录 touchstart、在 touchend/touchmove 按主轴与容差识别为四方向 turn 意图；多点触控、未过阈值的轻触不产生转向；监听选项需允许对滚动手势 preventDefault。
- 屏幕方向按钮：触发与滑动完全相同的 turn 意图。两套触控路径与键盘路径汇入同一意图流，下游无差异。
- 界面类指令同样受 phase 门控（如 gameover 未进入可交互状态前，restart 不生效）；门控在 GameStore 入口统一实施，InputManager 不做玩法判断。
- 触控热区、手势阈值、对角线处理、误触保护、屏幕按钮布局均为未决项（见第 14 节），实现时不得自行拍板成产品行为。

## 7. 布局与取景适配

### 7.1 相机 letterbox（世界空间）

- 输入：游戏视图矩形 R（HUD 顶条之下区域）的实际像素尺寸 (w,h)，通过 ResizeObserver/布局回调在尺寸变化时推送；参考取景 640×640。
- 计算：

  ```
  scale = min(w / 640, h / 640)          // 等比缩放，取较小轴
  square = 640 * scale                    // 正方形视图边长
  offsetX = (w - square) / 2
  offsetY = (h - square) / 2
  ```

  正方形视图在 R 内居中，两侧/上下为 letterbox 留白；世界 transform、格位占用、Tilemap cells 均不因此改变。
- 与已验证取景核对（设计态数值，运行时尚未实测）：
  - R = 1280×656：scale = 1.025，square = 656，offsetX = 312，offsetY = 0；
  - R = 390×784：scale ≈ 0.6094，square = 390，offsetX = 0，offsetY = 197。
- 渲染分辨率可按 devicePixelRatio 提升清晰度，但坐标/取景计算只用 CSS 像素尺寸，DPR 仅作用于输出位图。

### 7.2 UI 屏幕空间（独立适配）

- UI 根节点按实际宿主 viewport 解析，不以 640×640 固定宿主；referenceResolution 仅用于基础构图。
- HUD 顶条等需要拉伸的区域用 anchorMin/anchorMax + sizeDelta；固定尺寸控件（按钮、面板）用命名 anchor + position + size，遵守"子 pivot 默认同 anchor"规则，避免双重偏移。
- 响应式：compact（viewport 宽 ≤ 600，默认阈值）与 portrait（高>宽，在 compact 之后应用）变体只覆盖显式声明的字段，未声明字段继承基础布局；竖屏顶条约 60px、桌面约 64px 为预留估值，最终值写在作者态数据中。
- 触控是已确认目标，UI 文档的 targetViewports 必须包含移动竖屏代表尺寸（如 390×784），布局边界检查以实际矩形"控件完全在安全区内"为准；DOM 存在或 isVisible 不构成证据。

## 8. 持久化（localStorage）

- 两个键：最高分建议 `"snake.highScore.v1"`（整数字符串；无记录视为 0）；静音建议 `"snake.muted"`（`"1"`/`"0"`，读取异常按未静音）。静音键行为细节引用 AUDIO_DESIGN 第 5 节。
- 读取（应用初始化时一次）：
  - 整体包在 try/catch 中：访问 localStorage 本身可能抛错（隐私模式、禁用 cookie、跨域沙箱）；
  - 值缺失 → 0；解析失败、非有限数、负数、非整数 → 视为损坏，按 0 处理；
  - 损坏值不回写覆盖，直到本局产生合法新高分时才以新值替换。
- 写入：仅在 gameover 结算时，当且仅当本局分数 > 先前读到的最高分时写入；写入同样 try/catch，配额/安全异常被吞掉并降级为仅内存有效（本局结算显示照常，刷新后不保留）。
- 不持久化蛇形、分数、phase、设置等任何其他数据。

## 9. 资源加载、失败处理与性能

### 9.1 加载与缓存

- 经 Manifest 解析 assetRef → 资源文件路径；图集帧读取同名 JSON sidecar 的帧矩形（不支持旋转/裁剪帧），按区域渲染，不为每个帧单独请求图片。
- 进行中的同 URL 加载去重复用；解码后的源在有消费者期间缓存；消费者全部结束后释放自有源；不预加载无关图集组。
- 音频资源按事件需要加载（体量小可随 startup）；AudioContext 在首次用户手势前不强制创建/恢复。

### 9.2 失败处理

- startup 关键路径（index、startup 文档、棋盘/蛇/食物渲染资产）失败：进入 `error` 态，显示中文错误信息与"重试"入口（重试重新走引导加载），不出现白屏。
- 非关键资产（音频、装饰性特效）失败：记日志并静默降级，玩法与界面流程不受影响。
- on-demand 文档失败：在对应流程入口给出可重试的轻量提示，不把应用带回白屏。
- fetch 全部经过 AbortController：应用卸载时中止在途请求；重开不中止共享资源。

### 9.3 性能预算

- 目标：稳定 60fps；步进计算 ≤14 次/秒、单次 O(蛇长 ≤400)；帧内主要成本为渲染。
- 蛇身 transform 走命令式写入/画布绘制，不经过 React render；HUD 文本变化频次极低（进食时），可走 React。
- 克隆蛇节使用实例池：重开时回收而非全量销毁重建；避免频繁创建位图/纹理。
- 图集/Tilemap 静态层可一次绘制到离屏画布缓存，相机取景变化时只 blit（若采用 canvas2d 渲染）。
- 内存：棋盘级小资产，无纹理流式压力；退出页面时由浏览器回收，运行时仍需显式释放自管 GPU 资源。

## 10. 初始化、状态转换、重开与清理（显式时序）

所有跨模块调用按下列顺序显式编写，行为不依赖 React effects 的触发先后或模块求值顺序。

**应用引导（bootstrap）**

1. React 挂载，渲染 loading；创建 AbortController；注册应用级输入监听与 rAF 循环（rAF 运行但时钟未使能）。
2. ContentLoader 取 index → 加载 startup 文档与 Manifest。
3. 解析并解码关键资产；失败 → error 态（含重试）。
4. ScenePresenter 按场景文档构建世界（作者态默认 transform/组件/Tilemap/相机）。
5. UIPresenter 按 UI 文档构建开始界面与 HUD（HUD 在 start 态可隐藏或弱化，按作者数据）。
6. Persistence 尝试读取最高分（任何异常 → 0）。
7. GameStore 写入 `start` 态；时钟保持冻结；首屏可交互。

**开局 / 重新开始（同一路径：`startMatch()`）**

1. 取消结算/过渡定时器；`createInitialMatchState()` 产出全新状态（初始蛇形 (10,8)(9,8)(8,8)、朝右、score 0、eaten 0、stepsPerSec 6、turnQueue 空）。
2. 蛇节池复位到作者态 3 节，多余克隆回收；食物节点先隐藏，按空格随机结果定位后显示。
3. ScenePresenter 按初始状态写全部 transform；UIPresenter 重置分数/标识；AudioManager 复位一次性事件标志。
4. 时钟：acc 清零、锚点设为当前时间、使能累加；phase = `playing`。
- 从开始界面开局与游戏结束后重开走完全相同的函数，不存在随局数变化的差异。

**暂停 / 继续**

- 暂停：phase = `paused`；时钟停止累加并冻结 acc；清空 turnQueue；UIPresenter 显示暂停子树。
- 继续：先重置时钟锚点（当前时间），再 phase = `playing`。暂停期间无任何步进、无任何转向排队。

**结束（死亡/填满）**

1. 步进产出 endReason 后：时钟停摆；进入 `settling`；输入门控关闭（忽略转向与重开）。
2. 结算比较 score 与最高分：超越则置 newRecord 并由 Persistence 尝试写入。
3. 过渡时长（死亡 500ms / 填满 800ms）结束后，gameover 子树可交互，重开/退出入口生效；board-full 使用区别于死亡的文案位（措辞未定，占位"棋盘填满！"）。

**退出本局（暂停界面）**：停止时钟、清空队列与定时器、回收蛇节池到初始、显示开始界面，phase = `start`；最高分保留。

**应用卸载 / 彻底清理**：取消 rAF；移除全部输入监听；abort 在途 fetch；释放纹理/离屏资源；关闭（或释放）AudioContext。重开不做应用级清理，只做局内复位，防止资源抖动与监听器泄漏。

## 11. 音频

- AudioManager 只订阅事件，不在玩法代码中散落播放调用。建议事件：`ui-activate`、`eat`、`die`、`board-full`、`new-record`；`step` 类移动音是否需要由 ASSET_PLP 决定（默认不加，避免高频噪声）。
- 首次用户手势（开始按钮/按键/触摸）时创建或恢复 AudioContext，解决浏览器自动播放限制；解锁失败则整体静音降级，不报错、不阻断。
- 具体 cue 清单、资源 id、音量与混音在 ASSET_PLP 中定义；运行时只认"事件 → cue"映射表。

## 12. 可行性风险与验证方式（不预建框架）

| 风险 | 验证方式（临时、最小成本，用后还原） |
|---|---|
| 运行时未真正消费作者态 transform，实际靠代码默认值"看起来对" | 临时复制一份场景数据（或拦截加载响应），改动蛇头/食物节点 position、rotation、scale，观察目标运行时对象及子节点随之改变且坐标系正确；改 Grid 的 cellSize，观察格心定位变化；还原数据。无变化或错误变化即绑定失败 |
| Tilemap 只是"能查到格"但层级/单元格未被消费 | 在临时数据中改一个 cell 的坐标/tileId，运行时对应瓦片位置与图案必须改变；单独记录该项检查，不与 transform 检查混同 |
| UI 布局被第二套 CSS/引擎布局顶替 | 临时改作者态按钮的 position/size（含父级 anchor 与 compact/portrait 变体），运行时实际矩形必须一致；在 1280×656 与 390×784 下确认控件完整可见，而非仅 DOM 存在 |
| 资源绑定未解码、只拼了文件名 | 临时改 assetRef/frame/member，渲染或播放结果必须切换为对应资产；确认实际解码了 Manifest/图集映射 |
| 快速连按导致反向自杀；暂停预排路线 | 用脚本在同一步进间隔内派发"上、左"等组合键序列，核对蛇形轨迹与队列容量；验证暂停时队列被清空 |
| 回前台补发步进造成"回来即死" | 模拟后台挂起数秒后恢复，确认无补发、acc 语义正确 |
| letterbox 数值偏离已验证取景 | 在两种目标游戏视图尺寸下实测正方形视图矩形，与 656×656@x312、390×390@y197 逐一核对 |
| localStorage 不可用/损坏 | 在抛错存储桩与损坏值桩下分别启动，确认按 0 处理、流程可玩、写失败静默降级 |
| 蛇长接近 400 时的渲染/步进性能 | 构造接近填满的状态做一次性能观察（帧时间与内存）；优先验证命令式渲染路径 |

验证原则：以上均通过临时改作者数据或注入测试响应完成，不改布局代码，事后还原；无法观察目标运行时如实报"未验证"，不得以推断充当结论。本文档撰写时**未执行任何运行时检查**，全部留待实现阶段落地。首个实现里程碑应是"加载真实场景文档并渲染棋盘 + 食物"的最薄垂直切片，用它先过内容绑定验证，再堆玩法。

## 13. 灵活性边界

- 算法、渲染器选择（canvas2d/WebGL）、目录与文件组织、状态管理写法、是否使用契约可选 helper，均可在不改变 GDD 可观察行为与本文既定参数的前提下调整。
- 以下事项不是实现自由，不得擅自决定：滑动与屏幕按钮的主次/热区与容差、HUD 最终高度、死亡过渡时长与演出、填满结局文案、音效清单与风格、任何新棋子/新模式。它们属于后续批次或统一评审。
- 逻辑格位与步进裁决严格离散；呈现层允许格间短补间：补间在两次步进之间播放，时长不超过当前步进间隔（与美术方向一致，约占间隔 50–70%，高速时自动缩短），不得改变碰撞/占用所依据的逻辑格，不得延迟呈现已提交的状态，也不产生拖影。暂停、死亡、结算时渲染立即吸附逻辑格。GDD 中"步进之间蛇停在格上"指逻辑状态，补间只是该状态间的视觉过渡。

## 14. 未决项与对后续批次的技术接口要求

### 14.1 未决项（承接 GDD 第 8 节）

评审已裁决：触控热区（`game-view`）、阈值（24px、轴比 1.5）与 settling 时长（死亡 500ms/填满 800ms，门控见 5.1）均已定稿。

1. 棋盘填满结局的中文文案（规则已定，仅措辞待定）。
2. 回前台是否叠加自动暂停覆盖层（v1 默认仅重置时钟锚点）。
3. 移动步进音等额外音效是否存在（首发不加）。
4. 触控阈值与演出时长的实际手感，列为运行时试玩检查。

### 14.2 对 UI_UX_SPEC 的接口要求

- 给出全部 UI 文档的 id、kind、loadPhase，以及每个节点的稳定 id（运行时按 id 绑定，不按数组顺序/名称猜测）。
- 确认 4.5 节绑定键与动作名，或给出一次性重命名表；明确游戏视图区域节点/宿主元素的标识方式。
- 给出 HUD 顶条最终高度（桌面/竖屏）、targetViewports 列表（必须含移动竖屏）、compactMaxWidth 与 portrait 变体字段、安全区（notch/Home 指示条）处理。
- 给出滑动手势的触发区域、最小位移阈值、多点触控与滚动冲突策略，以及屏幕方向按钮的布局与按压反馈。
- 明确开始、HUD、暂停、结算（含破纪录标识、填满文案位）各状态的节点可见性矩阵。

### 14.3 对 ASSET_PLP 的接口要求

- 输出 `assets/asset-manifest.json`（version 9 索引结构）与全部资源/需求文件；资源含 sha256（`local_file_hashes`）、root_path/file_paths、verified 状态。
- 提供：蛇头（四朝向或可旋转约定）、蛇身、食物、棋盘瓦片（或整幅底板）、墙/边框、面板 nine-slice、字体、界面图标等槽位对应的资源 id、member、图集帧名（大小写精确，无旋转/裁剪帧）。
- 若棋盘用 Tilemap：注册 `beegame-tileset.v1` 数据资源并给出 tileId → sprite/frame/size/pivot 映射；明确 tilemap 单元格布局数据。
- 给出"玩法/界面事件 → 音频 cue"映射与音频资源 id；标明循环/一次性。
- 确认 pixelsPerUnit（建议 1）与全部资源的 dimension/kind 标记。

### 14.4 对实现计划的接口要求

- 里程碑以"内容绑定可验证"为门槛：先真实加载/渲染作者数据并通过第 12 节的临时改数验证，再实现输入、步进裁决、界面流转、持久化与音频；每个里程碑给出可观察的验收方式（键盘与触控各走一遍 GDD 1.4 完成条件）。
- 明确共享调参 JSON 的唯一路径与字段表（20×20、初始蛇形、曲线、分值、settling 死亡 500ms/填满 800ms、触控阈值），全工程只此一份。
- 明确内容数据在开发态的提供方式（静态文件/拦截响应/构建派生）与重建传播方式；规划对 GDD 5.2/5.3 的自动化用例（队列容量、尾格例外、进食步撞尾、填满结局）。
- 性能与后台标签、存储降级纳入测试清单，而非发布前临时排查。

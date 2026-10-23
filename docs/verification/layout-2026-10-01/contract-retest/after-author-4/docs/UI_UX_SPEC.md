# 打砖块（Breakout）UI/UX 设计规格 UI_UX_SPEC

- 版本：v0.1（作者批次 4/5 草稿，待五批次合并评审）
- 作者：UI/UX Designer Agent
- 日期：2026-10-01
- 文档语言：中文；游戏内玩家可见语言：中文
- 上游依据：`docs/GDD.md` v0.1（玩家可见规则唯一权威）、`docs/TECHNICAL_DESIGN.md` v0.1（坐标契约 §4、输入抽象 §6、状态/持久化 §7）、`docs/ART_DIRECTION.md` v0.1（色板 §3、字体 §5、焦点/安静区域 §6、动效令牌 §7、面板/按钮语言 §12）、`docs/AUDIO_DESIGN.md` v0.1（过渡 §8、音量轨与持久化 §9、事件 §12）、`docs/LEVEL_SCENE_DESIGN.md` v0.1（空间骨架 §3、取景与 UI 覆盖允许区 §7、计算器记录 §8、最小尺寸 §9）、`docs/BALANCE_DESIGN.md` v0.1（发布值 §3、可达状态 §9）
- 内容契约：`.beegame/delivery/content-format.json`（UI 字段完整契约）
- 作者化源：本文配套的最终可编辑 UI 输入位于 `content/ui/`（运行时直接加载，不以代码常量重写）；生成器 `.beegame/tmp/gen-ui-layouts.mjs` 可重建全部文件。

---

## 1. 目的、边界与批次状态

本文定义首版打砖块全部界面与界面行为：八个必需界面呈现（Loading 含失败重试、旋转/扩窗提示、Start、HUD、Ready 场内呈现、Paused、Win、Game Over）、共享组件（只定义一次）、共享布局骨架与各屏差异、宿主尺寸适配、焦点与导航、减弱动效，以及空间计算器运行记录。

边界纪律：

- 玩法规则（动作可用性、七状态机、计分与生命、胜负）引用 GDD §4/§6/§7，不复述不改写；数值（生命 3、球速 540、满分 3250、分数 50 倍数）引用 BALANCE §3/§8/§9。
- 视觉外观（色板、形状、材质、动效外观）引用 ART_DIRECTION，本文只决定矩形、状态归属、时序引用；声音行为引用 AUDIO_DESIGN。
- 不新增界面、模式、平台（GDD §1.2）；不改变场景文档的取景与覆盖允许区（一处窄解释见 §16.4，已显式记录供评审）。
- 本批次未运行目标运行时；所有"只能运行时验证"的项在文中以 **【运行时项】** 标记。

---

## 2. 全局设计基线

### 2.1 方向、参考帧与目标尺寸（唯一答案）

| 项 | 定稿取值 |
|---|---|
| 唯一方向 | **Landscape 横版**；竖版不重排，进入旋转提示页 |
| UI 参考分辨率 referenceResolution | **[1920, 1080]** 逻辑像素（设计参考，不是固定宿主窗口） |
| 最小可用尺寸 | **960 × 540**（BALANCE §3 第 13 项、场景 §9 已确认） |
| targetViewports | **[960,540]（最小）、[1920,1080]（参考）、[2560,1080]（超宽过渡）** |
| minimumControlSize | **[44, 44]**，最终宿主逻辑像素；独立于节点本地 `layout.minSize` |
| 字体最小字号 | 正文/按钮 ≥18；辅助 ≥14（宿主像素）；详见 §4 |

### 2.2 坐标契约（选定，不给实现者留选择题）

1. **屏幕 UI 根解析到实际视口**，尺寸 = 宿主逻辑像素（CSS px）；原点左上，+X 向右、+Y 向下；角度弧度，平面内正角顺时针。
2. **锚点（anchor）与枢轴（pivot）**：锚点为命名常量（归一化 [x,y]）；**子枢轴默认与锚点相同**，绝不隐式 [0,0]；需要不同枢轴时用节点 `data.anchor:{x,y}` 显式覆盖（本项目仅用于右上锚定的按钮）。
3. **layout.position 是相对锚点的父级本地偏移**，不是累计世界坐标；**本地布局一律用父矩形本地坐标**。
4. **拉伸只用成对 anchorMin/anchorMax + sizeDelta**：解析尺寸 = parentSize ×（anchorMax−anchorMin）+ sizeDelta；枢轴与位置偏移在拉伸后同样适用。固定控件禁止使用拉伸字段。
5. **父子偏移 vs 最终矩形**：作者只声明本地偏移（锚点、position、size、container 关系）；最终宿主矩形一律由 `uiLayoutContract` 解析，不手算、不在代码里维护第二套结果。
6. **唯一例外**：`game-view` 下的相机参考平面（`data.space:"camera-reference-2d"`）使用 1920×1080 相机设计坐标，经相机投影恰好一次到达宿主；其内部节点不直接写宿主坐标。

### 2.3 适配策略：固定宿主像素控件 + 拉伸区域 + 居中定宽列

在受支持的尺寸区间（960→2560 宽、540→1080 高）内，选定以下单一策略：

- **控件以宿主逻辑像素固定尺寸**（含字号、间距）。理由：命中区与可读性在 540 高度的下限得到保证；高窗口上控件自然占比变小但始终 ≥44px，不会因自动缩放出现亚像素命中。
- **背景层拉伸**填满任意画幅（渐变允许裁切）；**game-view 拉伸**填满视口，相机在其内部 letterbox；**HUD 条横向拉伸、高度固定**，内部控件锚左/中/右，变宽只拉开间距。
- **菜单/弹层面板为固定尺寸、middle-center 锚定**；在 960×540 已逐一核对不溢出，在更大画幅只增大外边距，不缩放、不重排。
- **受支持区间内无重排**（不需要第二套布局）；竖版或 <960×540 才切换为旋转提示页。

容器变化时的区域行为：

| 区域 | 宽度变化（960→2560） | 高度变化（540→1080） |
|---|---|---|
| 背景 L0 | 拉伸（渐变裁切） | 拉伸 |
| game-view | 拉伸 | 拉伸 |
| 相机场地（16:9） | contain：≤1920 宽时等比放大；超宽时两侧变背景带 | 等比，不裁切 |
| HUD 条 | 横向拉伸；三组元素固定，间距增大 | 固定高 52 |
| 菜单列/面板 | 固定宽、居中，边距增大 | 固定高、居中 |
| 压暗遮罩 | 拉伸 | 拉伸 |
| 旋转提示 | 全屏 | 全屏 |

不使用 compact/portrait 响应式变体（Landscape 唯一方向；不满足条件直接进旋转页），故不声明 compactMaxWidth。

### 2.4 焦点与导航

- **焦点环**：任何可聚焦控件获得焦点时显示 **3px 强调金（#FFD166）外环、外扩 2px**；焦点环与悬停态视觉独立，减弱动效下仍常驻。
- **键盘导航**：Tab/Shift+Tab 在当前活动界面内按文档顺序循环；纵向列内 ↑/↓ 移动焦点，横向行内 ←/→ 移动；Enter/Space 激活聚焦控件。界面首次出现时焦点落在 §6–§10 各屏指定的 default 焦点；从弹层返回时恢复此前焦点。
- **控件状态**（具体外观见 §4 共享组件）：default / hover（仅 pointer:fine；提亮 +1–2%、1px 上抬）/ pressed（下沉 1.5px、压暗 5%）/ focused（金环）/ disabled（opacity .45、整子树不可命中）/ feedback（动作分派 + 对应音频，边沿触发，不连发）。
- **触控**：无悬停态；任何信息不得只在悬停出现（触控/键鼠信息完全一致）。落在控件上的触点归控件，其余触点驱动挡板（GDD §3.1、Tech §6.2）。
- **Space 冲突裁决（Ready）**：焦点在可交互控件上时 Space 激活该控件；否则按 GDD §3.2 发球。点击/轻点场地始终发球。
- **Esc/P**：Playing→Paused、Paused→Playing（GDD §4）；在其他界面 Esc 不产生规则外效果（Start 可无操作；结算界面不响应 Esc）。

### 2.5 减弱动效（prefers-reduced-motion: reduce）

运行时以 `matchMedia("(prefers-reduced-motion: reduce)")` 判定【运行时项】。生效处理：

- 碰撞挤压、发球拉伸、Ready 球呼吸缩放全部取消（场内只保留位置更新；Ready 球改为完全静止，可保留静态光晕）；
- 面板/界面进入改为 ≤120ms 透明淡入，不使用 out-back 位移；Win 彩屑取消（保留背景提亮），分数 count-up 改为直接显示终值或 ≤150ms；
- Loading 旋转动画改为静止或不透明度步进；暂停的场地缩放取消，直接压暗。
- **不变项**：球速 540 等玩法时序、暂停冻结语义、所有信息与状态覆盖。ART §7 令牌时序在 reduce 下仅允许被缩短/取消，不得延长或阻塞操作。

---

## 3. 界面与 GDD 七状态映射

| GDD 状态 | 启用的 content/ui 文档 | 说明 |
|---|---|---|
| Loading | `loading-screen.json`；失败时 `loading-error-screen.json` | 二者为同一状态的两种呈现 |
| Start | `start-screen.json`；音量分支 `volume-settings-screen.json` | 音量为分支不是新状态 |
| Ready | `game-hud.json`（HUD + Ready 提示，球呼吸） | Ready 提示位于相机平面 |
| Playing | `game-hud.json`（Ready 提示隐藏） | — |
| Paused | `pause-screen.json`；音量分支 `volume-settings-screen.json` | 遮罩截留指针，场内冻结 |
| Win | `win-screen.json` | 面板下为静止场内 |
| Game Over | `game-over-screen.json` | 面板下为静止场内 |
| 任意状态（方向/尺寸不满足时） | `rotate-screen.json` | 条件恢复自动回此前界面；局内按暂停方式冻结 |

文档清单（9 份，均为 `beegame-content.v1`；根节点数据含 orientation=Landscape、referenceResolution、targetViewports、minimumControlSize；`game-hud.json` 根另含 `data.layoutCamera:{nodeId:"game-view",path:".beegame/tmp/camera-draft.json"}`）：

1. `content/ui/game-hud.json`（ui-hud，17 节点）
2. `content/ui/loading-screen.json`（ui-screen，7 节点）
3. `content/ui/loading-error-screen.json`（ui-screen，8 节点）
4. `content/ui/rotate-screen.json`（ui-screen，7 节点）
5. `content/ui/start-screen.json`（ui-screen，21 节点）
6. `content/ui/pause-screen.json`（ui-screen，12 节点）
7. `content/ui/volume-settings-screen.json`（ui-screen，21 节点）
8. `content/ui/win-screen.json`（ui-screen，13 节点）
9. `content/ui/game-over-screen.json`（ui-screen，13 节点）

---

## 4. 共享组件（唯一定义；各屏引用，不重复定义）

色彩引用 ART §3；形状/描边引用 ART §2。所有控件命中区均 ≥ §2.1 的 44×44。

### 4.1 主按钮（Primary / Gold）

- 几何：默认 **高 56**（Start 屏主按钮高 64）；圆角 12；填充 #FFD166；3px #0F0F22 描边；文字 #0F0F22、22–24px、居中。
- 用途：开始游戏、继续游戏、再来一局、完成、重试。
- 状态：
  - **default**：金底墨字墨线；
  - **hover**（pointer:fine）：顶部提亮一档（+约 2% L）、1px 上抬；
  - **pressed**：整体下沉 1.5px、压暗约 5%；
  - **focused**：叠加 3px 金环外扩 2px（金底时金环改为主文字色 #F3F4FF，保证可见——此为焦点环唯一的换色例外）；
  - **disabled**：opacity .45、不命中、子树抑制；首版无运行中 disabled 的主按钮（仅结构定义）；
  - **error**：不适用（错误呈现在 Loading 错误视图，不由按钮表达）；
  - **feedback**：点击边沿触发动作分派 + AUDIO §3 对应 UI 音（如 retry、back_to_start），长按不重复触发。

### 4.2 幽灵按钮（Ghost）

- 几何：**高 48**；圆角 12；填充 #1B1D3D（α .85）；**3px #F3F4FF 描边**；文字 #F3F4FF、22px。
- 用途：返回开始界面、音量设置、Start 音量入口（Start 屏尺寸为 128×48，含图标+文字）。
- 状态：default / hover（描边与文字 +2% L）/ pressed（下沉 1.5px、填充压暗）/ focused（3px 金环）/ disabled（opacity .45）/ feedback（动作分派 + UI 音）。

### 4.3 面板（Panel）与压暗遮罩（Scrim）

- **面板**：#1B1D3D（α .90）；圆角 18；3px #0F0F22 描边；内部布局一律用带 padding 的 column container（见 §5）。
- **压暗遮罩**：#0C0C1E α .62；**拉伸全屏并截留该层期间全部指针事件**（Tech §2.3/§6.4）。Start 屏无遮罩（背景即游戏背景，ART §12）。

### 4.4 信息盒（Info Box）

- 几何：#1B1D3D α .85；圆角 10；3px 墨线。用于：HUD 分数盒（220×48）、Start 最高分盒（320×48）。
- 内容规则：标签次文字色（#9FA3C7，14–16px）；**数字必须等宽（tabular figures）**（ART §5.3），更新时不左右位移。

### 4.5 生命图标（Life Icon）

- 几何：**28×28 圆形**，造型与球一致：实心 #FFF6BF + 3px 墨线。
- **满**：实心；**空（失去后）**：仅 3px 墨线空心圈、α .35；变化瞬间弹出一次（ART §7.5/§10.3），只减不增。

### 4.6 音量控件（对接 AUDIO §9；本处定义一次，供音量面板使用）

- **总静音 Toggle**：命中区 **56×44**；视觉为 28×28 方框（3px 墨线、圆角 6）居中；开启时盒内显示金色 #FFD166 短横标记。状态：default / hover / pressed / focused（金环）/ 切换 feedback（即时静音/恢复，边沿触发）。
- **滑杆 Slider（音乐/音效各一）**：命中区 **416×48**；轨道视觉 372×10（#2A2D5C、圆角 5），填充金 #FFD166，拇指 28×28（#FFF6BF + 3px 墨线）。值 0–1 连续；滑到 0 等同该轨静音。拖动即时预览该轨电平；状态：default / pressed（拖中）/ focused（金环；方向键步进 0.05）/ disabled（总静音开启时两滑杆 disabled）/ feedback（写入 localStorage，AUDIO §9.2）。
- 不设第三轨、不设语音轨（AUDIO §9.1）。

### 4.7 背景与母题图形

- **背景**：纵向渐变 #1E1E42→#13132B，拉伸裁切全屏；微纹理属 Canvas/美术层（ART §4）。
- **母题（球 + 上扬弧 + 小砖簇）**：以 shape 节点作者化（圆=球、旋转薄矩形=弧、5 个小圆角矩形=砖簇），当前为**布局占位**：矩形即最终布局，资产集成期可改为 assetRef 图形而**不得改动任何矩形**【运行时项，ASSET_PLAN】。

---

## 5. 共享页面布局骨架（先给区域分配，再列各屏差异）

### 5.1 全屏覆盖层解剖（Pause / Win / Game Over / Volume / Loading-error / Rotate）

```
root（实际视口）
├─ bg（拉伸全屏；各屏自带，位于最底）
├─ scrim 压暗遮罩（拉伸全屏；Rotate/Start 无；Loading 可无）
└─ panel 或 column（middle-center，position [0,0]）
   内部：column container
     padding [上,右,下,左]（见各屏）
     direction column；align center；gap 统一 14–16
     子项按文档顺序纵向排列，全部显式 size
```

区域关系：面板宽度由最宽子项 + 左右 padding 决定；面板高度 = Σ子项高 + Σgap + 上下 padding；面板在视口中上下左右居中。960×540 下全部面板已核对：最宽 520（<960）、最高 420（<540）。

### 5.2 Start 屏布局（无遮罩的居中式）

```
root
├─ start-bg（拉伸）
├─ start-volume-button（top-right，position [-24,24]，128×48）
└─ start-column（middle-center，600×480，column：padding [28,24,28,24]，gap 18，align center）
   ├─ game-title        552×96
   ├─ title-motif        552×120（非流式容器；子项绝对锚定）
   ├─ highscore-box      320×48
   ├─ start-game-button  280×64
   └─ start-hints        520×24
```

### 5.3 场内合成布局（game-hud）

```
hud-root（实际视口）
└─ game-view（anchorMin [0,0] anchorMax [1,1] sizeDelta 0）
   ├─ camera-plane（camera-reference-2d，1920×1080，item.absolute）
   │  ├─ ready-prompt-primary（top-center，[0,688]，680×48；仅 Ready）
   │  └─ ready-prompt-sub    （top-center，[0,744]，680×32；仅 Ready）
   └─ hud-strip（anchorMin [0,0] anchorMax [1,0] sizeDelta [0,52]）
      ├─ score-box   （top-left  position [24,2]，220×48）
      ├─ lives-group （top-center position [0,10]，120×32）
      └─ pause-button（top-right position [-24,4]，88×44）
```

要点：HUD 落在 Y0–52（场景文档建议 Y0–60 内），不进入球走廊投影区与安全带；Ready 提示走相机平面（解释见 §16.4）。

### 5.4 各屏差异索引

| 屏 | 与骨架的差异 |
|---|---|
| Loading | 无 scrim、无面板；居中裸 column 360×204（spinner/文字/进度条） |
| Loading-error | scrim 无（背景即 L0）；column 440×300（图标/标题/说明/主按钮） |
| Rotate | 无 scrim、无可聚焦控件；column 508×280（图标/标题/说明） |
| Start | §5.2 |
| Paused | 面板 480×360；4 按钮（1 主 3 幽灵） |
| Volume | 面板 480×418；静音行 + 2 滑杆 + 完成 |
| Win / Game Over | 面板 520×420；标题/分数盒/纪录牌槽/2 按钮 |

---

## 6. Loading 界面（含失败可重试错误视图）

**进入条件**：应用启动、startup 文档与资源未就绪（GDD §7）。
**退出条件**：startup 项全部就绪 → Start（ART §7 界面切换 200–300ms）；任一项失败 → 错误视图。

**元素与信息层级**：

| 层级 | 元素 | 内容来源 |
|---|---|---|
| 1 | spinner（48×48，金色球圆形，墨线；运行时持续旋转） | 纯呈现 |
| 1 | "加载中…"（24px） | 静态文案 |
| 2 | 进度条（312×14：结构色轨道 + 金填充） | bootstrap 进度；有进度时确定比例，无进度时填充在轨道内循环 |

**动作与后果**：无（GDD §7）；不截留规则外按键，不提供跳过。
**状态**：

- **default**：spinner + 文案 + 进度；
- **feedback**：填充随进度更新；
- **error 视图**（`loading-error-screen.json`）：危险色圆形图标、标题"加载失败"（30px）、说明"资源加载未完成，请检查网络后重试。"（18px 次文字）、主按钮"重试"（220×56）；
  - "重试"后果：重新执行缺失项加载（在途请求先 abort，Tech §5.3）；成功 → 继续 Loading → Start；再次失败 → 留在错误视图；
  - 该视图无 disabled；重试按钮 pressed/focused 态按 §4.1。

---

## 7. 旋转 / 扩窗提示页

**进入条件**：宿主高 > 宽（竖版），或横版可用空间任一维度 < 960×540（Tech §4.5，以 ResizeObserver + matchMedia 判定）。
**退出条件**：方向为横版且空间 ≥960×540 —— **自动返回此前界面**，状态与场内内容不变；当时在局内则模拟按暂停方式冻结，恢复后继续冻结前瞬间。

**元素与层级**：旋转图标（96×96：墨线圆环 + 金色箭头）→ 标题"请旋转设备至横版"（30px）→ 说明"也可请扩大窗口（至少 960×540）。恢复后将自动返回此前界面。"（18px）。背景 L0。
**内容来源**：宿主尺寸事件。
**动作与后果**：无按钮、无焦点项；不接受任何玩法输入。
**状态**：仅 default；无可选/禁用/错误态；出现与消失均为即时（≤120ms 淡入淡出，不计界面切换时长）。

---

## 8. Start 开始界面

**进入条件**：Loading 成功；或从 Paused/Win/Game Over 返回（GDD §7）。
**退出条件**：开始游戏 → 新一局 Ready；音量入口 → 音量分支（完成后回 Start）。

**元素（§5.2）与信息层级**：

1. **标题"打砖块"**：80px 标题粗黑，墨线描边挤出（ART §5.1；挤出效果实现方式为【运行时项】）；
2. **主视觉母题**（title-motif，552×120）：64 球（140,44）沿墨水上扬弧（180,62 起，-0.28 rad）弹起，弧端指向 5 块小砖簇（普通砖糖果色，非完整砖阵缩略图，ART §6.1）；
3. **最高分信息盒**："最高分"标签 + 次文字色等宽数字；
4. **主按钮"开始游戏"**（280×64，金）；
5. 辅助行："空格 发球 · Esc 暂停 · 支持鼠标与触控"（16px）；
6. 右上幽灵按钮"音量"（128×48）。

**内容来源**：最高分读 localStorage（Tech §7.3；缺失/异常按 0）；BGM 在本界面按 AUDIO §7/§9.3 起播（首次手势前静默，不报错）。
**动作与后果**：

| 动作 | 后果 |
|---|---|
| 开始游戏 | 从作者化初始数据建新一局 → Ready（GDD §4） |
| 音量 | 打开音量面板；完成后回 Start；不改变任何状态 |

**状态**：默认焦点 = "开始游戏"；按钮各态按 §4；最高分盒无交互；无 error/disabled 项；feedback：按钮激活即分派（Start→Ready 不另造专用音，AUDIO §8）。

---

## 9. HUD（Ready / Playing 常驻）

**进入条件**：进入 Ready 即显示；Playing 持续；Paused/结算时常驻但被遮罩压暗且不交互。
**退出条件**：返回 Start（退出当局）后卸载。

**元素（§5.3）与信息层级**：

| 元素 | 矩形 | 内容与来源 |
|---|---|---|
| 分数盒 | 220×48，左上 | "分数"标签 + **等宽数字**；bind `hud.score`（0–3250，50 倍数） |
| 生命组 | 120×32，顶部居中 | 3 个 28 生命小球；bind `hud.lives`（{3,2,1}） |
| 暂停按钮 | 88×44，右上 | 双竖条图标 + "暂停"；触控可见入口 |

**动作与后果**：暂停按钮/ Esc / P → Playing 切 Paused（发 pause_changed，AUDIO §12）；Ready 时同样可暂停（GDD §7）。
**状态**：

- **default**：HUD 常驻；
- **selected/focused**：暂停按钮金环；Tab 序：暂停按钮（HUD 唯一可聚焦项）；
- **feedback**：分数即时更新不跳位；生命损失时被扣图标"弹出+变空"（ART §7.5）；碎砖处可选分值浮字属 Canvas 层（≤280ms，ART §10.3）；
- **disabled**：Paused/结算期间暂停按钮不交互（遮罩截留），但不做 opacity 处理（画面整体已压暗）；
- **error**：不适用。

---

## 10. Ready 待发态的场内呈现

**进入条件**：新一局开始、或漏球后仍有生命（GDD §7、§6.2）。
**退出条件**：发球输入被接受 → Playing；暂停 → Paused。

**元素（相机平面，随场地投影）**：

- 主提示"按 空格 或点击屏幕 发球"（34px，680×48，相机坐标 (620,688)）；
- 次提示"方向键 / A·D 移动挡板"（22px，(620,744)）；
- **球呼吸**：附着挡板（偏移 (0,−34)），1 秒周期缩放 ±5%、光晕微脉动（ART §7.1）。

**信息层级**：球（第一焦点）＞主提示＞次提示。
**内容来源**：静态文案；球状态由引擎驱动。
**动作与后果**：Space/点击/轻点 → 球发出（提示按界面切换时长隐藏、球呼吸停止、沿出射向轻拉伸；`ball_launch` 声，AUDIO §3.1）；移动 → 挡板移动、球随动。
**状态**：

- **default**：提示常驻 + 球呼吸；
- **feedback**：发球瞬间提示隐藏；漏球回 Ready 时提示重新淡入；
- **disabled**：提示仅 Ready 可见，Playing 启用但不可见（enabled 由状态机切）；
- 无 selected/error 态（提示不是可交互物；ART §9）。

---

## 11. Paused 暂停弹层

**进入条件**：Playing（或 Ready）中暂停动作；页面隐藏自动暂停（Tech §3.4）。
**退出条件**：继续 / 再来一局 / 返回开始界面 / 音量设置（GDD §4）。

**元素（面板 480×360；column padding [28,32,28,32] gap 16）**：

1. 标题"已暂停"（32px）；
2. **主按钮"继续游戏"（416×56，金）—— 默认焦点**；
3. 幽灵"再来一局"（416×48）；
4. 幽灵"返回开始界面"（416×48）；
5. 幽灵"音量设置"（416×48）。

**内容来源**：无动态数据；场内在面板后保持静止冻结画面（ART §7.6：场地缩至 96–97%、压暗；reduce 下不缩放）。
**动作与后果**：

| 动作 | 后果 | 音频 |
|---|---|---|
| 继续游戏 | → Playing，从冻结瞬间恢复 | 继续短音；音乐恢复 |
| 再来一局 | 作者化数据重建 → 新局 Ready | retry |
| 返回开始界面 | → Start；放弃本局，**不写最高分**（GDD §6.4） | back_to_start |
| 音量设置 | → 音量分支；完成后回 Paused（保留暂停冻结） | — |

**状态**：default 焦点在"继续游戏"；方向键纵向遍历；各按钮态按 §4；暂停期间无 disabled 项（音量面板内静音时滑杆 disabled 属该面板）；无 error 态。

---

## 12. 音量设置面板（Start / Paused 共享分支）

**进入条件**：Start 右上"音量"或 Paused"音量设置"。
**退出条件**："完成" → 返回调用方（Start 或 Paused），调用方状态与场内冻结情况不变。

**元素（面板 480×418；column padding [28,32,28,32] gap 14）**：

1. 标题"音量设置"（28px）；
2. 静音行（row，416×44，gap 12）："总静音"（20px）+ 静音 Toggle（56×44）—— 默认焦点；
3. "音乐音量"标签 + 滑杆（416×48）；
4. "音效音量"标签 + 滑杆（416×48）；
5. 主按钮"完成"（416×56）。

**内容来源/持久化**：总静音、音乐 0–1、音效 0–1 对接 AUDIO §9 音频设置 API；写入 localStorage，启动恢复；首次访问默认 70–80%、不静音。
**动作与后果**：Toggle → 总静音（同时两滑杆 disabled、音乐按 AUDIO §7 压低/恢复逻辑一致）；拖动/方向键 → 对应轨实时电平预览；完成 → 返回。ducking 只在总线层，不改用户值。
**状态**：focused（金环；滑杆焦点时方向键步进）/ disabled（静音时滑杆）/ feedback（每次有效变更即持久化）；无 error 态。

---

## 13. Win 胜利结算

**进入条件**：最后一块可击碎砖销毁瞬间（GDD §6.1）；球停止。
**退出条件**：再来一局 / 返回开始界面。

**元素（面板 520×420；column padding [28,32,28,32] gap 16 align center）**：

1. 标题"通关！"（36px，**金色**）；
2. 分数盒（456×112）："本局得分"标签 + 大数字（52px 等宽、墨线挤出；count-up 后终值 **3250**）；
3. **新纪录牌槽（456×40）**：金 α.18 底、3px 金边，文字"新纪录！"（20px 金）—— 仅当本局严格大于历史最高分时启用（新纪录规则与写入按 GDD §6.3/Tech §7.3）；
4. 主按钮"再来一局"（456×56，金）—— 默认焦点；
5. 幽灵"返回开始界面"（456×48）。

**内容来源**：result.score；纪录标记来自状态机比较结果。背景提亮、上部几何彩屑（600–900ms，不遮按钮，ART §7.6；reduce 下取消）；`game_win`，若新纪录其后 0.2–0.5s 接 `new_record`（AUDIO §3.8/§3.13）。
**动作与后果**：再来一局 → 新局 Ready（retry；BGM 连续不重启）；返回 → Start（back_to_start；通关局已参与纪录比较，写入不受返回影响——写入发生在结算出现时）。
**状态**：纪录牌 enabled（有纪录）/ disabled 且不占位渲染，列底部留 40px 空白（justify start，无纪录时面板视觉下轻，已核对不溢出）；按钮各态按 §4；结算显示期不响应玩法输入（GDD §5.3）。

---

## 14. Game Over 失败结算

**进入条件**：漏球且生命归零（GDD §6.2）。
**退出条件**：再来一局 / 返回开始界面。

**元素（与 Win 同几何 520×420）**：

1. 标题"游戏结束"（36px，**危险玫瑰色 #FF5C7A**）；
2. 分数盒："本局得分" + 大数字（52px；**取值为 50 的倍数**，区间 0–3200；0 分时显示 0）；
3. **新纪录牌槽同 Win**：失败局若失败前分数已超前高，同样出"新纪录！（AUDIO §3.13 允许与失败情绪并存，时序由 Tech 保证）；
4. "再来一局"（默认焦点）；
5. "返回开始界面"。

**内容来源**：result.score、纪录比较。场内去饱和 −40%、四周玫瑰暗角慢脉动一次，无彩屑（ART §7.6）；`game_over` 衔接在漏球声之后（AUDIO §3.9/§8）。
**动作与后果、状态**：同 §13（再来一局/返回；纪录牌 enabled/disabled；不响应玩法输入）。

---

## 15. 空间计算器运行记录（强制工具验证；非手算声称 fit）

完整结果留存：`.beegame/tmp/ui-result-960x540.json`、`.beegame/tmp/ui-result-1920x1080.json`、`.beegame/tmp/ui-result-2560x1080.json`、`.beegame/tmp/ui-design-layouts-result.json`。相机计算输入引用 `.beegame/tmp/camera-draft.json`（**未复制相机值**）。

| # | 命令 | 视口 | 结果（摘要） |
|---|---|---|---|
| 1 | `bun .beegame/delivery/check-content.mjs --layout-draft content/ui/game-hud.json 960 540 --game-view game-view --camera .beegame/tmp/camera-draft.json` | 960×540（最小） | ok；相机 letterbox rect **{x:0,y:0,w:960,h:540}**；HUD/提示全部 inside；**diagnostics 全空，overlapCandidates 0**；Ready 主提示屏上 (310,344)–(650,368) |
| 2 | 同 1，参数 1920 1080 | 1920×1080（参考） | ok；rect **{0,0,1920,1080}**；diagnostics 全空；Ready 提示 (620,688)–(1300,736) |
| 3 | 同 1，参数 2560 1080 | 2560×1080（超宽） | ok；rect **{x:320,y:0,w:1920,h:1080}**（两侧各 320 仅背景带，与场景文档 §8 #3 一致）；Ready 提示 (940,688)–(1620,736) |
| 4 | 对其余 8 份文档逐一 `--layout-draft <file> 960 540` | 最小 | 全部 ok；无 belowMinimum、无 outsideViewport |
| 5 | **`bun .beegame/delivery/check-content.mjs --design-layouts`** | 全文档 × 全部 targets | **valid:true，issues:[]，files:9**（BGS 评审将跑同一命令） |

修复历程（如实记录）：首轮 #1 曾报 overlapCandidates `score-label ↔ score-value`（2px 纵向相交）；rotate-body 超出列 padding（outsideContentArea）；motif-arc 旋转后越出母题盒（outsideParent）。经调整分数盒几何（220×48、标签 y4/数值 y23）、正文宽 460、弧线 (180,62,-0.28rad,220 长) 后全部消除，**最终 overlap candidates：无**。

**计算器限制（写入本文件，评审同此口径）**：它只验证结构合法性与静态最终矩形/投影；**不检查 prose 一致性、状态覆盖、重叠意图、字体、视觉质量、文本测量、玩法遮挡**。ok 仅表示检查已运行，不构成整体设计通过。

**只能运行时验证的项【运行时项】汇总**：

1. 真实 WOFF2 字体渲染与 textFit（中文 glyph、等宽数字在 3250/最高分各长度下不溢出，uiLayoutContract.textFit）；
2. 触控实际命中、touch-action、触点不按挡板的指针投影正确性（Tech §6.2）；
3. 焦点环可见性、Tab/方向键遍历与焦点恢复；
4. prefers-reduced-motion 各分支行为（§2.5）；
5. 音频接线、BGM 首手势解锁、暂停压低、ducking（AUDIO §9.3）；
6. 母题/图标 shape 占位替换为 assetRef 后矩形不变（§4.7，ASSET_PLAN）；
7. count-up、彩屑、生命弹出、球呼吸的实际观感（ART §7）；
8. localStorage 不可用时的降级（Tech §7.3）；页面隐藏自动暂停（Tech §3.4）。

---

## 16. 与其他文档协调

1. **反馈外观与时序**：全部引用 ART §7 令牌（碰撞 80–120ms、碎屑 250–350ms、闪光 ≤150ms、界面 200–300ms），界面切换不另设时长；reduce 处理只在其范围内缩短。
2. **过渡事件含义**：与 AUDIO §8 过渡表、§12.1 事件钩子保持一致（`ball_launch`/`pause_changed`/`retry`/`back_to_start`/`game_win`/`game_over`/`new_record`）；本文不新增事件。
3. **音量**：控件与持久化对接 AUDIO §9（总静音 + 音乐 + 音效，localStorage）。
4. **场景约定**：
   - game-view 由本文选定为**拉伸至全屏**，相机在其内部 letterbox；未改动取景与覆盖允许区，HUD 仍限 Y0–60 带；
   - **一处窄解释供评审**：Ready 发球提示位于相机平面 Y688–792（投影在球走廊设计带内、球上方、安全带之外）。场景/美术安静区规则禁止的是"装饰/常驻 UI/移动背景元素"，Ready 提示为**仅 Ready 态出现的瞬态状态文案**，本文按不属于被禁类别处理，且不遮球（计算器核对：提示底边 776 < 球心 926）。若评审认为球走廊内不得出现任何 UI，需由场景/美术负责人修订权威源，备选方案为将提示移至上沿 HUD 带；**在权威源修订前不扩张、不实施备选**。
5. 不新增界面/模式/平台（GDD §1.2）。

---

## 17. 未决事项

1. Ready 提示对球走廊约定的窄解释，待合并评审签认（§16.4）。
2. 标题描边挤出、母题图形的最终视觉实现（assetRef/字体），属 ASSET_PLAN 与实现期；矩形本批已定。
3. `content/index.json` 的文档注册（startup/on-demand）在内容集成步骤完成；本批只交付 content/ui 源，不附索引与 Manifest。
4. 新纪录牌、分数/生命绑定的运行时联调，随状态机实现期完成【运行时项】。
5. 以上均为集成/参数级事项，不构成 GDD 排除项之外的新模式或新系统。

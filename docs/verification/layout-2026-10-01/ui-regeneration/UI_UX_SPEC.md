# 贪吃蛇 UI/UX 设计规格（UI_UX_SPEC）

- 版本：v1.1（依据最新空间计算入口重写；实现与验收基线）
- 作者：Bee Game Studio
- 日期：2026-10-01
- 适用平台：Web（React，2D，风格化）
- 上游依据：`GDD.md`、`LEVEL_SCENE_DESIGN.md`、`BALANCE_DESIGN.md`、`ART_DIRECTION.md`、`TECHNICAL_DESIGN.md`、`AUDIO_DESIGN.md`、`ASSET_PLAN.md`
- 本文拥有屏幕空间分配、布局选择条件与交互行为的唯一权威；其他文档只引用不复制。

---

## 1. 坐标与约定

- UI 使用屏幕空间逻辑像素，原点左上，+X 右、+Y 下；anchor/pivot 为归一化 [x,y]，`position` 为相对 anchor 的父级局部偏移，子 pivot 默认与 anchor 相同；嵌套节点只用父级局部坐标。
- 参考分辨率（referenceResolution）：桌面基础构图 **1280×720**；它是设计参考，不是固定宿主尺寸，屏幕根恒按实际 viewport 解析。
- 支持宿主：桌面 ≥ 宽屏；触控竖屏最小 **375×667**（更小高度不保证棋盘与按键最小尺度，属不支持宿主，不做裁剪式妥协）。
- targetViewports：`[1280,720]`、`[1024,640]`、`[390,844]`、`[375,667]`。
- 世界取景（相机 letterbox）与屏幕 UI 适配独立，但取景输入来自本文定义的 `game-view` 节点解析矩形，而非整个宿主窗口。

### 1.1 布局选择条件（优先级从高到低，互斥覆盖规则明确）

| 优先级 | 条件 | 选用构图 |
|---|---|---|
| 1 | height > width（在 compact 之后判定） | **portrait**：HUD 60 + game-view（正方形）+ 方向键区 |
| 2 | viewport 宽 ≤ 600 | **compact**：桌面骨架，间距/字号按紧凑值 |
| 3 | 其余 | **desktop**：HUD 64，game-view 占全部剩余 |

- 条件同时满足时先应用 compact 再叠加 portrait（portrait 优先）。compactMaxWidth = 600。
- 输入能力与 viewport 形状是两件事：触控不自动触发 portrait；桌面窄窗口同样可进入 compact。

---

## 2. 共享页面骨架（全宿主区域分配，只定义一次）

开始界面独占全屏，不走骨架；其余各屏（HUD、game-view、暂停/结算覆盖、竖屏方向键）共享同一宿主骨架。

```
desktop 1280×720                     portrait 390×844 / 375×667
┌────────────────────────────┐       ┌──────────────┐
│ HUD 顶条 64（横向拉伸）     │       │ HUD 顶条 60   │
├────────────────────────────┤       ├──────────────┤
│                            │       │              │
│      game-view             │       │  game-view   │ ← 正方形
│  (节点 id：game-view)       │       │ (390×390 /   │   相机取景输入
│  HUD 以下全部剩余           │       │  375×375)    │
│  参考 1280×656             │       ├──────────────┤
│                            │       │ 方向键区      │
│ 棋盘正方形居中 letterbox   │       │ (394 / 232)  │
└────────────────────────────┘       └──────────────┘
```

### 2.1 区域行为（固定/拉伸/收缩）

| 区域 | desktop | portrait |
|---|---|---|
| HUD | 横向拉伸（anchorMin/Max），固定高 64 | 固定高 60，横向拉伸 |
| game-view | grow 填充全部剩余，参考 1280×656 | **固定正方形，不 grow**：参考 390×390（宿主 y=60..450） |
| 方向键区 | 节点隐藏 | grow 取剩余全部高度；参考 394，小屏 232 |
| 覆盖层（暂停/结算） | 全屏半透明遮罩 + 居中卡片 | 同构，卡片用竖屏尺寸 |

### 2.2 portrait 空间不足时的确定规则（无备选列表）

- 触控按键最小尺度：高 ≥48；方向键区最小高 190。
- `boardSize = min(hostW, hostH − 60 − 190)`；game-view 为 boardSize 正方形，宿主 y=60；方向键区占剩余（高 hostH−60−boardSize），区内 3×3 网格随其矩形缩放按键（宽 = (dpadW − 32 − 16)/3，高 = (dpadH − 40 − 16)/3）。
- 代入：390×844 → board 390、dpad 394、键 114×104；375×667 → board 375、dpad 232、键 109×58。
- hostH < 60+190+320 ≈ 570 时棋盘将 <320 且按键不达标，为不支持宿主。
- 安全区：root padding 纳入设备安全区（顶部刘海、底部 Home 指示条 ≥16；方向键区底部 padding 24 已覆盖）。
- 预留区（HUD、方向键区）永不显示棋盘；允许覆盖区仅暂停/结算遮罩且只在对应状态出现。游戏进行中棋盘 400 格上方无任何 UI（满足 LEVEL_SCENE_DESIGN 3.4）。

---

## 3. 界面清单与状态可见性矩阵

状态机闭集（GDD 第 6 节）：`loading → start → playing ↔ paused → settling → gameover`（+error）。

| 文档（id / kind / loadPhase） | loading | start | playing | paused | settling | gameover |
|---|---|---|---|---|---|---|
| `ui-start` / ui-screen / startup | – | 可见 | 隐藏 | 隐藏 | 隐藏 | 隐藏 |
| `ui-hud` / ui-hud / startup | – | 弱化* | 可见 | 隐藏 | 隐藏 | 隐藏 |
| `ui-dpad` / ui-hud / startup（仅 portrait 启用） | – | 隐藏 | 可见 | 隐藏 | 隐藏 | 隐藏 |
| `ui-pause` / ui-screen / startup | – | – | – | 可见 | – | – |
| `ui-gameover` / ui-screen / startup | – | – | – | – | 演出后可见 | 可见 |
| `ui-system`（加载/错误外壳） | 可见 | 隐藏 | – | – | – | 错误时可见 |

\* start 态 HUD 隐藏（默认）；显隐由作者态数据 enabled 决定，代码不另造规则。

---

## 4. 各屏幕详细规格

### 4.1 开始界面 `ui-start`

- 进入：引导完成 loading→start；或从暂停/结算返回。退出：开始游戏 → playing。
- 构图（ART_DIRECTION 9.2：安静的开机位）：column 居中、大留白；视线顺序 **标题 → 盘蛇母题 → 主按钮**。
- 元素：

| id | role | 内容来源 | 动作/结果 |
|---|---|---|---|
| `title` | text | 静态"贪吃蛇" | – |
| `motif` | shape | 盘成方形的蛇形母题，矢量/代码绘制（视觉用途见第 7 节） | – |
| `start-btn` | button | "开始游戏" | `start` → 初始化一局 → playing |
| `mute-btn` | button | 图标随 `muted` 切换（两态形状互异） | `toggle-mute`，右上角锚定 |

- 矩形：桌面 标题 480×96 @ (400,156)、母题 160×160 @ (560,292)、按钮 280×72 @ (500,492)、静音 88×44 @ (1180,12)；竖屏 标题 342×80 @ (24,248)、母题 140×140 @ (125,360)、按钮 240×64 @ (75,532)、静音 56×40 @ (322,12)。
- 按钮状态：默认 / 悬停（描边加亮）/ 按下（scale 0.97）/ 键盘焦点（`#4CC9F0` 焦点框）；无禁用态。键盘：空格/回车开局，焦点默认在 start-btn。

### 4.2 HUD `ui-hud`

- 进入：playing；退出：暂停/结束。row + space-between；信息层级：**当前分数（一级）＞ 暂停/静音入口 ＞ 最高分（二级）**。
- 元素：

| id | role | 绑定 | 说明 |
|---|---|---|---|
| `score` | text | `score`："分数 {score}" | 桌面 28 / 竖屏 21 |
| `hiscore` | text | `highScore`：桌面"最高分 {}"，竖屏"高 {}" | 次级色 |
| `mute-btn` | button | `toggle-mute`；图标按 `muted` 切换 | 图标位 |
| `pause-btn` | button | `pause` | 图标位 |

- 桌面矩形（1280 宽）：score [24,264]、hiscore [456,696]、mute-btn [888,976]、pause-btn [1168,1256]。
- 竖屏矩形（390 宽）：score [12,128]、hiscore [148.7,240.7]、mute-btn [261.3,309.3]、pause-btn [330,378]。
- 数字为等宽字形，最大 3970（四位）已纳入验证宽度；分数变化短跳 scale 1→1.15→1（约 150ms），不滚动不翻牌；移动步进无 HUD 动画。

### 4.3 暂停覆盖层 `ui-pause`

- 进入：playing 触发 `pause`；退出：`resume` → playing，`quit` → start。
- 全屏遮罩 `#0F1420` 60% 透明（不模糊，降级友好）；居中卡片（column，stretch）：`panel-title`"已暂停"、`resume-btn`"继续游戏"（主操作、默认焦点）、`quit-btn`"退出到主菜单"。
- 卡片：桌面 380×300 @ (450,210)；竖屏 380×300 @ (5,272)。
- 规则约束（GDD 5.2/5.4）：进入暂停清空转向队列；遮罩可交互前的按键不触发退出；Esc/P/空格 → resume。

### 4.4 结算覆盖层 `ui-gameover`

- 进入：settling 演出结束（GDD 5.4：过渡期间忽略输入）；退出：`restart` → 新一局 playing；`quit` → start。
- 元素（column）：

| id | role | 绑定/内容 | 说明 |
|---|---|---|---|
| `end-title` | text | `endReason=board-full` → "棋盘填满！"，否则"游戏结束" | |
| `record-badge` | shape | `newRecord`=true 时启用，显示"新纪录"（金色星标/印章，形状承载） | 默认隐藏 |
| `score-line` | text | "本局得分 {score}" | |
| `hiscore-line` | text | "历史最高 {highScore}" | |
| `restart-btn` | button | `restart`（主操作、默认焦点） | |
| `home-btn` | button | `quit` | |

- 卡片：桌面 400×420 @ (440,150)；竖屏 340×440 @ (25,202)。空格/回车 → restart。
- board-full 视觉：无红色/叉形，金色安静基调（ART_DIRECTION 8.5），仅文案与色调差异。

### 4.5 方向键区 `ui-dpad`（仅 portrait）

- 3×3 grid，十字 4 按钮，占位 shape 全透明；按键尺寸随方向键区按 2.2 公式取值（参考 114×104，小屏 109×58）。

| id | 动作 | 参考矩形（390 宽） |
|---|---|---|
| `pad-up` | `turn-up` | [138,466 252,570] |
| `pad-left` | `turn-left` | [16,578 130,682] |
| `pad-right` | `turn-right` | [260,578 374,682] |
| `pad-down` | `turn-down` | [138,690 252,794] |

- 按压即时触发意图并高亮；转向合法性与节奏由规则/时钟处理（每步至多消费一个转向，GDD 5.2）。
- 全屏滑动同时可用，与按键汇入同一意图流；滑动识别区 = `game-view` 宿主元素，方向键区不响应滑动。

### 4.6 系统外壳：加载与错误

- loading：居中静态母题 + "加载中"；error：中文错误信息 + "重试"（重新引导，TECHNICAL_DESIGN 9.2）。非关键资产失败静默降级，不进 error。

---

## 5. 交互、焦点与导航

- **键盘**：转向（方向键/WASD）；start → `start`；空格/P → pause/resume；gameover → `restart`；Esc → 暂停/继续。焦点环统一 `#4CC9F0`，焦点只在当前可见屏控件间移动。
- **鼠标**：仅点击控件；点击非控件区域无结果。
- **触控（滑动）发布规则**：位移 ≥ **24 逻辑像素**才判定；主轴位移与另一轴之比 ≥ **1.5** 按主轴转向，否则视为对角模糊输入忽略；多点触控只取第一触点。
- **触控（按键）**：所有系统按钮命中区 ≥48×40（HUD 键竖屏 48×40，方向键最小 109×58）。
- 意图 phase 门控统一在 GameStore 入口：非 playing 转向丢弃；settling 期间 restart 不生效。首次用户手势同时解锁 AudioContext（AUDIO_DESIGN 第 6 节）。

---

## 6. 空间计算结果（全宿主草稿 + 联合取景）

命令（geometry only；文本未测量、runtimeVerified=false）：

```
bun .beegame/delivery/check-content.mjs \
  --layout-draft .beegame/tmp/ui-host-*.json <w> <h> \
  --game-view game-view --camera .beegame/tmp/camera-draft.json
```

相机草稿：orthographic、logical-pixels、orthographicSize 320、viewport 640×640、framing letterbox。

| 草稿 / 宿主 | game-view 解析矩形（宿主坐标） | 取景（cameraView.rect，相对 game-view） | UI 结论 |
|---|---|---|---|
| ui-host-desktop / 1280×720 | [0,64 1280,720]（1280×656） | 656×656 @ x=312，y=0 | 全部节点在视口，无重叠 |
| ui-host-portrait / 390×844 | [0,60 390,450]（390×390） | 390×390 @ 0,0 | HUD/game-view/dpad 三段合计 844，方向键十字位置正确 |
| ui-host-small / 375×667 | [0,60 375,435]（375×375） | 375×375 @ 0,0 | 修订：按键缩为 109×58 后全部在视口（初版 114×104 第三行溢出，已改） |

- 取景由 game-view 节点尺寸直接推导并保留宿主偏移：棋盘在宿主中为 656 见方（x=312，y=64）、390 见方（x=0，y=60）、375 见方（x=0，y=60），与 LEVEL_SCENE_DESIGN 可见性要求一致，且竖屏不与方向键区重叠。
- 工具边界：不验证真实文字测量、实际渲染遮挡、图标可辨性与触控手感；留待运行时验收，本文不声称已通过视觉检查。

---

## 7. 对 ASSET_PLAN 的视觉用途需求

| 视觉用途 | 形式 | 槽位 |
|---|---|---|
| 盘蛇母题 | 矢量/代码绘制（与棋盘同形） | `motif` |
| 暂停/重开/主页/静音/箭头图标 | 线性硬边、统一线宽；静音需有声/静音两态 | 各 button |
| 新纪录星标 | 形状优先的金色星/印章，代码绘制 | `record-badge` |
| 卡片底板 | 代码绘制圆角面板（1px 发光边） | 各 panel |
| 字体 | 几何中文黑体三级 + 等宽数字 | 全部文本 |

色值与圆角引用 ART_DIRECTION；素材清单与资源 id 以 ASSET_PLAN 为准；运行时按本文节点 id 绑定。

## 8. 动效反馈规格（目的/触发/时机）

| 反馈 | 目的 | 触发 | 表现与时长 |
|---|---|---|---|
| 分数短跳 | 确认进食计分 | score 变化 | scale 1→1.15→1，约 150ms |
| 开局落位 | 通电 | start 确认 | 淡入 + scale 0.98→1，约 200ms |
| 暂停压暗 | 状态静止 | pause | 30–40% 深色压层，无模糊 |
| 结算上浮 | 收手看成绩 | settling 结束 | 卡片上浮淡入，约 250ms |
| 按钮按压 | 操作确认 | pointerdown | scale 0.97，松开即回 |

- prefers-reduced-motion 时一律降级为淡入淡出；须提供无动效成立的静态帧。事件语义与 AUDIO_DESIGN 对齐：同一事件视听同时发生。

## 9. 遗留事项

1. "棋盘填满"最终中文文案（占位"棋盘填满！"），规则不受影响。
2. 需运行游戏的检查（本文无法完成）：真实字体加载后测量最大数字与中文标签；高速 14 步/秒下触控可用性；settling 500/800ms 与短跳的实际手感；结算面板在真机的遮挡检查。

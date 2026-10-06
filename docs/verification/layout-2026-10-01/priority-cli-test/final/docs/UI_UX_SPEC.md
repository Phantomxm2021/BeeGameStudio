# 打砖块（Breakout）界面与交互体验设计文档 UI_UX_SPEC

- 版本：v0.2（统一评审修订：结算屏补齐退出路径与 Game Over 新纪录 badge，快速重开改为仅 Enter）
- 作者：UI/UX 设计（Agent）
- 日期：2026-10-01
- 文档语言：中文；节点 id、组件字段名、事件/动作标识符保留英文
- 依据：
  - `docs/GDD.md` v0.1（状态机、玩家动作、完成条件的唯一权威）
  - `docs/LEVEL_SCENE_DESIGN.md` v0.1（960×540 参考场、墙内矩形 x80–880/y80–480、UI 允许叠加带 y0–64）
  - `docs/BALANCE_DESIGN.md` v0.1（分值 100、3 命、球速 360、分数域 0–6000）
  - `docs/ART_DIRECTION.md` v0.1（深夜霓虹机厅身份、等宽数字、面板/按钮语言、标题安静区）
  - `docs/AUDIO_DESIGN.md` v0.1（第 7.3 节：常驻静音开关与两态图标需求）
  - `.beegame/delivery/content-format.json`（UI schema、layout 契约、角色词表的唯一权威）
- 本文性质：规定每个屏幕/覆盖层/HUD 的**进入退出条件、信息层级、动作、状态、共享组件、坐标适配、焦点导航与反馈时序**；对应的可编辑实体在 `content/ui/*.json`，本文不为可编辑 JSON 的替代品。

---

## 1. 界面总览与文件对应

| # | 界面/覆盖层 | 对应文件 | document id | 说明 |
|---|---|---|---|---|
| 1 | 标题屏 Title | `content/ui/title-screen.json` | `ui-title-screen` | 标题字位、开始按钮、最高分、静音开关 |
| 2 | 游戏主屏（full-host 组合） | `content/ui/game-screen.json` | `ui-game-screen` | `game-view`（相机 viewport 边界）+ 世界相机参考面 + HUD |
| 3 | 待发提示 Ready Prompt | `content/ui/game-screen.json` 内节点 `ready-prompt` | — | 世界相机参考面中的居中提示，以节点 `enabled` 表达显隐 |
| 4 | 暂停菜单 Pause | `content/ui/pause-menu.json` | `ui-pause-menu` | 压暗层 + 面板：继续/重新开始/退出 + 静音开关 |
| 5 | 关卡完成结算 Level Complete | `content/ui/level-complete.json` | `ui-level-complete` | 祝贺标题、当局分、最高分、条件性新纪录标识、再来一局 |
| 6 | 游戏结束结算 Game Over | `content/ui/game-over.json` | `ui-game-over` | 当局分、最高分、条件性新纪录标识、重新开始、退出 |
| 7 | 旋转/尺寸提示 Rotate Prompt | `content/ui/rotate-prompt.json` | `ui-rotate-prompt` | 旋转图形 + 双行文案 |

运行时组合关系：游戏主屏为常驻宿主；暂停、两类结算覆盖层在运行时叠加于其上方（世界冻结）；标题屏与提示页为独立整屏。所有文件 `assetRefs: []`——首版视觉由 shape/text/底色表达，素材生产后以真实资源替换但节点结构不变。

## 2. 共享视觉组件（定义一次）

以下组件在各文件中以同一组节点模式与 style 值复用；编号为本文约定，节点 id 各屏加前缀。

### 2.1 霓虹胶囊按钮 Neon Button

- 结构：`role:"button"` 节点，内含居中 `text`（图标按钮内含 `shape` 或字符 `text`）。
- 层级语言：大圆角胶囊，`cornerRadius` = 高度/2（主操作按钮 48–52px 高，半径 24–26）。
- 三种视觉强度：
  | 变体 | 用途 | style 要点 |
  |---|---|---|
  | Primary | 每屏唯一主操作（开始/继续/再来一局/重新开始） | 青亮缘 `#2CE6E0` 宽 2 + 外辉；结算胜利时用暖金填充 `#FFC85A` + 深色文字 |
  | Secondary | 同级但非首选（暂停菜单的重新开始、退出） | 灰蓝亮缘 `#5C6FA0` 宽 1，文字 `#D8E2F8` |
  | Icon | 暂停、静音 | 44×44 圆钮，暗底 + `#3A4A78` 细缘 |
- 状态：**默认**亮缘稳定；**悬停/焦点（hover/focus）**亮缘增亮、同色外辉增强、内部明度微升（不换色相）；**按下（active/pressed）**一次极短的纵向压缩（幅度小于挡板击球压缩）随即回弹；**禁用（disabled）**整体压暗、去饱和、亮缘熄灭且不接收点击；**加载/过渡**首版无异步按钮态，结算浮出完成前按钮不响应（以面板浮出时序保证）。
- 危险语义：退出按钮不使用红色（红仅用于漏接等真实损失语义，见 ART_DIRECTION 3.3）。

### 2.2 霓虹面板 Neon Panel

- `role:"container"` 绝对锚定（`anchor:"middle-center"`），`background` 为深色半透明实底（opacity 0.94–0.95，保证压住粒子后数字仍清晰），`cornerRadius:16`，细亮缘：暂停/失败冷青/冷蓝（`#2CE6E0` / `#4A6FA8`），胜利暖金 `#FFC85A`。
- 内部：column 容器，`padding:[28,28,28,28]`，行 `gap:14`，按钮区 `align:"stretch"`（按钮横向拉满内容宽，不再硬写宽度差异）。
- 两类结算面板同构，仅换基调色与标题/图形。

### 2.3 HUD 数字与标签 HUD Numerals

- 标签：14px 灰蓝 `#7C89B0`（英文 `SCORE`；最高分中文标签 13px）。
- 数值：近白 `#EAF6FF`（最高分次级用 `#AAB6D8`），**等宽/表格式数字**：`style.fontFamily:"monospace"` 为占位，最终字体由资产计划交付；分数固定四位显示（`0000`），位数增长时数字不左右位移。
- 计分跳变：数值可一次极短增亮/轻跳，数字位不位移；不做滚动计数。

### 2.4 生命图标 Life Icon

- 22×22 圆形（`role:"shape"`，`style.shape:"circle"`），与球同形：存在为近白实心；**失去后变为暗色空轮廓**（形状实心→空心变化为主，不能只改颜色），变化瞬间可有一圈短红辉光散开。危险红仅在该短反馈中出现。

### 2.5 静音两态图标 Mute Toggle

- 44×44 圆形 `role:"toggle"`，两态图标：有声（喇叭/声波，占位字符 `♪`）与静音（喇叭带叉）；图标态与实际音频状态严格一致；静默降级期间显示静音/不可用态，不得误导为正在发声。
- 状态持久化与全局作用域遵循 AUDIO_DESIGN 7.2；点击该按钮可不发 UI 点按音。

## 3. 共享布局：区域分配与各屏差异

### 3.1 游戏主屏的区域分配（`ui-game-screen`）

```
┌──────────────────────────── HUD 带 y0–64（screen-space，拉伸）────────────────────────────┐
│ SCORE 0000        ● ● ●（生命）              最高分 0000   [II] [♪]                       │
├■■■■■■■■■■■■■■■■ 世界（game-view 内 letterbox 呈现）■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■■┤
│ 墙内矩形 x80–880 / y80–480：常驻 UI 禁入；Ready 提示为唯一例外（居中、半透明）             │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- `game-view`：`anchorMin:[0,0]`、`anchorMax:[1,1]`、`sizeDelta:[0,0]`——**占满整宿主**，其 resolved bounds 即相机 viewport；世界以 letterbox 呈现其内，世界本身不被 UI 布局缩放或移位。
- HUD：独立于 `game-view` 的 screen-space 节点（挂 `game-root` 下），`anchorMin:[0,0]`、`anchorMax:[1,0]`、`sizeDelta:[0,64]`——横跨整宽、固定 64 高。内部 row 容器 `padding:[10,16,10,16]`、`justify:"space-between"`，三个分组（左 SCORE / 中生命 / 右最高分+暂停+静音）由容器分配，未硬写子节点位置。
- 世界相机参考面：`world-overlay-plane`（`data.space:"camera-reference-2d"`，size `[960,540]`，`item.absolute:true`）挂在 `game-view` 下，承载 Ready 提示；其几何随相机投影。
- 遮挡合规：HUD 在 y0–64 带内，不进入墙内矩形（世界顶墙 y64–80 紧邻其下）；960×540 与 800×450 均为 16:9，世界铺满宿主，HUD 对应的世界条带正是 LEVEL_SCENE_DESIGN 第 6 节允许叠加带。

### 3.2 标题屏差异

- 标题字位 `title-group`：`anchor:"top-center"`、position `[0,118]`，column 容器：主标题"打砖块"（64px 近白）+ 英文副标 `B R E A K O U T`（20px 青，字距 6）。
- 主操作 `start-button`：`anchor:"middle-center"`、position `[0,52]`，220×52 胶囊。
- 次级信息：最高分只读组置于左上角低明度小字；静音开关置于右上角。
- **安静区**：左下至中下不放置任何节点（无图形、无粒子需求），与 ART_DIRECTION 1.3 对齐。

### 3.3 覆盖层差异

- 共同结构：root 拉伸；全屏 scrim（压暗，结算分别用暖/冷调底）；middle-center 面板。
- 暂停面板 360×308：标题 + 三按钮；静音 toggle 以 `item.absolute:true` 锚面板右上角（标题文本框收窄为 220 宽避让，见第 8 节）。
- 关卡完成面板 400×344：标题 → 新纪录 badge（条件性）→ 当局分 → 最高分 → 再来一局（暖金 Primary）→ 退出（Secondary）。
- 游戏结束面板 400×344：标题 → 新纪录 badge（条件性）→ 当局分 → 最高分 → 重新开始（青色 Primary）→ 退出（Secondary）。
- 旋转提示页：middle-center 的 420×248 column：旋转图形（设备框 + 球 + 圆弧箭头）→ 主文案 → 副文案；无按钮、无标题字。

## 4. 逐屏规格：进入退出、层级、内容来源、动作与状态

### 4.1 标题屏 Title

- **进入条件**：页面打开并完成资源加载（首版无重型资源，DOM/内容加载完成即进入）。
- **退出条件**：选择开始 → Ready；空间不满足 → 旋转提示页（替代）。
- **信息层级**：第一焦点 = 标题字（视觉）；主操作 = 开始按钮（交互第一焦点）；次级信息 = 最高分（角落、低明度）；静音 = 全局控件，不参与层级争夺。
- **内容来源**：最高分读自 `localStorage`（无记录时显示 `0000`）；静音态读自 `localStorage`。
- **动作与结果**：
  - `start-button`（`actions.click:"game:start"`）：分数清零、生命重置为 3、砖块全部生成 → Ready；同时作为音频解锁手势（AUDIO_DESIGN 第 6 节），音乐随后在对局淡入。
  - `title-mute-toggle`（`"audio:toggle-mute"`）：即时切换，全局生效。
- **状态**：开始按钮默认/悬停焦点/按下；首版无禁用态（加载在进入本屏前完成）。
- **键盘**：Enter/Space 等同点击开始（进入 Ready）。

### 4.2 游戏主屏 + 待发提示（Ready / Playing）

- **进入条件**：Title（或结算/暂停退出后重开）→ Ready。
- **HUD 常驻元素**：`hud-score-value`（SCORE，四位）、`life-icon-1..3`（生命×3）、`hud-highscore-value`（最高分）、`pause-button`、`hud-mute-toggle`。
- **信息层级**：游戏世界（球）为绝对第一焦点，HUD 整体明度低于球——扫视时在、盯球时不干扰；HUD 内部顺序：SCORE → 生命 → 最高分/控件。
- **内容来源**：SCORE 与生命来自**模拟层当帧快照**（事件发生当次结算立即生效，UI 无延迟缓冲）；最高分来自 `localStorage` 的最近读取值（对局中不变）。
- **待发提示 `ready-prompt`（Ready 专属）**：
  - 内容："点击 / 空格 发球" + `SPACE` keycap 图形（文字+图形双通道）。
  - 显隐以**节点 `enabled`** 表达：Ready 时 `enabled:true`；发球进入 Playing 当帧运行时置 `enabled:false`（不排队、不渐隐占位）；漏接回 Ready 重新启用。
  - 呈现：居中、半透明暗底（opacity 0.55），不覆盖球与挡板（位于其上方的世界中部，position y 偏移 -40）；呼吸动效（见第 7 节）。
- **动作与结果**：
  - 发球（世界区域点击 / Space / Enter）：仅 Ready 有效，输入释放时触发一次 → Playing；长按不连发。
  - 移动挡板：鼠标水平映射 / ←→或 A/D 按住 / 触控拖动；Ready 与 Playing 均可移动（细节以交互契约为权威）。
  - `pause-button`（`"game:pause"`）→ Paused；`hud-mute-toggle` → 静音切换。
- **状态**：HUD 控件默认/焦点/按下；生命图标的实心/空心与减少瞬态；Ready 提示的呼吸态。Playing 期间提示节点 disabled。

### 4.3 暂停菜单 Paused

- **进入条件**：仅 Playing → Paused（Esc/P 或暂停按钮）；世界模拟冻结、粒子/拖尾原地停留，scrim 压暗并去饱和。
- **退出条件**：继续 → Playing（从暂停时位置/方向无损恢复）；重新开始 → Ready（完整重置）；退出 → Title（当局不结算、不计最高分）。
- **信息层级**：第一焦点 = 继续按钮（Primary，进入时默认聚焦）；次级 = 重新开始、退出；静音开关在面板右上角（保证暂停期间静音可达，AUDIO_DESIGN 7.3）。
- **动作**：`pause-resume-button` `"game:resume"`；`pause-restart-button` `"game:restart"`；`pause-quit-button` `"game:quit-to-title"`；`pause-mute-toggle` `"audio:toggle-mute"`。
- **状态**：继续按钮默认焦点；Esc 等同继续；按钮悬停/按下/禁用（面板浮出/撤去动画期间短暂禁用）。

### 4.4 关卡完成结算 Level Complete

- **进入条件**：Playing 击碎最后一块砖（同帧末砖+越线时消除优先，见 GDD 5.2）；先播放暖色迸发，之后面板浮出。
- **退出条件**：再来一局 → Ready（完整重置）；退出 → Title（结算已完成、最高分已写入，退出仅为导航）。
- **信息层级**：祝贺标题（暖金）→ 新纪录标识（条件性）→ 当局分 → 最高分 → 再来一局（唯一主操作，默认焦点）→ 退出（次级）。
- **内容来源**：当局分来自模拟层终局快照；最高分取结算后写入 `localStorage` 的新值。
- **新纪录标识 `new-record-badge`（条件性节点）**：`enabled` 条件为 `sessionScore > storedBest`——破纪录时启用（星形 shape + `NEW RECORD` 文字 + 暖金辉光三重表达）；未破纪录时运行时置 `enabled:false`，其下行在 column 流中上移。
- **动作**：`complete-replay-button` `"game:restart"`；`complete-quit-button` `"game:quit-to-title"`；结算界面按 **Enter** 快速重开（Space 不作重开键，避免误触连发，以 GDD 第 3 节为准）。

### 4.5 游戏结束结算 Game Over

- **进入条件**：漏接扣减后生命数为 0；冷色收束后冷调面板浮出。
- **退出条件**：重新开始 → Ready（完整重置）；退出 → Title（结算已完成、最高分已写入）。
- **信息层级**：标题（冷色）→ 新纪录标识（条件性）→ 当局分 → 最高分 → 重新开始（Primary，默认焦点）→ 退出（次级）。
- **新纪录标识 `gameover-new-record-badge`**：失败局同样可能破分（GDD 2.3：胜利或失败均参与最高分更新），故本屏与关卡完成屏同构配置条件性 badge；视觉表达遵循 ART_DIRECTION 3.4（星形 + `NEW RECORD` + 暖金辉光，暖金在冷调面板上仍可辨识）。未破纪录时运行时置 `enabled:false`，其下行在 column 流中上移。
- **内容来源/动作**：同上；`gameover-restart-button` `"game:restart"`；`gameover-quit-button` `"game:quit-to-title"`；快速重开仅 **Enter** 触发（Space 不重开，以 GDD 第 3 节为准）。

### 4.6 旋转/尺寸提示页

- **进入条件**：设备处于竖屏（height > width），或可用空间低于 800×450（设计坐标口径，由运行时判定）。游戏不开始、不强制重排。
- **退出条件**：恢复可用横屏空间后淡出，回到标题或中断前流程（首版为回到标题）。
- **元素与层级**：旋转图形（横屏设备框轮廓 + 框内小球 + 旋转圆弧箭头，图形做小角度缓慢呼吸，不真翻转 90°）；主文案"请旋转设备至横屏"；副文案"窗口尺寸不足"。无控件、无交互焦点。
- **状态**：唯一循环呼吸态。

## 5. 坐标与适配规则

### 5.1 坐标约定

- 全部 UI 采用 top-left 逻辑像素：原点左上，+X 向右，+Y 向下；节点 layout 为父节点局部坐标，禁止使用已累加的世界坐标。
- anchor/pivot：`layout.anchor` 为命名锚点（如 `middle-center`）；pivot 默认与 anchor 一致；`position` 为相对锚点的父局部偏移。居中面板用 `anchor:"middle-center"` + `position:[0,0]`，不做负半宽二次偏移。
- 拉伸：`anchorMin`/`anchorMax` + `sizeDelta` 成对使用（root、game-view、HUD、scrim）；解析尺寸 = parentSize × (anchorMax−anchorMin) + sizeDelta。固定尺寸控件保持固定，不把整屏编码为拉伸面板。

### 5.2 固定/拉伸/居中行为总表

| 对象 | 行为 |
|---|---|
| 各屏 root、scrim | 拉伸铺满宿主 |
| game-view | 拉伸占满宿主（相机 viewport 随宿主变化，世界 letterbox） |
| HUD 带 | 横向拉伸，高度固定 64 |
| 面板、标题组、提示组 | 固定尺寸 + 居中/顶中锚定，不随宿主缩放 |
| Ready 提示 | 在 960×540 相机参考面内固定位置，随相机投影缩放（800 宿主上整体 ×0.8333） |

- 960×540 与 800×450：世界等比缩放（0.8333）、不重排不裁剪；**screen-space 面板/HUD 保持逻辑像素尺寸**（锚点定位保证仍在安全区内），这是有意的双空间策略：世界适配归相机，屏幕 UI 归锚点。
- 1024×576：16:9，行为同参考尺寸。
- letterbox 留黑区（非 16:9 宿主）由背景深色填充，禁止白边；背景在非 16:9 宽高比下仍铺满。
- **尺寸不足不重排**：低于 800×450 或竖屏一律显示提示页，不存在"缩到可用"的降级布局。

### 5.3 文本扩展处理

- 分数域 0–6000（BALANCE：60 砖 × 100），固定**四位**显示；HUD 数值框宽按四位等宽数字创作（88–96px），无需支持五位；最高分可能为历史值，同样按四位口径（首版最高理论值 6000）。
- 中文文案（最长"请旋转设备至横屏""点击 / 空格 发球"）按实尺排进固定文本框；不依赖自动换行掩盖框体不足；不允许运行时无界缩小字号。
- 字体实际度量须在字体资产加载后核验（textFit 契约）；计算器不做文本度量，当前以字符数估算，列为遗留验证项。

## 6. 焦点与导航

### 6.1 输入方式与焦点路线（本文需求，最终清单以交互契约为权威）

- **鼠标/触控**：直接点按任意可见控件；无悬停概念的触控设备上，焦点态仅在按下瞬间呈现。
- **键盘**：
  - Tab：在当前屏可交互控件间循环移动可见焦点；路线：
    - 标题：开始按钮 → 静音开关（循环）。
    - 暂停：继续 → 重新开始 → 退出 → 静音开关（循环）。
    - 结算：主操作按钮 → 退出按钮（循环）。
  - Enter/Space：激活当前焦点；**两结算屏例外——仅 Enter 激活，Space 不激活任何按钮**（避免误触连发重开，GDD 第 3 节）；Ready 状态下 Space 为发球（此时无 HUD 焦点环，避免混淆：对局中 Space 不参与 HUD 焦点，焦点环仅覆盖层/标题显示）。
  - Esc/P：Playing↔Paused 切换；暂停菜单内 Esc 等同继续。
- **进入覆盖层的默认焦点**：暂停 = 继续；结算 = 主操作按钮；关闭覆盖层焦点不残留在世界层。
- **触控热区**：所有可交互控件 resolved 尺寸不小于 `minimumControlSize:[44,44]`（最终宿主逻辑像素）；圆形图标钮 44×44；主操作按钮 220×52 / 拉伸满宽 ×48。相邻控件视觉间距 ≥8，暂停/静音间为 10。
- 挡板操控热区：游戏区域内整宽接受拖动/指针映射，属交互契约定义，本文不重复。
- 键位最终清单与交互契约/技术文档对齐；已决项：结算快速重开仅 Enter、Playing 中失焦自动暂停（GDD 4.2）；两处冲突以交互契约为准。

## 7. 反馈设计（目的/触发/表现/时序）

| 反馈 | 目的 | 触发 | 表现 | 时序档 |
|---|---|---|---|---|
| 按钮按下 | 确认操作接收 | pointerdown / 键盘激活 | 亮缘已增强（焦点态）+ 极短压缩回弹 + UI 点按音 | 最短档 |
| HUD 计分跳变 | 确认得分生效 | 砖块销毁当帧 | 数字即时变更 + 极短增亮/轻跳，不位移 | 短 |
| 生命图标空心化 | 传达生命损失 | 漏接判定 | 实心→暗空轮廓 + 图标位短红辉光 | 短（与漏接同期） |
| Ready 呼吸 | 传达"准备就绪、按下即发" | Ready 持续 | 提示与待发球辉光慢速明暗起伏 | 慢速循环（明显长于对局反馈） |
| 漏接 | 标记失误（失落而非惩罚） | 球整体越过 y=480 | 球下沉吸走熄灭、死亡线短闪、全场明度一沉 | 短 |
| 结算浮出 | 转场、给结果以仪式感 | 胜利迸发后 / 失败收束后 | 面板自暗场浮现（可带轻微上浮+透明度进入），世界在其后冻结/余韵 | 中长（对局微观反馈的数倍） |
| 覆盖层撤去 | 回到可操作状态 | 继续/重开生效 | scrim 快而干净撤去，颜色恢复 | 中短 |

- 总原则（与 ART_DIRECTION 8 一致）：对局反馈快、脆、短；只有待发呼吸与结算转场允许更慢；同类元素时长统一；无屏震、无慢动作。
- 反馈期间的输入：面板浮出动画结束前按钮不激活；覆盖层期间世界输入不排队、不补执行（GDD 5.2）。
- **reduced-motion 处理原则**：当用户系统开启 `prefers-reduced-motion`：
  - 取消/大幅收敛：按钮压缩、计分轻跳、面板浮出动位移与呼吸动效（改为静态或仅透明度即时切换，时长压到最短）；
  - 保留：所有状态切换的即时性、颜色/亮缘焦点态、文本与音效反馈（信息不损失）；
  - 世界侧特效（碎砖粒子、球拖尾）的降级幅度由 ART/技术实现统一处理，本文要求 UI 层不依赖位移传递关键信息。

## 8. 布局计算器运行结果

对每个最终文件实际运行（项目根；960×540 与 800×450；游戏主屏加 `--game-view game-view --camera .beegame/tmp/breakout-camera.json`）：

| 文件 | 尺寸 | outsideViewport | outsideParent | outsideContentArea | outsideCameraView | belowMinimumControlSize | overlapCandidates |
|---|---|---|---|---|---|---|---|
| title-screen.json | 960 / 800 | 0 | 0 | 0 | — | 0 | 0 |
| game-screen.json（含相机） | 960 / 800 | 0 | 0 | 0 | 0 | 0 | 0 |
| pause-menu.json | 960 / 800 | 0 | 0 | 0 | — | 0 | 0 |
| level-complete.json | 960 / 800 | 0 | 0 | 0 | — | 0 | 0 |
| game-over.json | 960 / 800 | 0 | 0 | 0 | — | 0 | 0 |
| rotate-prompt.json | 960 / 800 | 0 | 0 | 0 | — | 0 | 0 |

- 全部返回 `ok:true`；声明的 targetViewport（含 1024×576）由 boundaryChecks 自动探测，无越界报告。
- 修复过程中的实际问题（均已修复并复算归零）：
  1. 初稿将 `orientation/referenceResolution/targetViewports/minimumControlSize` 置于文档 `data`，校验报 `unrecognized_keys`；按契约移入**根节点 `data`** 后通过。
  2. 暂停面板静音 toggle 与标题文本框产生 overlapCandidate；标题文本框由 304 收窄为 220（文字仍居中）后消除。
  3. 旋转图形圆弧箭头初版位置超出 `rotate-graphic` 父框（outsideParent）；调整 position 为 `[50,-20]` 后消除。
- **评审 v0.2 复算**：两结算面板由 282/240 增高至统一 344（新增退出按钮；Game Over 新增条件性 badge），已对全部 6 个文件运行 `--design-layouts`（含声明变体）并对两结算屏单独以 960×540、800×450 复算：`valid:true`、五类诊断均为空、boundaryChecks 为空。
- 预期重叠的说明：面板设计为压住特效层粒子（深色实底），计算器以背景排除规则不报此类；旋转图形内部"球在设备框内"为同构图形组合，不构成控件遮挡。
- **计算器限制（如实声明）**：仅几何检查——不验证字体渲染与文本框是否容纳真实字形、不验证真实交互/焦点行为、不验证遮挡与可读性、不做运行时渲染；`ok` 仅表示检查完成。相机模式额外只验证参考面投影范围（outsideCameraView），不实现裁剪或指针逆映射。以上均须在目标运行时另行验证。本批未做运行时验证（项目尚无实现）。

## 9. 内容字段约定与实体/事件需求

- 动作标识：按钮/开关以 `actions.click` 声明，本批使用：`game:start`、`game:pause`、`game:resume`、`game:restart`、`game:quit-to-title`、`audio:toggle-mute`。这些是 UI 层对运行时的需求表达，最终事件命名以交互契约/技术实现为准。
- 条件性显隐：`ready-prompt`（Ready 可见）、`new-record-badge`（破纪录可见）均通过节点 `enabled` 由运行时切换；不新增文档类型。
- 全部数据需求（分数/生命快照、最高分与静音 localStorage、冻结/恢复、重置）均已由 GDD/AUDIO/TECHNICAL 既定；评审已决的 Game Over 屏新纪录 badge 与两结算屏退出路径不引入新实体或事件（复用既有 `game:quit-to-title` 与 badge 节点模式），已同步回改本文与 JSON。
- 绑定（bindings）首版未使用；模拟层快照到 HUD 数值的具体订阅方式归技术实现，节点 `text` 为默认占位值（`0000` 等）。

## 10. 文档间权责边界

- **本文权威**：屏幕/覆盖层/HUD 的进入退出条件与信息层级、共享 UI 组件与布局区域分配、坐标适配规则（UI 侧）、焦点导航需求、反馈时序要求、reduced-motion 原则。
- GDD：状态机、动作合法性、完成条件权威；本文不改变状态规则。
- LEVEL_SCENE_DESIGN：世界几何与世界侧叠加限制权威；本文的 HUD/提示设计遵从其带区与禁入矩形。
- BALANCE_DESIGN：分值、生命数、球速、分数域等数值权威；本文不重复参数推导。
- ART_DIRECTION：视觉身份、辉光/材质/动效性格权威；本文负责其几何落地，冲突时视觉语言以 ART 为准、结构行为以本文为准。
- AUDIO_DESIGN：声音行为与静音开关需求权威；本文负责其界面表达。
- 交互契约（待/在建）：键位清单、指针/触控映射与焦点行为的最终权威；本文第 6 节为需求声明，冲突以契约为准。
- ASSET_PLAN：字体与图标素材交付；本文的 `monospace`/字符/shape 均为首版占位。
- 任何可行性变化按 GDD 第 9 节流程反向修订，本文不自行扩大首版范围。

## 11. 遗留事项

1. 真实字体加载后的 textFit 度量（四位数字、中文文案）与对比度数值核验。
2. 覆盖层在运行时的组合验证（面板压粒子、HUD 不遮墙内矩形、letterbox 下指针映射）及触控真机热区确认。
3. 素材生产后将 shape/字符占位替换为真实图标/字体（节点结构与 id 保持不变）。

> 评审已决（2026-10-01，v0.2）：两结算屏均提供退出按钮（`game:quit-to-title`）；Game Over 屏配置条件性新纪录 badge；快速重开仅 Enter；失焦自动暂停已纳入 GDD 4.2。原第 3 条遗留项关闭。

# 打砖块（Breakout）资产计划 ASSET_PLAN

- 版本：v1.0-draft（初稿，author 批次 5/5，待统一评审）
- 作者：资产计划（Agent）
- 日期：2026-10-01
- 文档语言：中文；资源 ID、frame 名、字段名等标识符保留英文
- 依据（全部为 v0.1 初稿，本文件只汇总其已设计的用途，不新增设计）：
  - `docs/GDD.md`（首版范围、状态机、界面概要）
  - `docs/ART_DIRECTION.md`（视觉身份权威：深夜霓虹机厅、三层辉光、五层构图、UI 视觉身份、字体性格）
  - `docs/AUDIO_DESIGN.md`（声音事件行为权威；第 10 节文件规格）
  - `docs/LEVEL_SCENE_DESIGN.md`（960×540 世界几何、砖阵 10×6=60 块、相机 letterbox）
  - `docs/BALANCE_DESIGN.md`（3 命、分数域 0–6000、球与挡板参数）
  - `docs/UI_UX_SPEC.md`（6 个界面的节点结构、共享组件、等宽数字要求）
  - `content/ui/` 下 6 份 JSON：`title-screen.json`、`game-screen.json`、`pause-menu.json`、`level-complete.json`、`game-over.json`、`rotate-prompt.json`（当前 `assetRefs: []`，本计划即规划它们未来绑定的资源）
  - `assets/manifest/CONTRACT.md`（资源注册表契约：atlas frame 格式、同 basename JSON sidecar、不支持 rotated/trimmed frame）

---

## 0. 范围声明

- 本文汇总各设计文档**已经设计了实际用途**的首版资源：每项资源都能指向具体的场景节点、界面节点或状态行为；无用途的资源不列入。
- 本文**只规划**：不执行任何素材生成、检索、打包、Manifest 注册或 `assetRefs` 写入。
- 截至本批次项目无运行时实现，目录下不存在任何成品素材；本文不声称做过资源，也不声称做过任何运行时渲染或音频检查。所有"可用"结论均需在素材交付与运行时接入后按第 8 节验证。

---

## 1. 资产清单总表

| ID | 类型 | 设计用途与消费位置 | 必需/可选 | 共享关系 |
|---|---|---|---|---|
| `RES-GAME-ATLAS` | sprite-atlas（PNG + 同名 JSON sidecar） | 对局元素图集。Scene 侧：`paddle`、`ball`、`wall-top/left/right`、60 个 `brick-r{1..6}-c{1..10}` 节点的 `sprite-renderer`；L4 特效（反弹光弧、碎砖粒子）。UI 侧：HUD 生命图标 `life-icon-1..3`、`pause-button-icon`、三处静音图标（`title-mute-icon`、`hud-mute-icon`、`pause-mute-icon`）、`new-record-icon`；标题动画中的 ball / ball-trail / 光弧 | 必需 | Scene 与全部 6 份 UI 文档共享的唯一位图组；各文档 `assetRefs` 引用同一 ID，frame 名各自绑定 |
| `RES-FONT-DISPLAY-LATIN` | font（woff2） | 几何无衬线显示字体（拉丁），用于标题副标 `B R E A K O U T` 等拉丁显示文字（`title-sub`） | 必需 | `title-screen.json` 专用为主；其他界面如需拉丁显示字复用 |
| `RES-FONT-CJK` | font（woff2，regular + bold 两档） | 中文主字体：全部中文正文/标签（提示、菜单、说明）+ 中文标题"打砖块"（bold + 霓虹发光处理）+ 面板标题（"关卡完成！""游戏结束""已暂停"等） | 必需 | 全部 6 份 UI 文档共享；同时承担"显示字（中文）"与"正文（中文）"两个角色 |
| `RES-FONT-MONO` | font（woff2） | 等宽字体：HUD 全部数值（分数/最高分四位数字）、`SPACE` keycap、`NEW RECORD`、`SCORE` 等需要 tabular figures 的字符 | 必需 | `game-screen`、`pause-menu`、`level-complete`、`game-over` 共享 |
| `RES-BGM-LOOP` | audio / music（`.m4a` + `.ogg`） | 一首无缝循环合成器 BGM，对局期（Ready 淡入起）垫底，暂停挂起、结算弱化/停止 | 必需 | AudioSystem 专用；无第二首曲目 |
| SFX-PROC（无 ID，无文件） | audio，程序化 Web Audio 合成 | 覆盖 AUDIO_DESIGN 全部 SFX 事件：serve / wall / paddle / brick break / miss / reset / win / lose / UI 音。以代码模块实现，**零音频文件** | 必需（以代码交付） | AudioSystem 内部模块；不进入 Manifest，不产生 `assetRefs` |
| `RES-NOISE-TILE` | sprite（PNG，可平铺） | L1 深色背景上"几乎不可见的微噪点"，约 128×128 无缝平铺、极低透明度叠底，避免深色发死 | 可选 | 标题屏/旋转提示根节点背景叠层；程序化噪点方案可完全替代 |
| `RES-BG-TITLE` | background（独立大图） | 标题背景烘焙图（深色渐变 + 极弱网格 + 噪点一体） | 可选（**推荐不做**，见第 4 节） | 仅标题/旋转提示；与程序化背景二选一 |
| `RES-SFX-SAMPLES` | audio-bank（`.m4a` + `.ogg`，mono） | 程序化合成音色质量不达调音要求时的采样降级包：每个 SFX 事件一条短采样 | 可选 | 仅作为 SFX-PROC 的备选，不与合成同时启用 |

说明：

- 墙体在 `LEVEL_SCENE_DESIGN` 第 9 节带 `sprite-renderer`，其视觉处理（暗蓝紫直角窄边 + 内侧极弱暗青亮缘）通过图集内 3 个 wall frame 覆盖，不另立资源。
- 死亡线 `death-line` 在场景表中仅有 trigger collider、无 `sprite-renderer`；其"极暗红玫细线/虚线"视觉以运行时几何绘制覆盖，图集内保留 1 个可选 `hazard-line` 拉伸 frame 作为备选（见 2.2）。
- 旋转提示图形（设备框 + 小球 + 圆弧箭头）与 `SPACE` keycap 均由 shape/文字几何构成，不产生独立位图资源。

---

## 2. 2D 图集规划（`RES-GAME-ATLAS`）

### 2.1 分组策略与理由

**一个"对局元素图集"**：paddle、ball、ball-trail、反弹光弧（cool/warm）、碎砖粒子小块、life 实心/空心、pause/sound/star 图标、砖块全部色相 frame、墙体 frame。

理由：

1. **共享对局生命周期与采样**：这些元素在 Ready→Playing→结算的同一时间段内被高频取用，且绝大多数在单局开始后即持续需要——打成一个图集，启动后一次解码、全程复用，无中途 fetch/decode 抖动。
2. **共享视觉语法**：全部遵循 ART_DIRECTION 的"实体芯 + 亮缘 + 同色外辉"三层结构，适合一次成组生成或同一套程序化绘制参数产出，保证辉光粗细、圆角半径、色相关系一致。
3. **Canvas 2D 友好**：契约要求 frame 是共享图源上的区域，`drawImage` 源矩形 1:1 映射；小图集中管理比多散图更利于缓存与复用。

**大背景（标题/场地背景）不进图集**：背景是铺满全屏、与对局元素采样节奏不同的独立层，需要随容器拉伸并负责 letterbox 填充；且其内容（渐变、极弱网格、噪点）可由实时几何/渐变实现，无需烘焙位图。把大面积低频内容塞进图集只会放大图集边长、浪费解码内存（单图边长安全线 2048）。

### 2.2 frame 清单

约定：

- **逻辑显示尺寸**为 960×540 设计坐标下的尺寸（世界几何引用 LEVEL_SCENE_DESIGN：paddle 96×16、ball d=10、砖 72×24、life 22×22、控件 44×44）。
- **frame 像素尺寸含烘焙辉光**：frame 画布 = 逻辑尺寸 + 两侧外辉余量；显示时仍按逻辑尺寸绘制，辉光自然包含在内，pivot 仍为几何中心。下表"frame 尺寸（1×）"为含辉光的源画布建议值。
- pivot 以 frame 全画布归一化表达；居中元素因辉光对称，pivot=0.5 即对齐逻辑中心。ball-trail 的附着端单独说明。
- 全部 frame 无方向旋转帧；无 trim（保留完整透明画布，保证逻辑尺寸与采样框稳定）。

| frame 名 | 逻辑显示尺寸 | frame 尺寸（1×，含辉光） | pivot | 消费位置 |
|---|---|---|---|---|
| `paddle` | 96×16 | 120×40 | 0.5, 0.5 | Scene `paddle`（L3），青色大圆角胶囊，两端亮缘略强 |
| `ball` | 10×10 | 20×20 | 0.5, 0.5 | Scene `ball`（L3）；标题动画小球；近白核 + 极短青缘 |
| `ball-trail` | 48×10 | 56×18 | 1.0, 0.5（亮端在右，附着于球；运行时可整体旋转） | 标题贯穿拖尾（主用）；运行时拖尾的烘焙备选（运行时拖尾推荐用 ball frame 衰减印记程序化绘制，以随速度改变长度） |
| `arc-cool` | 24×14 | 32×22 | 0.5, 0.5 | L4：挡板击球光弧（青，半括号形） |
| `arc-warm` | 24×14 | 32×22 | 0.5, 0.5 | L4：碎砖光弧（暖；行色由运行时染色或绑定同行色相） |
| `particle-block` | 8×8 | 12×12 | 0.5, 0.5 | L4：碎砖/胜利粒子的圆角小光块 |
| `particle-dot` | 6×6 | 10×10 | 0.5, 0.5 | L4：碎砖光点、击球火花、拖尾末端离散光点（1–2 枚） |
| `life-solid` | 22×22 | 28×28 | 0.5, 0.5 | HUD `life-icon-1..3` 存在态（与球同形的近白实心圆） |
| `life-empty` | 22×22 | 28×28 | 0.5, 0.5 | HUD 生命失去态（暗色空轮廓）；短红辉光为运行时效果，不烘焙 |
| `icon-pause` | 20×20 | 24×24 | 0.5, 0.5 | `pause-button-icon`（两根竖条，替换占位文字 `II`） |
| `icon-sound-on` | 24×20 | 28×24 | 0.5, 0.5 | 三处静音 toggle 有声态（喇叭 + 声波） |
| `icon-sound-off` | 24×20 | 28×24 | 0.5, 0.5 | 三处静音 toggle 静音态（喇叭带叉） |
| `icon-star` | 18×18 | 24×24 | 0.5, 0.5 | `new-record-icon` / `gameover-new-record-icon`（同一 frame 两屏共享，替换 star shape 占位） |
| `brick-r1` … `brick-r6` | 72×24 | 84×36 | 0.5, 0.5 | 60 个砖节点：row r 绑定 `brick-r{r}`（见 2.3） |
| `wall-top` | 拉伸：横向整墙 | 32×16（无外辉） | 0.5, 0.5 | `wall-top`：亮缘在下缘（内侧） |
| `wall-left` | 拉伸：纵向整墙 | 16×32（无外辉） | 0.5, 0.5 | `wall-left`：亮缘在右缘（内侧） |
| `wall-right` | 拉伸：纵向整墙 | 16×32（无外辉） | 0.5, 0.5 | `wall-right`：亮缘在左缘（内侧） |
| `hazard-line`（可选） | 拉伸：横贯 x80–880，逻辑高 4 | 32×4 | 0.5, 0.5 | `death-line` 备选视觉：等距短划虚线、极暗红玫色；**默认方案为运行时几何绘制**，此 frame 可不产出 |
| `icon-rotate`（可选） | 32×32 | 36×36 | 0.5, 0.5 | `rotate-arrow` 备选（替换占位字符 `↻`）；默认保留字符方案时不产出 |

frame 统计：必需 24 个（含 6 个砖块 frame、3 个墙 frame），可选 2 个（`hazard-line`、`icon-rotate`）。

### 2.3 砖块 frame：6 行暖色递进的最少表达

- 玩法上 60 块砖完全等价，行间只允许平滑暖色位移（品红 → 玫红 → 橙 → 琥珀），不得出现跳变色带。
- **推荐：6 个色相 frame（`brick-r1`…`brick-r6`），数据按行绑定**——row r 的全部 10 块砖引用同一 frame。理由：frame 数量虽按行数给满，但每个 frame 同时被 10 个节点复用，实际成本极低；且逐行独立色相可精确控制"相邻行色差小、整面远看统一"，绑定规则最简单（r → `brick-r{r}`），无需运行时混色。
- 色相走向：r1 品红 → r2 玫红 → r3 玫红偏橙 → r4 橙 → r5 橙偏琥珀 → r6 琥珀；具体取色在制作时对照 ART_DIRECTION 调色板校准，灰度检验时 6 行明度必须一致（不允许某行明显更亮）。
- 备选：4 个色相 frame（品红/玫红/橙/琥珀），r2、r5 行取相邻 frame 或由运行时做两 frame 插值；可再省 2 个 frame，但相邻行节奏控制变粗，不作为推荐。
- 明确禁止以 frame 数量或色相暗示砖的强度/分值差异——这是视觉节奏 frame，不是类型 frame。

### 2.4 打包规格

- **出图倍率 2×（Retina）**：所有 frame 按上表 1× 尺寸的 2 倍绘制；运行时按逻辑尺寸绘制，Canvas DPR 上限取 2。
- **padding：4px（2× 源像素，即逻辑 2px）**；**bleed：frame 边缘向外复制 2px（2× 源像素）同色像素**，避免线性采样在 frame 边缘取到透明或邻 frame 颜色。含辉光 frame 的透明边缘不做硬裁切，辉光衰减在 frame 画布内自然落到零 alpha。
- **无旋转帧、无 trim**：契约明文不支持 rotated/trimmed frame；方向变化（如 ball-trail）由运行时节点旋转完成。
- sidecar JSON 采用契约格式：`frames: { "<name>": { "frame": { "x": …, "y": …, "w": …, "h": … } } }`，与 PNG 同 basename；每个矩形必须完整落在图源内。
- 图集画布估算：2× 下约 **2048×256**（6 个砖块 frame 横向排布约 1050px 宽，paddle/墙/图标分两到三行），最终由打包结果确定；远低于 2048×2048 单图安全线。

---

## 3. 标题画面资源

### 3.1 标题霓虹字处理：推荐"真字体 + 实时发光"，不做标题图

- **推荐方案**：`RES-FONT-CJK` bold（中文"打砖块"）与 `RES-FONT-DISPLAY-LATIN`（副标 `B R E A K O U T`）排字，霓虹灯管效果以实时发光实现：字形主体近白 + 沿字形的青/同色描边辉光（Canvas `shadowBlur` 分层叠加或等价的多层发光绘制），配极轻微辉光呼吸；标题贯穿的球拖尾直接使用 `ball` + `ball-trail` frame 做一次横向滑动动画，划过时字面短暂增亮（增亮为运行时合成）。
- 理由：文字保持可编辑（改文案/校字无需重新出图）、与正文同一字体度量体系、体积几乎为零；发光、呼吸、拖尾增亮全部可实时控制，契合"通电灯管字"设定。
- 不推荐烘焙标题 PNG：会锁死文字、2× 下体积大、任何文字调整都要重新出图，且发光在静态图上无法呼吸。仅当实时发光效果在目标运行时明显不达 ART 标准时，才考虑烘焙标题图作为降级（届时单独立资源，不进图集）。

### 3.2 标题背景层（明确哪些可程序化替代）

- **深色渐变**（顶部略偏紫 `#150C30` → 底部略偏蓝 `#0A1226`，已在 `title-screen.json` root style 中）：实时渐变填充，**无需烘焙**。
- **极弱透视网格**：以实时线条绘制，透明度压到纯色截图才可察觉；只允许出现在上部区域，**不得延伸进底部安静区**（左下至中下），**无需烘焙**。
- **微噪点**：默认用程序化噪点（运行时生成或极低 alpha 的细密点绘）；若实时噪点成本过高，使用可选的 `RES-NOISE-TILE` 平铺，二者择一。
- 安静区不放置任何图形节点，辅助信息（最高分）保持角落低明度小字——无资源需求。

---

## 4. 背景与独立层

- **L1 背景大图**：首版**不需要**。L1 职责（深色渐变铺满 + 极弱网格/噪点）全部可由实时渐变、线条与可选噪点平铺完成；L2 游戏空间底板为比 L1 略亮一档的深蓝面板（运行时矩形填充，颜色已见于 JSON：root `#070B1C`、game-view `#0B1026`）。`RES-BG-TITLE` 仅在程序化背景经运行时验证不达 ART_DIRECTION 第 10 节标准时才启用（建议 1920×1080、2× 不再加倍、覆盖式拉伸），首版不预生产。
- **letterbox 区填充**：比 16:9 更宽/更方的宿主出现留黑时，留黑区由 root 背景深色实时填充（无白边、无宿主页面亮色），**无资源、无位图**；世界本身不随宽高比变形或裁剪。
- L4 特效层为独立透明层：光弧/粒子 frame 均不含底色，暂停与结算时可被整体压暗、冻结；结算面板靠自身深色实底压住粒子，不需要额外遮罩图。

---

## 5. 字体

### 5.1 字体角色与选型

| 角色 | 推荐字体 | 格式 | 说明 |
|---|---|---|---|
| 显示字体（拉丁） | Chakra Petch（备选 Orbitron） | woff2 | 几何、方正、工业电子气质；用于 `B R E A K O U T` 及拉丁显示文字，配霓虹发光 |
| 正文 + 中文显示 | Noto Sans SC（Source Han Sans），weights 400/700 | woff2 | 中性清晰无衬线；regular 承担正文/标签，bold 承担中文标题与面板标题，霓虹效果由发光层附加 |
| 等宽数字 | Share Tech Mono（备选 JetBrains Mono / Roboto Mono） | woff2 | 全部数字位等宽（保证 tabular figures）、带街机气质；用于 HUD 数值、keycap、`NEW RECORD` |

全部字体以 **woff2** 交付（现代浏览器目标，不预制作其他格式；如兼容性评审提出再加 woff 降级）。许可均为 SIL OFL 1.1（见第 7 节）。

### 5.2 中文字符集与子集化策略

首版游戏内可见中文（来自 6 份 JSON）仅以下字符串：

- "打砖块"、"开始游戏"、"最高分"
- "点击 / 空格 发球"
- "已暂停"、"继续"、"重新开始"、"退出"
- "关卡完成！"、"当局得分"、"再来一局"
- "游戏结束"
- "请旋转设备至横屏"、"窗口尺寸不足"

去重后共 **51 个汉字**：

> 打 砖 块 开 始 游 戏 最 高 分 点 击 空 格 发 球 已 暂 停 继 续 重 新 退 出 关 卡 完 成 当 局 得 再 来 一 结 束 请 旋 转 设 备 至 横 屏 窗 口 尺 寸 不 足

子集化策略：

1. 保留原始全量字体文件归档；用 fonttools（pyftsubset）对 `RES-FONT-CJK` 按"上述 51 字 + ASCII 可打印字符 + 中文标点（！。，？：、（）等）"产出 woff2 子集，两档字重各一份；拉丁显示字与等宽字按 ASCII 子集。子集后单文件预期为数十 KB 量级。
2. 字形清单写入本文件即权威；**任何文案新增汉字，必须先更新清单并重新子集化**，不得依赖运行时回退字形长期使用。
3. `@font-face` 的 `font-family` 栈保留系统中文/系统等宽兜底（子集未覆盖或加载失败时优雅降级）；因体积极小，可预加载子集以避免首屏文字闪烁。
4. 占位字符 `♪`（U+266A）、`↻`（U+21BB）将被图集 frame 替换；若评审决定保留字符，必须把对应码点加入子集并通过覆盖检查。

### 5.3 textFit 与真字体度量

- HUD 数值框（四位数字，宽 88–96px）必须在字体加载完成（`document.fonts.ready`）后，用**真实字体**度量最大可能值（`0000`…`6000`）再锁定框宽；Share Tech Mono 下四个数字 advance 等宽，计分跳动与进位时数字不左右位移。
- 中文长文案（如"请旋转设备至横屏""点击 / 空格 发球"）同样按真字形度量排进固定文本框，不允许运行时无界缩小字号救场。
- 当前 JSON 中 `fontFamily:"monospace"` 仅为占位，字体资源交付后按 5.1 替换。

---

## 6. 音频

（行为细节以 `docs/AUDIO_DESIGN.md` 为权威，本节只汇总素材与格式。）

### 6.1 合成 vs 采样分工（推荐）

- **全部 SFX：程序化 Web Audio 合成，零文件**。理由：AUDIO_DESIGN 的音色方向本就是方波/锯齿短音、数字噪声爆破、短 FM 叮音——与振荡器/噪声缓冲合成完全同构；合成方案天然支持同帧多砖的半音级音高台阶（上限 3–4 级）、墙音截断重触发、零交叉淡出与手势前静默，且零加载体积、许可零风险。
  - 事件 → 合成语音对应：serve（上扬滑音）、wall（最短低能 tic）、paddle（略厚低短拍）、brick break（噪声瞬态 + FM 叮，音高随多砖数上台阶）、miss（明显下坠落音）、reset（两声中性确认）、win（3–5 音上扬琶音）、lose（3–5 音下行短句）、UI（确认 blip / 取消低音 / 暂停开下沉 / 暂停合回升）。
  - 交付物为一个 agent-authored 音频代码模块及可调参数表，不产生 Manifest 音频资源。
- **BGM：采样素材**（唯一音频文件资源 `RES-BGM-LOOP`）。理由：循环曲需要完整编曲与合成器宽度，程序化编排成本高且稳定性差；一首短循环采样即可，不引入音乐系统。
- 备选：仅当合成语音经调音仍不满足"同一台街机"的听感统一时，启用 `RES-SFX-SAMPLES` 单声道采样包整体替换合成模块；不逐事件混用。

### 6.2 BGM 规格与循环点

- 一首低调 synthwave 循环，建议循环时长 **32–64 秒**（短时重复不疲劳、低旋律侵略性）。
- **立体声**（保留合成器宽度；不做定位玩法）；44.1kHz。
- **无缝循环**：混音导出时循环边界处波形匹配（建议零交叉/首尾包络对齐），运行时以 Web Audio 采样级循环（`loop=true`，loopStart/loopEnd 即素材边界），接缝处听感差异须为零；不得用"播完重新触发"方式。

### 6.3 格式矩阵与降级

| 用途 | 声道 | 时长 | m4a（AAC LC） | ogg（Vorbis） |
|---|---|---|---|---|
| BGM（`RES-BGM-LOOP`） | stereo | 32–64s | 44.1kHz，约 128kbps | 44.1kHz，q≈0.4（约 112kbps） |
| SFX 采样包（可选 `RES-SFX-SAMPLES`） | **mono** | 碰撞类 <1s；漏接/终局短句 <3s | 44.1kHz，约 96kbps | 44.1kHz，q≈0.25–0.35 |

- 运行时按可解码性选择成员：m4a/AAC 覆盖 Safari/iOS 与全部现代浏览器，ogg 作为 Firefox 等环境的并行降级；两种格式都列入同一资源的 `file_paths`，默认入口选其一。
- SFX 合成方案下无 mono 文件问题；若启用采样包，全部为 mono（2D 非定位音，避免伪空间感与体积浪费）。

---

## 7. 来源与许可方案

| 资源 | 推荐来源 | 备选 | 许可要求 |
|---|---|---|---|
| `RES-GAME-ATLAS` | **自制程序化绘制**为基线（圆角几何 + 径向/线性渐变 + 辉光分层，像素级精确、零许可风险）；需要更丰富灯管质感时，以 **AI 一次成组生成**全部 frame（同一提示、同一深色背景、同一辉光语法出一张组图，再程序化切框打包） | CC0 素材库检索通用图标（Kenney 类风格包）仅作个别图标补救 | 视觉一致性优先：禁止逐 frame 从不同网页/风格零散检索（风格漂移不可验收）。AI 生成须确认所用平台条款授予商用且不涉及第三方 IP；记录生成批次与提示；成品以 agent-authored/资源库来源事实登记 |
| 砖块 frame | 与图集同一批次产出（程序化或 AI 成组），禁止单独检索 | — | 同上；6 frame 必须同一光照与辉光强度 |
| `RES-FONT-*` | Google Fonts 官方渠道下载 woff2（OFL 字体） | 各字体官方 OFL 发布渠道 | SIL OFL 1.1，随资源保留 license 文件；子集化不改变许可，保留字体署名 |
| `RES-BGM-LOOP` | 自制（DAW/合成器编曲导出 agent-authored） | CC0 合成波循环检索（须记录原 URL、页面、许可、获取时间） | 自制规避来源风险；CC0 需核实"无采样版权负担"；不使用训练与版权条款不明确的 AI 音乐服务 |
| SFX-PROC | agent-authored 合成代码 | `RES-SFX-SAMPLES`（CC0 复古电子音效包或自制渲染采样） | 代码自有；采样沿用 CC0/自制登记要求 |
| `RES-NOISE-TILE` | 自制（程序生成噪点并导出可平铺 PNG） | CC0 噪点平铺素材 | 同上 |

通用要求：所有外部来源事实（URL/page/licence/时间或 pack/element 身份）随资源在 Manifest 中登记；许可不清的素材不进入项目；任何资源在通过第 8 节检查前不标记为 verified。

---

## 8. "可用标准"与绑定方式

### 8.1 每项交付的验收口径

**`RES-GAME-ATLAS`**

- PNG 带 alpha，无底色；同名 JSON sidecar 存在且每个 frame 矩形完整落在图源内；frame 名大小写与 2.2 清单精确一致。
- 无 rotated/trimmed 条目；2× 源在逻辑尺寸绘制时 Retina 下清晰无锯齿；含辉光 frame 的边缘按 2.4 做 bleed，相邻 frame 无串色。
- 逐 frame 抽绘检查：paddle/ball/砖/wall 的逻辑显示尺寸与几何一致（96×16、d=10、72×24、墙厚 16）；三层辉光层级符合 ART（球 > 挡板 > 砖，墙无外辉）；6 个砖块 frame 灰度明度一致。
- 运行 `bun assets/manifest/check.mjs` 通过。

**字体（三份）**

- woff2 可正常解码；提供字形覆盖证据：`RES-FONT-CJK` 覆盖 51 字清单 + 标点无缺字；拉丁/等宽字体覆盖 ASCII。
- tabular figures 证据：等宽字体 0–9 的 advance width 完全一致；HUD 四位数字按真实度量入框（textFit），计分跳变不抖位。
- 中文长文案按真字体度量排进固定文本框；license 文件随附。

**`RES-BGM-LOOP`**

- m4a 与 ogg 均可解码、均为立体声；循环接缝做零差异/零交叉验证，连续循环多遍无可察觉接缝与爆音；时长在 32–64s 区间。

**SFX-PROC**

- 代码模块在 AudioContext suspended/不可用时静默不报错；按 AUDIO_DESIGN 逐事件核对触发时机（含末砖+越线播胜利音、同帧多砖只发一声且音高有台阶、暂停期无余音）；主总线在高频连发下不削顶。此项为代码验收，不产生文件交付物。

### 8.2 绑定到 content/ui assetRefs 与 Scene 组件

- 资源先在 `assets/asset-manifest.json`（requirements/resources 分离）注册并取得 verified 状态后，才允许被内容引用；每个被使用的资源 ID 在引用文档的 `assetRefs` 中列一次。
- **Scene（内容阶段创建于 `content/scenes/`）**：`paddle`/`ball`/`wall-*`/60 个砖节点的 `sprite-renderer` 以组件 `assetRef: "RES-GAME-ATLAS"` + 组件 `data.frame`（砖节点 row r 绑 `brick-r{r}`）引用；`death-line` 默认不挂 sprite，以运行时细线/虚线绘制。
- **6 份 UI JSON**（节点结构与 id 保持不变，只补引用）：
  - 文档级 `assetRefs`：按实际消费列入 `RES-GAME-ATLAS` 及所用字体资源 ID。
  - 图标占位（`II`、`♪`、star shape 等）替换为对应 frame 引用（通过节点嵌套 data 中的 frame 引用字段，具体字段以 content-format 在接入时为准），不重命名节点；life shape 替换为 `life-solid`/`life-empty`。
  - 文字节点按契约以 `data.font.assetRef` 绑定具体字体资源（中文 `RES-FONT-CJK`、数字 `RES-FONT-MONO`、拉丁显示 `RES-FONT-DISPLAY-LATIN`）；替换现有 `fontFamily:"monospace"` 占位。
- **BGM**：由 AudioSystem 从 `RES-BGM-LOOP` 中按可解码性选择成员文件，不经过 UI 节点引用；SFX-PROC 无任何 `assetRefs`。
- 资源引用的运行时验证按契约 resource-binding 执行：真实改变资源/frame 引用必须真实改变呈现或播放结果，HTTP 200 或文件名存在不构成绑定证据。

---

## 9. 执行边界

- 本文只做规划：未生成、未检索、未打包、未注册任何资源，未修改任何 JSON 的 `assetRefs`，也未修改 `docs/` 下其他文件。
- 素材生产、Manifest 注册、内容绑定与运行时验收均为后续工作；届时如实际可行性与本计划冲突，按 GDD 第 9 节流程反向修订相关文档并回改本文件。

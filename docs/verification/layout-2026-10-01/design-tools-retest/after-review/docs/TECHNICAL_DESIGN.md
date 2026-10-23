# 技术设计文档（TECHNICAL_DESIGN）——打砖块（首版）

- 文档名：TECHNICAL_DESIGN.md
- 版本：v1.0（作者批次 5/5 定稿）
- 作者：技术设计 owner
- 日期：2026-10-01
- 文档语言：中文

---

## 1. 目的、范围与定稿状态

本文档是首版打砖块的**运行时技术定稿**：规定模块职责、初始化与清理顺序、规则求值顺序、数据消费与绑定方式、取景适配实现，以及加载/失败/性能策略。

v1.0 相对 v0.1 的变化不是新增决策，而是与四份已定稿设计**逐一调和后闭合**：

| 上游文档 | 调和结论 |
|---|---|
| `docs/GDD.md` | 六状态与操作表为玩家可见行为权威；本文第 4 节把 GDD 6.2 的同帧优先级落成单步求值顺序，不选择任何不同的玩法结果。 |
| `docs/LEVEL_SCENE_DESIGN.md` + `content/scenes/breakout_level.json`（70 节点）+ `content/scenes/breakout_camera.json` | 世界几何与取景以此为唯一来源；相机 keep-height，场景 behaviors 占位 kind 字符串全部保留并在第 5.2 节固化。 |
| `docs/BALANCE_DESIGN.md`（+ `balance_model.mjs` / `balance_appendix.md`） | 全部调值（360/420/480/540、发球 40°（窗口 30–50）、挡板 120、键盘 560、生命 3、行分 60..10、总分 2100、fixedDt=1/120、单帧 8 步）落入第 6 节调值文件契约；本文不复制第二张数值表。 |
| `docs/UI_UX_SPEC.md` + `content/ui/` 九份 JSON | 根字段 Landscape / 1280×720 / 视口三档 / minimumControlSize [88,44] / compactMaxWidth 1024 全部采纳；bindings/actions 的消费方式在第 5.4 节回填闭合。 |
| `docs/AUDIO_DESIGN.md` | 事件名表、并发 6–8 路、三总线、`audio.unlock()` 手势与会话内作用域全部落实；技术后端选定 Web Audio（第 2.8 节）。 |
| `docs/ART_DIRECTION.md` | 视觉参数（色值、发光档位、形状语言、反馈时长）由渲染器按数据/资源消费，本文不另建参数表。 |
| `docs/ASSET_PLAN.md` | 资源分组、单一 gameplay 图集（11 必需帧，整体随 startup 装载——开始按钮/面板/球帧首屏即需）、字体 woff2 与音频文件规格与其一致；Manifest 注册由实现/整合执行。 |
| `.beegame/delivery/content-format.json` | 遵循 index `beegame-content-package.v2`、`sceneModel: game-object-v2`、startup/on-demand 规则与 `runtimeConsumption`；三类绑定验证在实现批次执行，当前未验证。 |

边界声明（沿用 v0.1 并继续生效）：本文不重述 GDD 规则的玩法含义；不规定平衡数值（只定义其承载文件与消费方式）；不替代 Scene/UI 作者的摆位与布局；任何实现结果若与 GDD 可观察规则冲突，以 GDD 为准。v1.0 不含"待补"清单；剩余事项全部是实现/评审阶段的**运行时验证项**（第 10 节）。

## 2. 运行时模块职责

### 2.1 模块总览

```
                    ┌──────────────────────────────┐
                    │  React 应用装配 / 屏幕路由     │  (2.2)
                    └───────────┬──────────────────┘
            ┌───────────────────┼────────────────────┐
            ▼                   ▼                    ▼
   ┌─────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ Canvas 世界渲染器 │ │   UI 绑定层        │ │   输入适配器       │
   │   (2.3)         │ │   (2.7)          │ │   (2.5)          │
   └────────▲────────┘ └────────┬─────────┘ └────────┬─────────┘
            │                  │ bindings 指令       │ 意图
            │ 绘制指令          ▼                    ▼
            │        ┌──────────────────┐ ┌──────────────────┐
            └────────│   逻辑引擎         │◄│  (设备无关意图)    │
                     │ fixedDt 1/120    │ └──────────────────┘
                     │   (2.4)          │◄──┐
                     └──────┬───────────┘   │ 解析后数据
                            │ 事件/状态       │
              ┌─────────────┼───────────┐   │
              ▼             ▼           ▼   │
       ┌────────────┐ ┌────────────┐    ┌───┴──────────────┐
       │ 音频系统     │ │ UI 反馈状态  │    │ 数据加载器 (2.6)   │
       │ Web Audio  │ └────────────┘    │ index/Scene/UI/   │
       │  (2.8)     │                   │ Manifest/图集帧    │
       └────────────┘                   └──────────────────┘
```

依赖方向单向：React 装配拥有其余模块；逻辑引擎不感知 React/DOM/设备；数据加载器不持有玩法状态；输入适配器只产出设备无关意图。模块之间通过显式调用与事件队列通信，**行为不依赖未声明的执行顺序**（具体顺序见第 3、4 节）。

### 2.2 React 应用装配与屏幕路由

- React 负责：应用生命周期、React 组件树装配、屏幕路由（当前挂载哪个 UI 文档）、Canvas 节点的持有、各模块的创建/连接/销毁。
- 屏幕路由是一个以 GDD 六状态（Menu / Ready / Playing / Paused / LevelClear / GameOver）与环境门控（竖屏、空间不足、加载中、加载失败）为输入的**确定性映射**：

| 路由情形 | 挂载内容 |
|---|---|
| 启动加载中 | `loading` |
| 启动/按需加载失败 | `load_error` |
| Menu | `start_screen` |
| Ready | 世界画布 + `game_hud`（含发球提示节点） |
| Playing | 世界画布 + `game_hud`（发球提示隐藏） |
| Paused | 世界画布（定格）+ `game_hud` + `pause_overlay` |
| LevelClear | 世界画布（球停止）+ `level_clear` |
| GameOver | 世界画布（球停止）+ `game_over` |
| height > width | `rotate_prompt`（取代上述内容，旋转回横屏自动恢复原路由） |
| 横屏但视口低于 960×540 | `space_prompt`（恢复尺寸后自动消失） |

- 路由只决定**挂载关系**；界面内所有节点几何由 UI JSON 解析，不用 CSS 自由排版发明（第 5、7 节）。
- React 不在帧循环内做协调：世界态变化（挡板/球/砖块）不触发 React 重渲染；HUD 文本与 pip 的更新由 UI 绑定层在 React 渲染通道外直接驱动（第 2.7 节），仅屏幕切换与覆盖层挂载走 React。

### 2.3 Canvas 世界渲染器

- 单一 `<canvas>` + `CanvasRenderingContext2D` 承担世界层（挡板、球、60 块砖、边界、背景、拖尾、碎块）；React 拥有画布节点，绘制在 `requestAnimationFrame` 帧循环中进行。
- 消费场景数据：节点 hierarchy、`enabled`、world transform（父变换组合一次）、`zIndex` 绘制顺序、`sprite-renderer`（assetRef 或作者占位 shape）、相机取景（第 7 节）。
- 分层绘制：背景层（暗墙、网格、中远光）在尺寸/取景变化时预渲染到离屏画布，帧内只做一次 blit；每帧实际重绘边界、存活砖块、挡板、球、拖尾与瞬态碎块。当前场景全部 sprite 为带显式 `size` 的作者占位（`"placeholder": true`、`assetRefs: []`），渲染器按作者占位数据绘制；占位是**作者数据**，不是代码内置图形回退。
- 画布 backing store 按容器 CSS 尺寸与设备像素比设置；容器尺寸变化时重算取景、重建 backing、重渲染背景离屏层。
- 绘制内容严格落在世界相机取景结果内；渲染器不计算玩法、不修改状态。

### 2.4 逻辑引擎（固定步长累加器）

- 由 `requestAnimationFrame` 驱动；以 `performance.now()` 计算帧间隔，累加器消费：
  - **固定逻辑步长 `fixedDt = 1/120 秒`（逻辑 120Hz）**——来源 BALANCE_DESIGN 3.5；
  - 每帧执行 0..N 个定步更新，**`maxStepsPerFrame = 8`**（约 66.7ms 逻辑预算）；
  - 累加器超过 8 步预算时**钳制并丢弃多余时间**，不补发、不回溯——死亡螺旋只丢弃展示时间，不改变规则结果；
  - 60/120/144/240Hz 刷新率由累加器自然归一：同一段时间内逻辑步数只由真实流逝时间决定，高刷屏不出现"球速翻倍"，低刷屏不穿透砖块。
- 每个逻辑步的求值顺序见第 4 节；逻辑引擎只消费设备无关意图与解析后数据，输出状态变更与事件队列。
- 渲染插值：v1.0 **直接取最新逻辑态绘制**（不做累加器剩余量插值）。120Hz 逻辑对 60Hz 屏每帧 2 步、单步位移 3–4.5px；是否需要渲染插值列为运行时观察项（第 10 节），不在本版预制。
- 暂停、LevelClear、GameOver 进入瞬间冻结逻辑更新（GDD 5.2、6.3）；冻结期间累加器不增长、不积分；Ready 停留不计时、不扣生命。
- 标签页隐藏时 RAF 自动暂停；恢复后按恢复时刻继续，不补发积压运动；隐藏期间的处理策略见第 3.2 节。

### 2.5 输入适配器

- GDD 第 4 节操作表为权威；适配器把键盘、鼠标、触屏三类物理输入归一为同一组设备无关意图，逻辑引擎只消费意图：
  - `movePaddle(targetX)`：挡板目标横坐标（世界逻辑坐标）；
  - `serve()`：发球（边沿意图，仅 Ready 有效）；
  - `pauseToggle()`：暂停/继续（仅 Playing 接受进入暂停）；
  - UI 动作：`startGame / resume / restart / exitToMenu / retryLoading`，由 UI 绑定层按界面节点派发。
- 归一方式：
  - **键盘**：左右方向键/A、D 产生按住方向状态，逻辑步按 `paddle.keyboardSpeed = 560 px/s` 积分出挡板中心；空格 → `serve`；P/Esc → `pauseToggle`；覆盖层按钮走焦点确认（Enter/Space），长按不连发。
  - **鼠标**：场地内指针横坐标经屏幕→世界逆映射（第 7.2 节，与渲染同一取景）直接作为 `targetX`，不要求指针位于挡板上；点按发球热区由 UI 节点派发 `serve`；按钮点击走 DOM。
  - **触屏**：触点横坐标同逆映射为 `targetX`，拖动持续更新；点按发球热区派发 `serve`；按钮点按走 DOM。触点与兼容鼠标事件去重，一次触碰不产生双份意图。
- 多设备并存：只更新同一个 `targetX`（最近一次有效输入自然覆盖），不维护设备分支状态。
- 状态门控在消费侧：Paused/LevelClear/GameOver 丢弃 `movePaddle/serve`；仅 Ready 接受 `serve`；门控丢弃的意图不缓存、恢复后不补发（GDD 6.3）。
- 发球水平方向符号：自进入本次 Ready 以来最后一次有效横向输入的方向；无前置输入时向右（BALANCE 3.1）。

### 2.6 数据加载器

- 唯一入口 `content/index.json`（schema `beegame-content-package.v2`，`dimension: 2d`，`sceneModel: game-object-v2`，声明 `entryScene`）：把文档 ID 解析到 `content/` 相对路径；`documents` 中每个 `files` 条目恰好登记一次（`id/path/kind/loadPhase`）。
- 按 `loadPhase` 取文档：startup 文档首屏前获取；on-demand 文档仅在进入/需要时获取（清单见第 5.3 节）。
- 资源解析：所有资源经 `assets/asset-manifest.json` 解析，禁止文件名猜测；多文件资源用 `member` 精确定位；图集帧用 `frame`（区分大小写、不带扩展名），帧是共享图源的区域选取，不逐帧 fetch/解码；区域视图独立 UV、不复制像素。
- 按解析 URL 复用在途加载与已解码图源（引用计数）；同一用途不同时加载打包图与原图；不预载无关图集组。图源在全部消费者结束后释放；文档/节点卸载解除引用。
- 任何文档获取/解析失败、assetRef 无法解析到 verified 资源：显式报错进入 `load_error`（第 8 节），不静默回退。

### 2.7 UI 绑定层

- 职责：把 UI 文档节点的 `bindings` / `actions` 字段接到会话状态与命令派发，是 UI_UX_SPEC 9.2 回填请求的闭合实现。
- **数据绑定（bindings）**：
  - `source: "session.score"` + `format: "00000"` + `range: "[0,2100]"` + `digits: "5"`：会话分数变化时更新节点文本为 5 位补零等宽数字；
  - `source: "session.lives"` + `index` + `aliveStyle/lostStyle`：序号 ≤ 当前生命 → alive 表现，否则 lost 表现；原地换形不重排；
  - `source: "session.bricksBroken"` + `format: "击碎砖块 {value} / 60"`：模板替换；
  - `enabledWhen`：闭集谓词（当前仅 `state===ready`、`lastRetryFailed===true` 两种），按字面字段比较求值，禁止脚本；
  - `defaultFocus` / `tabOrder`：供焦点管理器在界面挂载时设置默认焦点与 Tab 循环。
  - 绑定字段在 JSON 中均为字符串记录，绑定层按字段声明解析（不做任意 JS 求值）。
- **动作派发（actions）**：
  - `action` 字符串派发到应用命令：`startGame / pauseToggle / resume / restart / exitToMenu / serve / retryLoading`（语义见 3.1、5.4）；
  - `audioEvent`：在按钮**实际激活**（而非悬停/聚焦）时向音频系统发射对应事件名（与 AUDIO 12.1 一致）；
  - `audioUnlock: "true"`：仅开始按钮持有——在同一次用户手势处理中先/同步调用 `audio.unlock()`，再派发 `startGame`；解锁成败均不阻塞进入流程（无声可玩）。
  - 一次有效激活 = 一次命令派发 + 一次音频事件；键盘确认与指针点击按激活去重，不响两次。
- 绑定更新由帧/状态变化驱动直改 DOM，不经过 React 协调；屏幕切换时随文档挂载/卸载绑定。

### 2.8 音频系统：选定 Web Audio API

**决定：首版音频后端采用 Web Audio API（`AudioContext` + 音频缓冲/总线图），不采用 HTMLAudio（`Audio` 元素）。**

依据 AUDIO_DESIGN 的事件密度与控制要求，逐项对照：

| AUDIO_DESIGN 要求 | HTMLAudio | Web Audio（选定） |
|---|---|---|
| 碎砖高频连击的截断重启（voice choke/retrigger，碎砖 1–2 路） | 无可靠语音名额与互截断；逐音新建元素成本高 | 自有 voice 池，同组可立即 stop 旧声源重触发 |
| 全场音效 ≤6–8 路、按优先级淘汰、P0 永不被抢占 | 无中央调度 | 按优先级队列分配/回收声源 |
| P0（失误/过关/失败）须压过在响 P2：截断或快速压低 | 无法统一快速压低 | 可立即 stop P2 声源并对 SFX 总线做快速 gain ramp |
| 三总线（Master/Music/SFX）、音乐/音效分别静音、ducking | 元素无统一总线路由 | `sfxGain / musicGain → masterGain → destination` |
| 所有增益变动走短 ramp、防削波防爆音 | 仅 volume 标量、无渐变曲线 | `setTargetAtTime` / 线性/指数 ramp |
| 碎砖音高随机微移 | playbackRate 可粗调但难统一管理 | 每声源独立 `playbackRate`（±半音~小三音） |
| 与判定同逻辑帧精确触发 | 调度粒度粗 | 帧内事件队列精确触发 |
| 底乐暂停在当前位置、继续不重头 | 元素可暂停（唯一优势项） | 记录偏移，停止/重建 loop source 实现等价语义 |

实现形态：

- `AudioContext` 不预建：仅在开始按钮用户手势中由 `audio.unlock()` 创建或 resume，并完成一次静默管线初始化；被浏览器挂起后的再次 resume 仍在手势处理中进行。
- 音频文件经 Manifest 解析后 `decodeAudioData`；按行为编号与事件名映射，素材替换不改事件代码。
- 声源预算：碎砖 1–2 路（互截断）、挡板/边界合计 2–3 路、P0/P1 各独占、UI 1 路；总数 6–8 路；超额按 AUDIO 5.1 优先级淘汰。
- 接口（与 AUDIO 12.3 一致）：`setMasterVolume / muteMaster / setMusicVolume / muteMusic / setSfxVolume / muteSfx / unlock()`；仅会话内有效，不写 localStorage；静音为总线增益 ramp 归零，播放逻辑不停止。
- 削波防护：各声源与总线增益按电平预算设置（P0 +4~6dB 余量、UI −2~4dB、音乐 −8~12dB），一切增益变化走 ramp，目标峰值 ≤ −1 dBTP；连击密集场景的实际峰值在实现批次测量（第 8 节）。

## 3. 信息流与初始化/清理顺序

### 3.1 初始化与流程序列（编号即权威顺序）

**阶段 A：引导（无作者内容可用）**

1. 页面加载，React 引导启动；挂载暗色空壳（无任何作者内容，不绘制几何）。
2. 获取 `content/index.json` 并解析。
   - 失败：此时尚无作者文档可消费，渲染**唯一的非作者引导态**——纯文本错误 + 重试（最小 DOM，不含任何摆位/视觉发明）；重试回到步骤 2。
3. 优先获取 `loading` 与 `load_error` 文档；`loading` 可用后立即按其数据呈现加载视图（无进度百分比，不伪造数值，解锁前保持安静）。自此之后的一切失败均使用作者的 `load_error` 视图。

**阶段 B：startup 批次**

4. 按 index 获取其余 startup 文档：`start_screen`、`game_hud`、`rotate_prompt`、`space_prompt`；以及 `entryScene` 文档本身（content-format index 规则：entryScene 登记为 startup；调和说明见 3.4）。同步获取这些文档所需资源，**包括 ASSET_PLAN 确定的单一 gameplay 图集**（开始按钮、面板、球帧首屏即需，图集整体随 startup 一次解码；砖/挡板帧随之已在缓存中）。
5. 调值文件 `src/config/balance.json` 由构建打入，阶段 B 开始时已同步可用（第 6 节）。
6. startup 全部成功 → 路由进入 **Menu（开始界面）**，对应 GDD 5.1"资源可用后首先进入 Menu"。任何一项失败/资源缺失 → `load_error`；重试从失败步骤恢复，成功后回到本步骤。

**阶段 C：开始手势 → Ready**

7. 用户以键盘确认/鼠标点击/触屏点按激活"开始游戏"（一次用户手势）：
   - 手势处理中调用 `audio.unlock()`（创建/resume AudioContext + 静默初始化），成败均继续；
   - 发射 `ui.click`；
   - 会话记账重置：生命 = 3、分数 = 0、击碎数 = 0。
8. 实例化关卡世界：解析场景 hierarchy/transform/components/behaviors；按 `breakout_camera.json` 与实际容器计算取景。gameplay 图集已在步骤 4 随 startup 装载并缓存，此处仅绑定/确认资源就绪；若整合中存在未随 startup 装载的按需资源（如可选帧），在此获取。仅当确有未完成获取时呈现加载视图。
   - 失败 → `load_error`，重试目标为本阶段；成功后继续。
9. 进入 **Ready**：球静止附着于挡板（球心 = 挡板中心 +(0,−20)）；HUD 常驻、发球提示可见；移动挡板生效并带动球摆位。

**阶段 D：发球与游玩**

10. Ready 中 `serve` 生效（空格 / 点按发球热区）→ 进入 **Playing**：球离板，速度取当前档位（初始 360 px/s），方向按发球角 40°（符号按最近横向输入，默认向右）；发射 `ball.launch`；底乐 `music.bed` 起播。
11. Playing 中循环执行第 4 节定步求值；`pauseToggle` → 阶段 E。

**阶段 E：暂停**

12. 进入瞬间冻结逻辑；在响音效立即停止/极快淡出；底乐停在当前位置；挂载 `pause_overlay`。
13. 继续 → 移除覆盖层、底乐从停下处恢复、逻辑从冻结态原样推进；`game.resume` + `ui.click`；不补发暂停期间任何输入/声音。
14. 暂停内重新开始 → 走阶段 G；返回开始界面 → 走阶段 H。

**阶段 F：过关 / 失败判定**

15. 定步结算（第 4 节）得出结果的当步：球立即停止于判定时刻实际位置：
    - 过关：单次碎砖组音（若最后一击同时碎多砖，只发一次）+ `game.win`；底乐 0.2–0.5s 淡出；挂载 `level_clear`，展示最终分数与击碎计数；
    - 失败：`game.over`（取代 `life.lost`，不叠加）；底乐淡出；挂载 `game_over`；
    - 失误但仍有生命：`life.lost`；生命 −1（一次）；球停止；已碎砖块保持；回到阶段 C 步骤 9 的 Ready（不重新获取已加载资源）。
16. 结算界面光效期间（0.8–1.2s）按钮即可激活。

**阶段 G：重开（完整重置）**

17. 停止全部音效与底乐；按场景作者数据**重新实例化世界**：60 块砖全部恢复、挡板归位、累加器与事件队列清零；会话重置为生命 3 / 分数 0 / 击碎数 0；进入 Ready。`ui.click`；底乐随发球再起播。

**阶段 H：返回开始界面**

18. 停止全部音效与底乐；销毁世界实例、释放仅场景消费的资源引用（第 3.3 节）；进入 Menu。开始界面保持解锁后的安静状态。

### 3.2 标签页隐藏 / 失焦

- Playing 中触发 `visibilitychange`（隐藏）：按暂停同等处理——逻辑冻结、音效停止、底乐停在当前位置；**恢复可见时不自动继续**，路由呈现 Paused 覆盖层，由玩家显式继续（AUDIO 7 的技术取向）。
- 其余状态下隐藏：RAF 自然暂停即可；音频总线无在响内容。
- AudioContext 被浏览器挂起：下次手势中 resume。

### 3.3 清理顺序（卸载/刷新）

页面 `pagehide` / 组件卸载时按序执行，避免泄漏与离场漏音：

1. 停止 RAF，取消帧循环；
2. 逻辑引擎停止定步调度，清空事件队列；
3. 音频：停止全部声源 → 三总线增益归零（短 ramp）→ `audioContext.close()`；
4. 输入适配器解除键盘/指针/触点监听；
5. UI 绑定层卸载全部 bindings/actions；
6. 世界实例销毁，向加载器释放图源/图集引用（引用计数归零者释放）；
7. 解除模块间引用。

首版无持久化：任何状态下刷新页面都回到引导与 Menu，本局分数/生命/阵列进度不保留（GDD 5.2）。

### 3.4 entryScene 注册与世界实例化的调和

content-format index 规则要求 `entryScene` 在 documents 中登记为 startup。本文据此执行：**场景文档（JSON）在 startup 批次获取**（当前约 25KB、`assetRefs` 为空，成本可忽略）；共享 gameplay 图集也在 startup 批次装载（首屏 UI 即需其帧，见步骤 4）。但**世界的实例化与相机取景计算发生在开始手势之后（步骤 7–8）**，首屏只呈现 Menu（GDD 5.1）。即"文档与共享资源 startup、世界 on-demand 实例化"，同时满足内容格式与 GDD；加载器不以文档/图集已获取为由提前构建世界。

## 4. 规则求值顺序（GDD 判定的执行映射）

本节是 GDD 可观察结果的执行顺序，不改变 GDD 任何结论。

### 4.1 单个逻辑步内的求值序列

`step(fixedDt = 1/120)`：

1. **输入意图收集**：读取键盘方向状态、最新 `targetX`、`serve/pauseToggle` 边沿意图；被状态门控丢弃的意图在此步即丢弃。
2. **挡板移动**：键盘按 560 px/s 积分或直接采用指针 `targetX`；挡板中心夹在 220–1060；Ready 态球按附着关系随挡板摆位。
3. **球位移**：Playing 中按当前速度向量积分位置；Ready 态不移动。
4. **碰撞/碰撞对收集**：扫掠圆（r=8）对轴对齐矩形做碰撞查询，收集本步全部碰撞对（三面墙、存活砖块集合、挡板）及底部越过标志 `m`（球心越过 lineY 672）；碰撞对在结算前收集完毕，结算中新增的关系不回头改变本步集合。
5. **按 GDD 6.2 优先级统一结算**（见 4.2，全部碰撞对一次性结算，而非逐对顺序修改）。
6. **状态转移**：依据结算结果转移状态（Playing → Ready/LevelClear/GameOver/Paused）。
7. **事件发射**：结算完成后，把本步结果作为事件一次性排入队列（音频 + UI 反馈），保证每个结果只触发一次。

### 4.2 GDD 6.2 优先级的执行映射

| GDD 条目 | 执行规则 |
|---|---|
| 6.2.1 最后一砖与失误同帧 | 结算先统计本步击碎砖块集合 H 与击碎后存活砖数：存活 = 0 → **LevelClear**；此时即使 `m` 为真也不扣生命，失误结果不成立。 |
| 6.2.2 同帧多砖 | H 中砖块**全部击碎、逐块按行计分**（60/50/40/30/20/10）、击碎数一次累加；球**只产生一次方向变化**（按扫掠入射轴确定唯一法线；同一步多砖法线冲突时，以文档顺序最早砖块的法线为准）；含最后一砖即过关。音频侧对应**一次** `ball.brick`（载荷含当组砖块数，计数档 ≤3）。 |
| 6.2.3 砖与边界/挡板同时 | 砖块击碎与计分照常；**反弹结果以挡板规则优先**：存在挡板碰撞对时，速度统一由挡板公式给出（h·60°，恒向上），通用反射不适用，球不会因此向下。墙/砖各自的反弹只在无挡板碰撞时按入射轴生效。 |
| 6.2.4 生命扣减一次 | `m` 在存活砖 >0 时才成立：生命 −1 恰好一次；扣减后球速率立即置 0、停止交互；生命 = 0 → GameOver（`game.over` 取代 `life.lost`），否则 → Ready。同一步不产生第二次扣减，落底后不再有弹射/碎砖事件。 |

挡板反弹公式（BALANCE 4.1，执行口径）：`h = clamp((球心x − 挡板中心x)/60, −1, 1)`；`θ = h·60°`；反弹速度 `(s·sinθ, −s·cosθ)`，速率不变；每次挡板反弹后 `|v_y| ≥ 0.5s`。提速档位（BALANCE 4.3）在本步击碎累加后按 d = 0..5/6..17/18..35/36.. 重算，过阈时按新速率缩放速度向量，位置与方向不变。

### 4.3 事件发射规则

- 事件在步骤 7 统一发射，载荷取自结算**后**的最终状态；一个逻辑步内同一事件名最多一次（`ball.brick` 按当组合并）。
- 事件表（与 AUDIO 12.1 同名）：`ball.launch`（Ready→Playing）、`ball.paddle`、`ball.wall`、`ball.brick`（载荷含组内块数）、`life.lost`、`game.win`、`game.over`、`game.pause/resume`、`ui.click`、`music.bed`（起播/停止/恢复）。
- UI 反馈（屏闪、屏震、碎块、拖尾收亮）与音频事件同批派生；无音频时视觉反馈独立完整（AUDIO 9）。

## 5. 数据消费与绑定

### 5.1 Scene 文档消费

运行时对 `content/scenes/breakout_level.json` 的消费逐项对应格式字段：

- **hierarchy**：以 `id` + `parentId` 构建节点树；无 `parentId` 为根级；场景共 70 节点（场地组 4 墙、阵列父节点 + 60 砖、挡板、球、记账节点、主相机）。
- **enabled**：缺省 true；`enabled:false` 抑制整棵子树（更新、碰撞、绘制全部跳过）。
- **transform**：position/rotation/scale 为父节点局部值；父变换（平移·旋转·缩放）沿树组合一次；2D 使用 XY 平面；pivot 仅偏移渲染几何。
- **components**：类型仅取 `sceneVocabulary.componentTypes`；本场景实际出现 `sprite-renderer`、`box-collider-2d`、`circle-collider-2d`、`camera`；组件 id 与数组顺序无关；碰撞体数据（size/offset/isTrigger）供碰撞查询；相机组件供取景。
- **behaviors**：读 `node.data.behaviors`（id/kind/config），按 kind 注册表执行（5.2）；禁止脚本组件。
- **排序**：`zIndex` 为绘制先后（场地 0 ＜ 砖 10 ＜ 挡板 20 ＜ 球 30）；同级按文档顺序。
- **相机指定**：`data.cameraNodeId = "main-camera"`；相机节点参数与 `breakout_camera.json` 一致。
- 运行时可更新 Transform 与销毁砖块，但不替换作者初始世界；重开即从作者数据重建。

### 5.2 behaviors.kind 命名表（v1.0 固化，以 JSON 现有字符串为准）

下表逐字读取自 `breakout_level.json` 现有占位并**固化为 v1.0 闭集**；与 LEVEL_SCENE_DESIGN 9.3 所列占位一致，无名实冲突；若未来 JSON 与文档不一致，**以 JSON 为准**并走变更：

| kind | 所在节点 | config（现有字段） | 运行时职责 |
|---|---|---|---|
| `paddle.movement` | paddle | `axis, followPointer, bounds{minX:160,maxX:1120}, keyboardSpeedRef:"tuning.paddleKeyboardSpeed"` | 挡板横向跟随：键盘按调值积分、指针 targetX 即时跟随、中心夹取 |
| `ball.movement` | ball | `attachTo:"paddle", attachOffset:[0,−20], speedRef:"tuning.ballSpeed", speedupRef:"tuning.ballSpeedup", serveAngleRef:"tuning.serveAngleRange", bounceRef:"tuning.paddleBounce"` | Ready 附着随动；Playing 恒速运动；发球角/提速/挡板反弹按引用消费 |
| `brick.array` | bricks | `rows:6, columns:10, brickSize:[80,28], gap:[8,8], arrayOrigin:[204,96], destroyedBricksStayDestroyed:true` | 阵列作者几何与身份登记；失误后已碎砖保持；为记账提供集合 |
| `brick.destructible` | 60 个砖块节点 | `maxHits:1, row, column, pointsRef:"tuning.brickPoints.rowN"` | 一击即碎；按行取分；碎后从碰撞/绘制集合移除 |
| `boundary.wall` | wall-left/right/top | `edge:left/right/top, restitution:true` | 三面墙反弹（vx/vy 分量翻转），速率不变 |
| `boundary.miss` | wall-bottom | `lineY:672, restitution:false` | 底部触发型边界：不反弹，越过即失误 |
| `game.session` | game-director | `livesRef:"tuning.startLives", scoreRef:"session.score", clearCondition:"all-bricks-destroyed"` | 生命/分数/击碎数记账与过关条件持有 |

运行时只为以上 7 个 kind 注册执行器；不新增作者未使用的 kind。

### 5.3 UI 九文档加载阶段

采纳 UI_UX_SPEC 9.2 的注册建议，index 中据此登记：

| loadPhase | 文档 | 理由 |
|---|---|---|
| startup | `loading`、`load_error` | 加载与错误恢复在任何作者内容之前就须可用 |
| startup | `start_screen` | 首屏 Menu |
| startup | `game_hud` | Ready 进入即挂载，不可再延迟 |
| startup | `rotate_prompt`、`space_prompt` | 环境门控可能在启动瞬间触发 |
| on-demand | `pause_overlay` | 仅 Paused 需要，首次暂停前获取（获取时逻辑已冻结） |
| on-demand | `level_clear`、`game_over` | 仅对应结算状态需要，判定停球后获取 |

on-demand 获取失败：进入 `load_error`，重试成功后回到目标覆盖层流程（世界保持停止/冻结态）。

### 5.4 actions 命令语义

| action 字符串 | 派发条件 | 命令效果 |
|---|---|---|
| `startGame` | 开始按钮激活（手势内串联 `audio.unlock()`） | 会话重置 + 阶段 C 世界加载 → Ready |
| `pauseToggle` | HUD 暂停按钮 / P、Esc | Playing → Paused（冻结） |
| `resume` | 暂停层"继续" | Paused → Playing，原样恢复 |
| `restart` | 暂停/结算层"重新开始" | 完整重置 → Ready |
| `exitToMenu` | 暂停/结算层"返回开始界面" | 销毁世界 → Menu |
| `serve` | Ready 中发球热区激活（键盘空格由输入适配器等价派发） | Ready → Playing，球离板、底乐起 |
| `retryLoading` | 错误层"重试" | 重新执行失败的加载阶段 |

## 6. 项目自有调值文件

- **路径：`src/config/balance.json`**（位于 `content/` 之外、应用源码内；由构建打包，运行时同步可用，无独立获取/失败路径；无 `src/` 现状，实现批次创建）。
- 权威关系：取值由 BALANCE_DESIGN 第 3 节发布配置 authoritative 定义；本文件是其**唯一机器载体**，不新增、不微调；改动走平衡文档变更并重新构建。
- 字段契约（与平衡文档参数一一对应）：

```json
{
  "fixedDt": 0.008333333333,
  "maxStepsPerFrame": 8,
  "startLives": 3,
  "ball": {
    "baseSpeed": 360,
    "speedCap": 540,
    "speedup": [
      { "afterDestroyed": 6,  "speed": 420 },
      { "afterDestroyed": 18, "speed": 480 },
      { "afterDestroyed": 36, "speed": 540 }
    ]
  },
  "serve": { "angleDeg": 40, "minAngleDeg": 30, "maxAngleDeg": 50 },
  "paddle": {
    "width": 120, "height": 16,
    "keyboardSpeed": 560,
    "maxBounceAngleDeg": 60
  },
  "brick": {
    "rows": 6, "columns": 10,
    "width": 80, "height": 28, "gapX": 8, "gapY": 8
  },
  "pointsByRow": [60, 50, 40, 30, 20, 10]
}
```

- Scene 中 ref 的解析闭集：

| Scene 引用 | 解析到 |
|---|---|
| `tuning.ballSpeed` | `ball.baseSpeed` |
| `tuning.ballSpeedup` | `ball.speedup`（+ `speedCap`） |
| `tuning.serveAngleRange` | `serve.angleDeg / minAngleDeg / maxAngleDeg` |
| `tuning.paddleBounce` | `paddle.maxBounceAngleDeg` |
| `tuning.paddleKeyboardSpeed` | `paddle.keyboardSpeed` |
| `tuning.startLives` | `startLives` |
| `tuning.brickPoints.row1..6` | `pointsByRow[0..5]` |
| `session.score / lives / bricksBroken` | 运行时会话状态（非本文件） |

- 不复制原则：Scene/UI 不复制速度、生命、分值、步长等调值；对象尺寸/阵列位置等**世界几何只以 Scene 为摆位权威**——`balance.json` 中的 `paddle/brick` 几何字段是发布配置的机器记录（供模型/校验与一致性核对），运行时**不用它们重排世界**。平衡模型已交叉核对二者 0 不一致；后续若分歧，按 BALANCE 第 10 节变更流程同步，运行时呈现以 Scene 几何为准。

## 7. 取景与适配实现

### 7.1 相机取景（keep-height）

参数取自相机节点与 `breakout_camera.json`：正交、logical-pixels、`orthographicSize = 3.6`（世界单位半高）、`pixelsPerUnit = 100`、`framing = "keep-height"`、参考 16:9。

对实际容器（CSS 尺寸 W×H，宽高比 a = W/H）：

- 可见逻辑像素高恒定：`viewH = 2 × 3.6 × 100 = 720`；
- 可见逻辑像素宽：`viewW = 720 × a`；
- 视野中心为相机节点世界位置 (640, 360)（静态）；
- 世界视野矩形：`left = 640 − viewW/2`，`right = 640 + viewW/2`，`top = 0`，`bottom = 720`。

示例：16:9 → left=0、viewW=1280；1024×600（a≈1.707）→ viewW≈1228.8、left≈25.6，仅裁切两侧可扩展暗带，场地（x144–1136）完整可见；比 16:9 更宽则露出更多暗带。容器变化只改取景呈现，**不改写任何世界 Transform、不烘焙第二套布局**。取景的可见性结论与逐尺寸复核责任归 LEVEL_SCENE_DESIGN 第 5 节，本文不维护第二张视口表。

### 7.2 世界 ↔ 屏幕映射与逆映射（含留边）

设画布 backing store 铺满容器（backing 高 = H×dpr），世界→backing 缩放 `s = (H × dpr) / 720`：

- 世界 → 屏幕（backing）：`screenX = (worldX − left) × s`；`screenY = worldY × s`；
- 屏幕 → 世界（逆映射）：`worldX = screenX / s + left`；`worldY = screenY / s`；
- **留边规则**：当前 keep-height 全幅取景，世界视野矩形等于整张画布，无黑边；映射代码仍按通用规则先求"世界矩形在画布内的区域"——若取景改为含 letterbox 的形态，黑边内指针**不映射为世界坐标**，不产生 `movePaddle`；
- 逆映射出的横坐标在挡板语义下再夹取到中心范围 220–1060（场地内界 160–1120 与半宽 60 推导）；两侧暗带内移动只映射为世界坐标、不产生游戏效果。
- 鼠标/触屏的指针换算必须与渲染使用同一 `left/s`，容器尺寸或 dpr 变化时同步更新。

### 7.3 UI 适配

- 屏幕 UI 根解析到**实际视口**（`referenceResolution [1280,720]` 仅设计参考）；节点几何由 `layout` 的 anchor / 锚点枢轴 / `anchorMin/anchorMax + sizeDelta` / container（row/column/grid）按 content-format 公式解析；不用 CSS 布局替换作者布局。
- Compact：视口宽 ≤ `compactMaxWidth = 1024` 时应用各节点 `responsive.compact` 覆盖（未指定字段继承）；不使用 portrait 变体——竖屏只显示旋转提示。
- 控件保证：按钮解析后尺寸恒 ≥ `minimumControlSize [88,44]`（覆盖层按钮高恒 48）；不整体等比压缩、不裁文字；适配档位、HUD 带高（48）与面板数值以 UI_UX_SPEC 第 3、5 节为唯一来源，本文不维护第二张矩形表。
- 世界取景与 UI 适配是两条独立管线：UI 不因世界缩放重排，世界不因 UI 布局改写。

## 8. 加载、存储、失败与性能

**加载视图与错误恢复触发条件**

- 触发加载视图：startup 批次进行中；开始手势后的世界实例化与 on-demand 资源获取中。
- 显式错误（任一成立即进入 `load_error`，不静默）：文档 fetch 失败或 JSON 解析失败；index 引用缺失/重复；assetRef 未在 Manifest 解析到 verified 资源；图集帧名在实际图集中不存在；on-demand 覆盖层获取失败。
- 恢复路径恒在：重试重新执行失败阶段，可无限重试；再次失败显示错误细节与危险色脉冲。**禁止以代码内置图形静默"成功"**；作者占位（placeholder shape）按其数据绘制是数据消费，与内置回退无关。
- 交付前必须完成占位 sprite → verified assetRef 的替换（几何不变）；未替换时作者占位仍可被消费，但不构成最终资源交付。

**存储**

- 无任何持久化：不写 localStorage/IndexedDB/cookie；刷新 → 引导 → Menu，分数、生命、阵列清零；音量/静音设置同样仅会话内有效。

**性能**

- 高刷屏一致性：定步累加器保证不同刷新率下同一时段逻辑结果一致（球的位置、碰撞、计分只依赖逻辑步数）。
- 最小尺寸帧预算（960×540）：每帧一次全画布清屏 + 背景离屏 blit + ≤ 约 70 个启用对象绘制；目标世界绘制在一帧预算内（约 16.7ms 帧留足余量）；实际帧时在实现批次测量，未达预算时先简化作者允许的视觉档（ART 10：合高光、关发光），再评估 dpr 上限——本版不预制该降级框架。
- Canvas 重绘范围：v1.0 采用全画布重绘（背景离屏化后单帧绘制量小且确定），不维护脏矩形系统。
- 音频：全部增益变化走 ramp 防爆音；按 AUDIO 电平预算预留 headroom，密集连击与 P0 叠加场景验证峰值 ≤ −1 dBTP，不削波。
- 文本与字库：真实字库到位前以占位族显示；字库加载后按 textFit 测量，不在运行时自动缩字掩盖尺寸不足。

## 9. 可行性风险与验证方式

以下风险均**不通过预制投机框架处理**；验证在实现批次按 `runtimeConsumption.verification` 执行：用临时副本或拦截响应改作者数据、对比运行时结果、还原原始数据；无变化或错误变化即绑定失败；当前一律标注**未验证**（本批次未观测任何运行时）。

| # | 风险 | 已定的技术对策 | 验证方式 / 当前状态 |
|---|---|---|---|
| 1 | 高速穿透砖块/挡板 | 120Hz 定步（单步 ≤4.5px < 间隙 8、球径 16）+ 扫掠圆碰撞 + 单帧 8 步上限；防御性最小竖直分量钳制（`|v_y| ≥ 0.5s`） | 运行时构造高速/多步场景复核；**未验证** |
| 2 | Scene 绑定（scene-layout） | hierarchy/transform 全量消费 | 改作者 transform（含旋转/缩放）→ 对象及后代运行时结果改变；**未验证** |
| 3 | UI 绑定（ui-layout） | layout/anchor/container + compact 全量解析 | 改作者节点 position/size（含父级/锚点/compact）→ 实际几何改变，并在三档视口确认控件/覆盖层完整在视口内；**未验证** |
| 4 | 资源绑定（resource-binding） | assetRef/frame/member 经 Manifest 解析并实际解码 | 改作者资源/帧引用 → 实际渲染/播放的资产改变；**未验证** |
| 5 | 文字 fit | 固定文本框 + 声明字号 | 真实字库加载后测量 5 位分数（含 2100）与全部中文标签（多语言）；当前全部 **unmeasured** |
| 6 | HUD 与顶行砖小尺寸关系 | UI_UX_SPEC 8 已按"绘制内容不遮挡"消解（最小尺寸间距 ≥26px；与顶墙投影逐元素核对无遮挡） | 真实取景合成下按 `ui-layout` 逐尺寸运行时复核跨层遮挡；**未验证** |
| 7 | 音频语音名额/优先级/ramp | Web Audio voice 池与三总线（第 2.8 节） | 运行时验证碎砖 choke、P0 压制 P2、并发 ≤6–8 路、峰值不削波；**未验证** |
| 8 | 手感假设（360/540、40°、560 键盘速、d=36 悬崖） | 平衡文档明示假设（含 0.22s 反应时间为假设值） | Playtest 验证，计算器不证明；**未验证** |

## 10. 依赖与未决

### 10.1 运行时验证清单（实现/评审阶段事项）

1. GDD 第 9 节全部完成条件在实际游玩中可观察（三设备输入、弹射、碎砖计分、同帧四优先级、暂停冻结原样恢复、重开完整重置、提示屏）。
2. 第 9 节三类数据绑定验证（scene-layout / ui-layout / resource-binding）。
3. 真实字库文字 fit；HUD/顶行砖/顶墙在实际取景合成下的跨层遮挡复核。
4. 最小尺寸 960×540 帧预算与 dpr 策略；高刷（120/144/240Hz）设备下结果一致性；渲染插值是否需要。
5. Web Audio：unlock 手势链路、voice 名额与优先级、总线 ramp、底乐暂停位/淡出、峰值 ≤ −1 dBTP。
6. 占位 sprite 全部替换为 verified assetRef（几何不变），素材支持碎砖截断重触发、分组档与无缝循环。
7. 手感 playtest：速度四档、发球公平性、键盘速度与末段悬崖。

### 10.2 外部依赖

- ASSET_PLAN：素材规格/采购、字库选型授权（UI/音频/美术的行为定义已闭合，生产路线不影响本设计）。
- 实现工程：按本文模块边界落地；框架/代码结构任选，数据语义不可协商。

### 10.3 产品决策未决项

**无。** GDD 第 10 节两项未决产品决策已随定稿闭合：砖块颜色行对应不同分值（60/50/40/30/20/10，行为仍完全一致——BALANCE 3.4 拍板）；本机会话内不加任何额外记录（GDD 2.2 排除持久化）。如后续评审认为仍有产品级未决，须显式提出并走 GDD 第 10 节变更，本设计不代为拍板。

### 10.4 变更约束

任何文档若改变 GDD 已确立的玩家可见行为，按 GDD 第 10 节标注来源与受影响文档，由整合角色协调，不得静默覆盖；本技术文档随之修订版本。

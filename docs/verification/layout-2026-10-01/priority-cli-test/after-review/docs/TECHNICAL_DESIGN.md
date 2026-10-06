# 打砖块（Breakout）技术设计文档 TECHNICAL_DESIGN

- 版本：v1.0-draft（终版补完稿，author 批次 5/5，待五批文档统一评审）
- 作者：技术负责人（Agent）
- 日期：2026-10-01
- 文档语言：中文；代码标识符、字段名、事件名保留英文
- 依据（全部已定稿）：
  - `docs/GDD.md` v0.1（玩法范围、状态机、可观测规则的唯一权威）
  - `docs/BALANCE_DESIGN.md` v0.1（发布值定稿：球速恒定 360px/秒、3 命、挡板角度映射、不加速）
  - `docs/LEVEL_SCENE_DESIGN.md` v0.1（世界几何定稿；相机草稿 `.beegame/tmp/breakout-camera.json`）
  - `docs/UI_UX_SPEC.md` v0.1 + `content/ui/` 下 6 份最终 UI 文档（已通过 `--design-layouts`，valid）
  - `docs/ART_DIRECTION.md` v0.1（视觉层次与特效性格）
  - `docs/AUDIO_DESIGN.md` v0.1（第 2 节逐事件声音行为表为音频语义权威）
  - `.beegame/delivery/content-format.json`（内容数据契约，以下简称"内容契约"）
- 现状声明：世界 Scene JSON 尚未创建（实现阶段产出）；**本批次无任何运行时代码，本文不声称任何运行时检查、性能测试或数据消费验证已完成。**

---

## 1. 目标与适用范围

本文回答"模块如何划分、启动与帧信息流的完整时序是什么、每个游戏状态的运行时行为、怎样消费 Scene/UI 数据、模拟层事件如何映射到音频、有哪些硬约束与验证方法"。

本文不规定砖块布局（归 LEVEL_SCENE_DESIGN）、不给出 UI 矩形（归 UI_UX_SPEC 与 `content/ui/*.json`）、不列按键清单（归交互契约）、不写可调数值（归 BALANCE_DESIGN）。

已确认平台事实（不再讨论）：Web、React、2D、横屏（Landscape）、街机、风格化、键盘/鼠标 + 触控；设计参考 960×540，最小可用 800×450。

**契约性质**：本文中的行为条款——启动时序、帧数据流、各状态运行时行为、behavior kinds、模拟层事件名、存储键名——是**不可变行为契约**；实现可以自由选择文件划分、类/函数组织与具体库（见第 12 节），但任何可观测行为不得偏离本文。偏离上游设计文档时，以上游为准并修订本文。

---

## 2. 运行时总体选型

### 2.1 React 单页应用与分层

- 交付形态为 React 单页应用（SPA），可静态托管；构建工具建议 Vite + TypeScript。该建议不构成对内容契约的偏离。
- 模块分层（第 3.1 节给出完整模块清单）：
  - **React 层（外壳 + UI 渲染器）**：应用外壳、加载/错误视图、UI 文档的解析渲染与屏幕切换、HUD 数据展示；
  - **模拟层（simulation）**：游戏循环、固定步推进、碰撞结算，独立于 React；**逐帧变化的球/挡板位置绝不进入 React state/props**；
  - **内容层**：`content/index.json` 与各 Scene/UI 文档的解析、ID 缓存与类型化访问；
  - **服务层**：输入采集、持久化网关、音频网关。
- React 与模拟层之间通过轻量 store/订阅交换**低频快照**（`phase`、分数、生命、最高分）；高频坐标只存在于模拟层，由 Canvas 直接绘制。

### 2.2 2D 渲染：Canvas 2D（世界）+ DOM（UI）

**世界渲染使用 Canvas 2D；屏幕 UI 使用 React 输出的 DOM；不使用 WebGL。** 理由：

1. 对象数量级极小（60 砖 + 单球 + 单挡板 + 少量墙），Canvas 2D 在低端设备可稳定 60fps；
2. 与契约 atlas 规则 1:1 对应——一次 `drawImage(atlas, sx,sy,sw,sh, dx,dy,dw,dh)` 区域绘制，frame 不单独解码、不复制像素；
3. 无光照/3D/大规模粒子需求；碎砖等表现以少量 atlas 帧四边形在 Canvas 2D 呈现；
4. WebGL 的上下文丢失与移动兼容分支对本项目零收益。若未来需求超出本基线，按第 11 节触发条件再评估。

UI 侧运行时提供一个 UI 文档渲染器，按契约 anchor/pivot/stretch/container 规则计算几何并输出 DOM/CSS。**CSS 只绘制外观（颜色、字体、圆角等 style 字段映射），不承担第二套布局**；绘制顺序、disabled 子树抑制遵循契约，不自造规则。

Canvas backing store 按 `game-view` 的 CSS 尺寸 × `min(devicePixelRatio, 2)` 分配（第 11 节）；绘制逻辑坐标仍为逻辑像素。

### 2.3 游戏循环：帧率无关的固定时间步进（定稿）

GDD 要求"结果不因帧率变化而改变销毁集合"。采用 **fixed timestep + accumulator**，参数定稿：

1. 每渲染帧由 `requestAnimationFrame` 驱动，取 `performance.now()`；
2. 帧间隔先钳制（上限约 100ms），防止切后台返回后补发巨量步进；
3. 帧间隔累加 accumulator，按固定步长 **`dt = 1/120` 秒**逐步推进；每帧步进数设上限；
4. 所有积分式只用固定 `dt`：`position += velocity * dt`。60Hz/120Hz/其他刷新率下单位真实时间的模拟结果一致，变化的只是每帧步进数；
5. 渲染可按 accumulator 余数在相邻状态间插值，仅用于视觉平滑，**插值不参与任何判定**。

`dt=1/120` 已被 BALANCE_DESIGN 作为上游事实引用，本稿定稿。发布球速 360px/秒下每步移动 3px，配合第 11 节的 swept 碰撞验证共同保证判定精度。首版不加速（`acceleration.enabled=false`），步进模型不因任何速度参数改变。

覆盖层（暂停、结算）显示期间模拟冻结，不推进有效模拟时间；覆盖层关闭前的输入不排队、不补执行（GDD 5.2）。

### 2.4 固定步内的碰撞结算顺序（可观测结果契约）

一次结算（一个固定步）必须产出下列可观测结果，实现细节可不同，结果必须稳定一致：

1. 先按 `dt` 对球做运动积分；
2. 求本步内球与墙/挡板/砖块的接触：反弹方向按**最先接触的碰撞面**确定；挡板击球按击中挡板的水平位置映射出射角（BALANCE_DESIGN 第 3 节分段线性公式，θ∈[15°,60°]）；
3. 本步接触到的砖块**全部销毁并逐块计分**，不得只销毁其中一部分；
4. **该次结算末尾**才检查死亡线：同一结算内最后一块砖被击碎且球整体越过 y=480 时，判定**关卡完成**（消除优先于漏接，GDD 5.2）；
5. 生命、分数、砖块数变化当次结算立即生效，HUD 当帧反映；
6. 状态转移当刻起丢弃旧状态输入：暂停生效后该帧移动/发球丢弃；漏接判定后球立即停止受挡板影响。

接触次序的确定性排序为实现细节（按 swept 进入时刻排序，并列时刻使用固定法线优先级 tie-break），其帧率无关性必须按第 11 节方法验证。

---

## 3. 模块职责与信息流

### 3.1 模块清单与职责

| 模块 | 职责 | 依赖方向 |
|---|---|---|
| `app-shell`（React） | 启动编排、加载/错误视图、屏幕挂载与切换、应用级生命周期监听 | 调用内容层、服务层 |
| `ui-renderer`（React） | 解析 UI 文档，按契约计算几何并输出 DOM；处理 `actions` 与焦点 | 内容层 → DOM |
| `simulation`（框架无关） | 固定步推进、swept 碰撞、砖块销毁/漏接判定；产出领域事件；持有全部高频状态 | 只读 tuning 与场景数据 |
| `renderer`（Canvas 2D） | 消费模拟层实体当前状态与场景渲染组件，绘制世界与世界特效 | 模拟层 → Canvas |
| `input-service` | 采集 pointer/keyboard，归一化为输入状态（按键集合、指针世界 X、发球边沿） | DOM 事件 → 模拟层输入 |
| `audio-gateway` | 订阅领域事件与 UI 事件，映射为 Web Audio 发声；静音/音量/声部管理 | 事件总线 → Web Audio |
| `storage-gateway` | 读写两个 localStorage 键；容错与默认值 | localStorage |
| `content-store` | index/文档/manifest/tuning 的 fetch、解析、ID 缓存、绑定校验 | 网络 → 类型化数据 |
| `event-bus` / `snapshot-store` | 瞬时领域事件分发；低频快照发布 | 单向：模拟层 → 订阅者 |

**单向依赖铁律**：模拟层不知道 React、Canvas、Audio 的存在；事件总线不得反向影响玩法结果——无声、解码失败、存储失败均不改变游戏状态。

### 3.2 启动序列（完整时序，显式阶段门）

下列步骤的先后由阶段门强制，不依赖任何隐含执行顺序：

1. **外壳引导**：React 挂载 `app-shell`，立即渲染加载视图 `app-loading`（第 3.3 节）；本步骤无网络依赖。
2. **加载 index（阶段门 A）**：fetch 并解析 `content/index.json`（schema `beegame-content-package.v2`，`dimension:"2d"`、`sceneModel:"game-object-v2"`、`entryScene`）。建立 **id → {path, kind, loadPhase}** 注册表；ID→路径解析只此一处，后续一律按 ID 取用，代码不写死文件路径。
3. **并行获取启动必需数据（阶段门 B，全部成功才进入下一步，彼此并行）**：
   - 全部 `loadPhase:"startup"` 文档：入口场景（`scene-2d`，即 `entryScene`）与 6 份 UI 文档（`ui-title-screen`、`ui-game-screen`、`ui-pause-menu`、`ui-level-complete`、`ui-game-over`、`ui-rotate-prompt`——体积均极小，定稿全部随 startup，避免对局中网络等待）；
   - `config/tuning.json`（BALANCE_DESIGN 发布值的唯一机器可读投影，第 6 节）；
   - `assets/asset-manifest.json`（资源权威清单）。
   - VFX 文档（若未来引入）为 `on-demand`，仅在需要时获取；首版无 VFX 文档。
4. **解析与绑定校验（阶段门 C，输入为门 B 全部结果）**：
   - 节点层级、transform、`semantic`、collider、`behaviors` 全部解析；
   - 每个 `assetRef` 在 manifest 中恰好登记一次并可解析；多文件资源以 `data.member` 指定；
   - 每个 behavior `kind` 必须在运行时 behavior registry 中已注册；**未注册 kind 加载期显式报错（fail loud）**，不静默忽略；
   - tuning 字段齐全；**字段缺失或加载失败启动期显式报错，不以代码默认值兜底**；
   - 场景中恰好各有一个 `paddle`、`ball` 语义节点。
5. **资源解码（阶段门 D）**：按 manifest 解码 startup 引用的图集大图并由渲染器缓存；音频一次性解码为 `AudioBuffer`。当前 6 份 UI 文档 `assetRefs: []`、场景尚未创建；真实资源生产后本步骤才产生实际解码。Atlas 规则：frame 是共享图源上的区域，不单独 fetch/decode、不复制像素，按 URL 复在途与已解码源，消费者全部用完后释放；禁止文件名猜测。
6. **适配预检**：读取宿主 viewport，按第 9 节判定 orientation 与 800×450 阈值。
7. **首帧（阶段门 E）**：满足可用横屏空间 → 卸载 `app-loading`，挂载 Title（`title-root`），最高分与静音态从本地存储读取（读取与门 B/C 并行亦可，容错见第 7 节）；不满足 → 挂载 Rotate Prompt（`rotate-root`）并持续监听尺寸变化。**首帧及手势解锁前不发出任何声音。**

任一步骤失败 → 进入错误视图（第 3.3 节），不产生半成品可交互状态。

### 3.3 加载视图与错误视图（外壳级，非内容 UI 文档）

定稿说明：6 份内容 UI 文档中**没有**加载/错误文档；这两个视图由 `app-shell` 内置提供，不经过内容层。节点 id 约定如下（外壳实现，非创作数据）：

- **加载视图 `app-loading`**：深色底（与世界底色一致，不得白屏）+ 居中"加载中"文本与不确定进度指示；不展示虚构百分比；不接收玩法输入；全程静默。
- **错误视图 `app-error`**：深色底 + 居中错误说明（按类别给出中文文案：网络错误 / 数据格式错误 / 资源缺失）+ 唯一按钮"重试"。控制台保留技术细节用于诊断，玩家可见文案不暴露堆栈。
  - "重试"重新执行 3.2 第 2 步起的完整序列；
  - 不做无限自动重试；网络类错误允许有限次数（建议 ≤2）自动重试后转入本视图；
  - 错误视图期间不发声、不推进模拟。
- 若评审要求加载/错误视图内容化，需新增 UI 文档并反向更新 UI_UX_SPEC 与本文，不在当前批次隐含处理。

### 3.4 对局帧数据流（输入 → 模拟 → 三路消费）

进入 Ready 后启动世界主循环。每个渲染帧的完整数据流：

1. **输入采集（DOM 事件 → input-state）**：`input-service` 监听 pointer/keyboard，写入：键盘按下集合、指针经逆变换后的世界 X（第 5.5 节）、发球释放边沿队列。监听器由外壳生命周期注册一次，不随帧/局重复注册。
2. **帧门控**：计算帧间隔并钳制（≤100ms），累加 accumulator。模拟冻结（Paused/结算）时本帧不产生步进，渲染仍绘制冻结画面，覆盖层为 DOM。
3. **固定步推进**：while accumulator ≥ dt：`simulation.step(dt, inputState, tuning)`——积分、swept 接触、反弹、砖块销毁、死亡线判定；每步返回**领域事件列表**（瞬时，不跨帧排队）并就地更新实体状态。
4. **帧末分发（一次）**：
   - 同一固定步内的多砖销毁在分发前聚合为**一个** `bricks-destroyed` 事件（payload 含 `count`，第 6.2 节）；
   - 事件经 event-bus 分发：`audio-gateway` 据此调度声音；`storage-gateway` 只订阅终局事件；
   - 发布**低频快照**（`{phase, score, lives, highScore}`）到 snapshot-store，React HUD 本帧一次更新；
   - `ui-renderer` 按 phase/条件切换节点 `enabled`：`ready-prompt`、`new-record-badge` 等；
   - `renderer` 读取实体当前状态向 Canvas 绘制世界（可使用余数插值，仅视觉）。
5. 顺序约束：事件分发与快照发布在同帧全部步进结束后进行；声音与视觉反馈因此与结果同帧出现，且不会读到半步中间态。

### 3.5 失焦处理（定稿规则）

GDD 将同步把本规则补入状态机；在 GDD 更新生效后本条即为既定实现规则：

1. **触发源**：`document` 的 `visibilitychange`（`document.hidden === true`）与 `window` 的 `blur`。
2. **状态行为**：当前为 **Playing** 时，自动转移到 **Paused**（同一失焦周期内多事件去重，只转移一次）；等价于玩家主动暂停，但没有"暂停开"之外的额外仪式。当前为 Ready 时不发生状态转移（暂停仅可从 Playing 进入）。
3. **音频行为（Ready/Playing 一致）**：音乐挂起（记住位置）、全部音效立即停止、`AudioContext` 调 `suspend()`；后台标签绝不发声。
4. **回焦行为**：`visibilitychange`（visible）/ `focus` 后**不自动恢复游戏、不自动恢复声音**；状态停留在 Paused，由玩家显式"继续"（该手势同时幂等 `resume()` AudioContext）后按 Paused → Playing 同一规则恢复。Ready 下失焦回焦后，音频由下一次用户手势幂等解锁，不自动发声。
5. 自动暂停时释放已持有的 pointer capture，避免回焦后挡板粘滞；下一次按下重新获取。

---

## 4. 状态运行时行为与转移清理

### 4.1 每状态资源占用总表

| 状态 | 模拟层 | rAF / Canvas | 输入 | 音频/音乐 |
|---|---|---|---|---|
| Loading | 未创建 | 不运行 | 仅错误/重试（错误态） | 静默 |
| Error | 未创建 | 不运行 | "重试"按钮 | 静默 |
| Title | 不运行（场景已缓存，世界不实例化） | 世界循环未启动 | 开始按钮、静音、Enter/Space | 静默（手势前）/解锁后仍不放音乐 |
| Ready | **running**：挡板可移动；球速度为 0、吸附挡板随动 | 世界循环运行 | 挡板输入 + 发球释放边沿 | Ready 当帧音乐淡入；呼吸反馈 |
| Playing | **running**：全速推进 | 运行 | 全部玩法输入 | 音乐循环；玩法音效 |
| Paused（含自动暂停） | **frozen**：实体状态与 accumulator 原值保留，零步进；input-state 清空 | rAF 继续，仅绘制同一冻结帧 + DOM 覆盖层 | 仅覆盖层按钮/焦点；世界输入不排队 | 音乐挂起、音效全停、context suspend |
| Level Complete / Game Over | 判定当刻起 **frozen**；短演出窗口内允许 **FX 呈现层**（非模拟）更新粒子，演出结束纯冻结 | 运行至演出结束，之后静态帧 + DOM 面板 | 面板浮出动画结束前按钮不激活；之后主操作 + 退出按钮，Enter 快速重开（Space 不重开） | 终局短句；音乐快速弱化/停止；其余音效静默 |
| Rotate Prompt | 不运行/冻结 | 提示为 DOM（呼吸），世界不更新 | 无控件 | 静默 |

FX 呈现层只播放创作数据驱动的粒子/光效（胜利暖色迸发、失败冷色收束），**不执行任何玩法判定、不读写分数与碰撞**。

### 4.2 发球边沿消费

- 发球输入在 **Ready 且仅 Ready** 有效；在**释放边沿**（指针 `pointerup` / 键 `keyup`）触发，单次消费。
- `keydown` 的 `event.repeat === true` 一律忽略；长按不连发；非 Ready 状态该输入直接忽略。
- 消费结果：当帧完成 Ready → Playing 转移、`ready-prompt` 置 `enabled:false`、球按 tuning 的发球参数离板（标称 30° ± 10°、50% 随机侧向），发出 `serve` 事件。
- Paused/结算期间的边沿不排队、不补发。

### 4.3 漏接与复位序列（Playing → Ready）

在结算末尾的 swept 死亡线检查中，球中心 y ≥ 485（死亡线 y=480 + 球半径 5，几何直接推出，不另设容差）：

1. 当步发出 `miss` 事件；在响高频音由网关让路；
2. 生命数减 1，立即生效（HUD 生命图标同期变化）；
3. **扣减后仍有余命** → 复位到场景数据中的待发布局：挡板中心回初始 (480,440)、球回吸附位 (480,427) 且速度归零重新吸附；已销毁砖块保持消失（节点保持 disabled）、分数保持累计；`ready-prompt` 重新 `enabled:true`；转移完成当帧发出 `reset-to-ready` 事件（在漏接音收尾后或轻微重叠进入）；
4. **扣减后生命为 0** → 进入 4.4 的 Game Over 序列；**只发 `game-over`，不发 `reset-to-ready`**。

### 4.4 结算序列（Playing → Level Complete / Game Over）

1. 触发：最后一块砖销毁的当步（含同帧末砖 + 越线，此时**只发 `level-complete`、不发 `miss`**）；或最后一命漏接当步。
2. 模拟冻结；播放终局演出（FX 呈现层）与终局短句；音乐快速弱化或停止。
3. **最高分结算恰好一次**：终局转移当刻由 storage-gateway 比较当局得分与已保存最高分，超过则写入（第 7 节），随后刷新快照中的 `highScore`。
4. 挂载对应覆盖层（`complete-root` / `gameover-root`）：
   - Level Complete：`new-record-badge` 的 `enabled` 按 `sessionScore > storedBest`（当局开始前的已存值）判定，未破纪录置 false 且 column 流中后续行上移；
   - Game Over：评审已决补齐 `gameover-new-record-badge`，判定与上移规则同 Level Complete（失败局亦可破分，GDD 2.3）。
5. 面板浮出动画结束前按钮不响应；结束后主操作按钮获得默认焦点；**Enter** 触发快速重开，Space 不触发（GDD 第 3 节；UI_UX_SPEC 4.4/4.5）。
6. 停留结算期间音乐不恢复；终局短句若被重开/退出截断，做短促淡出，不硬切。

### 4.5 重开完整清理清单（Title → Ready 与结算 → Ready 等价）

每次重开必须逐项完成，保证多局后无残留：

1. **玩法状态**：分数 → 0；生命 → tuning 的 `initialLives`（发布值 3）；球 → 吸附位、速度 0、发球状态清零；挡板 → 初始 transform；
2. **砖块**：60 个砖节点全部恢复 `enabled:true`。运行时只允许切换 `enabled`，**绝不改写节点 transform 或移动节点**——布局权威永远是 Scene JSON；
3. **输入**：清空键盘按下集合；清空发球边沿队列；释放 pointer capture；accumulator 清零（旧帧时间不带入新局）；
4. **事件**：事件总线无队列（事件瞬时），核对无重复订阅；订阅关系在应用/会话生命周期内注册一次；
5. **音频**：停止全部声部（终局句短淡出）；音乐作为新一局从曲目起点重新淡入；
6. **UI 节点**：卸载暂停/结算覆盖层；`ready-prompt` → enabled；`new-record-badge` 重置（enabled:false，待下次结算重新判定）；HUD 数值刷新（`0000`、3 个实心生命图标、已存最高分）；
7. **监听**：window/document 级监听由外壳持有，重开路径不得再次注册，防止监听器叠加泄漏。

### 4.6 退出与页面卸载清理

- **Paused → Title（退出，当局不结算、不计最高分）**：停止世界循环（取消 rAF）；全部音乐/音效短淡出后停止；释放 pointer capture；卸载 game-screen 与所有覆盖层（Canvas、HUD）；挂载 Title；不播胜利/失败句。
- **结算 → Title/外层页面**（未来若提供该路径）：同上；先卸载覆盖层。
- **页面卸载（`pagehide`）**：挂起/关闭音频，停止 rAF；浏览器回收其余资源。退出到标题后音频保持静默（标题界面不放音乐）。

---

## 5. 坐标系与 Scene/UI 数据消费

### 5.1 坐标规则（引用契约，不复制第二份规则表）

坐标、层级组合、旋转、pivot、stretch、绘制顺序等全部规则以内容契约原文为唯一权威（`coordinates`、`rectTransform`、`uiPaint`、`sceneVocabulary`、`uiLayoutContract` 等节）。要点声明：

- Scene：top-left 原点，+X 向右、+Y 向下，逻辑像素；`pixelsPerUnit` 仅作单位换算；Z 仅用于排序；transform 按 `parent * translation * rotation * scale` 组合一次；旋转角为弧度、2D 正角顺时针。
- 本关 `data.settings.coordinateSystem`：`origin:"top-left"`、`units:"logical-pixels"`、`width:960`、`height:540`、`pixelsPerUnit:100`。
- UI：top-left 逻辑像素，与场景维度无关；`referenceResolution` 是设计参考；anchor/pivot 归一化；拉伸成对提供 `anchorMin`/`anchorMax` + `sizeDelta`；子节点使用父局部坐标。

### 5.2 Scene 数据的实际消费用途

| 数据 | 运行时用途 |
|---|---|
| 节点 hierarchy（`parentId`） | 构建场景图，计算局部→世界矩阵；背景/墙为根级，砖阵挂空父节点 `bricks`（仅组织层级，无 collider），`paddle`/`ball`/`death-line` 为根级，便于按 semantic 检索 |
| `node.enabled` | false 时该子树同时**退出渲染与碰撞**；碎砖 = 节点 disabled；重开全部恢复 |
| `node.semantic`（契约数组形式） | 玩法身份。终版词汇：`paddle`、`ball`、`brick`、`wall`、`death-line`；模拟层据此检索与分类，不读节点名字猜测 |
| `transform` | 挡板/球/60 砖的位置与尺寸唯一来源；改 JSON 即改布局，玩法代码不固化任何布局常量 |
| `box-collider-2d`（`size`/`offset`/`isTrigger`） | 挡板（96×16）、砖（72×24）、墙、死亡线（trigger，厚 4，横贯 x80–880）的碰撞几何 |
| `circle-collider-2d`（`radius`/`offset`/`isTrigger`） | 球（radius 5）碰撞几何 |
| `sprite-renderer` | 绘制外观与 frame 引用；视觉素材决策，不影响几何 |
| `data.behaviors` | 装配玩法行为（第 5.3 节） |

不创作 `rigidbody-2d`（本规模自定义确定性结算，无需外部物理引擎）；**禁止 `script`/`MonoBehaviour` 类组件或 `scriptId` 字段**；创作数据不承载可执行脚本。

### 5.3 behaviors 终版：kinds 与 config 字段

运行时维护 behavior registry，按 `kind` 装配、`config` 传参。**终版 kinds 冻结为两个**：

**1) `paddle-motion`（挂在 paddle 节点）**——挡板水平运动与钳制。config 字段（均可缺省，缺省取下列默认值；config 只承载装配键名，不承载数值）：

| 字段 | 缺省值 | 含义 |
|---|---|---|
| `moveAxis` | `"x"` | 运动轴，首版唯一支持 `"x"` |
| `pointerControl` | `true` | 是否接受指针直接跟随 |
| `keyboardSpeedTuningKey` | `"paddleKeyboardSpeedPxPerSec"` | 键盘速率在 tuning.json 的键（发布值 600） |

挡板边界钳制由 collider 与墙语义几何推出，不进入 config。

**2) `ball-motion`（挂在 ball 节点）**——球速、发球参数、挡板反弹映射。config 字段：

| 字段 | 缺省值 | 含义 |
|---|---|---|
| `speedTuningKey` | `"ballSpeedPxPerSec"` | 恒定球速键（发布值 360） |
| `serve.angleNominalKey` | `"serve.angleNominalDeg"` | 发球标称角（30，度） |
| `serve.angleJitterKey` | `"serve.angleJitterDeg"` | 均匀扰动（±10，度） |
| `serve.randomizeSideKey` | `"serve.randomizeSide"` | 50% 随机侧向（true） |
| `paddleBounce.angleMaxKey` | `"paddleBounce.angleMaxDeg"` | 挡板映射上限（60，度） |
| `paddleBounce.angleMinKey` | `"paddleBounce.angleMinDeg"` | 角度下限（15，度） |

死亡线判定不需要 config：阈值由 death-line 节点 y=480 与球 radius 几何推出（球中心 y≥485）。砖/墙/死亡线以 semantic + collider 表达，不挂 behavior。遇到未注册 kind 加载期 fail loud。

### 5.4 UI 6 文档的装载与切换

- 6 份文档在启动阶段一次性 fetch/解析并缓存；运行时切换**不重新 fetch**。
- 屏幕（整屏，同一时刻只挂载一个 root）：
  - `title-root`（Title）↔ `game-root`（Ready/Playing 的常驻宿主）↔ `rotate-root`（Rotate Prompt）；
- 覆盖层（挂载在 `game-root` 之上，下层 game-root 保持挂载以呈现冻结世界）：
  - `pause-root`（Paused）、`complete-root`（Level Complete）、`gameover-root`（Game Over）；
- 文档内显隐不通过切换文档完成：`ready-prompt`（Ready 可见）、`new-record-badge`（破纪录可见）以节点 `enabled` 切换。
- HUD 订阅 snapshot-store 刷新：`hud-score-value`、`life-icon-1..3`、`hud-highscore-value`；节点 `text` 占位值（`0000`）由订阅数据替换。
- 按钮 `actions.click`（`game:start`/`game:pause`/`game:resume`/`game:restart`/`game:quit-to-title`/`audio:toggle-mute`）由 ui-renderer 翻译为运行时动作；最终语义以上述动作标识与交互契约为准。

### 5.5 相机 letterbox 与指针逆变换（引用，不另建矩形表）

- 相机参数以 `.beegame/tmp/breakout-camera.json` 为准：`orthographic:true`、`orthographicSize:2.7`、`pixelsPerUnit:100`（`2×2.7×100=540` 参考半高）、`viewport 960×540`、`framing:"letterbox"`；相机节点位于世界中心 (480,270)。
- letterbox 的世界矩形与各宽高比留黑结果以 LEVEL_SCENE_DESIGN 5.2 的计算器实际输出表为唯一引用（如 1024×768 → 世界矩形 (0,96,1024,576)，上下各留 96；1280×540 → (160,0,960,540)，左右各留 160；16:9 含 800×450 无留黑）。**本文不另建矩形表。**
- 指针逆变换以 `game-view`（其 resolved bounds 即相机 viewport）的 bounding rect 与当帧世界矩形计算：

```
scale = worldRect.width / 960            // 恒等于 worldRect.height / 540
worldX = (clientX - rect.left - worldRect.x) / scale
worldY = (clientY - rect.top  - worldRect.y) / scale
```

- 鼠标与触控共用这一条路径，不各写一套；逆变换必须把 letterbox 的缩放与留白计入，点在留黑区时 worldX 落在 [0,960] 之外，该位置只用于钳制，不产生玩法。
- 取景适配只改变呈现：世界 transform、collider、砖位不被缩放或移位。

---

## 6. 音频接入与事件映射定稿

### 6.1 网关边界、手势解锁与音乐

- 全局共享一个懒创建的 `AudioContext`；SFX 预解码为 `AudioBuffer` 后 one-shot；事件语义、音色、混音由 AUDIO_DESIGN 拥有，本文只定对接边界。
- **手势解锁**：以 Title 的"开始"操作为主解锁点（键盘 Enter/Space 同为手势），在手势处理中创建或幂等 `resume()`；context 变为 running 前不调度任何声音。解锁失败/被禁止/无输出时**静默降级**，游戏正常可玩，不阻断、不反复重试打断。
- 音乐：一首无缝循环；**Ready 当帧淡入**，Playing 持续；Paused 挂起（记住位置）；结算快速弱化/停止；重开从起点淡入；Title 不放音乐；失焦全停（3.5）。
- 场景中 `audio-source` 组件（持 `assetRef`）按 manifest 解析音源；玩法代码不引用音频文件名。

### 6.2 模拟层事件 → AUDIO_DESIGN 事件对照表（定稿）

事件名冻结；事件由模拟层或 UI 层发出，经 event-bus 到 audio-gateway：

| 事件名（终版） | 发出层 | payload | AUDIO_DESIGN 语义 |
|---|---|---|---|
| `serve` | 模拟层 | — | 2.1 发球（Ready→Playing 当帧，一次） |
| `bounce-wall` | 模拟层 | `{wall:"top"\|"left"\|"right"}` | 2.2 球击中墙 |
| `bounce-paddle` | 模拟层 | `{u}` | 2.3 球击中挡板 |
| `bricks-destroyed` | 模拟层 | `{count, ids[], scoreGained}` | 2.4 击碎砖块（**同一固定步只发一次**，`count` 驱动同事件音高台阶） |
| `miss` | 模拟层 | — | 2.5 漏接 |
| `reset-to-ready` | 模拟层 | `{lives}` | 2.6 待发复位（有余命才发） |
| `level-complete` | 模拟层 | `{score}` | 2.7 关卡完成短句 |
| `game-over` | 模拟层 | `{score}` | 2.8 游戏结束短句 |
| `ui-confirm` | UI 层 | `{controlId}` | 2.9 界面音·确认类（开始/继续/重开） |
| `ui-cancel` | UI 层 | `{controlId}` | 2.9 界面音·返回/退出类 |
| `pause-open` | UI 层 | — | 2.9 暂停开（下沉收束音） |
| `pause-close` | UI 层 | — | 2.9 暂停合（回升音） |

互斥发射规则（与 GDD 判定一致，音频不得违背）：

- 同帧末砖 + 越线：**只发 `level-complete`，不发 `miss`**；
- 生命扣减为 0：**只发 `game-over`，不发 `reset-to-ready`**；
- 同一步同时存在挡板与墙接触：网关**只播挡板音**（AUDIO_DESIGN 2.3）。

### 6.3 同帧多砖、节流与声部

- **同一固定步多砖 = 一个 `bricks-destroyed`**：网关不逐砖发声；音高以单碎为基准每多一块升一个固定小台阶，上限 3–4 级；瞬态可略强但主总线不得削顶。
- 跨步（跨结算）碎砖各自独立，受碎音最小重触发间隔节流（约 30–50ms：截断上一个余音、只留最新瞬态）。
- 墙音同层不叠加：极短间隔内后发截断重触发前者。
- UI 音必须连触节流（同一按钮同一操作最小间隔；长按空格/回车不重复出声）。
- 声部上限 8（最多不超过 16）；超限时按优先级回收最旧/最低声部；主总线预留 headroom 并以轻量 limiter 兜底，高频场景优先截断/节流而非靠限幅硬压。
- 优先级遵循 AUDIO_DESIGN 3.2：终局层 > 重要事件层（miss/reset/serve）> 玩法反馈层（碎砖/挡板）> 墙 > 界面 > 音乐。

### 6.4 静音与音量

- 主静音为必需项，作用于音乐 + 全部音效，全局即时生效；开启时在响声音快速淡出（不爆音），取消静音不补播。
- 音量滑块首版可选、不做硬性要求；若实现需与静音联动。
- 静音态从 `localStorage` 读取并持久化（第 7 节），所有状态一致；两态图标与实际音频状态严格一致，静默降级期显示静音/不可用态。点击静音按钮自身不发声。

---

## 7. 持久化（定稿）

首版仅两个 localStorage 键：

| 键名 | 格式 | 含义 |
|---|---|---|
| `breakout:highscore:v1` | `{"version":1,"highScore":0}` | 本地最高分 |
| `breakout:audio:v1` | `{"version":1,"muted":false}` | 全局静音设置 |

- 读取以 `try/catch` 包裹：键不存在、JSON 损坏、字段类型不符（高分须为非负有限整数）时，高分回退 0、静音回退 false，不阻断启动。
- 写入单次 `setItem` 并 `try/catch`（隐私模式、配额、禁用存储时可能抛错）：失败仅影响持久化；静音设置在会话内存活，不报错。
- 高分更新时机：单局结束（胜利或失败）且当局得分严格大于已保存值，**每局至多写一次**；清除浏览器数据丢失属预期。
- localStorage 不可用时两键均降级为会话内存态。

---

## 8. 输入采集与集成

具体按键清单、触控热区、焦点行为以交互契约为权威（GDD 第 3 节），冲突时以该文档为准。接入规则：

1. **指针 → 挡板 X**：游戏区域 `pointermove`，经第 5.5 节逆变换得世界 X，按挡板半宽与墙内边界（中心 128–832）钳制；鼠标触控同一路径。
2. **键盘**：`keydown`/`keyup` 维护按下集合；固定步内按 tuning 的 600px/秒持续移动，左右取净值。
3. **触控**：统一 Pointer Events；容器 `touch-action:none`；触摸相关事件使用非 passive 监听并 `preventDefault()`，阻止滚动/缩放。
4. **指针捕获**：游戏区域内按下时 `setPointerCapture`，`pointerup`/`pointercancel` 释放；滑出窗口仍受控。
5. **发球边沿**：见 4.2，Ready 释放边沿单次消费。
6. 覆盖层按钮点按是冻结期间唯一允许生效的输入类别；面板动画期间由 ui-renderer 抑制。

---

## 9. 响应式适配：orientation 与 800×450 阈值

- **持续检查**：`resize` / `orientationchange` / `matchMedia("(orientation: landscape)")`。
- **阈值实现（CSS 像素口径，DPR 不计入）**：可用条件 = `matchMedia("(orientation: landscape)").matches && clientWidth >= 800 && clientHeight >= 450`。该口径与各 UI 文档根 `data.targetViewports`（`[960,540]`、`[800,450]`、`[1024,576]`）一致，不另设阈值表。
- 不满足：显示 Rotate Prompt（`rotate-root`，双行文案 + 呼吸图形，无控件），游戏不开始、不重排、不缩到可用。
- 启动时即判定一次（3.2 第 6/7 步）：不满足则首帧为提示页而非 Title。
- **对局中变为不可用空间**（移动端旋转到竖屏等）：按 3.5 失焦同一路径处理——Playing 自动进入 Paused 并显示提示页、音频挂起；恢复可用横屏空间后停留在 Paused，不自动恢复，由玩家显式继续。
- 恢复后：标题流程返回 Title（UI_UX_SPEC 4.6）；世界/UI 双通道独立——世界归相机 letterbox，屏幕 UI 归锚点与响应式变体，二者不混用；首版不做竖屏重排。

---

## 10. 性能与可行性硬约束

1. **同屏规模**：60 砖（创作上限 120 块）+ 单球 + 单挡板 + 少量静态墙；不引入移动砖、多球等超 GDD 内容。
2. **纹理/图集**：优先 PNG（alpha），WebP 须保留 PNG 降级；不使用旋转帧/trim；frame 完整落图源内；单图集 ≤2048×2048，避免 4096；图集个位数；按 2 倍逻辑像素出图；Canvas DPR 上限 2。
3. **字体**：字体文件在 Manifest 注册（建议 woff2）；HUD 按契约 `textFit` 以真实字体度量最大可能分值（四位）后定框，不靠运行时缩字。
4. **音频并发**：context 全局唯一；声部上限 8（≤16）；同音 30–50ms 节流；SFX 全部预解码。
5. **帧预算**：目标 60fps（16.7ms），当前负载远离瓶颈；新增表现需求须先核对本节约束。

---

## 11. 风险与可执行验证方法

本批次无运行时代码，以下全部为**实现阶段必须执行的验证方法**，当前无一完成：

| # | 风险 | 可执行验证方法 |
|---|---|---|
| 1 | 高速球隧穿薄砖 | 搭建无 UI 的确定性测试夹具，脚本化驱动球轨迹，对运动段（swept circle 对 AABB）求精确进入时刻；分别以模拟 30/60/120/144Hz 的帧节奏重放同一场景，断言砖 id 销毁集合、反弹法线、终局判定完全一致；覆盖 360px/秒（及调音上限 400）正对薄砖与砖缝的用例；禁止用"提帧率"替代算法 |
| 2 | 角落同时接触多砖/墙的歧义 | 角落用例矩阵（砖-砖、砖-墙、双墙夹角、球同时碰板与墙），断言接触排序与 tie-break 结果在各帧节奏下稳定，且符合 2.4 可观测结果与 6.2 互斥发射规则 |
| 3 | 触控延迟/抖动/手势干扰 | iOS Safari + Android Chrome 真机实测：拖动跟随与延迟、页面不滚动不缩放、手指滑出区域的 pointer capture、44×44 热区、多点触控下不误发；不以桌面模拟器结论为准 |
| 4 | iframe autoplay 受限 | 在带/不带 `allow="autoplay"` 的 iframe 嵌入页分别验证：手势解锁路径、suspended context 容忍、静默降级不阻断玩法；交付说明写明宿主权限要求 |
| 5 | 高 DPR 内存/帧率 | DPR 1/2/3 真机与模拟环境：backing store 分配、DPR 上限 2 生效、Retina 下球/砖/HUD 清晰不糊；实测帧时间与解码内存 |
| 6 | 切后台 rAF 暂停、accumulator 大跳 | 验证帧间隔 clamp + 步进上限；按 3.5 实测 visibilitychange/blur 自动暂停、音频挂起、回焦不自动恢复的完整路径 |
| 7 | 真实字体 textFit | 字体资产加载后度量四位数字与全部中文文案，断言文本框容纳、不缩字、对比度达标 |
| 8 | Canvas 2D 未来不够用 | 基线不预埋 WebGL；当且仅当 VFX/美术需求超出 sprite/少量帧动画粒子量级时，重开本文修订评估迁移 |

**数据消费验证义务（契约 `runtimeConsumption.verification`，状态：未验证）**——实现阶段至少覆盖，方法为：在临时副本/拦截响应中改动创作数据、**不改布局代码**，对比运行时结果后恢复：

- `scene-layout`：改 Scene JSON 砖/挡板 transform（含层级），运行时实际位置随之改变；
- `ui-layout`：改 UI 节点位置/尺寸（含 anchor 与适用响应式变体），实际几何改变；各 targetViewport 下控件完整在屏；
- `resource-binding`：改资源/frame 引用，实际绘制素材改变（真实解码；HTTP 200 或文件名不算数）。

**本批无运行时代码，以上数据消费检查与第 1–7 项验证全部为未验证状态，本文不声称任何检查已完成。**

---

## 12. 代码组织边界

- **可灵活**：文件与目录划分、类/函数形态、状态管理库选择、CSS 方案、测试框架、具体合成/解码实现，均由实现方决定。
- **不可变（行为契约）**：
  1. 单向依赖：模拟层框架无关、不反向感知 UI/音频/存储；事件总线不得影响玩法结果；
  2. 固定步 1/120 + accumulator + clamp 的帧率无关模型；2.4 的可观测结算结果；
  3. 3.2 启动阶段门与 3.3 加载/错误视图行为；3.4 帧数据流；3.5 失焦规则；
  4. 第 4 节各状态资源占用与清理清单；
  5. behavior kinds（`paddle-motion`/`ball-motion`）与模拟层事件名（6.2）是模拟/音频/持久化之间的冻结接口，重命名必须修订本文并回改全部 JSON；
  6. 所有可调数值只来自 `config/tuning.json`，所有布局只来自 Scene JSON，所有 UI 几何只来自 UI 文档与契约公式——代码不持有第二份副本。

---

## 13. 文档性质、评审项与权责边界

本文为 **v1.0-draft**：行为契约已补完定稿，仍待五批文档统一评审；评审通过后方可作为实现的冻结依据。

**待统一评审 / playtest 项**：

1. GDD 同步补入失焦自动暂停规则（3.5）与对局中空间不足的同路径处理（第 9 节）；
2. 交互契约定稿：完整键位清单（结算快速重开为仅 Enter）、触控热区与焦点行为；
3. Game Over 屏是否补新纪录 badge、Level Complete 是否补退出路径（UI_UX_SPEC 遗留项）；
4. 真实素材生产后替换 shape/字符占位（节点 id 结构不变），并完成第 11 节全部验证；
5. BALANCE_DESIGN 9.2 的手感假设（360 球速、键盘余量约 0.10 秒、角度映射感知等）须原型 playtest，本文不预支结论。

**与其他文档的权责**：

- 内容契约：坐标/schema/index/atlas/消费验证唯一权威；本文只选择与引用。
- GDD：玩法范围、状态机、可观测规则唯一权威；本文保证其可实现。
- BALANCE_DESIGN：全部可调数值唯一权威；`config/tuning.json` 为工程投影。
- LEVEL_SCENE_DESIGN：世界几何、节点/组件数据需求、相机草稿与取景结果权威。
- UI_UX_SPEC：屏幕/覆盖层规格、`targetViewports`、响应式变体与提示页阈值权威。
- AUDIO_DESIGN：事件语义、音源、混音、并发细则权威；本文 6.2 表是其工程对接投影。
- 交互契约：按键/指针/焦点最终权威。
- ART_DIRECTION：视觉风格与素材规格权威。
- **本文**：运行时架构与信息流、状态运行时行为契约、数据消费方式、事件/存储接口命名、硬约束与验证方法。

冲突处理：玩法冲突以 GDD 为准；数据格式以内容契约为准；按键以交互契约为准；数值以 BALANCE_DESIGN 为准；屏幕分配以 UI_UX_SPEC 为准。本文条款与上游冲突时以上游为准并修订本文；可行性变化反向影响玩法时，按 GDD 第 9 节流程反向修订。

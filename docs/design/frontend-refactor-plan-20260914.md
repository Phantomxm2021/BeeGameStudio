# Bee Game Studio 前端重构落地方案

日期：2026-09-14。状态：设计与实施计划；尚未实施前端代码重构。

## 1. 目标、依据与工作分支

将 `apps/frontend` 重构为一套克制、清晰、响应迅速的工作界面，覆盖桌面 Web、移动 Web 和 Electron 桌面客户端。保持真实项目创建、聊天、审批、交付物、资源管理、预览、部署及账户管理能力。

设计依据按以下顺序解释：

1. 用户要求：保留真实业务内容；三端适配；模块化、隔离、组件复用；避免过度设计。
2. [engine-fronted-design-patten.md](./engine-fronted-design-patten.md)：视觉与组件规范的主要依据。
3. [dark.png](./dark.png)、[light.png](./light.png)：布局、空间层级、明暗主题关系的视觉参考。
4. 本文：对原准则未定义的移动布局、浅色 token、桌面壳、异步状态和验收方法作出的实施决策。

严格对照图片的空间关系、视觉密度和样式方向，但不复制示例项目名、场景、对话、头像、文件名、完成状态和计数。图片没有出现的现有功能，仍需在新布局中有明确入口。图片与准则冲突时采用准则，例如普通按钮采用 8px 圆角、面板 12px、少阴影，不能从图片推导出更大的圆角或玻璃效果。

| 项目 | 已建立的状态 |
| --- | --- |
| 来源分支 | `codex/ir-workflow-integration-20260914` |
| 基点 | `6137c4d9c0cb6022935dbf008c34f706f08fadbd` |
| 新分支 | `codex/frontend-refactor-20260914` |
| 新 worktree | `/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/frontend-refactor` |
| 设计资料 | 从主仓库 `bee-game-studio/docs/design` 原样复制上述三份资料；它们尚未存在于来源分支的提交中 |

来源工作区有未提交的 IR/workflow 后端改动。本 worktree 基于已提交分支，不携带这些工作区改动。后续合入后端提交时，核对公开 runtime/display 字段与行为；不要复制前端推测的阶段状态来兼容未确认的后端实现。

本次重构主范围是 `apps/frontend`，新增 `apps/desktop` 作为桌面壳。独立营销网站 `apps/LandingPage` 和 CLI 不随本次应用前端重构改版。已有产品内的 LandingView（创建项目首页）在范围内。

## 2. 源码调查：需要解决的实际问题

以下是静态代码调查，不能视为已经做过运行时性能测量。路径均相对 `apps/frontend/src`。

| 已确认的事实 | 影响 | 实施方向 |
| --- | --- | --- |
| `components/Demiurge/RightSidebar.tsx` 固定 `absolute right-4 top-24 bottom-4 w-[420px]`；`BeeGameLivePreviewPage.tsx` 用 `right-[29rem]` 给预览留位 | 窄屏不能自然重排；两个组件分别掌握全局布局 | 一个 WorkspaceShell 掌握空间分配，内容组件不再自行绝对定位 |
| `index.css` 有 48/36/30px、800 字重、大阴影、玻璃面板及胶囊按钮；多处 JSX 写死 zinc/emerald/black | 字号、颜色、形状与准则不一致，浅色模式覆盖不完整 | 先统一语义 token，再逐功能迁移样式 |
| `index.css` 与 `tailwind.config.js` 使用 HSL 分量变量，现有 Button 又使用 `var(--secondary)` 作为完整颜色 | 直接粘贴准则中的 hex token 会产生不合法颜色引用 | 同一次修改内统一为完整 CSS 色值，并修改对应 Tailwind 映射和引用 |
| `LandingView.tsx` 2166 行，混合登录、需求收集、恢复草稿和多种对话框；`SettingsMenu.tsx` 混合多个设置域 | 业务状态和呈现修改互相牵连 | 按实际功能拆分；保留已有流程和服务，避免新造流程引擎 |
| `DashboardView.tsx` 同时处理 runtime、账单、部署、权限和界面，且和 App/useChat 存在整 store 订阅 | 高频消息变化可能扩大渲染范围 | 收窄 selector；按数据生命周期分离 hooks 与视图，之后用 Profiler 验证收益 |
| `useProjectEventPolling.ts` 已有串行轮询、退避、隐藏页面处理，但请求成功后缺少取消检查；资产轮询亦有类似迟到写入风险 | 项目切换时旧请求可能继续更新新视图 | 在原请求路径加项目/取消检查，必要时传 AbortSignal；不追加另一套同步机制 |
| `RightSidebar.handleSend` 在异步发送结束前清空输入和附件 | 发送失败后的恢复需要专门验证 | 提交失败保留或恢复原稿，提交期间防重复；以服务结果决定状态 |
| `systemStore` 已持久化 `isDark`，默认深色；App 挂载后才同步 `.dark` | 首屏与浮层需要统一主题，存在闪色风险 | 延用该主题来源，首帧同步同一份偏好，不创建第二套主题 store |
| 已有 `@shadcn/react/message-scroller`、历史分页、memo 化 ChatPanel、ResourceLibrary/ModelPreview 按需加载 | 已有可利用的交互与性能能力 | 保留并验证，不重复实现消息滚动或 3D 预览器 |
| `TopBar.tsx`、`App.css` 在已扫描的生产源码中没有找到导入 | 修改它们可能不影响真实页面 | 以 `App → DashboardView → BeeGameLivePreviewPage / RightSidebar` 的真实入口迁移；最终确认无引用再清理 |
| 未发现 BGS Electron/Tauri 壳；`src/commands/desktop` 是 CLI 的 DesktopHandoff | 不能把已有 desktop 文件当成 BGS 客户端 | 新建最小 Electron 壳，共用应用前端 |

## 3. 图片的布局与业务映射

桌面图的核心是一个紧凑顶栏，下方左侧大工作区与右侧协作区并列，两面板顶部、底部对齐。预览承担主要视觉面积；协作区内容独立滚动，输入框固定在该区域底部。全局入口不再散落在画布上的浮动卡片里。

```text
┌────────────────────────────────────────────────────────────┐
│ 项目菜单 / 项目名称 / 简洁状态        预览操作   发布/部署    │
├───────────────────────────────────────┬────────────────────┤
│                                       │ 协作 | 交付物 | 资源│
│            真实项目预览                 ├────────────────────┤
│        或当前阶段的真实空状态           │ 消息 / 结果 / 审批  │
│                                       │ 独立滚动区域        │
│        错误日志按需展开                 ├────────────────────┤
│                                       │ 输入 / 附件 / 发送  │
└───────────────────────────────────────┴────────────────────┘
```

| 参考图元素 | 产品中的落地内容 |
| --- | --- |
| 左上应用图标与项目名 | 现有项目列表、返回首页、当前项目名称；账户与设置从明确的菜单进入 |
| 左侧游戏画面 | 现有 build report 对应的预览 iframe；无产物时显示状态、原因与可执行操作 |
| Preview 下拉 | 启动、停止、重启、外部打开等真实预览能力；按权限和 runtime 状态启用 |
| Build 按钮 | 按当前接口语义显示“发布/部署”；`deployProject` 不因图中文字被改名成“构建”。首页继续使用真实的“开始构建”流程 |
| Chat / Artifacts | 保留“协作 / 交付物 / 资源”三项，数量来自实际数据；没有数据时不制造数字 |
| 对话与结果卡片 | 原有用户消息、工作流摘要、审批、文档、资源和产物；复用 display model 与真实状态 |
| 右下输入 | 原有发送、停止、编辑重发、附件、中文输入法行为；与消息区分开布局 |

保留真实项目资源的颜色与内容；蓝色面积小于 5% 的要求约束应用 UI 装饰，不约束用户的游戏画面、图片、资源预览或代码内容。

## 4. 视觉系统的明确决策

### 4.1 深色与浅色 token

深色按原准则，浅色是根据 light.png 推导的对称语义方案，不声称从截图精确吸取色值。两套主题共用结构、字号、组件尺寸和动效；浮层、加载态、空态、错误态一并覆盖。

| Token | Dark | Light（实施起点） |
| --- | --- | --- |
| background | `#090A0C` | `#F7F8FA` |
| foreground / text-primary | `#F4F4F5` | `#181A1F` |
| surface-1（面板） | `#0C0D10` | `#FFFFFF` |
| surface-2（次级区） | `#101215` | `#F7F8FA` |
| surface-3 | `#15171B` | `#F4F4F5` |
| surface-hover | `#191C20` | `#ECEEF1` |
| text-secondary | `#A1A1AA` | `#52525B` |
| muted-foreground（可读辅助文字） | `#8B8D94` | `#64646E` |
| border-subtle / border / border-strong | 白色 6% / 9% / 14% | 深色 `#181A1F` 的 6% / 9% / 14% |
| primary / primary-foreground | `#F4F4F5` / `#090A0C` | `#181A1F` / `#FFFFFF` |
| secondary / accent（shadcn 中性表面） | `#15171B` / `#191C20` | `#F4F4F5` / `#ECEEF1` |
| selection / ring（蓝色强调） | `#2F81F7` | `#2F81F7` |
| success / warning / destructive / info | `#3FB950` / `#D29922` / `#F85149` / `#58A6FF` | `#1F7A35` / `#8A5B0A` / `#C4312D` / `#1D67B1` |

`card`、`popover`、`input`、各 foreground 映射到上述语义，不另建一个竞争的颜色体系。蓝色 `selection` 与 shadcn 的中性 `accent` 分开命名，解决准则第 7 节与第 31 节中“Accent”语义不同的问题。Primary Button 按第 12/31 节采用黑白反相，不使用大面积蓝底。

辅助文本选用准则第 31 节的 `#8B8D94`：在 `#15171B` 上计算对比度约 5.41:1。第 6 节的 `#71717A` 在同一背景仅约 3.71:1，不用于必须阅读的小字。浅色 `#64646E` 在 `#F4F4F5` 上约 5.32:1。上述仅为不透明色对计算，半透明混合、状态色、hover 和 focus 仍需在实际组件中检查。

### 4.2 字体、密度与形状

- 字体沿用 Inter / 系统字体，补齐原准则的 SF Pro 与 PingFang SC fallback；不为改版增加远程字体请求。
- 字号仅 11/12/13/14/16/20/28px，对应行高 16/18/20/20/24/28/34px；正文默认 13px，聊天与控件 14px。字重 400/500/600，700 仅极少需要时使用。
- 移动端输入文字采用已有字号档的 16px/24px，提高触摸输入可读性并纳入 iOS 真机检查；其余字体不整体放大为营销页标题。
- 4px 间距网格：4/8/12/16/20/24/32/40/48。边框 1px、下划线 2px、图标 14/18px 等采用原准则专门规定，不误当成间距违规。
- 圆角档位 4/6/8/10/12/16px；按钮 8px、卡片 10px、面板 12px、Dialog/Sheet 12–16px。Input 默认 8px；Composer 按第 15 节容器样式用 10px。
- 普通按钮高度 xs/sm/md/lg = 28/32/36/40px，主力 32/36px，图标默认 16px，描边 1.5–1.75。
- 桌面 Tabs 高 36px、14px/500、下划线 2px。Badge 高 20–22px、11px/500、圆角 6px。
- 输入编辑区高度 44–96px，达到上限后内部滚动；附件区与按钮行单独计高，长附件不能挤出发送按钮。
- 胶囊仅用于准则允许的 status、badge、segment、tiny filter、icon toggle group。发送、添加附件等操作默认使用统一 IconButton 的 8px 圆角，不照抄图中的圆形按钮。
- 卡片和普通面板无大阴影、无默认玻璃。Dialog/Popover/Dropdown/Floating Panel 才可用 `0 8px 24px rgba(0,0,0,.24)`。

### 4.3 原准则覆盖清单

| 原章节 | 对应实施与验收 |
| --- | --- |
| 1–3 设计基调/字体/字重 | 中性分层、七档字体、正文 400、标题 600；去除应用内超大标题 |
| 4–8 背景/边框/文本/Accent/语义色 | 双主题 token；蓝色限定于 selection/focus/link/progress；状态附带文字与图标 |
| 9–11 圆角/Pill/间距 | 有限档位；普通按钮非胶囊；4px 间距网格 |
| 12–15 Button/Input | 共用 primitive variants；黑白 Primary；键盘 focus 与错误文案 |
| 16–19 Card/Panel/Shadow/Divider | 10/12px；轻边框；默认无阴影/玻璃；优先间距分组 |
| 20–22 Icon/Tab/Badge | Lucide、细描边、36px Tabs、真实简洁 Badge |
| 23–24 Tooltip/Dropdown/Popover | Tooltip 12px、6px 圆角、6×8px padding、600ms 延迟；菜单桌面项高 32px、最小宽 180px、容器 10px 圆角 |
| 25–27 Scrollbar/Selection/Focus | 6px 透明轨道；轻选中底色或 2px 指示；统一 focus-visible 双层环，浅色以当前背景分隔 |
| 28–29 Hover/Panel 动画 | 120ms hover/Dropdown、140ms Popover、180ms Dialog、200ms Sheet；不使用 700ms 全页切换 |
| 30–31 透明度/最终 tokens | 透明度统一使用命名 token；组件局部样式不自行混入不同透明度与色值；必要文字对比度优先 |

## 5. 三端布局与交互

布局按可用容器宽度变化，不按 UA 判断设备。首版用 CSS media queries 足够；不建立设备状态机。以下数值为布局实施起点，最终用真实中英文内容验证。

| 可用宽度 | 布局 | 关键行为 |
| --- | --- | --- |
| ≥1200px | 顶栏 56px，外边距 16px，面板间距 12px；右栏 `clamp(360px, 30vw, 480px)`，左栏 `minmax(0,1fr)` | 保持图中约 2:1 的视觉关系，内容可读优先；预览不被侧栏盖住 |
| 900–1199px | 顶栏 56px、外边距 12px、右栏 340px | 次要顶栏操作进入菜单；保留预览和协作并列 |
| <900px | 顶栏 48px、外边距 8px；“预览 / 协作”切换单一主面板 | 默认进入协作以支持生成和审批；随时可切回预览；交付物/资源仍在协作区可达 |
| 小高度、横屏或 200% 缩放 | 使用同一窄屏策略；主区 `min-height:0`、内容可滚动 | 顶栏、发送、关闭与审批按钮始终可达；不设固定最小页面宽度 |

首版不新增可拖拽分栏。自适应宽度已解决已知需求，避免引入拖拽、持久化和 iframe 抢指针等额外问题；未来只有实际使用证据支持时再增加。

移动交互决策：

- 主页面使用 `100dvh` 配合回退高度、safe-area；处理软键盘出现时的 viewport 缩小。不能依赖 `100vh + 全局 overflow:hidden` 作为唯一策略。
- 桌面 32/36px 视觉控件在触摸模式提供至少 44×44px 的实际点击区，避免点击区互相覆盖；菜单行和 Tabs 同步提高触摸高度。44px 是本产品触摸目标，WCAG 2.2 AA 的通用最低目标另有 24px 与间距例外规则。[目标尺寸依据](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- 手机默认通过显式发送按钮提交；键盘操作保留 Enter 发送、Shift+Enter 换行以及 IME composition 防误发。输入错误、附件过大等反馈紧邻输入区。
- 常用操作不可只依赖 hover、右键或拖放；移动端有点击菜单和文件选择入口。
- 聊天草稿、消息位置、当前 tab 随布局切换保留；切换项目按 projectId 隔离，不把 A 项目输入带到 B。
- 布局切换不同时挂载两套消息轮询、表单或 iframe。已启动的预览保持同一个 DOM 实例和稳定 key，隐藏时不可聚焦；不为隐藏 tab 持续开启额外 3D 资源预览。
- 全局导航/设置使用可访问的 Sheet；聊天不是必须长按/拖动才能打开的底部抽屉。嵌入游戏需自行支持触屏，前端壳提供尺寸正确的容器及外部打开入口，不承诺为游戏内容自动生成触控机制。

## 6. Electron 桌面客户端决策

用户已授权由本任务决定客户端技术。选择 **Electron + TypeScript + Electron Forge**。现有 React/Vite 前端直接复用，主进程只处理原生能力；主要收益是复用当前语言工具链以及一致的 Chromium 渲染环境。代价是安装体积和常驻内存较高，需要测量，但本次没有已提出的安装包体积约束。无需同时维护 Tauri 版本。[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)、[Electron Forge](https://www.electronforge.io/)

具体落地：

1. 新建 `apps/desktop`，以 Electron Forge 管理主进程/preload 的构建与 macOS/Windows 安装包。前端仍只有 `apps/frontend` 一套源码；Linux 保持可构建，发布验收以实际取得的目标机器结果为准。
2. 第一版采用连接现有服务的桌面客户端：开发加载当前工作树的 Vite，发布加载受信任的同源 HTTPS 应用地址，共用 `/api`、`/previews`、`/deployments` 与 Web 认证配置。失联时保留窗口并给出重连/服务地址信息，不宣称支持离线生成。
3. 此选择不包含打包整个 Bun/模型/资源/账单运行环境。现有服务保持独立部署；如需完全离线的本机引擎发行版，应单独设计其安装、更新和进程生命周期，不能偷偷塞进 UI 重构。
4. 第一版保留系统窗口边框与标题栏，应用内部仍使用统一 WorkspaceHeader，不制作假的 macOS 三色按钮。记忆合理窗口位置与大小，避免在断开显示器后恢复到屏幕外。窗口缩小时使用与 Web 相同的响应式规则。
5. 页面通过 `lib/platform.ts` 中少量具名函数调用所需能力，例如打开外链、保存导出；普通文件上传优先复用浏览器标准 file input。只有实际需要原生目录选择等功能时才增加对应 preload 方法。
6. Electron renderer 启用 `contextIsolation`、sandbox，禁用 Node integration；preload 只暴露明确参数的具名方法，不暴露任意 IPC/文件系统/shell。验证调用 frame/origin，生成游戏 iframe 无权调用桌面桥；外链校验协议与目标。保持浏览器安全策略，不通过关闭 webSecurity 或放开 CORS 绕过登录问题。[安全依据](https://www.electronjs.org/docs/latest/tutorial/security)
7. 认证使用现有服务端 session；OAuth 在系统浏览器完成，通过登记的应用回调与一次性交换码恢复客户端 session，校验 state/PKCE，不把长效 token 放到深链。该交换入口若现有后端不支持，需要在桌面集成阶段明确增加并联测，不能只做一个“登录成功”页面。协议注册必须在打包应用中验证。[Electron 深链集成](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)
8. 对下载、外部打开、剪贴板的失败有明确结果；macOS/Windows 系统快捷键不被聊天快捷键抢占。客户端最小化、恢复和睡眠唤醒后复用现有事件重连逻辑。

发布服务地址、签名证书和 macOS 公证账号属于发布环境配置，当前尚未核验。可先完成本地桌面开发与未签名测试构建；对外分发验收必须有目标平台安装与签名证据，不能用浏览器截图代替。

## 7. 模块边界与复用策略

### 7.1 保留单应用、按现有功能拆分

不重建 monorepo、不新建跨应用 UI 包、不引入新状态管理/请求框架、不改变后端工作流。现有 `services`、`store`、`viewModels`、`utils` 是可以利用的分层。组件目录按业务自然边界演进：

```text
apps/frontend/src/
  App.tsx                         # 入口、认证门和页面选择
  styles/tokens.css               # 双主题、字体、圆角、motion tokens
  index.css                       # Tailwind、基础样式、少量全局规则
  components/ui/                  # 复用/补齐 Button、Tabs、Dialog、Sheet 等
  components/Common/              # Toast、ErrorBoundary 等已有共用组件
  components/Workspace/           # Shell、Header、PreviewPanel、CollaborationPanel
  components/Demiurge/Sidebar/    # 先保留现有业务内容路径，迁移时逐步拆分
  components/Demiurge/Landing/    # 首页、Intake、Auth、历史/账户既有组件
  components/Settings/            # 从 SettingsMenu 按设置域抽取
  components/ResourceLibrary/     # 沿用现有模块，不重新实现资源管理
  hooks/                          # 项目级数据生命周期及已有 useChat/轮询
  services/                       # 既有 API、认证、上传队列
  store/                          # Zustand，按需 selector
  viewModels/                     # 后端公开结果 → UI 展示模型
  lib/platform.ts                 # 实际用到的 Web/Electron 具名能力入口
  lib/motion.ts                   # 少量共用时长/曲线，不造动画 DSL
apps/desktop/
  src/main.ts                     # 窗口、导航、下载、生命周期
  src/preload.ts                  # 白名单能力
  forge.config.ts                 # 打包配置
```

上图是目标职责地图，不要求预先生成全部空目录或转发文件。每抽取一个模块必须对应当前混合的职责或两个以上调用点；单处使用且简单的结构可以留在所属文件。

| 模块 | 拆分后的责任 | 不承担的工作 |
| --- | --- | --- |
| WorkspaceShell | 顶栏、主区、响应式空间分配 | API 请求、runtime 状态推导 |
| WorkspaceHeader | 项目入口、运行摘要、预览和部署操作入口 | 自行判断审批、部署是否成功 |
| PreviewPanel | 真实 iframe、空态、错误日志、预览控制状态 | 账户/资源库/设置的大型弹窗实现 |
| CollaborationPanel | 三个 tab 和数据组合 | 把聊天、上传、下载、历史分页全写在一个组件 |
| ChatTimeline / ChatComposer | 消息呈现/滚动与输入分别负责 | 自建消息协议、以渲染结果驱动后端任务 |
| DeliverablesPanel / AssetsPanel | 延用 ArtifactsPanel/AssetsPanel 的数据和权限语义 | 从图片推断“已完成”或固定文档数量 |
| Intake / Auth | 从 LandingView 抽取需求步骤、认证表单与其局部状态 | 修改需求收集和审核的业务规则 |
| Settings 各区 | 模型、工具、MCP、Skills、账单、邀请、项目生命周期分别负责 | 共用一个巨大的保存/加载处理函数 |

数据单向流动：`service → store / feature hook → display model → view`。视图通过具名回调发起操作。权限沿用真实授权；组件拆分不能把原本不可用的操作重新放开。复用现有 i18n 文案与命名空间，新增可见文案进入词条，不再在大型 JSX 中写中英分支。

### 7.2 组件选择

| 需求 | 首选复用 | 必要调整 |
| --- | --- | --- |
| Button / IconButton / ButtonGroup | 当前 `components/ui/button*` 与 Base UI | 统一 variant、尺寸、颜色、focus，IconButton 作为现有 Button 的薄组合 |
| Dialog / Sheet / Menu / Select / Tabs / Tooltip | 当前 shadcn base-nova 对应的 Base UI primitives，按需补入本地 ui 目录 | 保留库的焦点/键盘行为，统一皮肤；不再手写一套弹层焦点陷阱 |
| Switch / Skeleton / ContextMenu | 现有 ui 组件 | 修正硬编码主题和触摸尺寸；确有交互缺失时回到现有基础库实现 |
| 消息列表与跳转 | 当前 `@shadcn/react/message-scroller` | 主题、reduced-motion、分页锚点验证；不再并行采用 beUI MessageScroller |
| 工作流/审批/交付卡片 | 当前 CollaborationFeed、WorkflowCard/StageCard、ArtifactCard、displayModels | 清理外观与职责混合，保留真实业务语义 |
| 资源树/预览/上传 | react-arborist、现有 ResourcePreview/ModelPreview、上传队列 | 响应式详情、加载态、错误恢复；不新写树或 3D 查看器 |
| 动画 | 已安装 `framer-motion` | 按原准则使用；beUI 动效按需迁入并核对 import/API，避免同时新增另一份 Motion 运行库 |

beUI 是可选源码来源，不是第二套设计系统。[Motion 组件目录](https://beui.dev/components/motion) 可供选取；[Tabs](https://beui.dev/components/motion/tabs) 的移动指示器可以借鉴，但查阅的示例 trigger 主要处理点击，不能据此认定键盘交互已完整。Tabs 的焦点/键盘仍交给基础 primitive。[Drawer](https://beui.dev/components/motion/drawer) 仅在有实际需要时选取进出场模式，去掉玻璃默认皮肤。引入代码记录源 URL、取得时版本/commit、许可证，先检查依赖，不执行整库覆盖。

不采用跑马灯、磁吸按钮、3D Tilt、gooey popover、shader 背景、全页平滑滚动或长弹簧作为工作台默认语言。这些不能解决本次布局与交互问题。

## 8. 动画与加载不卡顿的实现方法

### 8.1 Motion

| 场景 | 约束 | 处理方式 |
| --- | --- | --- |
| hover / press | 120ms；点击立即反馈 | 只过渡背景、边框、文字、opacity；普通按钮不反复弹跳 |
| Tabs 指示器 | 120–160ms，首次挂载不飞入 | 小范围 transform 或局部 layoutId；tab 切换不等待上一页退场完成 |
| Dropdown / Popover | 120 / 140ms | opacity + 4px 内位移；无模糊动画 |
| Dialog / Sheet | 180 / 200ms | 受控进出场；退出时阻止残留层接收输入，库管理焦点恢复 |
| 消息与结果更新 | 单条新项可短淡入 | 历史记录不逐条重播；流式文字不逐字动画、不每批触发全列表 layout |
| 主题切换 | 无动画或 ≤120ms 颜色反馈 | 首屏不动画；不做 700ms 全页过渡或整页截图转场 |
| reduced-motion | 取消位移、缩放、弹簧和持续闪动 | 保留静态状态/简短淡入反馈；关闭 smooth scroll 和装饰循环 |

共用时长服从原准则第 28–29 节；不使用 beUI 的较长默认时长覆盖项目规范。[beUI motion 指南](https://beui.dev/docs/motion-patterns) 仅作为按交互目的选择动画和 reduced-motion 的补充资料。

避免 `transition-all`、全工作区 `layout`、大量常驻 `will-change`。不对 iframe 每条消息重设 key，主题和 tab 切换不重启游戏。动画不能作为延迟发请求或锁住输入的理由。

### 8.2 数据与渲染

1. 延用 `useProjectEventPolling` 的单一事件通道，不再增加 WebSocket/SSE/第二条轮询。修正请求返回后的取消检查，使卸载、切换项目和重连不会消费旧响应。
2. App、Dashboard、useChat 改为只订阅所需 Zustand 字段；账单刷新不能让输入重建，流式消息不能让整页预览更新。稳定对象和 memo 只放在经检查确有价值的边界。
3. 首次加载在对应区域显示与内容近似的 Skeleton；已有内容刷新时保留旧内容并标明更新中。资源、额度、部署历史失败不遮住聊天和预览整个界面。
4. `loading / empty / error / success` 以及后台刷新要能区分。空数组不是请求失败，断线不是任务成功；审批提交后继续显示等待服务确认。
5. 保留现有历史分页与滚动锚点。用户在底部才跟随新消息；阅读旧内容时给“新消息”入口。加载更早记录不把视口拉到底部。
6. 首先利用分页、局部订阅和稳定消息行控制渲染成本。只有 1000 条消息等约定数据集实测不达标时才引入成熟虚拟列表；不得自写虚拟滚动算法，也不能破坏现有消息跳转和可访问性。
7. 流式高频事件先测量；确有多次同帧更新时再合并同一消息的增量。结束、错误、审批等状态不能被节流丢弃，后台页面恢复后必须拿到最终状态。
8. 延用 Dashboard、ResourceLibrary 和 ModelPreview 的 lazy 边界；设置、账单等大型功能按打开时加载。无关后台视频/Shader 不进入核心工作台首屏。资源缩略图设尺寸占位并懒加载；3D 资源取消/切走后释放 GPU、监听器和对象 URL。
9. 单条 API 路径处理取消、错误与重试，避免组件和 store 各写一层重复重试。上传沿用现有队列；审批、构建、发布等写操作不因自动刷新再次执行。

### 8.3 性能目标与测量条件

以下是待验收预算，不是当前测量结论。先固定构建、机器、浏览器版本、网络条件，记录测量后再决定是否加复杂优化。

| 场景 | 验收目标 | 取证方式 |
| --- | --- | --- |
| 点击/输入反馈 | 本地反馈 ≤100ms，代表性操作延迟 ≤200ms | 生产构建，桌面和移动真机 trace；记录慢操作而非只看均值 |
| 拖动滚动/展开面板 | 60Hz 设备目标流畅 60fps；前端不得持续产生 >50ms 长任务 | 持续滚动与切换的 Performance trace，分离游戏 iframe 自身开销 |
| 首屏 | 冷加载模拟移动网络，目标 LCP ≤2.5s、CLS ≤0.1 | 固定 Fast 4G、4× CPU throttling，各 5 次报告分布；用户认证/API 等待单列 |
| 长会话 | 1000 条混合消息、长 Markdown、图片、真实形状审批/阶段卡，加载历史与输入可同时使用 | 固定测试 fixture 与 React Profiler；不以截图内容减少为优化 |
| 资源库 | 至少 500 项列表/树，按需渲染预览，无一次性加载全部 3D 文件 | 网络瀑布与交互 trace；确认已有分页/树实现行为 |
| 反复进入/离开 | 项目切换与 3D 打开关闭 20 次，无持续增加的计时器、监听器、iframe/WebGL 实例 | 堆快照与资源计数；有 GC 波动需区分趋势 |
| 客户端 | 冷启动、最小化恢复、系统睡眠恢复均可操作 | macOS/Windows 打包应用实测启动与内存，不用 Web 结果替代 |

后端生成速度、网络耗时与 UI 卡顿分别记录。前端只承诺等待过程可交互、信息准确；不可用动画伪装进度或固定写“50%”。

## 9. 页面与状态的完整覆盖

| 页面/功能 | 必須保留的真实能力 | 改版重点 |
| --- | --- | --- |
| 认证与恢复登录 | 登录、注册、OAuth、忘记密码、认证故障反馈 | 统一 Form/Dialog；恢复期间无全屏纯黑闪烁；错误字段可定位 |
| 创建项目首页 | 需求输入、附件分析、方案选择、生产参数、确认 brief、启动构建、草稿恢复 | 克制的主操作区；分步骤呈现已有流程；不额外增加需求确认阶段 |
| 项目列表/历史 | 打开、返回、权限允许的项目管理与错误恢复 | 可滚动、可键盘操作，移动端行操作入口明确 |
| 工作台/预览 | 真实预览、启停重启、构建错误、修复、外部打开 | 预览主区域；状态提示就地呈现；日志展开不遮住全部操作 |
| 协作 | 历史/新消息、用户身份、工作流卡、输入、停止、编辑重发、附件 | 列表和 Composer 分离；审批始终可发现；长内容不溢出 |
| 审批 | 允许/拒绝及现有 scope、提交中、等待 runtime、失败重试 | 操作含义不变；同一审批不能重复提交；图标与文案共同表达状态 |
| 交付物 | 文档进度、内容预览、下载、项目导出 | 保留现有服务事实；文档阅读桌面 Dialog/窄屏全屏层；不固定为截图中的 4 件 |
| 项目资源 | 需求/清单、上传、验收状态 | 卡片/列表简化皮肤，权限/运行状态禁用有原因 |
| 全局资源库 | 资源包、树、预览、元数据、批量上传、处理/整理任务、发布/归档 | 沿用现有数据与上传队列；移动端列表→详情；复杂操作不因屏幕小而消失 |
| 部署 | 发布、历史版本、失败日志、修复、回滚 | 独立 DeploymentDialog；真实成功/失败；保持现有授权与确认语义 |
| 账户与积分 | 资料、头像、余额、消费信息、套餐/支付入口、退出及现有账户操作 | 统一浅/深色与信息密度；不改收费流程 |
| 设置与管理 | 模型、工作目录、搜索、runtime、MCP、Skills、邀请、账单管理、项目保留规则 | 按功能区拆分；局部请求和保存状态；权限仍决定入口与操作 |

每一行都覆盖深色、浅色、首次加载、空数据、失败、无权限/禁用状态。涉及写入的操作另外覆盖提交中、成功、失败恢复，不能只交付 happy path。

## 10. 交互规范与可访问性验收

- Tabs 使用 tablist/tab/tabpanel 和正确关联；支持方向键与 Enter/Space。涉及网络懒加载的 tab 使用手动激活，避免焦点移动被请求阻塞。[WAI Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
- Dialog/Sheet 打开后焦点进入、关闭后返回触发项，Tab 不逃出模态；有可见关闭按钮，Escape 能关闭可关闭层。复杂内容先聚焦标题。由基础库维护，不重复手写。[WAI Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- 所有可点击图标具备可访问名称；tooltip 不是唯一标签。焦点可见且不被固定顶栏或输入框遮住，tab 顺序与视觉顺序一致。
- 正常小字对比度目标 ≥4.5:1，大字 ≥3:1；必要控件边界/焦点/状态视觉标识需满足对应非文本对比要求。装饰性弱分隔线不能是识别输入框的唯一线索。[WCAG 对比度](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[非文本对比](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- 成功、错误、等待不只依赖颜色；错误提示有重试或恢复路径，局部问题不滥用全屏模态与重复 Toast。
- 流式消息不逐 token 向读屏器播报；只适度通知新消息/完成/审批。表单 label、错误描述与控件关联。
- 200% 缩放、键盘全程操作、reduced-motion、触摸、中文 IME、长中英文项目名与文件名都要检查。隐藏面板不留在焦点序列。

## 11. 实施顺序与完成标准

采用可独立核验的小批修改。每批替换当前实际入口中的一个明确职责，不维持长期双套实现，不新增特性开关平台。先让真实页面可用，再推进下一批。

| 批次 | 实际修改范围 | 完成标准 |
| --- | --- | --- |
| 0：设计与基线 | 本 worktree、三份设计依据、本文；整理现有行为覆盖 | 本次已完成源码与图片调查。实施启动时运行原有检查并记录失败，不能把基线失败算成新引入 |
| 1：视觉基础 | `styles/tokens.css`、`index.css`、Tailwind 配置、Button/Switch/Skeleton 等实际共用组件、主题首帧 | 明暗主题均有合法完整变量；一组真实控件覆盖 hover/focus/disabled/error；无 hex 被包进 hsl 的兼容问题 |
| 2：工作台布局 | 抽出 WorkspaceShell/Header；迁移 PreviewPanel 和 CollaborationPanel 外壳；局部拆出部署对话框 | 1440/1024/390px 三档可用；保留实际 iframe、所有 tab 和现有操作；侧栏不遮挡预览 |
| 3：协作与异步 | ChatTimeline/Composer、交付物/资源、局部数据 hooks、迟到请求和 selector | 发送失败不丢草稿；历史滚动稳定；审批不重复；跨项目无串数据；流式更新不重载 iframe |
| 4：首页与管理界面 | LandingView 的 Auth/Intake、历史、账户、设置各区、全局资源库统一皮肤 | 第 9 节每个功能可找到且可操作；移动输入/长表单/弹层检查通过；迁移掉对应玻璃和硬编码色 |
| 5：桌面集成 | `apps/desktop`、实际 platform 函数、客户端 OAuth/下载/外链、Forge 打包 | 同一前端在 macOS/Windows 窗口可用；原生桥隔离；实际安装、登录、项目、导出、唤醒测试有记录 |
| 6：交付核验 | 三端主题/状态矩阵、关键行为测试、性能 trace、移除无引用旧代码 | 达到本文的独立设计/行为标准；剩余限制逐项写明；不能以“比旧版好”替代验收 |

批次 2 是首个完整的工作台视觉成果，但不是整个前端重构完成；批次 4 和 5 不能遗漏。桌面认证需要的服务端改动单独说明并测试，避免混入纯视觉提交。

### 11.1 验证执行

在新 worktree 安装其自身锁定依赖；不把其他工作区的 node_modules 当成本次修改。执行命令从 `apps/frontend` 运行：

```sh
bun run build
bun run lint
bun run test:run
```

小批修改先运行对应已有测试；发布前做完整前端检查。重点沿用 `App.test`、`DashboardView.test`、`RightSidebar.test`、`ChatPanel.test`、WorkflowCard/ArtifactsPanel/AssetsPanel、`useChat.test`、`useProjectEventPolling.test`、store/service 和 ResourceLibrary 测试。拆分后迁移相关测试，UI 文案/布局变化不能通过删除业务断言来“通过”。

新增测试只覆盖必要行为：跨项目迟到响应、发送失败草稿恢复、键盘焦点/IME、布局切换不重复挂载通信与 iframe。颜色、间距和静态样式以浏览器视觉核验为主，不为每个 CSS class 写镜像测试。

基准截图使用固定、隔离的代表性项目数据：就绪、生成中、等待审批、失败、空态。对设计图比对布局、层级、密度、边框、字体、按钮与输入外观；动态内容区不做截图像素相等要求。建议记录桌面 1440×900/1920×1080、窄桌面 1024×768、移动 390×844/360×800 与横屏，加上 macOS/Windows 客户端截图。Web 至少检查 Chromium、Safari、Firefox；移动用 iOS Safari、Android Chrome 真机。

实际可用端口需先核对：当前服务约定前端 `62173`、runtime `62174`，Vite 启用 strictPort。不能为运行新 worktree 自动杀掉旧服务或改全仓固定端口。并行视觉检查可用构建产物和隔离的测试夹具；真实联调按可用服务实例安排。

### 11.2 开发环境与风险记录

| 事项 | 处理 |
| --- | --- |
| 来源分支后端仍在变化 | 合入具体提交后核对公共 display/runtime 接口，保留前端组件边界，不复制后端阶段逻辑 |
| 浅色图与文档只提供部分状态 | 本文明确补齐浅色语义；实现时逐状态核验实际对比度 |
| beUI 源码可能不符合现有依赖/交互 | 只按需取用，保留基础 primitive 行为，检查许可证与依赖后再落盘 |
| 生产服务地址/桌面签名配置未核验 | 不阻塞 Web 改版与本地壳开发；对外桌面发布前补齐环境与平台证据 |
| 性能数据尚未采集 | 先记录基线和固定数据集，用 trace 决定是否引入虚拟列表等复杂度 |

当前成果是可执行方案与独立开发工作树；此文中的代码结构、桌面壳、性能目标和验收步骤均为接下来要实施/验证的工作，不表示已经交付对应功能。

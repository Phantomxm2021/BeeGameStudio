# Idea to Game 宣传片设计

## 目标

为 BeeGame Studio 制作一支约 60 秒的对外宣传片，核心展示“一句 Idea 如何变成一个可玩的游戏”，并突出产品区别于普通 AI 聊天工具的能力：游戏生产工作流、协作式 Agent、语义化资源组织，以及从规划到预览的闭环。

第一阶段只实现 16:9 横版 MVP；场景数据固定、渲染可重复，后续再复用同一套场景适配 9:16。

## 叙事结构

1. **Idea 输入（0–8 秒）**：展示 `LandingView` / `HeroIntro` / `IdeaPromptForm`，用户输入一句游戏创意。
2. **创意拆解（8–18 秒）**：创意展开为玩法、系统和任务节点，说明用户不需要先写完整策划案。
3. **Agent 协作（18–32 秒）**：展示 `DashboardView`、`WorkflowCard`、`WorkflowStageCard` 和协作 feed，多个 Agent 依次激活并推进工作流。
4. **资源理解与组合（32–44 秒）**：展示 `ResourceLibraryView`、`ResourcePackExplorer`、`ResourcePreview` / `ModelPreview`，将需求映射到候选资源并组合成资源包。
5. **构建与预览（44–55 秒）**：展示构建状态、产物和 `BeeGameLivePreviewPage`，从产品工作台过渡到游戏结果。
6. **品牌收尾（55–60 秒）**：游戏画面与品牌文案收束，推荐文案为 “From a thought to a playable world.”。

## 技术方案

新增 `apps/promo-video` Remotion workspace，包含一个主 composition `IdeaToGame`。Remotion 负责时间轴、镜头、缩放、聚焦、转场、字幕、音乐和导出；产品前端组件负责真实 UI、品牌样式、图标和布局。

视频不直接启动完整 `App`，也不依赖登录、API、Supabase、实时 Store 或网络资源。为宣传片提供固定的 `demo-data`，并优先复用无副作用的展示组件；与业务状态强耦合的组件只提取或包裹展示层，不改动真实业务流程。

动画原则：采用 Remotion 的 `Sequence`、`interpolate` 和 `spring` 编排确定性动画；复用现有 `framer-motion` 的视觉语言和动效参数，但不依赖其运行时状态作为视频时序控制。已有背景视频和生成视频素材作为媒体层使用。

## 过渡动画设计

过渡是宣传片的主叙事手段。镜头不使用连续硬切，而是让同一个“Idea”视觉对象贯穿全片并逐步变形：输入框中的文字变成玩法节点，玩法节点变成 Agent 工作流，工作流节点变成资源卡片，资源卡片最后汇聚成游戏预览。

- **共享元素变形**：使用同一组标题、节点、卡片和光点的 `layout`/位置连续变化，保持观众的视觉追踪。
- **镜头推进**：通过 `scale`、`translate` 和轻微 `perspective` 从 Landing 推入 Dashboard，再推入 Resource Library，最后穿透到 Live Preview。
- **状态接力**：上一个场景的完成状态成为下一个场景的入口，例如 Agent 完成徽章飞向资源筛选条件，资源 Pack 的封面展开成游戏预览。
- **缓动节奏**：UI 元素使用短距离 `spring`，镜头使用平滑 ease-in-out；避免所有元素同时运动，采用先引导主体、再补充细节的 stagger。
- **遮罩与光线**：用产品已有的深色玻璃、模糊、扫描线和绿色/蓝色高亮作为统一转场语言，不额外引入复杂特效。
- **声音同步**：每次场景转换由一个轻微 whoosh/click 与关键状态变化对齐，音乐在 Idea、Agent、Playable 三个阶段有明显但连续的情绪提升。

第一版重点验证三段连续转场：

```text
IdeaPromptForm → WorkflowCard
WorkflowStageCard → ResourcePackExplorer
ResourcePreview → BeeGameLivePreviewPage
```

如果某个业务组件无法稳定参与共享元素动画，则保留其真实视觉作为画面层，用 Remotion overlay 完成聚焦、连线和变形；不为动画重写整个业务组件。

## 组件边界

- `scenes/IdeaInputScene.tsx`：Landing 风格的 Idea 输入。
- `scenes/WorkflowScene.tsx`：Dashboard / workflow 演示数据与 Agent 激活。
- `scenes/ResourceScene.tsx`：资源库筛选、预览和 Pack 聚合。
- `scenes/BuildResultScene.tsx`：构建完成、Live Preview 和品牌收尾。
- `overlays/`：Remotion 专属的聚焦框、连线、字幕和镜头运动。
- `demo-data/`：固定且可审阅的 Idea、Agent、工作流和资源数据。

## 交付与验证

- 支持 Remotion Studio 预览和 MP4 渲染。
- 同一输入数据多次渲染结果一致。
- 首先验证前 15 秒：Idea 输入 → 项目工作台 → Agent 启动。
- 通过 TypeScript 构建和一次低分辨率/短时长渲染检查；完成后再做完整 60 秒渲染。
- 不在第一阶段加入真实 API、登录流程、全量业务页面重构或独立 3D 游戏场景。

# Content 坐标统一约定

适用：新项目八文档、Scene/UI/VFX Content、BGS 编辑器、静态预览与目标运行时。本文澄清已有坐标语义，不增加 IR、引擎适配框架或 Agent 审计阶段。

## 唯一约定

| 数据 | 原点与轴向 | 单位 |
| --- | --- | --- |
| 2D Scene | 根场景左上；X 右、Y 下；子节点相对父节点 | 逻辑像素；pixelsPerUnit 只用于引擎边界换算 |
| 屏幕 UI（含 3D 游戏的 UI） | 画布左上；X 右、Y 下 | 逻辑像素 |
| 3D Scene | 世界原点；右手系，X 右、Y 上、Z 朝默认正视视点 | 米 |
| 图集区域 | 图片左上；X 右、Y 下 | 图片像素，不能当作场景尺寸 |
| 碰撞器、发射器、局部 VFX | 所属节点的局部空间，继承父变换一次 | 随所属 2D/3D 空间 |

所有 `transform.rotation`、`layout.rotation` 保存弧度。3D 使用 XYZ Euler；2D/UI 正角度在 Y 向下平面内顺时针。Inspector 可以显示角度，但存储必须转换回弧度。已有实验性 UI `data.rotation3D` 是角度字段，不得当作 Transform；保留它的显示边界转换，不静默改写旧数据。

2D 世界坐标由 `data.settings.coordinateSystem` 的 `origin: top-left`、`units: logical-pixels`、width/height/pixelsPerUnit 定义。3D 使用 `origin: world`、`units: meters`。借鉴 GameObject/Component 结构不意味着采用某个引擎的坐标默认值。

## 局部变换与锚点

世界变换 = 父世界变换 × 平移 × 旋转 × 缩放。必须保留父旋转、非均匀缩放和负缩放；不能简单把父子位置相加，也不能将全局位置再次作为嵌套 DOM 的局部位置。

UI 九宫格使用 `[x,y]`：top-left=[0,0]、top-right=[1,0]、middle-center=[.5,.5]、bottom-left=[0,1]、bottom-right=[1,1]。新输出使用 middle-*；旧 center/center-left/center-right 只作为同义拼写读取。

- `layout.anchor`：父矩形中的参考点。
- `layout.position`：相对该参考点的偏移。
- 子 pivot 默认等于 anchor，`data.anchor={x,y}` 只覆盖子 pivot。
- 未变换的局部左上角 = 父尺寸 × anchor + position − 子尺寸 × pivot。
- 旋转/缩放围绕 pivot；编辑框、旋转手柄、拖拽和 DOM 使用相同语义。
- Sprite pivot 只移动渲染几何，不移动 GameObject、子节点或碰撞器。

Scene 内的 RectTransform 使用同样的左上锚点语义：

```
size = parentSize * (anchorMax - anchorMin) + sizeDelta
rectOffset = parentSize * (anchorMin + (anchorMax-anchorMin)*pivot - parentPivot)
             + anchoredPosition
localPosition = Transform.position + rectOffset
```

没有父 RectTransform 时 parentSize 为零。世界空间 Canvas 的尺寸随所属场景单位；独立屏幕 UI 仍用逻辑像素。RectTransform 不能同时被解释成目标引擎的默认坐标。

## 落地边界

- 公共常量/纯数学：`packages/scene-editor/src/content-coordinates.ts`。
- Author、Content、Implementation 读取同一约定；只规定数据含义，不规定 Agent 的工具顺序或审计次数。
- Scene Editor 使用中心原点、Y 向上的内部空间。导入/保存边界互逆转换位置、旋转、RectTransform、碰撞器偏移；不把编辑器坐标写回 Content。绘制层产生的临时深度偏移必须从保存值中移除。
- 3D 世界和 3D VFX 不套用 2D Y 翻转、画布中心偏移或 pixelsPerUnit。
- UI Editor 共用锚点与矩阵定义；静态 Scene Preview 按完整二维仿射矩阵绘制，包括父旋转、镜像、剪切及越界裁切。
- 已生成的游戏代码不是 BGS 内置运行时：新契约不会自动修好旧游戏。旧项目需要单独修订，或按计划使用全新项目验收。此轮不直接改测试项目文件。

## 验证与下一步

先验证九宫格、三层嵌套、非中心 pivot、父旋转/缩放、RectTransform 拉伸、Z 保留、资源 pivot 与碰撞器分离，以及“导入→编辑→保存→重开”不漂移；静态预览检查实际栅格结果，不仅检查函数返回成功。

随后才启动全新 Web React 项目，检查真实游戏和编辑器在位置/缩放/旋转/显隐编辑后是否一致。单元测试通过不等于整个项目可交付；既有子代理提前收尾、空验证通过的问题仍需独立修正，不能凭当前 Workflow PASS 宣布验收成功。

本轮验证（2026-09-20）：服务端相关测试 45 项、Scene Editor 数学/渲染/操作测试 15 项、前端 Scene/UI 编辑与保存测试 34 项全部通过；服务端、Scene Editor、前端 TypeScript 检查通过。覆盖了旋转后实际栅格像素和负缩放，不代表已完成真实浏览器或新项目的端到端验收。未重启服务、未改写既有测试项目。

# 翻灯解谜项目 Bug 审计

审计对象：本轮 BGS 生成的完整游戏项目（八文档、Content、资源、源码、测试及现有 dist）。不是整个 BGS 系统的全量审计。

结论：**目前不合格。确认 24 项问题：P1 5 项、P2 12 项、P3 7 项。未发现 P0。** 核心翻灯规则和两关解法正确，主要问题集中在操作、画面数据消费和文档落实。

“实测”＝当前浏览器复现；“代码”＝源码明确存在；“文档／数据”＝原文冲突或独立计算。未修改测试项目，未追加付费生成。此清单不保证穷尽全部潜在缺陷。

## P1：影响正常游玩，先修

| 编号 | 问题与影响 | 直接原因／根源分类 | 证据 |
|---|---|---|---|
| 01 | 支持范围内的 568×320 被判为“尺寸过小”，不能游玩。 | 先减掉边距，再拿剩余空间判断窗口尺寸。**实现写错**，需求明确。 | 实测；E1:190–196 |
| 02 | 焦点在“重开本关”时按回车，没有重开，反而翻灯、步数增加。 | 全局键盘处理抢走按钮的 Enter／Space，没有区分正在操作哪个控件。**实现写错**。 | 实测：步数 1→2；E1:123–152 |
| 03 | 点击一个格子后按回车，可能翻到之前选择的另一个格子。 | 点击只改盘面，不更新内部选择位置。**实现遗漏**，UI 文档明确要求跟随。 | 实测／代码；E1:211、E2:85；UI §5.3 |
| 04 | 最终结算页按回车无法“重新开始”。 | 进入结算后，220ms 回调又把焦点移到已锁定的棋盘。**实现写错**。 | 当前两关完整实测；E1:99–107 |
| 05 | 窗口过小／竖屏时，隐藏棋盘仍能被键盘操作。 | 只隐藏画面，未关闭输入；操作条也仍保留。**实现遗漏**。 | 实测：尺寸提示下 Enter 使步数 0→1；E1:125、204–228 |

## P2：明显偏离交付要求，验收前修

| 编号 | 问题与影响 | 直接原因／根源分类 | 证据 |
|---|---|---|---|
| 06 | 灯光、焦点框等偏离灯窝，亮灭位置不好辨认。 | 把节点中心坐标当成左上角，忽略 JSON 的 pivot。**数据消费错误**，不是 JSON 没写位置。 | 画面观察／代码；E3:82–99 |
| 07 | 方向键改变内部选择，却不移动真实页面焦点；操作条按钮也没有可见键盘焦点。 | 选择状态与页面焦点没同步，还全局取消了焦点描边。**实现遗漏**。 | 实测／代码；E1:148、E4:37 |
| 08 | 结算卡片没有限制焦点范围，Shift+Tab 可回到后方操作条。 | 只在进入时聚焦一次，没有隔离后方控件。**实现遗漏**。 | 实测聚焦到静音按钮；E5:19、E6 |
| 09 | 结算／提示卡片的底色、圆角等没按数据呈现，文字直接浮在棋盘上。 | 有外观的 container 被当成纯布局节点跳过。**数据消费错误**。 | 画面观察／代码；E5:26；Hud／Unsupported 同类处理 |
| 10 | 正式 Scene 的 Camera 配置不控制实际画面，改它不会得到预期构图。 | 自行使用“400／360”缩放，绕过数据中的 Camera。**数据消费错误＋文档与正式数据未对齐**。 | 代码；E3:66–72、218；E8 |
| 11 | 开启系统“减少动态效果”后，涟漪、呼吸等仍未按要求关闭。 | 降级 CSS 使用的类名，实际节点没有挂载；亮灭仍固定 140ms。**实现遗漏**。 | 代码；E3:112、119、143；E9:172 |
| 12 | 两关全部完成的专属音效不会触发。 | 音频引擎有该声音，但进入最终结算只播放“继续”。**实现遗漏**。 | 代码；E1:99–104；Audio §3.7；未做独立听感验收 |
| 13 | 快速连续重开时，重开音可能叠在一起。 | 新声音没有替换旧重开音，只停翻灯／撤销音。**实现写错**。 | 代码；E10:287–292；Audio §3.3 要求单实例 |
| 14 | 游戏组件卸载后，音频资源和延迟聚焦回调未清理。 | 清理只移除监听，没有调用现成 dispose，也没有取消定时器。**实现遗漏**。 | 代码；E1:64–67、105；E10:454；未复现实际泄漏规模 |
| 15 | 最小窗口的布局预算自相矛盾，照文档做需要自行猜。 | 同时要求边距≥12／按钮≥44，却用边距8／操作条40计算可用空间。**文档冲突**。 | 文档；E11:42、137–138 |
| 16 | 按正式 Camera 投影，568×320 的棋盘格约42px，小于要求的44px。 | Content 的缩放结果没有满足最小命中区要求。**Content 与要求不符**；不能靠忽略 Camera 掩盖。 | 数据核算：96×236÷540≈41.96；E7／E8；当前运行时另有01阻挡 |
| 17 | 文档说不用 Manifest、没有 assets/runtime，实际系统要求注册且代码已依赖这些资源。 | 平台检查与已发布资源方案不一致，执行后又未同步文档。**系统约束／文档交接冲突**。 | 日志／代码；E12:732；Tech §5.2、Asset §2 |

## P3：不阻断主玩法，但影响一致性与完成度

| 编号 | 问题与影响 | 直接原因／根源分类 | 证据 |
|---|---|---|---|
| 18 | 静音 icon 约向上偏2.25px。 | 内部图标未做垂直居中。**实现细节错误**。 | DOM 实测；E6:63–69 |
| 19 | 操作条缺少规定的悬停／按下反馈。 | 只实现静态与禁用样式。**实现遗漏**。 | 代码；E6；UI §6 |
| 20 | 步数更新、重开复位波、换关交叉淡化等没有落实；撤销却播放了不应有的涟漪。 | 动效资源有定义，使用端没有完整接入／区分事件。**实现遗漏／写错**。 | 代码；E1:95–104；E3:136–145；Art §7 |
| 21 | 换场220ms期间按方向键，输入直接丢失，不是结束后生效。 | 所有相关动作统一丢弃，没区别翻灯与移动选择。**实现偏离文档**。 | 代码；E1:70–76；UI §8.3 |
| 22 | “乱点后过半概率至少还需5步”的结论没有成立依据。 | 把全部盘面的均匀统计当成玩家乱点后的分布。**文档推理错误**。第1关随机点一次只会剩0或2步。 | 独立枚举；Balance §5.3；E12 的 finiteCheck |
| 23 | 进入制作后，多处文档仍标“草稿／待评审／待交付”。 | 已完成的交接状态没更新，实施者难辨哪些还未定。**文档交接未同步**。 | 八文档现存正文；E13 |
| 24 | 重开动效没有说明怎样恢复初始亮灯；通关要求先播完翻灯，又要求进入通关时立即清掉瞬态。 | 终态／播放顺序说法不完整或冲突。**需求表达不明确／文档冲突**。不是当前规则重开失败。 | 文档；E14:142–161 |

## 为什么会漏掉

| 分类 | 本次证据与判断 |
|---|---|
| 实现缺陷 | 多数操作要求已有明确文字，但没有落到代码；不是“需求没说”。 |
| 数据消费错误 | JSON 有数据，不代表使用端理解字段：pivot、Camera、带外观的容器被忽略。 |
| 文档／交接问题 | 最小尺寸预算、平台资源要求、动效顺序和完成状态没有统一。 |
| 验收覆盖不足 | 几何测试只检查 UI 矩形解析，没检查真实 Scene／CSS；键盘测试只推进到第二关，没走完最终结算；模拟环境用 click 代替回车，绕过了真实焦点和默认行为。 |
| 记忆混乱／模型能力不足 | **没有足够证据定为根因。** 能确认生成和审查出现错误，不能据此断言都是长上下文或模型能力造成。 |
| 系统流程 | 本轮真实验收到时限仍未完成，**没有最终通过记录**；不能把前面检查通过当成游戏已合格。 |

## 未计入已确认 Bug

- 长按结算确认是否意外连续推进、后台声音恢复是否补播旧音、刘海安全区大于12px时的实际布局：待专项实测。
- 早期数据加载失败：本轮后续重建已解决。
- **更正旧结论：960×540 棋盘裁切，本次当前 dist 未复现。** 第一格 x≈294.67、宽≈106.67，棋盘居中；旧观察保留，但不继续列作当前确定缺陷，变化原因尚未确认。
- 按钮文字未居中的旧反馈来自独立 HTML preview，不能直接认定实际游戏所有按钮都有同一问题。

处理顺序：先修01–05保证完整操作，再修 Scene／UI 数据消费和音频／动效；同步消除文档冲突，最后用真实浏览器重走键盘、指针、最小窗口完整两关。不需要先追加复杂框架。

## 证据定位

- E1 [App：输入、尺寸、转场与清理](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/App.tsx:70)
- E2 [reducer：翻灯没有更新选择](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/game/reducer.ts:85)
- E3 [Scene 渲染：位置、缩放、动效](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/ui/BoardSceneView.tsx:66)
- E4 [全局取消焦点描边](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/styles.css:37)
- E5 [结算层：一次聚焦、跳过容器](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/ui/Overlay.tsx:19)
- E6 [操作条：样式、事件和 icon](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/src/ui/Hud.tsx:19)
- E7 [正式 HUD 数据](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/content/ui/hud.json:70)
- E8 [正式 Scene／Camera 数据](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/content/scenes/board-scene.json:21)
- E9 [减少动态效果规则](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/assets/runtime/procedural/theme.css:172)
- E10 [音频实现](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/assets/runtime/procedural/audio-engine.ts:287)
- E11 [UI 文档](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/docs/UI_UX_SPEC.md:136)
- E12 [前轮原始验收记录](/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/docs/verification/design-delivery-paid-acceptance-lights-2026-10-05.json:732)；其中 O14 裁切结论以本报告的新复查为准。
- E13 [交付后仍标草稿的技术文档](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/docs/TECHNICAL_DESIGN.md:6)
- E14 [美术动效顺序要求](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/docs/ART_DIRECTION.md:142)
- 验收覆盖：[模拟浏览器旅程测试](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/test/app.journey.test.tsx:235)；[只核对 UI 矩形的测试](/private/tmp/bgs-newidea-lights-paid-20261005-cwNL4ZqW/projects/users/design-test/newidea-lights-20261005-cwNL4ZqW/test/uiLayout.geometry.test.ts:13)


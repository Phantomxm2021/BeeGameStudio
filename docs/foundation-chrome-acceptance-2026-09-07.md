# Foundation 三模块 Chrome 真实模型验收

日期：2026-09-07。结论：生命周期闭环完成，但产品验收不通过。最终被接受的文档仍存在明显玩法冲突，且正常等待 Checklist 交接被界面显示为错误。

## 环境与范围

- Chrome 实际操作 `http://127.0.0.1:62173/`，不是浏览器接口模拟。
- 工作树：`game-ir-isolation-recovery`。后端在确认旧项目无运行任务后重启至本工作树代码。
- 用户授权真实模型调用，不设置费用上限。未修改生产代码、未预置结果、未注入文档缺陷、未发布游戏。
- 项目：`star-catch-60s--e4ca0a116bac`。
- projectId：`project_1788761029362_tbuw7v`。
- runId：`9162a52e-81a8-4b19-9ea4-90e1b0854fa3`。
- 项目目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/star-catch-60s--e4ca0a116bac`。
- 测试需求：桌面 React 2D 接星星，60 秒、3 生命、左右移动，失焦冻结并手动继续，简单几何与程序化音效；无外部素材、账号、联网、排行榜、支付和存档。

## 实际经过

1. 经首页输入需求、实际计费确认、生成方案、选择最小方案、补充约束、确认构建，创建独立项目。
2. Author 约 06:03:49 UTC 开始。编写中刷新，恢复同一项目及同一 Author handle，未重复启动。
3. 约 06:18:46 UTC 八份文档完成。Reviewer 检出关卡文档只有 DSML 工具协议残片、缺少正文标题；自动交给 Revision。
4. 第一次整文修订输出校验失败（`output_invalid`），第二次成功。此轮候选仅改变关卡文档，其余七份摘要未变。
5. 复核发现 13 条格式、事实契约及语义问题，包括不适用的 3D 镜头、关卡、恢复和时长设计；自动进入第二轮修订。
6. 下一次复核收敛为 1 条资源覆盖需求契约不一致，自动进入第三轮修订。
7. 最终 Reviewer 返回 `passed`、`issues: []`；工作流 sequence 为 6，停在 `needs_action / DOCUMENT_REVIEW`。后台消息为 `Foundation review passed. Checklist handoff awaits acceptance.`。
8. 完成后再次刷新，恢复相同项目、相同最终状态。交付物预览可打开，关卡文档已替换为修订版 1.0.2。
9. 对公开项目目录的八份文档做只读 SHA-256 校验，全部与 acceptedReview 的摘要一致，排除“预览到旧文件”的解释。

## 阻断验收的问题

### P1：审计通过的最终关卡文档仍明显偏离确认需求

在 Chrome 最终文档预览中直接观察到：

- `docs/LEVEL_SCENE_DESIGN.md:13`：持续世界、hub、biome 分支。
- `:24`：`Hive_Hub`、save system、跨场景管理器。
- `:26`：每个 biome 首次穿行需要 8–12 分钟。
- `:37`：Tutorial Descent、Pollen Fields、Resin Warrens、Queen's Gallery 等关卡序列。
- `:39`：flight-stamina meter；`:41`：持续飞行和上升气流。
- 同一文件 `:54` 却明确说只有 60 秒接星星、没有 biome 和持久化推进，形成文档内部直接冲突。

最终 acceptedReview resultId：`3341413d84caee693e8ceed302603f3ec897ff8e61ddfa86f0f1dc84c3a90ac9`，kind 为 `passed`，issues 数量为 0。因此这是已接受产物中的漏检，不是尚未修复的候选，也不是旧预览缓存。

诊断边界：整文修订最初只有损坏文档及结构契约等有限上下文；随后仅修订审计指定章节。可推断上下文不足与检查覆盖不足共同导致错误内容残留，但未对模型行为做确定性根因归因，也未实施修复。

### P2：正常交接等待被展示为阻断错误

后台明确表示审计通过、等待 Checklist 接受；Chrome 却显示“需要处理”、`Workflow is blocked and needs attention.`、“复制错误信息”，任务仅显示“已审计”。页面未清晰呈现审计通过和下一步接受入口。刷新后仍相同。

### 其他观察

- Author 中途已有多份内部产物提交，交付物计数仍为 0/8，直到整体发布才变为 8/8；容易误判没有进展。
- 首版仅含协议残片的关卡文档在交付物列表显示“已完成”；该状态无法表达是否通过审计。
- Revision 首次输出失败仅留下通用 `output_invalid`，具体输出校验理由未保留在该结算记录中，增加诊断难度。
- 复核期间两个语义检查出现 `review native worker: invalid_output`，均自动重试后完成；不是最终停止原因。

## 验收边界与后续

已验证真实创建、真实模型生成、三次自动修订及复核、最终接受文档发布、两次浏览器刷新恢复和最终预览。未执行 Checklist、游戏实现、游戏发布或 ZIP 下载内容验收；不宣称完整游戏验收或实际计费金额核对通过。

本轮停在正常交接等待，没有继续推进不合格文档。下一步应先修复语义审计覆盖与整文修订上下文，以及正常等待状态的 UI 表达，再以同类真实案例重新验收。

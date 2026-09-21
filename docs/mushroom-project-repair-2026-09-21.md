# Mushroom Platform Quest 定向修复与验收

项目：`mushroom-platform-quest--a896be58bebc`。用户授权停止 workflow 并修复产物；本轮没有调用付费模型或重新生图，未自动续跑。保留 implementation 已写入的相机及关卡修复。

## 生图：区分两类失败

| 本地请求 | 上游事实 | 本地问题 / 状态 |
| --- | --- | --- |
| mpq-player-small-01 | 400，安全系统拒绝；req_cffd3894b9f2407e9ab71d79aca082a9 | BeeGame reservation 已释放，实际扣款 0；不代表 Cloudflare 未收费 |
| mpq-player-small-02 | 400，安全系统拒绝，violence；req_3ee5f472f4c9401f9a8a8fa74a254fd5 | BeeGame reservation 已释放，实际扣款 0；不代表 Cloudflare 未收费 |
| mpq-smoke-01 | 200，Completed，已下载并保存有效 PNG | price-usage 阶段失败，向 Agent 返回 503；预留未结算，图片未交付 |

第三次响应只有 gatewayMetadata，没有本地计价需要的 token/cost 信息。[Cloudflare 模型响应文档](https://developers.cloudflare.com/ai/models/openai/gpt-image-2.5-flare/) 的示例也不承诺 token usage。不能把成功图片与上游 400 混为一谈。

修复：已校验且持久化的 PNG 不再因计价/结算失败被丢弃；返回 billing-pending，保留预留供对账，不伪造费用、不重复生成。同 requestId 恢复已有图片。安全拒绝单独分类为 safety-rejected。成功图片已从收据恢复至本地修复目录，未当作游戏资产强行注册。

仍未确认：Cloudflare 两次 400 各自是否计费及金额，需要上游逐笔账单按上述 request ID 对账。未擅自结算或退款。

## 编辑器与项目产物

- 玩家 PNG 原高 256，末行 frame 下边界 269；按已有生成器将画布改为 270，仅重绘该 PNG。
- UI atlas 为平铺矩形，而编辑器规范为嵌套 frame；同步修正 JSON 和生成器，删除游戏 loader 的私有格式适配。没有增加双格式兼容。
- 更新两个 Manifest 模块的真实文件 hash，并调用现有资源/内容验收与版本刷新；9 项资源要求、9 个资源及 16 个内容文档通过，workflow 保持 stopped。
- 资源验收复用编辑器 atlas parser，对配对 PNG 检查帧越界；Content 验收包含资源契约检查，避免错误图集通过后直到编辑器才报错。当前宿主尺寸检查针对 PNG 配对，不声称覆盖所有图片格式。
- 资源加载改为有限并发；非引用资源损坏不阻断编辑器，实际引用资源仍严格报错。仍预加载 picker 的已验证资源，尚不是按需加载。

## Chat 与测试行为

- worker/mirror 统一原始 session/turn 身份；Thinking 按原生 block 归并。真实碎片样本合并后开始 00:43:47.336、结束 00:44:00.972，共 13.636 秒，文本完整。
- Todo 按执行范围使用最新完整快照，而不是累计所有历史改名条目；不同阶段仍全部保留。资源阶段恢复为 6/6；内容 4/5、实现 7/9 是最后真实写入状态，不伪造完成。
- session.stopped 收束该 session 的未结束活动，不受旧镜像丢失 turnId 影响，不影响另一 session。
- 测试指引增加测试浏览器静音、超时、协议错误传播及关闭实际页面/自建浏览器要求；项目 CDP helper 修正目标页关闭和错误传播。已关闭此次 Agent 遗留的测试 Chrome，不修改游戏音频。未来 Agent 的启动参数仍是执行约束，不是宿主强制静音机制。

## 顺序核对（UTC）

运行事件：09-20 22:39 文档 → 23:00:58 资源 → 23:29:58 内容 → 09-21 00:05:39 实现，未发现跨阶段提前启动。

资源工具记录：23:01:30 内置库查询 → 23:02:41 起 WebSearch/WebFetch → 23:09:07 起三次生图请求 → 23:13:08 起 PIL 生成器。实际发生了该来源顺序；调用存在不等于每次取舍或最终美术质量全部合格。第三次生图被本地误报失败，影响了 Agent 对可用结果的判断。

## 验证与边界

- 后端生图/图集/Chat 回归 53 项通过；前端编辑器/图集/适配器/Todo 相关 43 项通过；停止活动补充回归及适配器 21 项通过。
- 前端、Scene Editor 构建通过；git diff --check 通过。
- 使用根目录 .env.local 重启五项开发服务，项目保持 stopped。
- Scene Editor 已实际打开并显示 518 个对象、背景、地形和精灵。
- UI Editor 已实际打开 ui-hud-playing，图集与层级加载成功；HUD 数字换行和标签拥挤尚未修复，不能称为视觉质量通过。Todo 页面实测与上述快照一致。
- 停止后的末条工具不再显示 Running tools；组标题区分已停止、未完成与真正失败。
- 本轮不等于游戏最终交付；未重新执行完整关卡通关验收。
- 尚需后续优化：超大项目 Chat 服务端历史驻留量、资源 picker 按需加载、前端大 chunk。没有用新增框架或重跑付费流程解决这些性能项。

## 后续修复：不通过编辑器或直接修改 JSON 调整 HUD

- 本轮只改应用代码、测试和生成指引，未调整项目 HUD 的位置、尺寸或字号。只读打开 UI Editor 验收后退出，未保存；前后 `content/ui/hud.json` SHA-256 均为 `57dc485bd0ea0312f1a8cedf01e65cc6842a5d41b921d4730fb12ee97af3f7a5`。
- 编辑器不再用 `overflow-wrap:anywhere` 强行拆分数字；文字对齐改用明确的横向/纵向对齐，隔离宿主字重和字距。浏览器实测 `200` 为一行，项目字体实际需要 72px，文档只留 56px，仍挤压邻近标签。这部分是内容生成的尺寸问题，尚未修复，未用自动缩字或特例偏移掩盖。
- 内容生成指引要求加载真实字体后测量最大计数值和各语言文本，并验证目标运行时；这只是生成约束，不等于已有 HUD 已重新生成或通过视觉验收。
- UI Editor 首次只加载 UI 文档引用的资源；其他已验证资源在打开选择器时加载，同一次打开周期复用请求。保留所有 UI screen 引用资源，以免切换 screen 时缺图。取消时中断请求并清理 URL/font，不写入文档或破坏 Undo/Redo。
- Chat 时间线仅常驻游标、字节偏移和旧记录文本身份索引，正文按需读取既有日志；增量接口与 SSE 传入游标，不再为每次增量读取反序列化整个项目时间线。仍保留完整历史，原始 session 缓存和历史分页聚合尚未全部优化。
- 真实日志副本 22,382,824 字节、23,939 条记录：本机索引扫描 81.1ms，连续 100 次读取末尾 10 条平均 0.21ms。仅为本地日志层基准，不代表完整接口延迟。
- 本轮 UI Editor 15 项测试、后端时间线/流/内容契约 23 项测试通过，前端 build、后端 typecheck、diff 检查通过。使用根目录 `.env.local` 重启五项服务，实际确认 Chat 历史与 Thinking 时长、UI Editor 加载正常，workflow 保持 stopped；无付费模型调用。
- 仍待处理：HUD 生成产物的字体尺寸适配、Scene Editor 非引用资源按需加载、前端大 chunk，以及 Cloudflare 两笔 400 的上游逐笔计费核对。未宣称全项目最终验收完成。

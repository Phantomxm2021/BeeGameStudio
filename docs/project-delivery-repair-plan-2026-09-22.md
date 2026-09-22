# 项目交付与修复：系统整改执行方案

## 边界与验收原则

依据 mushroom-flag-dash--fa5e09356acf 的日志及系统代码审计。只修改 BGS；不改测试项目，不代替 Agent 编写游戏运行时，不强制使用 Tilemap，不新增预审 Agent、重试循环或游戏引擎。旧流程不是正确性标准。

## 实施清单（按优先级）

| 问题 | 所属模块 | 最小修复 | 独立验收 |
| --- | --- | --- | --- |
| 预览代理把解压后的内容带着原压缩头返回 | Preview HTTP proxy | 同步响应实体与编码/长度/缓存头；保留鉴权隔离 | gzip HTML、JS、二进制经真实 HTTP 代理可读取 |
| 小修复先分析、再派完整实现任务 | Delivery controller / worker port | 用户后续请求直接一次派发；按需读取完整能力说明；不重置已通过阶段 | 单次派发、原文保留、工具不收窄、上游成果不重跑 |
| 平台故障被派给游戏项目、局部通过被当成全量验收 | Worker result / acceptance | 区分请求处理结果与完整交付；平台阻塞明确返回，不能自动改项目绕过 | blocked 不变 passed；局部修复不制造完整验收凭据 |
| 编辑场景时静态精灵仍逐帧更新、重复加载纹理 | Scene Editor viewport | 只让动态对象订阅帧；复用图片源并隔离每个对象的 UV；降低无意义重建 | 相同图片只加载一次、不同帧互不污染、释放正确、静态节点无动画订阅 |
| 按钮/shape 无法换图片 | UI Editor inspector | 图片编辑能力与语义角色解耦，保留按钮行为/文本/布局 | 按钮及图形可选/清除图片，撤销恢复，保存角色不改变 |
| 资源阶段未提供 TileSet，内容阶段又无权补资源 | Resource / Content contract | 提前明确 TileSet 是可选资源产物；缺失时准确报告资源依赖，不强迫散图替代或越权改 Manifest | 资源说明与内容约束一致；现有 Tilemap 解析、编辑、图片加载回归通过 |
| 数据通过不代表游戏正确消费数据 | 内容契约 / Agent 验收 | 保持数据是唯一布局来源；检查工具只检查结构，不能声称游戏可玩；Agent 自定运行验证 | 检查与运行验收结论分开，不为测试案例增加专用运行引擎 |

## 后续请求的执行规则

1. 一次派发原始请求、工作目录及最小结果记录要求；Agent 自主判断是回答、排查还是修改。问问题不授权改文件。
2. 大型文档、资源与生图说明按需读取；能力保持可用，不注入所有历史需求和全量资源表。
3. 不因报 bug 重置文档、资源、内容阶段，不自动重跑完整 workflow。发现跨职责问题返回具体证据和所属模块。
4. 结果明确已修复/失败/阻塞；局部修复与整项目交付不是同一个结论。代码变化使旧交付证据失效，但不自动发起付费验收。
5. 不限制调查文件数、工具次数或固定测试步骤；依据实际问题决定深度。

## 验证与交付

先运行离线单测、临时夹具 HTTP 验证、编辑器回归及类型检查。现有项目仅只读检查；实际项目的 FPS、完整用户旅程、资源决策及端到端耗时必须另行实测，不能由单测推算节省比例。未复现的 TSX 报错不凭推测修改游戏源码。

执行状态与验证结果在本文件末尾记录，失败项不得标记完成。

## 已执行与验证

- Preview：修正解压后残留编码/长度头、HTML 改写后的旧 ETag，以及 HEAD/304 空响应。真实 HTTP 临时服务验证了 gzip HTML、JS、二进制、缓存响应与凭据隔离。
- Preview：受控夹具在 Vite 5.4.21 复现 `/var` 与 `/private/var` 路径身份不一致导致 TSX 未转换；统一真实工作目录后通过。系统 Vite 和项目安装的 Vite 5 + React 插件 + TS 配置均已回归。**这证明修复了路径别名触发条件，不代替对该项目历史报错实际链路的最终确认。**
- Controller：删除新请求的强制影响分析入口，一次直接派发；只诊断的问题不授权修改。无需已有有效 Scene/Manifest 才能排查坏项目；工作区与受保护文档边界保留。
- Worker port：后续请求的原始需求/资源库/生图/预览说明写入仅该任务可用的按需参考文件，不再自动塞入全文。原工具权限不变，结束/停止时撤销访问并删除临时说明。
- 状态与验收：请求结果独立记录；平台阻塞不自动派给下一阶段。内容实际改变后，旧整项目验收失效，仅实现任务待重新验证，上游凭据保留，不自动启动模型。已覆盖中断后继续、旧快照重复请求和局部通过不能当全量通过。
- Scene Editor：相同图片共享解码源，独立 UV/动画纹理；600 个消费者单次解码及释放测试通过。静态节点不再订阅动画帧，图集帧切换只改 UV，不重复上传像素。
- UI Editor：图片能力与 button/shape 等角色解耦，支持选择、清除与撤销，保留角色、动作、文本和布局；前端真实组件测试通过。
- Tilemap：明确资源阶段准备可选 TileSet、内容阶段负责格子位置；缺少必要 TileSet 时明确报告资源依赖，不静默以海量 sprite 绕过。**是否选择 Tilemap 仍由 Agent 判断；没有对既有项目做自动转换。** 现有 TileSet、图集、编辑、撤销、导出及 PNG 预览回归通过。
- 消费与验收说明：明确 ID 不是坐标；完整消费 transform/anchor/pivot 与引用屏幕。区分真实 host Preview、替代 iframe、开发/生产和调试注入；不把终点触发测试当关卡可达性证明。不添加游戏运行引擎。
- 修正 Scene preview CLI 对 `.` 工作目录的绝对路径解析。

验证批次：工作流/内容契约 149 项通过（其后新增的中断恢复项也通过）；Preview/worker port 28 项通过；Scene Editor 40 项通过；前端 Scene/UI 编辑器 62 项通过。后端、Scene Editor、前端各自配置的 TypeScript 检查通过；前端使用自身 TypeScript，不用根目录不同主版本代跑。

## 明确未完成、不得冒充通过的部分

1. 已获授权并通过系统 `stopRun` 停止遗留 workflow，状态为 stopped、worker interrupted；runtime 与前端已加载修复后重启，未续跑模型任务。资源服务启动会恢复处理队列，本轮无费用验收未启动该服务。
2. 真实项目的交互 FPS、完整 host Preview 用户旅程及端到端生成耗时尚未复测；CPU/单元测试结果不能换算成帧率或节省比例。
3. 测试项目中已生成的散图场景、按 ID 推导坐标的游戏代码、遗漏/错误 UI 消费等没有被 BGS 偷改。它们需要项目 Agent 在系统修复生效后定向处理；本轮不付费调用 Agent。
4. 当前 UI flow 的自由 `data.screen` 还混用了运行状态名（如 boot）与内容 ID。不能未经契约订正就把所有字符串强制当文件引用，否则会制造新的编辑器拒绝。此项仍待明确引用语义后处理，不宣称现有结构校验能抓出全部缺屏问题。

旧在途分析结果的终态读取暂保留，以免升级时丢失现有工作；没有新请求入口再创建影响分析 Agent。没有新增双轨运行引擎。

## 2026-09-22 重启后无费用验收

- 使用 BeeGameStudio/bee-game-studio/.env.local 现有根配置，恢复 frontend/runtime/billing/skills；不启动资源自动处理队列，不调用模型、生图或 Continue workflow。
- 真实 host Preview 首次仍报 `SyntaxError: Unexpected token ':'`。已在临时夹具精确复现：代理调用 URLSearchParams.delete 会把 `?import&raw` 重编码成 `?import=&raw=`，使 Vite 把 JSON 模块返回为原始 JSON。
- 修复系统代理：只移除 BGS capability 参数，其余查询字节保持原样。覆盖重复/编码后的 capability、bare flags、重复键及 percent encoding；不放宽访问控制。
- 临时 Vite 夹具使用真实 `import.meta.glob(..., {query:'?raw', eager:true})` 导入路径；默认 Vite 与项目安装的 Vite 5 均通过。重启后真实项目已进入“旗帜冲刺 FLAG DASH”主菜单，不再出现该语法错误。没有修改游戏源码或 Scene/UI JSON。
- 真实 Scene Editor 成功加载 611 对象，地形、角色及图集素材可见；真实 UI Editor 成功加载 ui-hud，shape 节点具备 Image / Source Image 选择窗口。只打开、选中、检查和关闭，未保存内容；这些检查不代表全部交互性能验收。
- 本轮最终相关回归 14 项通过，另加项目 Vite 5 夹具 1 项通过；后端 TypeScript 与 diff whitespace 检查通过。
- 当时新发现未通过项：停止后 Chat 历史尾部工具仍显示 Running tools，而页面 workflow 已可 Continue。后续修复见下节，不代表 Chat 所有问题都通过。
- 完整通关、交互 FPS、生成耗时、付费 Agent 后续修复均未执行，不宣称交付完成。

## 2026-09-22 执行干预审计与 Chat 终态修复

详细分类、代码位置和原始事件 ID 见 [执行干预审计](agent-interference-audit-2026-09-22.md)。本轮修复 scratch 目录授权、提示执行顺序、file-agent NODE_ENV 污染、进度展示异常取消 Agent、worker 终态过滤及依赖提示文案恢复历史六类问题。

重启后在真实项目 Chat 验证：历史尾部已从 Running tools 变为“1 次工具调用 · 1 次失败”，思考块显示已思考；保持 workflow stopped，未点击 Continue。前端 worker 终态只结算自身，不改变项目生命周期。测试项目源码和 Scene/UI JSON 未修改。

验证：系统回归30项、file-agent故障注入/流观察2项、前端51项通过；前后端各自 TypeScript 检查通过。首次端口夹具因沙箱不能绑定本机端口失败，授权本机端口后重新执行；旧提示断言已按自主修复顺序订正，最终无失败。未运行真实付费模型、新项目生成或完整通关。

## 2026-09-22 移除工具与资源策略干预

- Checklist 不再仅允许 Write/Edit 或禁 Read。沿用现有私有文件任务隔离：冻结 authority.md 只读，原生 Read/Bash/Agent 与本地中间产物可用；只收 checklist.md 候选，复用原验收和发布。会话仍关联原项目的 Chat/计费，不新增 workflow 阶段。
- 取消必走“资源库→网络→AI→程序绘制”的阶梯；Agent 根据质量、成本、适配度及用户要求选择，保留出处/许可/费用边界。Checklist 输入只保留一份，不重复塞入全局 brief。
- 删除旧 worker 清空工具、QueryEngine 特判、Read/Edit 单文件特判及废弃测试；不删除有效任务的权限边界。
- 重建 CLI 后，72 项无费用回归通过，包括真实 CLI + 本地假模型的读取、shell、委派、保护文件、外部访问和取消半成品测试。没有修改测试项目。
- 明确未解决：普通项目会话 shell/文件边界尚不一致；Mac 系统 Python/Xcode 在隔离环境的依赖仍有问题。逐目录试探性放宽已撤回，不靠堆白名单宣称修复；当前 shell 回归验证的是 Bun 链路。

## flag-pole-platformer 系统修复（2026-09-22）

边界：只修 BGS，未改测试项目源码、资源、Scene/UI JSON 或 workflow 状态；未调用模型、生图或续跑任务。Agent 保留工具、顺序、引擎和验证方法的决定权。

| 已证实问题 | 最小系统修复 | 职责 |
| --- | --- | --- |
| 开发环境通过、仍有遗漏也能被当成完整交付 | 最终结果声明验证目标、已知问题、未验证项；完整交付有遗漏则不能通过，局部请求不升级为完整交付 | workflow 只核对明确结果，不分析措辞或代测玩法 |
| 构建输出改变仍可复用验收证据 | Agent 列出实际测试的发布文件，host 保存并复核 hash | 不限定构建命令、输出目录或引擎 |
| 关闭自动处理队列同时使资源库不可用 | 增加 BEEGAME_RESOURCE_PROCESSING_ENABLED=0；查询下载照常，队列不恢复，处理/重试入口拒绝 | resource service 分离读取与后台处理 |
| 手抄 Preview capability 出错；Bun Playwright CDP 重复超时 | status 返回可直接读取的 hostUrl/frameSelector/environment；浏览器端点提示 Node Playwright | 不放宽 iframe sandbox，不强制 Agent 工具路线 |
| 源码版本扫描包含 228MB 临时依赖及 Chat 投影 | 排除 .beegame/tmp 和 .beegame/chat；发布文件另绑定 hash | 不删除缓存、日志或产品文件 |
| npm 缓存落在任务授权范围外 | 普通会话和私有文件任务统一使用各自 scratch/npm-cache，覆盖大小写 npm 环境变量 | 不开放宿主缓存或跨项目访问 |
| 锁文件写入权限错误被误判为锁竞争，持续空转 | 仅 EEXIST 归类为锁竞争；其余写锁错误立即返回 io | 不重试真实存储错误、不扩大权限 |

无费用验证：72 项系统回归、3 项 Preview 测试（含真实浏览器开发/生产夹具）、26 项 CLI/环境测试通过；runtime/resource TypeScript 和 diff 检查通过。真实 CLI 使用本地假模型，确认 Read/Bash/Agent 可用，缓存写入成功，冻结输入和外部文件仍受保护。资源服务真实 health 返回 processingEnabled:false，内部 catalog matches 查询 HTTP 200。使用根 env 重启 runtime/frontend/billing/skills，资源服务保持只读查询可用、自动处理暂停。

限制：hash 证明测试产物身份和后续是否改变，不能证明 Agent 测试时已重新构建、声明完整或游戏可通关；没有靠时间戳猜测质量。历史验收没有明确覆盖和发布文件证明时，不再作为完整部署凭证，但不重写历史 run.json。样例中的控件、父级变换、VFX、UI 排版和音频问题仍需项目 Agent 修复，不能伪称这轮已修好。Mac Python/Xcode、所有 Bun 安装问题及模型英文 thinking 也未因此得到保证。没有耗时节省比例或全流程验收结论。

收尾补充：只读解析样例旧 runtime 验收返回 blocked（缺少明确覆盖记录），原 run.json 未改写。最初直接调用 delivery gate 发现其 load 会尝试写读锁，在本次只读沙箱下触发上述空转，已终止诊断进程并修复错误分类。追加锁权限、版本及交付门禁 4 项回归通过（与前述集合部分重合），TypeScript 再次通过。不把这次诊断失败隐藏为项目本身的游戏问题。

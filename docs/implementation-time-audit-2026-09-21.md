# Implementation 耗时审计与系统调整建议

样本：mushroom-platform-quest--9b076afc632c；dispatch 62182a2c-26d1-4b0b-b1a4-3969f7855a4c。
诊断阶段只读检查项目与原生 transcript。以下保留根因和调整依据；已落地范围见文末。系统修复没有继续 workflow、调用模型或修改项目产物。

## 计时口径

Implementation 从 2026-09-21T05:36:20.789Z 到 08:05:26.323Z，共 149 分 05.534 秒。
下表按工具时间线的主要活动划分墙钟区间，不是互斥的 CPU/模型耗时指标，也不把整个区间都称为浪费。

| 区间 UTC | 主要活动 | 墙钟 |
|---|---|---|
| 05:36:20.789–05:58:59.380 | 读取输入、安装依赖、初版实现、类型修复；结束时首次执行生产构建命令 | 22:38.591 |
| 05:58:59.380–06:50:45.372 | 浏览器启动、内容结构消费修正、开发服务器排障、输入与首关测试反复调试 | 51:45.992 |
| 06:50:45.372–07:36:15.312 | 自动通关、道具、暂停、iframe 和生产产物验证、修复与准备交接 | 45:29.940 |
| 07:36:15.312–08:04:19.026 | 独立验证子 Agent；生产环境污染排障、浏览器权限失败、尝试替代测试方法 | 28:03.714 |
| 08:04:19.026–08:05:26.323 | 主 Agent 抽查、收尾和 BGS 交付判定 | 01:07.297 |

主 Chat 工具记录按 toolUseID 配对：364 次，Bash 142、Read 62、Write 44、Edit 92、其余 24。主 Agent 的 Write/Edit 中 59 次作用于 verify/probe/trace/host/cors-server 辅助文件。

- 57 次 Bash 命令涉及浏览器 verify/probe/trace 脚本，执行区间合计 1793.984 秒（约 29:54）；部分命令一次运行多个脚本，因此不是精确进程启动次数。
- verify-3.mjs：15 次命令，约 13:52；verify-full.mjs：6 次；verify-mush.mjs：12 次命令（其中一条重复执行脚本）。
- 4 次 TaskOutput 阻塞等待合计 1608.523 秒（26:48.523），主要等待上述独立验证 Agent；不能再与子 Agent 执行时间相加。
- 所有主 Chat 工具区间取并集约 58:08.535。剩余墙钟约 90:57，包含模型、压缩、调度及未细分间隙，不等于纯思考时间。
- 主流观测到 303 个不同 message_start ID，两次自动压缩（pre_tokens 168440、167376）。原生最终结果累计 outputTokens 224236、duration_api_ms 7074134（117:54）；累计 API 口径可能包含并行子调用，不能与上面的工具并集相加做百分比饼图。

## 已确认的系统问题

### 1. 宿主 NODE_ENV 污染 Agent 构建

runtime-process-environment.ts 的继承白名单含 NODE_ENV。beegame-dev-lib.ts 为 BGS runtime 设置 development，native runner 继续传递给任务。
子 Agent 日志：07:36:57 构建 373.58 kB，开发调试标记保留；07:41:24 使用 env -u NODE_ENV 后构建 181.47 kB，调试标记消失。

调整：不将 BGS 自身的构建模式当作项目环境传递；项目自己的脚本或显式 env 仍有效。不能改成全局强制 production。覆盖父/子 Agent、开发启动和生产构建的环境边界测试。

### 2. 实际浏览器能力与权限不一致

独立验证 Agent 在 07:42:03、07:49:48 请求未获批准；07:49:23 正确 headless-shell 报 bootstrap_check_in MachPort Permission denied；08:00:24 剩余三条测试仍报同类启动错误。
主 Agent 告知可用路径未能修复子 Agent 的 OS 能力问题。不能把这 28 分钟解释为成功重测，也不能只换浏览器路径声称解决。

调整：提供经过实际健康检查的、项目隔离的预览测试浏览器能力。先验收现有原生权限通道修复是否足够；若 OS 沙箱确实不能承载 Chromium，仅由获授权的宿主进程负责浏览器生命周期，使用专属 profile、保留 Chromium 沙箱、不借用用户浏览器。Agent 自选 Playwright/CDP 操作与测试方式，父子会话沿用同一项目授权。不对任意 Bash 开放无沙箱权限；不可用时明确返回能力错误，不冒充就绪。

### 3. Preview 是说明，不是可操作的测试入口

delivery-worker-session-port.ts 仅注入 PREVIEW_ENVIRONMENT 和 getPreviewContext() 的状态/URL 快照；实际项目自行编写 host.html、host-prod.html、cors-server.mjs，后期才遇到生产资源未拷贝、opaque origin/CORS 等问题。

调整：扩展已有 preview-manager 的项目作用域访问入口，让 Agent 可启动/查询真实开发或生产预览，并取得实际宿主 iframe 页面、frame 定位信息、就绪/失败详情和对应产物身份。不为每个项目生成另一份宿主 HTML/CORS 服务；不能用放宽 iframe 隔离作为优化。

### 4. 平台内容格式的消费仍由每个项目手写

06:01:37–06:02:07 检查 Scene 外层结构后修正 types、assets、world、App 中的 scene.nodes/scene.settings 消费。既有 inspectionCommand 已实际使用；因此重复添加“请阅读格式”没有解决运行时消费问题。

调整：从现有 schema 导出可直接使用的纯类型和最小读取/引用解析能力（含 Scene 外层、assetRef、图集帧），保持 schema 单一来源，提供给项目自主使用。只处理 BGS 自己定义的数据格式，不接管游戏循环、物理、输入、关卡设计或引擎；先落地 Web 当前需要的部分，不预建多引擎框架。

### 5. 验证反馈导致重跑，且成功信号不可靠

多条命令为查看同一输出的头/尾或某字段再次运行几十秒脚本；部分管道 grep/tail 返回 0，但正文实际为浏览器错误。verify-flow/verify-iframe 开启 __MPQ_NOCLIP，只能证明相应调试条件下的流程，不能证明正常可达性。生产脚本多处只 console.log，没有失败断言。

调整：优先复用现有原生持久化输出机制，在预览测试入口提供完整输出、浏览器错误/网络失败、截图和运行条件的同次运行记录；能读已有结果而无需再次执行。不能缓存替代 Agent 明确要求的重跑，不能自动改写其命令。明确区分命令退出、浏览器启动和实际观察结论，不以 exit 0 自动标记产品合格。游戏如何测试仍由 Agent 决定，不制作平台通用自动通关 Bot。

## 顺序与验收

1. 隔离 NODE_ENV；真实验收父子 Agent 浏览器能力。用临时测试夹具，无模型调用；确认生产构建不受 BGS dev 环境污染、浏览器可实际打开截图并清理。
2. 扩展现有 Preview 访问入口与一次运行的结果读取；让测试直接面对实际宿主与产物。无须在生成项目里另写 host/CORS 服务。
3. 导出现有内容 schema 的纯消费接口，回归外层结构、资源和图集；不添加游戏引擎。
4. 新项目中观察初版构建后的返工区间、浏览器启动失败、重复测试环境代码，以及验证证据质量。先不承诺节省比例，不以减少真实检查或强制 Agent 并行达成指标。

仅日志去重、快一点文件扫描不能解释或解决本次 149 分钟主因，应降低优先级。交付收尾的 memory 误判已另行修复，它导致最终失败，但不是此前两小时的执行瓶颈。

## 本轮落地与验收

先提交已有全部改动：`18de25863`，205 个文件。之后的修复限于 BGS 系统：

| 已落地 | 对应根因与边界 |
|---|---|
| 移除宿主 NODE_ENV 自动继承 | 原生任务及其 shell 子进程不再把 BGS development 当作项目构建模式；显式项目环境仍有效。 |
| 独立测试 Chromium 生命周期 | 复现 macOS seatbelt 的 MachPort 启动失败后，由宿主按需启动已安装的 headless-shell。专属临时 profile、静音、仅本机 CDP，不下载、不使用个人 profile、不关闭 Chromium sandbox，不授予任意 Bash 无沙箱权限。 |
| 实际 Preview 测试 API | Implementation 可自行启动/查询 development 或 production，并得到与 Dashboard 同 sandbox 的 iframe 宿主页。复用 preview-manager 和能力鉴权；不接受额外工作区、命令或任意代理地址。production 只调用已有 preview script，不隐式构建或回退 dev。 |
| 会话清理 | 停止先中断 Agent；访问入口撤销、自己的预览和浏览器关闭、临时 profile 清理。并发浏览器启动合并；已退出的浏览器不返回假就绪。 |
| 单一内容消费接口 | 现有 Schema 提取成纯模块，服务端继续使用同一个定义。可选 ESM 导出 Scene/UI 外层读取、坐标、图集解析；不复制另一套 Schema、不包含 Three.js/文件系统/游戏循环、不强制 Agent 使用，也不自动写入项目。 |

验收用的是临时夹具，不是 mushroom 项目：

- 13 个相关测试文件覆盖环境、内容、Worker 生命周期和 Preview；随后追加 macOS 沙箱客户端 CDP 实测。
- 实际 Vite development 和已构建 production：经能力鉴权、原有 preview proxy 和 opaque-origin iframe 成功执行模块、获取 JSON 资源；800×600 viewport 正确，截图成功。
- 宿主 NODE_ENV=development 时，隔离后的生产构建中 import.meta.env.DEV 为 false。
- 原生文件系统沙箱内的客户端在网络已获授权条件下可连接宿主 CDP；未声称绕过网络授权或完成了付费父/子 Agent 回归。
- 内容 ESM 可在独立临时目录直接执行，无 BGS 包安装依赖；不兼容错误的平铺 Scene 外层，也不静默吞掉缺失图集帧。

完整工具输出继续沿用原生持久化记录。后续本轮已完成浏览器观察汇总：Agent 选择页面并开始一次 recording 后，被动收集该页与子 frame 的 console、页面异常、HTTP 错误和网络失败；finish 留存一次视口截图及冻结报告。GET/重复 finish 不驱动游戏、不重新截图或运行测试。独立详细报告/PNG 保存在所属用户数据目录的 preview-tests/<session hash>/，现有 native-runtime.jsonl 只追加索引与计数，没有新增一条完整工具日志流。

### 浏览器记录补完验收（无模型费用）

- API：POST /recordings {targetId, label, conditions}；GET /recordings 列表；GET /recordings/<id> 读取；POST /recordings/<id>/finish；GET /recordings/<id>/screenshot。只允许当前专用浏览器的 page，不接受输出路径或任意命令。
- Agent 仍自行选择测试方法、页面、输入、断言和是否采用记录能力。采集器不导航、不输入、不修改缓存、不拦截请求、不暂停页面。协议参考 [Chrome DevTools Target](https://chromedevtools.github.io/devtools-protocol/tot/Target/)。
- 报告记录实际起止时间、耗时、Preview 模式、目标页、计数和错误。conditions 明确标记 agent-declared；gameplayVerdict 恒为 not-evaluated。浏览器连接/采集完成不等于游戏合格。
- 排除记录开始前缓存的控制台事件；开始记录前或 attachment readiness 前的事件不保证补录。退出/断开、截图失败、存储失败均显式反映；会话结束时未完成记录使用 session-closed，不伪装已验收。
- 每份保留最多 1000 条、单条最多 4096 字符，丢弃/截断计数可见。最多缓存 32 份，DELETE 已结束记录仅释放内存，不删除归档。PNG 保存后从运行时内存释放，读取时再加载；不为截图建立连续视频或轮询。
- 临时 Vite 开发与生产夹具实测：iframe 资源加载、页面异常、HTTP 失败、连接失败、截图文件与接口字节一致、报告重读/重复 finish 稳定、每次连续 10 次读取不产生新游戏执行、旧 console 不串入下一次、其他 page 的错误不串入、超过 1000 条后明确报告截断、关闭清理和归档保留。
- 用户已明确选择：**先完成无费用验证，付费新项目复测暂缓**。以上不是一次新游戏生成 benchmark，不据此报告生成耗时减少百分比。

这些修复消除已复现的环境、浏览器能力和格式消费障碍，不证明具体游戏可达、交付合格或耗时已降低某个比例。后续需在用户启动的新项目中观察返工区间和重复测试次数；不得靠自动重试旧 workflow、修改关卡/HUD 或减少真实验收来获得数据。

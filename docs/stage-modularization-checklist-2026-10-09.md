# BGS 阶段模块化实施清单

目标：各阶段只负责自己的业务，修复一个阶段时不必修改其他阶段的业务判断；共用执行、存储和专业工具，不再复制检查口径。保留八文档和已确认的交付要求，不修改测试游戏来取得通过。

日期：2026-10-09。本文是本轮实施与验收清单；历史隔离方案仅供查证，不以旧行为作为正确性标准。勾选代表相应代码与检查已完成，不代表付费生产已验证。

## 边界和实施顺序

采用模块化单体，不新建工作流引擎、消息总线、通用规则框架或六套状态库。先贯通 Content，再迁移其他阶段。公共调度保留阶段选择、调用、统一保存和推进；阶段模块处理任务材料、专业检查、结果与恢复。原生任务身份、取消、事件、用量、专业工具继续共用。

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| 规划 | 八文档、Scene/UI 初稿、实现清单及作者交接 | 资源制作、实现验收 |
| Review / Revision | 确定范围内审查、授权修订、关联证据及定向复核 | 自动扩大需求、无限循环 |
| 资源 | 视觉/音频生产、字体、图集、登记、资源交接 | 改布局、改玩法 |
| Content | 在既有 Scene/UI 中绑定资源和接口、消费检查 | 重新设计或重建 Scene/UI |
| 实现 | 按清单实现、修复代码、记录真实检查证据 | 私改已确认设计 |
| 验收 | 核验当前产物、归类问题、提出受影响复测范围 | 静默兼任实现作者 |

阶段不能读取其他阶段的私有实现。共享设计权威、专业检查器不是某个阶段的私有逻辑。仍使用现有状态版本、原生任务身份与原子保存；新增接口只承载真实调用所需的输入输出，不预建插件协议。

## A 事实和安全边界

- [x] A01 核对当前调度、原生结束钩子、检查器和状态保存位置；确认检查口径分裂及修订计算命令识别差异。
- [x] A02 明确生成项目只读、无关前端修改保留；本轮不自动付费测试、重启或部署。
- [x] A03 将已证实问题分别建立独立合成回归：计算命令、Content 检查差异、UI 批量样本、字体成员、检查资源重复加载、证据工具升级。
- [x] A04 建立阶段依赖检查，禁止阶段之间导入私有实现；允许共享专业工具，避免仅按目录计数宣称解耦。stage-boundaries.test.ts 已覆盖当前拆出的模块；总调度尚未迁完的业务不能据此宣称独立。

## B 公共执行边界

- [x] B01 提取阶段标识和原有默认推进关系，保留现有调用兼容入口；不复制另一份阶段表。实现：delivery/phases.ts。
- [x] B02 提取单一状态存储与写入串行化，保持现有路径、版本、原子保存和旧项目拒绝策略。实现：delivery/state-store.ts；别名并发、失败释放锁、旧版本不自动迁移回归通过。
- [x] B03 把各阶段任务说明归还所属模块；调度只选择，不维护六份专业正文。规划/Review 复用 project-author.ts；其他四阶段说明移入各自模块，尚不代表四阶段业务全部迁移。
- [x] B04 提取实际阶段检查入口；调度调用结果，不内嵌 Content/资源专业检查。
- [x] B05 明确暂停、取消、无效回执、恢复与结果保存仍由公共执行处理，阶段业务不能自行启动额外付费回合。
- [x] B06 测试旧状态读取、并发写入、取消及普通用户消息不误启动生产。state-store / project-conversation / production-task 回归通过。

## C Content 完整试点

- [x] C01 模块接收明确的工作区、目标设置和已确认设计依据；不得读取调度器私有状态。实现：delivery/stages/content.ts 与 production-check-input.ts。
- [x] C02 统一设计保护比较，宿主与原生结束检查不各写一套；保留证据过期与到期待决问题。实现：delivery/design-protection.ts，接入两个边界。
- [x] C03 模块内完成包结构/引用、布局和设计保护检查；明确程序检查不等于视觉或玩法验收。Content 不再内嵌结构/布局检查分支。
- [x] C04a 作者可调用 --content-handoff 进行保存产物预检；与结束钩子、宿主调用同一实现和主机提供的目标/基线。缺 index、越权布局、未知资源、合法绑定的三入口对照回归通过。
- [x] C04b 回执中新增问题的来源、期限与已有记录一致性判断归入 Content 交接结果接口；原生结束与宿主调用 checkContentResult，通用问题规则复用 delivery/production-findings.ts。源码预检不冒充回执检查。
- [x] C05 保留独立的局部检查工具及其真实范围，不把局部成功称为阶段通过。普通 check-content 仍标明 content-contract-and-references。
- [x] C06 保留既有绑定工具、文件身份和设计字段保护；完整合成链路验证中断、会话重建后继续同一个原生任务，已保存绑定及 Scene/计算输出字节不变，绑定只执行一次。
- [x] C07 Content 准备入口明确恢复路径：未改变设计可续作；设计漂移或计算证据过期时保留成果，指向现有 design-resolution 的显式授权检查入口。不自动修改基线、不自行启动修订；入口接通不等于语义修复已成功。
- [x] C08a 合成验证绑定→实际 CLI 预检→原生结束→宿主交接；覆盖正常绑定、非法布局修改、未知资源、缺索引及缺基线。真实 binding 改动改变进度指纹，无关说明不改变。
- [x] C08b content-recovery.test.ts 连通实际准备→绑定→原生中断→会话重建→续作→结束检查→宿主交接；另覆盖 Scene 漂移及计算模型变化未重算，验证不启动生产、不接纳旧证据且可进入受影响审查。模型响应由测试适配器模拟，不是付费验收。
- [x] C09 Content 结构/布局/设计保护/问题回执判定均由阶段接口返回；公共调度只消费结果并保存推进，不保留第二套 Content 专业检查。公共任务身份与状态存储继续共用。

## D 资源阶段

- [x] D01 resources.ts 接管准备检查、资源验证、回执结果与资源协作说明；复用现有视觉/音频原生任务和公共保存，不另建调度机制。
- [x] D02 --resources-handoff、原生结束与宿主使用相同目标策略/基线及阶段检查；旧 manifest 检查保留局部用途。回执缺失或资源未就绪不推进，结果明确不证明绑定/运行已通过。
- [x] D03 资源模块继续调用现有 media / resources / manifest 工具，没有复制制作实现；图集、音频配方、登记及真实字体解码回归通过。
- [x] D04 字体加载、编辑器/静态渲染、布局测量和 cmap 覆盖使用显式 member；默认字体只作为无 member 时的选择。真实本地浏览器及模拟测试证明选定成员被消费，缺失成员不当作默认字体通过。
- [x] D05 合成完整准备→视觉完成/音频中断→会话重建→同一音频任务续作→登记→交接；视觉组只派发一次，Scene 字节未变。设计输入被改时派发前停止且保留原基线/成果。缺失登记文件仍由实际阶段检查拒绝；不承诺模型一定正确判断素材质量。
- [x] D06 移除总调度内联资源验证；资源与 Content 共用调度保存，不共用彼此私有业务。资源独立回归、Content 连接及阶段依赖检查通过。

## E 规划与 Review / Revision

- [x] E01 规划模块接管批次输入、作者产物检查和交接；共享调度不解释八文档内容。
- [x] E02 Review 模块接管审查范围、修订权限、定向复核与结果解释；不再散落于总调度。
- [x] E03 统一计算命令解析：权限允许的重算命令必须能被中断写入记录识别，包括 --scenes。共享 design-calculation-command.ts；命令模式、路径越界及原生权限回归通过。
- [x] E04 修订者能修改授权问题涉及的文档、JSON、计算模型和输出；保护无关权威，版本随实际修订提升。
- [x] E05 审查读取范围与结束检查一致；不在交接时突然要求全稿复读。
- [x] E06 到期待决问题按实际需求和所有者处理；不可把可选新增项变为必需用户决策，不以删记录消除阻塞。
- [x] E07 --ui-all 先核对整批样本 ID/值，再按每份 UI 的实际文本节点分配；未知 ID、只有非文本节点的 ID、空样本仍报错。记录分配前输入 hash，检查中变更不能拼成同一快照。单测和双 UI 的真实本地浏览器回归通过，不搬移 UI 文件。
- [x] E08 独立验证初审/修订/复核、中断恢复与生产阶段必要设计变更；移除旧业务分支。

## F 实现与验收

- [x] F01 实现模块接收已确认清单及必要源条款，保持任务 ID、依赖和完成依据，不另建任务数据库。
- [x] F02 验收模块复用仍有效证据，输出实际失败或未验证项，不把回执通过等同游戏合格。
- [x] F03 将验收发现的代码缺陷交回实现修复，再定向验收；复用现有结果和调度状态，不叠加循环引擎。
- [x] F04 保留设计问题交有权所有者处理、环境故障与产品故障分开；不自动扩大要求。
- [x] F05 验证修复后旧验收失效、无关证据可复用、最终发布使用已验收字节；移除旧业务分支。

## G 工具、证据及收尾

- [x] G01 浏览器检查一次任务复用同一资源加载结果，避免每个视口重复解码整份清单；错误仍归属具体消费者。
- [x] G02 工具升级与项目设计修改分开：保留可执行的版本关联，不因覆盖计算工具让旧证据凭空失效，也不跳过真正输入变化。
- [x] G03 依据现有引用、计算输入、绑定字段及清单关联决定影响范围；不建立通用字段依赖图，不从全局 hash 猜全部重做。
- [x] G04 检查六阶段依赖方向、唯一检查入口、单一保存入口；清理迁移后无调用的代码与说明。
- [x] G05 跑无模型费用的模块测试、连接测试和类型检查；记录具体命令、失败及原有缺陷，不能只报测试数量。
- [x] G06 构建隔离 CLI 产物验证导入；不自动覆盖运行版本，不触碰已有前端修改。
- [ ] G07 后续获明确授权后，用不同新 idea 做真实付费验收，记录阶段耗时、输入/缓存/输出用量、中断和重复生成；实际达标前不宣称降耗成功。

## 验收标准和进度记录

模块化是否完成看业务调用与恢复路径，不看文件是否拆开。最小合格条件：同一产物在预检、原生结束和宿主推进的判断一致；中断续作保留正确成果；真实设计变化不被绑定豁免；局部错误不会让无关阶段重新生产；无重复权威和额外状态库。

当前：六阶段的准备输入、专业检查及结果处理已迁入所属模块；状态仍由公共入口统一保存。规划/Review、Content/资源恢复及实现→验收→修复连接通过合成回归。仅修改清单要求的字体消费链路，保留无关前端修改；未修改生成游戏、重启运行服务或付费调用。

第一批证据：

- delivery/state-store.test.ts：项目别名共用锁，并发变更不丢失，异常后可继续保存；旧版本没有被重写。
- src/beegame/content-stage.test.ts：同一产物在命令入口、原生结束和宿主判断一致；绑定后的 UI 保留，Scene 字节未重生成。
- 原有三项“Content 几何”用例原先没有已确认基线，现明确作为局部来源检查；缺基线不能推进另有完整链路断言，未放宽生产校验来迎合旧测试。
- src/beegame/production-task.test.ts：既有任务身份和中断续作回归通过；与全部 Content 准备/恢复路径的整体验收仍待完成。
- 本批最终回归：328 通过，0 失败，14 个文件。覆盖 delivery 下的 state-store / stage-boundaries，服务端 project-delivery / project-conversation / content-handoff / content-binding / design-release / game-content-validation-cli，共享 native-direction-authors / design-calculation-command，以及原生 content-stage / saved-draft-check / design-review / production-task。
- 服务端类型检查：`bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` 通过。
- 根类型检查：`bunx tsc --noEmit --pretty false` 仍有原有 layout-report-history.ts 的 7 个 possibly undefined 错误；本轮未改该文件，不宣称根检查通过。
- 隔离构建：`bun build.ts --outdir /private/tmp/bgs-stage-modules-final.ZGh2aK` 通过，包含 Bun / Node 启动检查；未发布到运行中的 dist 入口。
- 验证中修正了本轮新接入的同步启动依赖异步布局初始化问题、Zod 整包导入带入无用语言包问题。另将旧测试对压缩后内部变量名的断言改成实际执行 helper --help 核对 --scenes 接口。

第二批：Content 结果解释与恢复（2026-10-09）

- 结果检查区分保存源码、回执和阻断问题；缺当前回合完成结果不能仅凭文件存在推进，缺已确认基线时原生结束与宿主均拒绝交接。
- 新增问题不得引用不存在的条款、改写已有问题期限或将当前到期问题当作后续待办；未来到期且来源有效的问题保留后允许推进。新增对照断言覆盖原生结束与宿主。
- 原有完整流程合成测试补交明确的 Content 完成回执；没有放宽检查来适配测试。
- 完整恢复使用独立临时项目，真实调用调度、原生任务身份存储、绑定工具、计算器和交接检查；仅模型执行由合成适配器替代。
- 未改变设计的中断可续作；发现漂移时只打开现有显式授权的受影响处理路径，没有引入自动接纳变更或新的修订循环。
- 本批最终回归：上述第一批 14 个测试文件加 content-recovery.test.ts，共 331 通过、0 失败；服务端类型检查通过。根类型检查仍仅报告 layout-report-history.ts 原有 7 项错误，未改该文件。
- 最终隔离构建：`bun build.ts --outdir /private/tmp/bgs-content-pilot-final.Jtg9Oo` 通过（含 Bun/Node 启动检查）；未替换运行产物。复用上一个非空输出目录的尝试被构建安全检查拒绝，随后使用新临时目录，没有删除已有产物。

第三批：资源阶段与字体成员（2026-10-09）

- 已消除原生只查设计、宿主另查资源的交接差异；预检使用主机临时提供的原始策略/基线，不以作者修改的登记策略替代用户设置。
- resource-stage / resource-recovery 回归覆盖缺文件、制作失败、策略冲突、到期问题、缺回执、中断后组任务身份、设计漂移与正常交接。使用合成模型适配器，不是付费生产结果。
- 362 项测试通过（22 个文件）；包含上一批 15 个文件与新资源阶段/恢复、asset-contract-audit、resource-delivery-readiness、resource-production、media-production、font-inspection。
- 字体相关前端 42 项、scene-editor 测量 4 项通过；真实本地 Chromium 的 production-inspection 回归通过，验证显式字体成员的加载、测量、cmap 及实际静态渲染。
- 服务端类型检查通过；前端类型检查加 `--ignoreDeprecations 6.0` 通过（仅忽略既有 baseUrl 弃用选项，不修改配置）。根类型检查原有错误仍单独记录，不宣称整体通过。
- 隔离 CLI 构建 `/private/tmp/bgs-resource-stage-final.RQJeLB` 通过，含 Bun/Node 启动验证。没有替换运行版本。
- 浏览器测试初次受沙箱本地监听限制失败；授权执行本地临时测试端口后通过。无模型、无资源付费生成，也未启动项目服务。

第四项补充：E07 批量样本分配

- 保留既有 samples.json 格式；跨界面样本不再误传给每个界面，未知节点不能被过滤后静默通过。
- design-browser-inspection.test.ts：5 通过，2 项默认浏览器测试跳过；另显式开启 production-inspection.test.ts 的真实本地浏览器回归，字体成员、双 UI 样本和错误 ID 共 39 个断言通过。
- 尚未处理每个视口重复加载资源的问题（G01）；本项只解决样本归属，不冒称浏览器复用或耗时已达标。
- 最终根类型复核仅剩 layout-report-history.ts 原有 7 项错误，本批新增测试的类型问题已修正；前端/服务端类型检查通过。追加检查器输出回归 7 通过、2 默认浏览器测试跳过。包含代码变更的隔离 CLI `/private/tmp/bgs-stages-resource-ui.kSGWzU` 构建及启动通过；帮助文字另同步了字体成员与批量样本说明，未发布部署。

以上为历史批次记录；以下更新本轮完成项和剩余验收。


第五批：规划／Review、实现／验收及共享工具（2026-10-09）

- E01/E02：planning.ts 接管批次材料需求、作者产物/版本保护与交接；review.ts 接管任务读写范围、结果解释、有权决策和中断写入恢复。project-conversation 使用同一 assignment 生成任务、原生读写权限和结束读取范围；project-delivery 保留兼容入口与单一保存，不再内嵌这些专业分支。
- E04/E05/E08：保留授权文档、JSON、计算模型/输出的实际写入范围及版本提升；Inspect/Verify 只读，定向读取没有改回全稿检查。design-repair / project-conversation / design-review / saved-draft-check 覆盖正常修订、拒绝无权变更、读取范围、中断及恢复。
- E06：到期规则、真实用户答复和可选项不扩大范围的回归保留。程序不能证明模型对“是否必要”的语义分类一定正确；新增判断仍需原始条款依据，不宣称误判绝迹。
- F01：实现与验收消费同一已确认清单，保留原任务 ID、依赖、源条款和设计版本，不另存任务数据库。
- F02–F05：验收报告捕获、证据/产物新鲜度和发布门禁迁入 acceptance.ts。具有保存证据及被测产物的产品失败交回 implementation；缺环境/缺验证不伪装成产品故障，设计争议仍走显式所有者处理。实现返回后沿用验收；相同失败证据不会仅凭重写摘要反复派发自动修复。合成连接验证了跨保存/重读的修复流程，没有新增状态文件或循环引擎。
- G01：一次 --ui-all 共用浏览器 context、解码资源和字体；每次渲染卸载旧 React root。逐消费者输出诊断，检查整个观察快照的实际字节，资源在两次视图间改变则拒绝旧观察。真实本地 Chromium 验证两个 UI、三个视口 resourceLoads=1；额外直接调用验证 context=1 和缓存资源变化不能通过。
- G02：更新计算器前按代码 SHA-256 保留旧可执行版本，新版本原子替换工具入口。旧结果仍核对原工具版本、原输入、输出和 Scene 成员，不因部署升级被迫重算；源码或旧工具归档被篡改仍失败。没有重写项目计算结果、重标旧 hash 或执行模型来冒充新证据。
- G03/G04：沿用专业引用、计算输入、绑定字段和实现清单关联，不新增通用依赖图。六个阶段对兄弟阶段、调度及状态存储的直接和传递依赖均由 AST 回归检查；专业共享层可读快照，不能绕回调度保存。
- 验证：394 通过、2 默认浏览器项跳过、0 失败（21 文件）。运行 delivery 全目录，以及 project-delivery、project-conversation、design-release、design-repair、design-handoff、balance-calculation、runtime-acceptance、design-browser-inspection、project-deployment-routes、design-calculation-command 和原生 design-review、saved-draft-check、content/resource-stage、content/resource-recovery、production-task。
- 显式浏览器回归：`BGS_DESIGN_BROWSER=1 bun test ./packages/agent-workflow-server/src/beegame/production-inspection.test.ts` 通过，45 个断言。最初在 Bun 进程直接连接 CDP 超时，改为正式工具使用的 Node 客户端后通过；没有将测试驱动故障当作产品通过。
- 类型检查：服务端和前端（既有 TS6 baseUrl 弃用参数忽略）通过。根类型检查仍仅剩 layout-report-history.ts 原有 7 个 possibly undefined，不在本轮顺带修改。
- 隔离构建：`bun build.ts --outdir /private/tmp/bgs-six-stages-final.uDdcwe` 及 Bun/Node `--version` 启动通过；产物与运行目录分离，未部署、未重启、未改生成游戏或无关前端。
- 补充收口：保留前端所有者反馈接口，其验收业务校验也归入 acceptance.ts。追加原有工作流/反馈与 deployment-manager 回归（共 63 通过）；覆盖发布仅使用已测文件/目录，拒绝缺失、额外或已变更产物及源代码，不实际远程发布。
- 最终代码隔离构建 `/private/tmp/bgs-six-stages-verified.4wUhiL` 及 Bun/Node 启动通过；最终服务端/前端类型复核通过，`git diff --check` 通过。运行版本仍未替换。

剩余 G07：需要单独授权的不同新 idea 付费生产验收。当前只证明系统边界与本地/合成链路，不能据此承诺模型语义、游戏质量、端到端耗时或 Token 已达标。

## 第六批：真实依赖与局部修改隔离（2026-10-09）

目标不是六套独立系统，而是：内部实现不要求同步修改兄弟模块；交接或公共能力变更有明确消费者；局部故障不撤销已交付成果、不因版本变化自动重复生产。

### 已核实的调用与职责

业务入口是 `project-conversation.ts` 的准备和回合结束回调；`project-delivery.ts` 在同一锁内读取最新状态、调用所属阶段、提交结果。六阶段文件不互相调用，也不直接保存公共状态。下面区分阶段函数本身的写入和其调度的作者/工具写入，避免把“检查函数只读”误写成“整个阶段只读”。

| 模块 / 公开入口 | 实际输入与输出 | 共享能力 | 读取文件 | 允许写入及状态职责 |
| --- | --- | --- | --- | --- |
| 规划 `planning.ts`：preparePlanningAssignment / checkPlanningBaseline / advancePlanning | 原始目标、作者批次、已交付草稿快照、当回合完成信号 → 作者任务范围、草稿诊断、下一批次/Review | project-author、design-inputs、design-handoff、引用/布局/计算检查 | 当前及必要前置 `docs/*.md`、各文档侧索引、被引用 Scene/UI 和计算记录 | 作者写自己文档及其关联源；finalizeDesignDocuments 仅版本化当前授权文档/索引。状态：authorBatch、designDrafts；首次进入 Review 不发布正式设计基线 |
| Review `review.ts`：prepareReviewAssignment / requestReviewResolution / interruptedReview / advanceReview | 原始目标、草稿或已审基线、问题及真实用户答复、实际写入快照 → Inspect/Revise/Verify 范围、关闭依据、正式基线及受影响返回阶段 | design-handoff、引用/布局/计算检查、问题/答复格式、design-inputs | 初次完整检查八文档；后续按 changedSections、sources、受影响文档及其关联文件读取 | Inspect/Verify 只读；Revision 写授权文档、索引和 designSupportingFiles 返回的相关源，禁止无依据扩大授权。状态：designReview / designRepair / designHistory / designBaseline；保留其他阶段结果 |
| 资源 `resources.ts`：prepareResources / checkResourceHandoff / checkResourceResult | 已审基线、原始资源策略、实际 Manifest/资源、当回合回执 → 资源诊断、后续待办及 Content 交接 | design-protection、production-findings、resource-validation、media/resources/资源检查工具 | 相关设计条款、`assets/asset-manifest.json`、引用的资源与登记请求 | 视觉/字体、音频工作者分别写自己的输出及请求；资源所有者统一登记 Manifest。检查函数不改设计、Content、实现代码；不负责生成下一阶段工具说明 |
| Content `content.ts`：prepareContent / prepareContentContract / checkContentSources / checkContentHandoff / checkContentResult | 已审源、Manifest、当前平台格式及回执 → 绑定数据、index、来源与交接诊断 | project-content-authority、game-content-package、design-layout-check、绑定/渲染工具、design-protection / production-findings | `content/scenes/*`、`content/ui/*`、必要 VFX、Manifest/资源、关联设计条款 | 工具绑定同一源文件的已知资源/动作字段并写 `content/index.json`；保留规划的几何、ID、层级。入口生成 Content 工具说明，不在前一阶段提交中生成；不重写设计文档 |
| 实现 `implementation.ts`：prepareImplementation / checkImplementationResult | 已审 implementationItems、源条款、已交付数据/资源、必要验收失败证据 → 可运行代码、任务关联的检查证据、验收交接 | implementation-inputs、design-protection / production-findings、Content 消费格式 | 原任务及依赖条款、实际代码、index/Scene/UI/Manifest、必要失败报告 | 写游戏代码/构建；可修复违反明确要求的 Content 数据，不重新做规划、不自行改设计。实现结果不能改 acceptance 判定或历史 |
| 验收 `acceptance.ts`：prepareAcceptance / captureAcceptance / advanceAcceptance / checkAcceptanceGate / validateQualityReview | 当前代码/构建、已审要求、实际观察与产物、用户反馈 → 当前验收记录、产品修复交接或未验证/环境问题 | implementation-inputs、runtime-acceptance、workspace-revision、design-protection / production-findings | 当前已测产物、证据、`acceptance.json`、各源条款/索引及 Content | 写观察/报告，不静默修代码；产品故障交实现、设计争议交有权所有者。状态：accepted / acceptanceHistory / qualityReview / lastProductFailureEvidence；由公共存储提交 |

### 共同文件不是共同决策权

| 共享点 | 实际所有者及必要交接 | 隐藏耦合 / 本轮处理 |
| --- | --- | --- |
| `docs/*.md`、`.beegame/design-handoffs/*.json`、`docs/calc/*`、关联引用 | 规划/授权 Revision 定义、修改及版本化；下游只消费、提交具体问题 | 设计证据可能被多个文档引用；按实际消费者核查。没有为每阶段复制文档或数值证据 |
| `content/scenes/*`、`content/ui/*` | 规划/Revision 定义几何；Content 绑定；实现可纠正明确的消费/数据缺陷 | 同一 JSON 具有分字段职责，不能靠目录独占解决。既有 design-source/绑定投影和原写入快照继续保护非绑定字段；没有新增字段依赖引擎 |
| `assets/asset-manifest.json`、实际资源文件 | 资源阶段登记；Content 和实现消费；必要生产纠错按源要求说明 | Content 的版本输入消费整份规范化 Manifest；版本变化不等于全部资源需重做。工具说明已移出资源提交事务 |
| `.beegame/delivery/{check-content,bind-content,media,resources,edit-drafts,compose-drafts,inspect-design,content-consumer}.mjs`、`content-format.json`、`content-contract.json` | 宿主维护公共工具/格式；阶段仅使用，Content 入口负责当前契约准备 | materializeSceneUiFormat 仍会生成一组共享工具，不是阶段独占目录；升级属于公共能力变更，不能按单阶段代码修改验收。工具文件不属于玩法/布局决策，也不因可用就授权阶段改其他产物 |
| calculate-balance 工具及按工具 hash 保留的旧版本、计算输出 | 宿主维护工具；规划/Revision 所有者写模型/记录；下游只核实依赖 | 保留既有工具版本证据机制；没有因本轮工具准备而重写原计算结果 |
| `<dataRoot>/project-delivery/<规范化工作区 hash>/state.json` | 公共 state-store 唯一提交；业务函数返回当前阶段结果，规划/Review 的快照 spread 只保留未拥有字段 | 全量状态保存仍是共享点；锁内读取最新状态再提交，非另一套六阶段存储。验收修复身份已从可被其他阶段覆盖的临时 lastValidationFailure 独立出来 |
| 原生任务目录 `bgs-{phase}-{原始输入 hash}.json` 和资源组关联 | production-task 保存与原生 Agent 的既有关联；当前 context 每次更新真实输入及回执 | 原先把版本变化当成新任务，重派组任务/Content 作者。现优先原关联；新版本没有精确关联时复用同阶段唯一旧记录。多候选无法确定则要求核对，不新建、不覆盖。文件名保留旧输入 hash，但不被当成当前源版本或完成证据 |
| 验收报告、失败观察、被测产物 | 验收产生；实现读取失败交接，发布只消费已通过的确切产物 | reader 会对当前文件重算 hash；旧报告 + 新构建并非新观察。去重改用失败观察身份，并存于验收字段，不让构建变化/其他诊断重派修复 |

### 修改影响与回归范围

| 修改类型 | 正常影响 | 必须回归 | 不应触发 |
| --- | --- | --- | --- |
| 阶段内部实现，输入/输出语义不变 | 本模块；业务提交/恢复连接 | 所属模块正常、失败及恢复测试；涉及推进时加相邻交接测试 | 修改兄弟阶段代码；重写现有设计/资源；所有阶段重新生产 |
| 交接格式、语义、版本规则变化 | 该格式的生产者及实际消费者 | 格式解析、生产端、消费端、已保存旧记录兼容性；源变化对应的定向复核 | 因“版本不同”自动全部重做；用文件存在替代当回合回执 |
| 公共能力变化：Schema/坐标/绑定投影/Manifest/计算器/检查入口 | 使用该能力的各阶段和命令/原生结束/宿主三入口 | 相关能力测试和使用方连接测试；计算器保留旧证据；涉及状态/任务身份时加暂停/重启及旧记录恢复 | 宣称只测一个业务文件就保证其他阶段无影响；覆盖项目源来适配工具升级 |

具体对应：设计输出/验收索引变化回归规划、Review、Content authority、实现清单、验收要求与发布；Manifest/atlas/font 变化回归资源生产/登记、Content 绑定/检查、静态与运行时消费；纯 UI/Scene 几何修订回归其引用消费者和相关计算，不默认重做音频或所有资源；公共状态或任务关联变更回归全部推进/恢复入口。是否需要实际重测由源条款、引用文件、绑定及现有实现清单决定，不能只看全局 hash。

### 实施清单（只按本轮证据标记）

- [x] H01 核对六阶段公开入口、共享调用、状态字段及文件读写，区分宿主、阶段函数和执行作者；保留必要交接。
- [x] H02 移除资源→Content、Review→Content 提交时对 Content 工具说明的写入；准备归 Content 入口，兼容原公开 helper 名称。
- [x] H03 修正旧失败报告因构建改变被误当新观察的问题；验收修复身份不被无关诊断覆盖，实现提交不再判断 acceptance 私有前缀。
- [x] H04 局部输入版本变化后，原生资源/Content 复用原任务；中断资源组只续作未完成组；多候选不擅自派发新任务。
- [x] H05 静态依赖回归除相对 import/export 外，纳入 workspace package 别名、字面量 dynamic import 和 require 的传递路径。
- [x] H06 新增隔离合成回归；先证明旧实现失败，再验证修复。已有 Content/资源/Revision 中断恢复连接重新回归。
- [x] H07 给出内部、交接、公共能力三类修改的实际回归消费者；不新增通用事件总线、状态机、依赖图或六份状态库。
- [ ] H08 真实多进程并发写同项目、进程在 rename/提交点被强杀的故障注入；当前只证明单服务进程锁和合成中断，不宣称跨进程事务安全。
- [ ] H09 未展开的计算型动态 import、自定义路径别名及运行时工具行为的穷尽隔离；AST 不是任意执行代码的沙箱。
- [ ] H10 旧运行项目已经丢失的失败身份/多条历史任务关联能否完整还原；本轮没有改写在跑项目，唯一旧关联恢复与明确拒绝歧义已测试，不承诺找回不存在的证据。
- [ ] G07 真实付费验收仍未完成；2026-10-09 已获授权部署并启动下述新 idea，未完成前不勾选质量/用量/耗时达标。

新增复杂度只有：复用旧原生关联的路径查找、同一状态中的一个验收失败观察标识、隔离回归及清单。分别对应已复现的重复派发、诊断覆盖和提交耦合；没有新增业务阶段、任务生命周期或产物协议。

本轮证据：

- 修复前，新增 stage-isolation 两项真实文件合成用例均失败：资源提交抛出下一阶段写入错误，旧验收报告在仅改构建后又派发实现。修复后通过；核对八文档、八侧索引、已有 Scene/UI、Manifest 和资源的原字节未变。
- 扩展 production-task 既有用例，让中断后/所有者续作时改变 inputRevision：修复前 3 项失败（新建 Agent/重派资源组），修复后均续作原 Agent；另新增多旧记录歧义用例，0 次工具执行，记录不被覆盖。
- `bun test ./src/beegame/production-task.test.ts ./src/beegame/resource-recovery.test.ts ./src/beegame/content-recovery.test.ts`：14 通过、0 失败。覆盖资源组部分成功、CLI 重启、同一 Content 绑定、源漂移及计算证据失效。
- 连接回归：`bun test ./packages/agent-workflow-server/src/beegame/delivery ./packages/agent-workflow-server/src/beegame/project-delivery.test.ts ./packages/agent-workflow-server/src/beegame/project-conversation.test.ts ./packages/agent-workflow-server/src/beegame/design-release.test.ts ./packages/agent-workflow-server/src/beegame/design-repair.test.ts ./packages/agent-workflow-server/src/beegame/runtime-acceptance.test.ts ./packages/agent-workflow-server/src/__tests__/project-deployment-routes.test.ts ./packages/agent-workflow/src/__tests__/design-calculation-command.test.ts ./src/beegame/design-review.test.ts ./src/beegame/saved-draft-check.test.ts ./src/beegame/content-stage.test.ts ./src/beegame/resource-stage.test.ts ./src/beegame/content-recovery.test.ts ./src/beegame/resource-recovery.test.ts ./src/beegame/production-task.test.ts`：326 通过、0 失败，19 文件。之后追加旧验收标记兼容用例，acceptance.test.ts 单独 3 通过（其中 2 项已包含在上述 326 项，不重复计数）。旧标记尚完整时可转为验收拥有的失败观察记录；不存在的历史身份无法据此恢复。
- AST 传递依赖检查通过，包括 workspace package 的实际源文件；公共状态同进程序列化测试通过。这不证明跨进程同时写入安全。
- 服务端 `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` 通过。根 `bunx tsc --noEmit --pretty false` 仍仅有 layout-report-history.ts 原有 7 项 TS18048，未修改该文件；不宣称根检查通过。`git diff --check` 通过。
- `bun build.ts --outdir /private/tmp/bgs-stage-isolation-build.52Ah39` 隔离构建通过；Bun/Node 产物的 `--version` 启动均返回 2.8.4。未覆盖运行入口、未重启服务、未改生成游戏。

限制：观察去重仅控制重复自动派发，不证明 LLM 的报告真实、也不证明首次失败报告对应的历史被测版本。报告内容、语义影响及游戏质量仍需实际证据；改变证据文件本身不自动等于真实复测。公共工具/格式和全局设计/Manifest 身份仍有必要共享，只能按实际消费者定向复核，不能宣称绝对独立。

### 部署与真实验收跟进

- 部署前确认 62173–62177 均未监听，无 BGS 原生任务进程；没有中断已有项目。
- 使用既有环境配置启动全部服务，正式构建并发布 `dist/build-pr2xpC`，旧构建未删除。运行解析器指向本 worktree 的 `dist/cli-bun.js`，稳定入口引用本次构建。
- 前端及四个后端健康接口均 HTTP 200；服务监听于 127.0.0.1 固定端口。资源处理已启用。账务服务报告缺少 Stripe 配置，充值/支付未因此被当作已验收，现有用量接口可读。
- 部署前定向回归 18 通过；部署后的真实 CLI 离线接口/子任务/Skills 回归 4 通过，响应来自本地合成提供商，无模型费用。
- 用户另行授权后，经真实 HTTP bootstrap 创建唯一新 idea「潮汐信使·阶段隔离验收」，projectId `production-test-08da36ab-10a3-4b2c-9197-5232b3a8a928`；未改默认模型、无 Credit 上限、不自动追加项目或付费重跑。
- 审计观察器及运行记录位于 `/private/tmp/bgs-tidal-courier-isolation-20261009.tCOsVG/`。观察器只读生产产物，日志写在独立审计目录；正常生成/修订均由 BGS 进行。
- 当前正在执行首轮六阶段生产；局部修改、中断恢复及用量/质量结论待该轮实际结果后记录，不提前宣称通过。

### 首轮真实运行：权限等待时的实际进度

2026-10-09 21:22（Asia/Shanghai）停在资源作者的原生权限请求，任务仍保存、服务未停止。不是六阶段验收通过，也未开始额外项目。

| 阶段 / 后续验证 | 实际证据 | 状态 |
| --- | --- | --- |
| 规划 | 八文档、7 份 UI、harbor-main Scene 和计算记录已保存；技术集成任务补齐实现清单 | 宿主推进完成，不等于游戏质量通过 |
| Review / Revision | 联合修订修复 touch-stick 将 assetRef 直接放在 button 上的契约错误；定向 Verify 关闭；UI 与资源计划升至 v1.1，其余来源保留 | 已推进到资源 |
| 资源 | 音频原任务 a05a77dcbae412eb7 已交接；视觉原任务 a0a1f6e7882a7405d 未完成 | 等待删除权限，未交接 |
| Content / 实现 / 验收 | 尚未到达 | 未验证 |
| 局部修改 / 一次中断续作 | 要在首次交付后对同一项目执行；未提前打断首次生产 | 未执行 |

权限请求原命令：`rm -f assets/runtime/visual/world/num-*.png && bun assets/visual/scripts/gen-world.mjs`。只读核对匹配 6 张 num-1/2/3 的 solid/hollow PNG，共 3,866 字节；原生成脚本保留。通配符删除触发原生确认，未擅自批准，已向用户提出这一次删除许可。没有把权限等待当作业务通过或按测试案例改系统。

用量以实际 native_accounting 记录为准，包含重复请求的缓存输入，不是上下文净长度；原生 task_progress.total_tokens 不用于代替累计费用统计。

| 已结算阶段 | 未缓存输入 | 缓存输入 | 输出 | 合计 Token | 阶段墙钟 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 规划（含技术集成） | 669,322 | 8,400,792 | 177,074 | 9,247,188 | 56.6 分钟 |
| 联合修订及 Verify | 189,771 | 1,104,416 | 12,551 | 1,306,738 | 4.7 分钟 |

资源回合尚未返回最终结果；21:22 时实时累计 15,039,511 Token（未缓存输入 1,120,627、缓存输入 13,670,840、输出 248,044）。账务汇总暂为 7 个已结束回合的 10,553,926 Token，不能当作整轮最终总量；费用估值不冒充提供商实账。

已观察到的成本来源：UI 原生作者执行 93 次工具调用，几何检查 7 次（6 次失败后 0 诊断通过）；技术集成另一个原生任务执行约 42 次工具调用；资源工作者另写检查/生成脚本，并发生错误模块名、PNG 检查图及三次缺 todos 参数等无效调用。上述是日志事实，不证明全部读取都不必要，也不证明更换模型或叠加规则能解决。阶段隔离、端到端可用性、语义质量和成本需要分别下结论，目前 G07 不勾选。

审计目录保留 `planning-complete-snapshot.json`、`review-complete-snapshot.json`、`resource-permission-wait-snapshot.json` 及阶段用量；快照只读生成项目，写在独立审计目录。尚未证明局部修改不重做、中断后原任务恢复、实际游戏质量或降耗成功。

## 第七批：依据真实用量修正流程（2026-10-10）

### 最新运行状态

上述权限等待已由用户批准一次，资源组随后完成、共享登记交接通过；资源完成快照与 Review 快照的设计文档/Scene/UI 差异为空。进入 Content 后，用户要求优先优化消耗，已通过正常 stop 接口于 2026-10-09 23:49:07（Asia/Shanghai）停止本轮。没有删除成果、覆盖原任务身份或继续追加付费实验。Content 未完成，实现与验收未到达；预定局部修改/中断续作验证仍未执行，G07 不勾选。

### 已核实的成本

来自 native-runtime.jsonl 已记账累计计数的增量，共 28,574,969 Token：未缓存输入 1,667,018、缓存输入 26,596,488、输出 311,463。缓存输入是重复请求的消费，不是上下文净长度，也不冒充实际金额。中断 Content 的已记账用量不能因为没有最终 result 而算成零。

| 工作 | 计入 Token | 请求结束记录 | 事实解释 |
| --- | ---: | ---: | --- |
| GDD | 371,372 | 7 | 首个主任务 |
| 技术/美术/音频初稿 | 964,580 | 34 | 并行共享累计计数，仅合并归因，不伪造每个并行作者的精确分摊 |
| Scene / 数值 | 1,284,266 | 28 | 消费已保存输入，包含实际计算和写作 |
| UI | 4,124,123 | 46 | 93 次工具调用，其中 54 次 Edit（含失败）、多轮布局检查；工具调用数不是模型请求数 |
| 资源计划 / 技术集成 | 2,502,847 | 38 | 专业依赖读取和集成；不把所有必要读取都当浪费 |
| 联合修订 / Verify | 1,306,738 | 28 | 保留原有限审查，不新增 Review 层 |
| 视觉/字体与音频制作 | 6,234,972 | 81 | 并行生产合并归因 |
| 共享资源登记/交接 | 10,277,863 | 107 | 122 次工具调用（含 9 次失败）；配置试错、读工具源码、重复检查及自制验证放大历史 |
| 未完成 Content | 1,508,208 | 30 | 包含把全部登记模块输出后再读大文件失败等探索；不当作交付完成 |

独立审计脚本和结果：`/private/tmp/bgs-tidal-courier-isolation-20261009.tCOsVG/cost-evidence.{ts,json}`。脚本只读原项目/原日志；工具输出字符数另记，不拿字符数冒充 Token。部分并行请求计数在结束前已入全局账，故专业并行组不拆成虚假的精确作者费用。

### 本轮落盘与影响

| 已证实放大器 | 最小改动 | 保留的边界 / 验证 |
| --- | --- | --- |
| 资源组接收整个里程碑说明，包含登记回执、Content 绑定等无关接口 | 沿用现有作者 scoped-context 方式，为 visual/audio 各生成临时输入；原始需求、当前源位置和可用能力保留 | 不截断原生历史、不替换任务身份、不加轮数限制；旧共享 context 仍可恢复。原任务续作、已完成组不重派及临时文件清理回归通过 |
| 工具拒绝无资源的配置请求，所有者只能混入某个制作组；音频组的 WAV/JSON 格式被误当全局目标 | 接受明确的 resources:[] 配置请求，与各组请求用既有 --register-from 一次提交；工作者不负责全局 target/requirements | 无配置/无资源的空请求仍失败；既有目标不可静默改写，不自动扩展格式。配置信息不能被当成平台能力证明 |
| 首个 PNG 错误修完再碰 WOFF2、未知需求 ID；靠源码猜参数 | 同一注册验证器在写入前收集未知需求和格式错误，列出资源 ID、实际/允许格式；同扩展名的重复错误按文件数汇总 | 不复制语义验证器，不改变实际媒体/来源检查；批次失败原登记字节不变 |
| 字体成员及候选缺字反复进入报告 | --report 汇总成功成员/候选比较数量，完整 JSON 仍按原方式保留；每个失败/未验证选定字体仍返回，非绑定比较明确不是 PASS | 两份现有原始报告各 5,091,198 字符，新摘要各约 2,100 字符。只是输出量测，不宣称真实费用已下降 |
| 资源作者被提示 --ui-all 和绑定，提前做 Content 工作；许可证 TXT 在渲染模式被误报环境阻断 | 资源入口只提供 --resources 检查用途，Content 保留最终 UI-fit；预览可读 TXT 支持文件，仍报告没有媒体解码器 | 不将字体/静态渲染当审美或交互验收。真实本地浏览器证明许可证不是环境失败，覆盖限制仍保留 |
| Content cat 全部资源模块，74.1 KB 输出持久化后再次读取 41,831 Token 超限 | 既有 resources.mjs 增加只读 --list：默认返回 ID/用途/默认根/状态/文件数，指定 ID 才列成员，--details 保留完整来源/哈希 | 实际当前 9 份资源总览约 2,991 字符，不生成第二份库存；未知 ID 明确失败、链接越界拒绝、不写 Manifest。绑定/几何保护不变 |
| UI 被给到技术文档的批改示例，实际使用大量单字段 Edit | 示例改为本作者路径，并明确既有 edit-drafts 支持 Scene/UI、多文件已知修改；先完成关联修改再检查 | 只是纠正可调用接口，不强制模型正确选布局、不增权限；精确匹配预检、JSON 失败不写、部分写入恢复回归通过 |

### 验证与未完成项

- [x] 最新 17 文件定向回归 165 通过、0 失败；覆盖制作/登记/查询、报告、作者输入、原生任务身份与恢复、绑定保护、阶段依赖及批量修改。另补真实 materialized --list 调用、目录链接拒绝和 301 个同扩展错误摘要断言，资源生产 6 项再次通过。
- [x] 无模型费用的真实本地浏览器回归 1 通过、48 个断言；许可证读取、真实字体成员、错误保留及多视口资源复用仍成立。
- [x] 服务端类型检查通过；git diff --check 通过。根类型检查仍为 layout-report-history.ts 原有 7 个 TS18048，本轮未改它。
- [x] 隔离构建 `/private/tmp/bgs-flow-cost-final.Yt5yBC` 成功，Bun/Node --version 均正常。没有发布到 dist，也没有重启服务。
- [ ] 扩展检查中，既有“checker 仅保留英文 Zod locale”体积回归仍失败（当前依赖生成 64 个 locale）。通过内存替换去除本轮登记逻辑的只读构建仍得到 64 个，未以通过测试为由改断言或回滚依赖；现有小入口策略不变。此项另列，不宣称全部检查通过。
- [ ] 真实端到端降耗、总请求数和交付质量尚未重新验收；不能用 5 MB→2 KB 摘要、测试通过或更多代码替代这些结论。部署后的新增付费运行需明确授权。
- [ ] 仍可能存在模型反复探索、错误生成、自制校验和专业判断失误；本轮去掉已证实的接口/输入放大器，不承诺仅靠提示能消除这些行为。八文档业务未删除，原生自由选工具/权限/压缩机制未改。

下一步先解决残留构建检查并核对可部署版本，再在同等交付要求下记录新运行的资源登记、UI、Content 请求数与真实输入/缓存/输出。若仍是百万级重复探索，不继续叠 Prompt 或重试；重新审视对应任务的机械部分和必要产物范围。

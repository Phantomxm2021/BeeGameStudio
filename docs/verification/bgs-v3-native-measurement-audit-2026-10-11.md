# V3 1.40：自主测量、按需生产能力与收尾审计

日期：2026-10-11。依据实施规范 1.39 第 7 节继续落地。当前规范更新至 1.40，旧稿按字节归档。下述工程结论与非付费回归先于付费派发；随后唯一授权付费组的中途事实见文末，不把它写成完整游戏通过。

## 结论

- 原生 Claude Code 仍自行规划／委派／执行；没有新增宿主阶段、Task、模型循环或次数限制。
- 自主会话可显式调用“源副本构建＋浏览器加载测量”，以真实需求／报告／源码／产物和执行身份核对同一成果；独立 debug 已能预览、导出静态包及可编辑工程。
- 纯 Content 批量绑定、生图和旧资源 CLI 进入正常自主回合，保留实际来源、权限、计费与恢复。
- 真正发现并修复了准备失败时漏等图片能力清理、仍释放写者的问题。未知结果／未确认退出不解锁。
- 真实数据库并发验证 18 项通过，无新 SQL／表。只是合成数据库记录，不能外推真实模型／完整游戏。
- 未改正式 frontend、Claude Code src、builtin-tools 或真实游戏产物；未重启正常服务。没有付费模型／图片调用。
- 品质语义、真实 Token 改善、完整引擎开发和正式产品接线仍未完成；不靠勾清单宣称全部实现。

## 实际调用与修改边界

| 位置 | 真实缺口／处理 | 不做什么 |
|---|---|---|
| agent-goal.ts → agent-tools.ts | 正常 prepareTurn 提供可选测量、绑定和图片入口；讨论不开放生产桥；明确等待清理后持久化 quiescedAt | 不改原生循环，不重复初始 goal，不为每个专业领域派作者 |
| agent-measurement.ts、state.ts | 复用 AgentTurn.measurements，先保存请求预留，再执行实际检查；保存结束／失败，CAS 重试只落事实；未知结果不重放 | 不增表／DAG，不把失败改为通过，不把报告 PASS 当认证 |
| project-preview-capability.ts、project-execution-access.ts | 复用当前会话／工作区能力指针，增加独立 measurement 指针；旧回合清理不撤销新回合权限 | 不把临时端点写死进可复用测量脚本，不放宽宿主文件访问 |
| editable-project.ts、checks.ts、sandbox-build.mjs | 复用源码副本构建；新原生桥使用独立子进程中的现装 sandbox-runtime，无网、只写副本、依赖只读、不可用则失败 | 不改 Claude Code；不自动安装依赖或升级所有 legacy 构建为已隔离 |
| runtime／content／UI／font／pixel／audio checks | 参数类型缩小为实际消费字段，使纯检查不再需要空壳 Task；旧检查行为保留 | 不新增引擎框架、统一 Scene 或品质评分 |
| measured-build.ts、measured-preview.ts、routes.ts | 同一真实 measurement 的 source／reports／requirements／artifact 校验、Preview、静态／工程 ZIP；旧 Task 选择兼容 | 不用假 Task，不在导出时执行模型／重建，不打开整体交付资格 |
| debug.html、debug-client.js | 仅独立 debug：选 measurement、核对当前性、Preview／下载；实际观察固定构建身份，转为普通消息草稿，默认讨论，另行明确授权变更 | 不改正式 frontend，不自动 Review／Repair、改需求或收费 |
| content-binding.ts | --current 复用原批量执行器，用实际 Content／Manifest／模块／引用成员字节确认来源；保留设计字段；部分失败返回 written／pending | 不伪造八稿版本、index 或阶段授权；不是全量 package／handoff 语义审查 |
| app.ts、image-generation/access.ts | 复用实际用户／项目、生图服务及配置计费；显式请求才生成。关闭等待在途结果／观察记录，旧连接即使保留也拒绝请求 | 不复制密钥，不新增计费系统，不换 requestId 盲重购 |
| verify-workflow-v3-database.ts | 延伸现有 opt-in 合成数据库脚本，测自主 JSON 记录／变更／测量预留的竞争与历史 | 不启动原生模型，不写“原生成功”或游戏通过，不改数据库结构 |

## 已核实失败与纠正

1. 测量构建若直接用原 host commandCheck，会绕过原生受限执行。新入口改为隔离的源码副本构建；恶意合成脚本读取原项目／其他文件、改外部文件或访问网络均失败。原有合法副本构建与浏览器测量通过。仅 macOS 实测，其他 OS 未验收。
2. macOS Bun 在隔离副本中无法读取 cwd 的祖先目录。日志确认是目录条目读取，不是源码缺失；只允许锚定的精确祖先目录，不递归开放用户目录或其他工程。构建正例和逃逸反例同时通过。
3. 真实 CLI 合成变更测试未先 Read 就 Edit 规则测试文件，原生正确拒绝，后续 `&& measure` 未执行。修正的是合成模型调用顺序，没有改 Claude Code 或手修真实游戏。
4. 测试误以为关闭 HTTP 服务后必须连接失败；实际 keep-alive 可能返回 404，仍不可提交新工作。断言改为连接拒绝或 404，而不是改产品允许重连。另一测试的 `bun -e` 参数位置不等于实际脚本入口；改用生产适配器测试 --current。
5. **实际生命周期漏洞**：图片桥已打开后，后续准备失败且图片 close 失败，tools 对象尚未返回；原执行器只追踪 Preview，遗漏图片，错误写入 quiescedAt 并释放 writer。合成回归修复前 writer 为 undefined，修复后 writer 保留且无退出／完成声明。执行器现在独立保留图片句柄，即使工厂失败也再次等待同一清理结果。
6. 新增资源反例证明，首文件提交后资源字节发生变化，余下文件停止；已写成果和外部修改不被回滚覆盖。无 docs／index 前置，不牺牲实际资源检查。

## 验收证据

### 非付费回归

- 最终 V3 全模块回归：**264 pass、0 fail、2,147 expects，32 文件，554.09 秒**。上一遍使用了修复前加载的资源清理代码，263 pass／1 fail；修复后定向组和本次最终全量均通过，未删失败用例。真实模型尚未派发。
- 共享边界七文件：**38 pass、0 fail、367 expects**（5.38 秒）；启用 BEEGAME_TEST_REAL_BROWSER=1。覆盖 content-binding、image-generation/service、project-execution-access、project-preview-capability、preview-test-access、project-asset-command、project-content-authority。
- 图片异常清理修复后的原生入口／真实 CLI 独立 debug：**23 pass、0 fail、260 expects**（19.77 秒）。与 V3 全模块组有重叠，不重复累计。
- Content 当前资源中途变更反例所在文件：7 pass／0 fail；已包含在共享组，不重复累计。
- 根配置 TypeScript、debug JS／sandbox helper 语法检查通过；最终补丁后再次核对类型检查。未使用包内错误 paths 配置掩盖问题。

真实 CLI＋独立 debug 使用现有 native runner 和正常 API，provider 仅本机固定响应：
五个真实回合、25 个受控请求，同一原生 UUID；原生 Todo／Skill／Question、写入、失败测试→修正→复测、需求变更、中断／显式续作均执行。源码目标 3→4，维护测试相应变化，原无关 README／备注保留。
显式 measurement 真实执行源码副本 build 与隔离浏览器；报告、源码和已测包关联。修改后旧结果失效，最新成果可从 debug 下载工程；观察转为消息草稿不派发，篡改观察来源拒绝。
相同请求不重跑，缺报告、非零退出、取消、清理失败、丢失结算、旧权限均保留失败／未知；新失败不回退选择旧 PASS。

固定假模型用量不代表真实费用。合成 goalPrompt 2,327 字符、工具 context 2,335 字符（含本轮新增按需入口），不是原生系统总 Token。没有增加模型记账／审计／总结回合，也没有为了减少消耗删除必要专业责任；真实净降幅仍未知。

### 真实数据库（零模型）

命令：

```text
bun scripts/verify-workflow-v3-database.ts --apply --env-file <正常根环境文件> --source-project v3-paid-6fc08c27-1946-499b-999c-bd775af26361
```

现存项目仅提供归属元数据，未修改其行或工程。新增并保留四份 Synthetic 证据：

- v3-db-cas-4988e3b9-9507-4c9a-a656-71b4f588eacb
- v3-db-writer-a-1800e4ac-3b17-4789-a846-50b8d72452f3
- v3-db-writer-b-15c99b6e-0986-4b09-941f-2a417ae6e42a
- v3-db-native-7883bf67-74cf-49b3-b4c6-a903d1e23b82

18 项检查通过，独立 worker 实际获得 409 revision-conflict／workspace-busy，胜方与事件原子保存。自主测量仅保存明示的未执行预留记录，未写成功或原生退出证明。暂停与未知记录在重载后均保留。历史改写被宿主 remote store adapter 拒绝，不能宣称这是新增 SQL 约束。详细机器结果见同名 database JSON。

### 引擎／部署边界

- 实际 Unity CLI `/Applications/Unity/Hub/Editor/6000.4.0f1/Unity.app/Contents/MacOS/Unity -version` 返回 6000.4.0f1。
- 当前 PATH 未发现 Godot；本次审计会话可见工具清单没有 Unity／Godot MCP，不能据此断定 BGS 原生会话的全部配置。未安装／变更配置或打开引擎工程。
- 版本可查询不等于许可证、工程编译、MCP 控制或后台取消／恢复通过；这些仍是未验证项，不设为普通 Web 开工门槛。
- 当前源码服务通过现有 scripts/dashboard-server-dev.ts／debug 脚本直接加载 BGS TS 和辅助脚本；本轮没有构建／重启正式运行版，不声称现有正常服务已部署此改动。Claude Code 未改，不需要为本轮重建 CLI。
- 旧 Task／六阶段入口仍有现存兼容消费者，未整目录删除。新自主入口不调用它们，不新增自动迁移。

## 尚未完成

1. 用户已明确批准一组新 idea「磁轨调度」的真实游戏／同工程变更／中断续作／成本验收；最终离线回归全部通过后已派发。当前因用户指出交付内容问题而暂停，细节见文末；没有追加项目或付费重跑，需求变更与最终交付尚未验收。
2. 八领域实际决定是否完整、专业 Skill 是否恰当调用、玩法趣味、动态反馈、美术与听感：需要真实成果与观察。程序不证明任意自然语言充分性。
3. 新可选测量只覆盖静态 Web 源副本与加载 smoke；不是所有 React SSR、Unity、Godot 的通用测量／导出。大型源与依赖重复扫描开销仍需真实样本，未捏造性能优化收益。
4. 正式 frontend／产品入口、发布闭环不在现授权内；deliveryEligible=false。
5. 完整 legacy Content package／handoff 仍使用真实旧基线；新纯草稿／current binding 不是为其编造授权。没有实际消费者需求前不再建立第三套 Content authority 框架。

这些是明确的验收／环境／权限边界，不是让 Agent 自己打 PASS 后可以省略的项。

## 唯一授权付费组：用户指出交付缺口后暂停

- 项目：`v3-paid-a801f793-52cb-4874-8893-f5eaad8bf833`；Run：`bedaee26-a2a7-4997-adf2-688eb3a79a61`；实际模型 `ark-code-latest`，沿用正常配置，非假模型。
- 原生会话 `a81cfeaf-b023-43c6-ad73-d5a94c6b60ed`；原始证据位于项目 `transcripts/v3-agent-acceptance-1b167e40f20a__7b5f404a.jsonl`，只读未改。
- 02:51:09 UTC 派发；02:55:27 完成计划中的中断，四份已保存初始化文件在暂停前后哈希一致。明确恢复操作不派发；用户授权续作于 02:56:21 沿用同一原生会话继续，没有重建项目。
- 03:24:00 UTC 因用户指出文档目录、设计深度、Scene/UI JSON 和资源问题再次暂停。这是问题排查暂停，不是第二组付费续作实验。03:24:02.124 原生退出已确认，03:24:02.876 结算为 interrupted，writerLiveness=none。未再派发、未人工修补游戏。
- 已记录 60 次模型请求，58 次完整结束、2 次中断。累计 **4,358,327 Token 下限**：未缓存输入 147,427，缓存输入 4,140,520，输出 70,380。中断可能缺最终用量，不声称精确账单。首回合 178,969；续作 4,179,358。没有 Skill 调用，也未发现 Read/Bash 读取 Skill 方法文件；已有目录不能作为使用证据。
- 游戏尚未完成交付、同工程需求变更和新测量/导出验收。部分设计和代码正在修订，不能将中途草稿等同于最终成品，也不能据此忽略已证实的系统交付缺口。

### 四项问题的实际归因（尚未实施修复）

| 问题 | 证据与边界 |
|---|---|
| 文档散落八个目录 | agent-goal.ts 的 professionalWork 明写 gameplay/GDD.md、art/ART_DIRECTION.md 等路径；产物按此建目录。是接单路径表达错误，不应只归咎 Agent。新工程应统一 docs/，不得人工搬迁本验收产物。 |
| 专业设计不足 | 八稿共 356 行，已有规则、配色和事件等决定，并非完全空白；但行数不证明充分性。美术没有代表画面验证，专业 Skills 未加载；UI/美术仍写 1–4 道岔而当前第三关为 5 个，数值草稿与运行配置仍有差异。模型正在修订数值，尚未最终交付。接单只压缩为通用责任，没有向当前工作实际带入完整专业方法；不能靠再加文件或字数门槛证明改进。 |
| 无 Scene/UI JSON | 当前规范 §3.3 与 agent-tools.ts 明确允许原生 TS/DOM 实现且不创建 BGS JSON；项目选择 src/levels.ts + render.ts + DOM。这不是明令要求后单纯漏写；若交付承诺包含现有 BGS 场景/UI 编辑能力，当前目标未保留该数据要求。应由真实消费者确定所需格式，不给 Unity/Godot 强加第二套 Web JSON。 |
| 未获取/生成外部资源 | ASSET_PLAN 明确选择 Canvas/WebAudio/系统字体，不是完全没有视觉和音频制作。但付费 debug 启动未接资源配置：根 env 单独 resolve 返回 undefined；正常 beegame-dev-lib 会补本地资源服务环境，dashboard-server-dev 再传入 resourceSelectionRuntimeConfig，验收脚本两者都未接入。故原生会话得到“资源库未配置”属实，不能用本次测试证明资源库链路可用。图片生成另有可用入口但未调用；optional 设置允许不使用外部资源。应先纠正环境与交付要求，不以采购/生图次数代替品质。 |

本节是中途审计，不修改规范方向、不改正式 frontend/Claude Code/生成工程，不自动恢复付费工作。

# Reviewer r1 / GLM-5.3 两会话语义筛查

日期：2026-09-11（Asia/Shanghai）。结论：**两会话均完成并结算，但 r1 未通过语义门槛，不接入生产，不补跑，旧协议不退役。** 本批新增费用 **7.7925 积分**，与此前所有批次分列。

## 结果

| 指标 | case-1 | case-2 |
|---|---:|---:|
| 确定缺陷检出 | 8/8 | 7/8 |
| 漏报 | 无 | S15 权威归属矛盾 |
| 正常例确定误报 | 1/8：S14 | 1/8：S16 |
| 宿主回合 / HTTP 请求 | 1 / 2 | 1 / 3 |
| 计算工具调用 / 最终报告尝试 | 2 / 1 | 2 / 2 |
| 原生耗时 | 48.094 秒 | 79.362 秒 |
| tokens | 28,353 | 43,963 |
| 正式积分 | 3.3925 | 4.4000 |
| 生命周期 / 结算 / 默认配置核验 | completed / settled / unchanged | completed / settled / unchanged |

第一份虽有 8 个 finding，但其中一项合并了真实缺陷 S03 与正常 S14；第二份也有 8 个 finding，却包含一个误报并漏掉一个缺陷。finding 数量不能代替检出率。

## 足以否决本批的问题

1. **case-1 误报 S14。** `findings[7]` 的标题、actual、repair 和 omissionCheck 都声称 S14 使用未定义的 `F_SHILED`，甚至要求修改 S14。其引用的 BALANCE_DESIGN 第 18–19 行实际正确使用 `F_SHIELD`；错误只存在于 S03 第 7 行。引用被原样复制，却与模型的陈述相反。这是确定误报，不只是标题笔误。
2. **case-2 误报 S16。** `findings[1]` 把 S16 的 TECH 第 6–7 行与 ART 第 3–4 行判为“直接相反”。两处原文都明确点击时扣血、光点到达不扣血；报告把 S01 的错误模式错误套到了独立的正常例 S16，并要求修复不存在的矛盾。
3. **case-2 漏报 S15，并错误声称一致。** GDD 第 19 行把出场顺序唯一归 BALANCE；BALANCE 第 25 行明确不拥有顺序、归 LEVEL；LEVEL 第 13 行也声明由自己给出。没有 finding 覆盖这一矛盾，omissionCheck 却将 S15 列为一致。
4. **证据相关性仍不稳定。** case-2 S12 的 `evidence[2]` 引用 BALANCE 第 15–16 行，即独立正常例 S07，而非 S12 第 3–4 行。其余两条直接证据足以使 S12 计为命中，但不能让这条错例引用变得合格。case-1 也在 S13 中附带 S04 的 UI 第 4 行、在 S10 中附带 S05 的 LEVEL 第 9–10 行。

另有报告质量问题：case-1 用独立正常例的“正确模式”反复支持本例的 expected/repair，summary 又把三项 MEDIUM 写成两项；case-2 将 S09 的“只改透明度”带入 S08 的修复要求，而本例 GDD 只要求菜单动画不改变生命或战斗计时。相关附加问题不重复计为新的正常例误报。

## 相比历史报告，能说明什么

两份 r1 都识别了 S06 的同一 status 冲突，并明确区别于 maturity/status 独立；两份都正确选择了 S08 的 UI 第 12–13 行。此前唯一已完成的基线报告在这两处分别漏报和错引。

这只是两次观察，不证明提示已可靠修复问题：新增误报、另一项漏报与其他错例引用仍存在。没有同期新基线对照，B24 又是已知诊断样本，不能据此推断普遍提升、因果效果或泛化通过。两条通用提示仍是**未通过筛查的实验候选**。

## 固定条件与实际接入

用户对[候选](foundation-reviewer-semantic-instructions-r1-2026-09-11.md)及随后登记明确批准：GLM-5.3，最多两个独立 B24 会话；新预留 24 积分，单会话观察到 12 积分即停止并允许在途尾差；仅本批读取、使用及正常续期原 BeeGame 本机登录会话。旧批次未重开、旧额度未续用。

- 候选为 `semantic-instructions-r1`，相对基线只增加两句、345 UTF-8 字节；未加入样例答案、旧报告或评分说明。两会话输入及候选不变，初始历史为空。
- 输入摘要仍为 `0400917b5c06036cf1aef67902bd0b850727ba056c199795cbc7fe8aad98f7e1`；初始候选提示摘要为 `dcef20f3f9fa9efe20e423c208fa9115aa9d501557b56499086c5b62a648c993`。
- `semantic-candidate-runtime.ts` 仅在隔离测试进程加载时，将 lifecycle 的一个 task factory import 指向候选构造器，要求实际绑定恰好一次。没有改生产源码文件、public API、最终 schema、工具、准入、预算或正常结算/发布流程；不是通过绕过 frozen task 校验冒充候选。
- 在发送前逐份检查实际 HTTP 请求包含完整冻结候选提示及原 budget guidance 边界；五份请求都通过，后续独立核验再次确认。捕获器不改请求或响应正文。
- 使用同一项目隔离 CLI，主 bundle SHA-256 `e75e4c1e35fab0bbdac561333b144da549b58f417a579572823c1289fdfb0b87`。不使用 Mac 安装版，也没有安装、部署或重启服务。
- 53 项相关测试、完整 public lifecycle + 合成本地原生子进程的候选提示核验、TypeScript 与 diff 检查通过；这些是工程检查，不计为语义通过。最终冻结 34 个文件，含原有 22 个生产/基准文件和新增实验执行材料；两会话前后均未漂移。

## 协议、用量和认证核验

五份响应均 HTTP 200、完整 EOF 和 message_stop；原始工具参数与实际执行记录一致，全部工具 schema 未变；最终 StructuredOutput 可重新准入为同一份正式报告。两会话均只做两个计算：`18−11=7` 与 `50+420=470`，没有虚构计算调用。

case-2 第一次 StructuredOutput 的原始参数不是合法 JSON，现有 CLI 报告缺少顶层必填字段；同一原生会话正常纠错一次后交付。其第三个 HTTP 请求属于原有格式纠错流程，费用已计入 4.4000 积分；没有新增宿主语义复核回合，没有人为要求重审或补跑。

| 用量 | case-1 | case-2 |
|---|---:|---:|
| prompt tokens | 12,848 | 6,557 |
| completion tokens | 3,985 | 6,878 |
| cache read tokens | 11,520 | 30,528 |
| cache creation tokens | 0 | 0 |

原始 SSE 用量与 sealed journal、正式 recorded/debited 回执逐项一致；按事件去重，本批合计 **7,792,500 creditsMicro**。没有把两个回执字段当作两笔费用。没有触发费用、请求数、时间或生产预算保护。

两次均验证执行锁已释放、用量封存、正式结算及发布绑定；测试前后配置摘要一致，默认三个档位仍为 `ark-code-latest`。凭据只在获批基础设施路径内使用，不打印或导出。原始正文已检查不含选定模型凭据。

## 持久证据与停止边界

132 个白名单文件已逐字节摘要核对并归档到：

`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/output/reviewer-r1-semantic-glm53`

入口包括 `registration.json`、`evaluation-plan.md`、`semantic-assessment.json`（逐项人工理由及 finding 索引）、两个 `case-*/report.json`、`independent-verification.json`、`completed.json`、原始请求/SSE、正式回执、冻结提示/源码快照及 `evidence-manifest.json`。认证存储、环境文件、请求头和运行配置/缓存目录不归档。材料包含内部路径及 owner/回执标识，仅作本机证据。

旧批次 52 个证据文件再次通过摘要及错误重放核验，未覆盖历史失败。当前两次执行 claim 均已消耗，批次关闭；不补跑、不更改本批评分或结果。生产提示保持基线，不发送保留样本/真实八文档，不运行真实 Revision，不推进旧协议退役。后续若考虑新候选或新模型，需要另行决定实验方向并重新登记预算。

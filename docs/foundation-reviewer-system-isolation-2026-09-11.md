# Reviewer 系统提示隔离与日志转义修复

> 历史实验记录：本页的 PID、部署状态和费用描述属于约 06:12 的那次实验，不代表当前运行环境。其后曾回退；2026-09-11 约 07:36 已重新应用三项修复并部署独立验证门槛。当前状态见 [独立覆盖与证据验证](foundation-reviewer-independent-validation-2026-09-11.md)。

## 结果

已完成代码修改、新 CLI 的独立构建及离线验证。此后经用户批准，于 2026-09-11 北京时间约 06:12 部署并重启空闲运行时，执行了一次同输入 Reviewer-only 付费对照。工程隔离与日志修复在真实请求中生效，但语义质量仍未达标：固定核心锚点从上一轮 6/7 变为 5/7，画布高度误报保留。本轮费用 17.4318 credits，无追加运行或自动修订。下文离线结果与旧 CLI 摘要是部署前记录。

真实对照完整记录：`claude-code-main/output/reviewer-system-isolation-20260911/assessment.md`；新 run 为 `4272ce04-47e2-4120-bd89-c55ba4782727`。新版 CLI 已部署，运行时 PID 为 94774；原有 27 个 workflow、八文档和 .env.local 保持不变。

## 修改范围

1. `single-agent-prompt.ts` 新增 Reviewer 专用系统提示；native-worker 通过 `--system-prompt` 替换通用编程 persona，而非在其后追加指令。v2 自有系统提示为 1,199 字符。细粒度审计任务、八文档和需求仍作为 user 输入；不把来源内容提升为系统指令。
2. `single-agent-native-worker.ts` 的 host_turn_input 证据增加 systemPrompt 与其摘要。只修改 Reviewer 的启动方式，不修改全局 CLI 默认系统提示、其他阶段的 persona 或工具集。
3. `single-agent-prompt.ts` 清除“12 分钟”“12 个 structured actions”“宿主限制累计请求/工具数”等旧文案；明确无隐含累计时间、轮数或工具调用上限，显式 token cap 仍包含缓存用量。保留来源、报告、无进展和 StructuredOutput 失败校验，未增加次数限制或放宽校验。
4. `single-agent-evidence.ts` 不再通过 URL 对象重新序列化全部 URL。扫描在反斜杠前停止，保留普通 URL 的原始 scheme/host/path 与嵌套 JSON 的引号转义；仍删除 userinfo、清理 query 数据，并保留原有凭据值与隐藏思维脱敏。日志不改写实际请求。

没有加入固定七个问题的答案或专用检查表，没有改变报告 admission 的语义范围，也未修改原始文档或此前归档。

## 验证

- 完整 Reviewer 回归及日志单测：**212 pass / 0 fail / 1,900 assertions / 23 files**，42.94 秒。此前针对性 23 项单测和 11 项 CLI 集成检查包含在这个数量中，不重复累计。
- 根项目、agent-workflow-server、agent-workflow 三项 TypeScript 检查均通过。
- 独立正常 splitting 构建成功，共 1,274 outputs；没有清理或覆盖运行环境的 dist。
- 真实 CLI → 本地模拟 API 的所有捕获请求均含专用系统提示，不含 SearchExtraTools、auto memory、generic core tools 声明，系统文本少于 2,500 字符；v2 工具仍严格为既有 Reviewer 工具加 StructuredOutput。
- 覆盖首轮、后续轮、同会话续审、分页拒绝后完整读取、429 重试、格式重试、取消、重复无进展和禁用工具等路径。
- SVG namespace 的单层与双层序列化 JSON 均保留转义并可解析；包含未知 URL 凭据和 query 的嵌套 JSON 仍被脱敏；原始对象不变。
- 用上一轮冻结的全部八文档与确认需求构造完整新 prompt，日志脱敏前后逐字相同，编号源 JSON 可解析并还原全部原文。
- 27 个既有 workflow 状态、上一轮文档副本、用户根 .env.local 和已安装 CLI 摘要均未变化。

离线接口使用模拟响应和假凭据；通过这些检查不能推出真实模型的召回率或误报率已经改善。

## 构建与证据位置

本次工作目录：

`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/output/reviewer-system-isolation-20260911/`

- `build.ts`：独立构建脚本。
- `dist/cli.js`：待部署构建，SHA-256 `1b428dca712e7ccb2edae121485978942d5f92ba719562734096ebc2e3e384bb`。
- `verify-frozen.ts`：冻结输入与既有状态的只读比对。
- `frozen-input-verification.json`：机器校验结果。

仍安装的旧 CLI SHA-256：`ed70a2898f51cc62e01f8bbab6d9d6dc93653316471b187941f9e919fd1e25cf`。

## 真实验证方法（已执行一次）

部署新版并重启空闲运行时后，对相同冻结输入执行了一次 Reviewer-only 付费对照。所选 model、原始需求和八文档保持不变；已检查实际 system、输入完整性、上下文事件、报告交付、固定锚点命中与误报。两轮请求 alias 均为 ark-code-latest、供应商均回报 auto，底层模型无法单凭该字段确认。本轮实际 system 为 1,331 字符，含 1,199 字符专用角色提示及 CLI 固定前缀。单次结果不构成变更导致改善或退步的充分因果证明。

Reviewer-only 完成后被页面展示为“已暂停/需要处理”的映射问题仍未修复，本轮未扩展到 UI 改动。

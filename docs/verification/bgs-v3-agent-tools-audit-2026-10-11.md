# V3 1.32：按需专业工具接线审计

日期：2026-10-11。续接 1.30／1.31 主线，只改 BGS 集成和配套回归。未改正式 frontend、Claude Code 核心／builtin-tools；未改真实项目产物，未部署／重启／迁移数据库／安装引擎／调用付费模型。

## 本步结论

完整目标会话现在可以发现并调用现有资源与纯 Content 工具，不必先写八文档、进入旧生产阶段或发布手填 Task。只是提供能力入口，工作安排仍交给正常 Claude Code。完整 Content 权威／绑定、付费生图桥未接入，不制造空权威绕过；游戏发布资格继续关闭。

## 已查证缺口与修正

| 实际入口 | 输入 → 输出／写入 | 隐藏耦合／根因 | 本轮修正 |
|---|---|---|---|
| app.ts → registerV3Routes → agent-goal | 所属用户／项目／Chat、原始完整 brief → 一次正常 native turn | 新入口没有旧阶段 openCapabilities，资源脚本不会自然出现 | 传实际宿主资源服务地址；用现有 prepareTurn 加短入口说明及关闭函数，无作者标识、Task、后继派发 |
| agent-tools → project-asset-command | 宿主只读桥地址 → 项目 .beegame/tmp/goal-tools-* 下 assets.mjs | 旧命令由阶段 materialization 创建；旧媒体帮助路径不存在 | 使用现有 CLI，不改 native 工具／结果；媒体帮助指向本次实际入口 |
| openResourceLibraryAccess | 当前用户凭据＋白名单路径 → 目录／元数据／下载地址响应 | 无鉴权容易被误当空搜索；旧短地址需要正确生命周期 | 复用现有只读桥，每次取当前用户凭据；服务 token 不进入 native；未配置／错误清楚区分；退出和暂停关闭 |
| checker --format | 指定参考部分 → 当前保存参考或运行时纯格式 | 即使无需 index／资源，仍读取旧阶段创建的 content-format.json | 从现有格式抽出纯函数；缺文件才读纯参考，现有损坏文件仍报错，现有参考不覆盖。不传零哈希或空 Manifest 给 authority |
| checker 草稿布局／结构 | 实际文件＋视口 → 诊断、覆盖限制 | 算法本身已可独立使用，只缺入口 | 提供薄入口，不产生第二套 UI／Scene，不将几何执行成功判为视觉／玩法通过 |
| resources --contract | 明确请求 → 现有 Manifest 契约正文 | 帮助指向未创建的 CONTRACT.md，迫使作者探索实现或先造登记 | 新增只读契约请求，复用现有渲染器，不创建 Manifest／资源／虚假需求 |
| media／resources | 实际项目输入 → 原本生产／登记结果 | 本地制作与旧调度混在入口供应中 | 只提供现有薄入口，保留非覆盖、来源、路径、并行登记及失败反馈约束 |
| projectContentAuthority／完整绑定 | 真实设计／Manifest／版本 → 权威及绑定 | 仍聚合八文档，不能用空输入证明可用 | 不接入、不删除、不伪造；这不是纯草稿检查的前置，真实需要时单独处理 |

### 回归发现的副作用

纯格式开始进入共享 checker 后，旧 namespace Zod 引用把 64 个语言模块重新带入 bundle。定位到 scene-ui-content-authoring／content-runtime-contract 的导入，改为实际使用的具名导入。最终真实打包测试确认仅英文保留，不通过放宽测试掩盖。开发中还修正了测试对 stdout／字符串 prompt／返回 scope 的错误假设和假服务配置缺字段；都不作为成功证据，以下以冻结后结果为准。

## 修改影响与回归范围

- 模块内部：新工具入口供应与回收；验证目录链接拒绝、鉴权失败、凭据刷新、桥撤销。
- 交接：正常 sendWithDisplay 的 turnContext 包含短工具说明，完整 confirmed goal 保持最后的真实用户文本块。仍没有 directionAuthors／projectTurn／onTurnReady、宿主 Task 或自动接续；原 native 计划、委派、权限、事件和用量机制不改。
- 公共能力：纯格式／authority 分离、--format 缺参考时的只读回退、resources --contract、可指定的媒体帮助路径、Zod 依赖导入。核对旧阶段 materialization、handoff、布局、资源登记、绑定及原执行访问边界。
- 既有项目资料：不更新旧格式／CONTRACT／文档／index／Manifest；每次生成新临时入口。关闭桥，不递归删除 Agent 成果；保留薄入口用于执行溯源，不当作游戏交付包。

## 实际验证

冻结源码定向回归：19 个文件，129 通过、0 失败、2 跳过（旧 design-browser-inspection 两项需要 BGS_DESIGN_BROWSER=1，未开启）。TypeScript 全工程检查通过。未重新跑全部 V3 专项，不声称未运行部分通过。

真实 native CLI＋独立受控浏览器＋本机假模型：

- 正常目标接单、TodoWrite、专业 Skill、Question 答复、保存候选、失败测试、Read／Edit 修复、再次测试通过。
- 同一 turn 实际 Bash 调用本次 assets.mjs catalog，收到本机资源服务结果，服务观察到正确用户 Bearer；service token 未进入 native 请求。
- 同一 turn 读取 --format coordinates，无旧格式文件／八文档／index／Manifest；调用 --layout-draft menu.json 960 540，真实空间算法返回诊断，并保留 textFit 未测量、runtimeVerified=false。
- 重复接单未重跑，无宿主 Task、旧阶段后继。保留无关 notes。
- 12 次本机假模型请求；目标提示 870 字符，新增工具说明 1,311 字符。模型报告 180 Token（120 输入＋60 输出）仅是脚本合成值，不是实际费用或优化收益；付费调用 0。
- 合成单元验证资源桥在暂停／native cleanup 后失效，再释放 writer；缺凭据返回 503 而非空目录，父目录链接拒绝；有现存格式不覆盖，损坏格式不回退；缺真实 authority 仍失败。

本轮前后 src、packages/builtin-tools、apps/frontend 的文件计数和聚合哈希均一致，见配套 JSON。没有调整正式入口，没有部署。

## 未验证与下一步

- 未验证真实模型是否自主正确使用专业能力、游戏质量、成本、Unity／Godot 或真实资源库线上响应。
- 完整 Content 权威／绑定和付费生图桥尚未解耦；不要求为了开工先迁齐它们。
- 新 goal 路径的远端数据库并发仍未实测；本轮本地存储，复用原 JSON／CAS，无新表。
- 下一步按规范 §7 第 4 项：同工程自由对话／明确需求变更和中断续作最小闭环。必须保留当前成果、原生历史和暂停意图，按实际受影响版本重验；不把重新发送原 goal 当自动重跑，不增加宿主 repair plan。


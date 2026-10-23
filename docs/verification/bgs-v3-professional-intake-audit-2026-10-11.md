# V3 1.39：专业责任接入、方法解耦与 Preview 复用

日期：2026-10-11。依据 V3 1.38 第 7 节。本轮为系统实施与离线回归；不是付费游戏验收。

## 结论

- 第 1 项：接单／授权变更／续作共享八领域职责与默认八文档组织；简单工程可明确合并，按依赖渐进形成。讨论仍仅答复。没有宿主作者批次、八稿开工门禁或固定 Review 链。
- 第 2 项：默认 Preview 示例不再把临时 apiUrl 写进长期脚本，复用已有当前能力解析；同脚本跨回合和访问撤销已实测。
- 第 3 项部分：独立 debug 可只读核对现存设计／报告、当前需求与已有执行记录。**尚未把报告、执行证据和已测构建可靠关联，不能据此开放交付。**
- 没有付费调用、SQL、正常服务重启、真实测试工程修改或 Claude Code 重构。正式 frontend、Claude Code src、builtin-tools 整树指纹前后一致。

## 真实调用与修正

| 位置 | 已证实问题 | 本轮处理／边界 |
|---|---|---|
| workflow-v3/agent-goal.ts | 目标只泛称使用 Skills；变更与续作没有共享专业要求 | professionalWork 在目标、change、continue 中复用；原生 Agent 自行决定计划和委派。discuss 不带制作指令 |
| 专业 Skills | 通用审查默认旧批次／回执，部分方法默认 BGS JSON／旧 delivery 路径；技术规划一律排除原型 | 对实际选用 BGS 的场景保留契约；合并记录、DOM 与原生引擎使用真实来源，完整授权任务可作必要原型；不新增技能或第二套职责 |
| preview-test-access.ts | 示例显式写入短期 apiUrl，即使 helper 已有当前能力解析，复用脚本仍可能过期 | 默认示例省略地址；优先解释真实 gameFrame，保留 frame 兼容与显式 apiUrl；没有修改浏览器权限、resolver 或原生循环 |
| workflow-v3/debug.html／debug-client.js | 自主会话的设计／报告没有方便的只读核对入口，旧 Task 来源索引不能充当它的证据 | 复用 artifact-index／artifacts API；显示当前需求／变更、文本指纹和既有原生回合记录。缺失读取清除旧响应，读取不派发或写项目 |
| app.ts::readBeeGameProjectArtifact | 项目内链接指向项目外时，词法路径检查仍返回 200 | 合成文件复现后核对 realpath，并读取检查后的目标；项目外返回 400，项目内合法链接仍可读 |

debug 文本指纹只标识本次返回的 UTF-8 文本，不是全部源字节／构建哈希，不证明历史报告对应当前版本。执行中来源仍可变化，界面保留 writerActive 与未验证说明；没有新增证据协议、数据库表或语义判断器。现有共享 API 边界修正同样影响旧产物读取，不改变返回结构。

## Skills 核对

使用 skill-creator 的范围与渐进披露原则，只修改真实冲突条款；没有把 V3 的八领域业务责任再写进每个 Skill。

| 方法 | 处理 |
|---|---|
| game-design-check | 文档名作为专业主题；接受合并记录；旧 batch／handoff／receipt／review-layouts 仅在实际提供时使用；不再宣称宿主负责通用语义放行 |
| gameplay-programmer | 区分文档-only 与完整实现授权，不禁止后者用小原型验证技术风险 |
| game-implementation-planning／game-plan-execution | 保留实际内容权威与依赖，不把 JSON/YAML 或另一套布局作为所有项目的前提 |
| game-ui-ux-designer／game-level-designer-expert | 保留几何、覆盖、反馈与美术要求；BGS 算法／game-view／旧路径限定到实际 BGS 数据 |
| game-balance-designer-expert | 计算来自真实规则；缺旧 calculation 入口不要求生成旧 delivery 包，正常项目计算／测试可用 |
| game-content-pipeline-engineer | 服从当前工程实际数据格式，资源用途包含字体与程序化视觉／音频 |
| game-creative-director-expert／game-systems-designer-expert／game-art-director-expert／game-audio-designer | 核读后保留；已允许按真实问题选择方法，没有必要为了本轮改名或重写 |

8 个 Skill 入口及 game-design-check 的一份参考有本轮修改。原有不相关修改保持，不能把整个 git diff 当作本轮产出。原生 plugin loader、调用生命周期和目录发现不变；已读方法不要求每次 Edit 重载。格式校验不是语义／实际使用验收。

## 回归证据

最终冻结源码命令：在集成工作树执行 `BEEGAME_TEST_REAL_BROWSER=1 bun test`，参数为下列 14 文件。结果 **62 pass、0 fail、605 expects，31.45 秒**。前期分批结果与此重叠，不重复累计。

```text
packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/agent-tools.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/routes-discovery.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/debug-page.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/context-content.test.ts
packages/agent-workflow-server/src/beegame/preview-test-access.test.ts
packages/agent-workflow-server/src/beegame/project-execution-access.test.ts
packages/agent-workflow-server/src/beegame/project-preview-capability.test.ts
packages/agent-workflow-server/src/beegame/native-skill-plugins.test.ts
packages/beegame-skills-core/src/__tests__/store.test.ts
packages/agent-workflow-server/src/beegame/shared-playwright.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/agent-goal-native.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/debug-browser.test.ts
packages/agent-workflow-server/src/beegame/workflow-v3/debug-question.test.ts
```

关键反例／观察：

- 接单原始 brief、引擎／语言／资源策略保留；没有宿主 Task、计划批次或自动接续。
- 专业责任实际送入原生请求，数值与资源可定位；合并 README 的合成工程未因文件数不足被拒绝。假模型不会证明专业设计真的完整。
- 独立 debug → 正常 BGS API → 实际 CLI → 仅本机受控 provider；五个回合、25 个固定响应请求。真实 Todo／Skill／Question、文件编辑、失败测试与修正、实际浏览器观察均走正常工具。
- discussion 不改需求；change 更新实际规则及消费者并重测；中断保留成果，显式 continue 使用同一 native UUID，不重发原始 goal；重复请求不二次执行。
- 同一 Node 脚本在两个新能力回合中通过真实 gameFrame 读取不同页面；撤销后 PREVIEW_CAPABILITY_EXPIRED，其他工作区 PREVIEW_CAPABILITY_MISMATCH，旧端点不可用。显式 apiUrl 的现有测试继续通过，成功／失败均清理测试上下文。
- debug 读取缺失报告返回 404，旧响应清空；需求更新后显示新版本，无关 README 指纹不变，但仍 unverified，不把旧文档当新验收。
- 产物读取链接逃逸修复前 200（回归失败），修复后 400；合法项目内链接返回原内容。没有使用真实秘密测试。
- 既有 debug 编辑／Question／拒绝／暂停／恢复／Review／导出兼容回归通过；只是合成旧入口兼容，不升级为自主交付已接通。

类型检查：工作树根目录 `./node_modules/.bin/tsc --noEmit` 退出 0。第一次误用包内 tsconfig，缺根 paths 映射而产生大量 src 别名错误；改用项目正常根配置验证，没有改源码或类型配置掩盖错误。

8 个修改后的 Skill 均运行 skill-creator 的 quick_validate.py 通过；BGS 技能目录、加载及用户隔离回归同时通过。JS 语法与改动空白检查通过。

最初沙箱内回环服务绑定失败产生 EADDRINUSE／后继失败，不能当作系统缺陷；同一代码获准在可绑定回环端口的环境复验。所有 provider 指向本机假模型，paidModelCalls=0。该模型用量是固定测试数据，不能当作真实成本或节省比例。

## 用量与未完成边界

- 排除用户原文，目标指令由 487 增至 1,944 字符（增加 1,457），变更指令 2,215 字符，讨论 181 字符；这些是字符，不是模型 Token。必要专业责任有输入成本，不能称“首轮输入更低”。
- 没有预载八文档正文、完整 Skills 或增加模型审计／总结回合。修正的是已证实的入口试错与重复维护诱因，是否减少总请求、长上下文往返及费用仍未真实测量。
- 本轮合成目标完整 prompt 2,327 字符，按需工具上下文 1,648 字符；不代表真实项目原生系统上下文或总 Token。
- 接单是否实际遵守八领域、专业判断质量、审查漏检、模型是否合理委派均仍有风险。不能用加了职责、加载 Skill 或更多测试证明这些问题已解决。
- 第 3–4 项仍需把实际报告／执行与对应构建接起来；现有 Task-only 已测 Preview／导出不能用空壳 Task 或 PASS 绕过。独立 debug 当前只提供人工核对所需材料。
- 正常服务未重启；本轮验证使用源码启动的临时服务，未声称已部署到现有运行服务。没有修改原生 CLI 源码，因此未重建 CLI。
- 下一步按真实现有报告／构建消费者做最小关联与对应回归；真实模型／成本测试须另获授权，不自动付费重跑。

## 保护目录

以下 SHA-256 由排序后的相对路径、链接目标与文件字节计算；排除 node_modules、.git。前后值一致：

```json
{
  "apps/frontend": "5e5471a61fdd7342285d2e2b49c7c216beb447289747c272c9c58a807c20057a",
  "src": "2739b640c38d40aded62fbc28f518a6069fbbb41ba686c26f7b78b16bef06ad6",
  "packages/builtin-tools": "a3c386e4289091b3935d8b66310d906d2eaf604b419c65f5666c4163b0cd1531"
}
```

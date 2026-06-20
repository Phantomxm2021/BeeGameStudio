# Web Dashboard 替代 CLI/TUI 交互设计

> 状态：草案（待用户 review 后进入 implementation plan）
> 日期：2026-06-21
> 范围：把 Web dashboard 作为主交互入口，CLI/TUI 降级为兼容与 worker 层

---

## 1. 背景与现状

当前项目仍以 CLI/TUI 为主入口：

- `src/entrypoints/cli.tsx` 与 `src/main.tsx` 负责启动、参数解析、命令注册和 REPL 分发。
- `src/screens/REPL.tsx` 是主要用户界面，承担输入、消息显示、权限确认、计划审批、斜杠命令等交互。
- `src/QueryEngine.ts` 已经抽出了无 UI 的会话编排能力，可被 REPL、SDK、ACP 等入口复用。
- `packages/remote-control-server/` 已有 Hono 后端、React/Vite Web UI、session/event/permission 通道，但当前定位是远程控制已有 CLI session，而不是自己拥有完整产品工作流。
- `packages/workflow-engine/` 已有 phase、agent、parallel、pipeline、journal、resume、budget、concurrency，适合承接长流程作业。

目标是把 Web dashboard 升级为主产品入口：用户不再需要在终端 REPL 中完成日常操作，而是在浏览器中配置模型、创建项目、输入 idea、观察 agent 流程、审批权限、查看文档/代码/预览。

## 2. 目标与非目标

**目标**

1. Web dashboard 成为主交互入口，覆盖核心 CLI/TUI 工作流。
2. CLI/TUI 不立即删除，先降级为兼容入口、调试入口和可选 worker。
3. RCS 后端从 remote-control server 扩展为 dashboard application server。
4. 支持第三方 LLM 配置：provider、base URL、API key、fast/balanced/strong 模型映射。
5. 支持 project/run/artifact 数据模型，为游戏生成流程提供稳定承载。
6. 支持从一个 game idea 启动 workflow：生成 GDD、技术设计、实现计划、代码、测试结果和预览。
7. 保留多平台扩展点，不把业务逻辑绑定到 Web、Unity 或 Godot。第一期可默认生成 Web/HTML5 游戏以获得最快预览闭环。

**非目标**

- 不在第一期删除 `src/screens/REPL.tsx` 或大规模重写 `src/main.tsx`。
- 不把游戏业务硬编码进 `QueryEngine`、工具执行器或 provider 共享层。
- 不使用关键词、正则或固定文案判断 agent 产物状态；状态由 schema、事件类型和 workflow 阶段驱动。
- 不在第一期实现完整多租户 SaaS。默认本地单用户优先，但数据模型保留 owner/workspace 字段扩展点。
- 不在第一期实现所有斜杠命令的 Web 等价 UI。先迁移主路径命令和必要配置。

## 3. 推荐方案

采用中等改造路线：**Web-first dashboard + headless runtime**。

RCS Web UI 变成主应用，RCS 后端拥有 project/run/artifact/model config。Agent 执行仍复用现有 `QueryEngine` 与 `workflow-engine`。CLI/TUI 不再作为主入口，但保留用于：

- 兼容老用户；
- 本地调试；
- 作为短期 headless worker 进程；
- 承接尚未迁移到 Web 的长尾命令。

这条路线避免直接撕掉 REPL 导致启动、权限、会话恢复、斜杠命令、MCP、provider 配置同时失稳。

## 4. 产品信息架构

第一期 dashboard 页面：

| 页面 | 职责 |
|---|---|
| Projects | 项目列表、最近 runs、状态、创建入口 |
| New Game | 输入 idea，选择目标平台、模型配置、项目目录 |
| Run Detail | 主工作台：阶段进度、事件流、聊天、权限审批 |
| Documents | GDD、技术设计、任务拆解、测试报告 |
| Files | 生成代码、diff、重要文件浏览 |
| Preview | 游戏预览 iframe 或 build URL |
| Models | 第三方 LLM provider/base URL/API key/model 映射 |
| Agents | 查看和配置 designer/implementer/qa 等 agent |
| Integrations | MCP、外部工具、环境连接 |
| Settings | workspace、权限模式、sandbox、默认路径 |

第一期可以把 Documents/Files/Preview 做成 Run Detail 内的 tabs，避免导航过深。

## 5. 后端模块

在 `packages/remote-control-server/src/` 下新增 dashboard 业务模块：

| 模块 | 职责 |
|---|---|
| `services/model-config.ts` | provider 配置 CRUD、mask、默认选择、测试连接 |
| `services/projects.ts` | project 创建、列表、状态 |
| `services/runs.ts` | game generation run 生命周期 |
| `services/artifacts.ts` | 文档、代码、构建结果、预览 URL 索引 |
| `services/workflow-runner.ts` | RCS 到 workflow-engine/QueryEngine 的桥 |
| `routes/web/model-configs.ts` | Web Model Settings API |
| `routes/web/projects.ts` | Project API |
| `routes/web/runs.ts` | Run API 与 SSE |
| `routes/web/artifacts.ts` | Artifact API |

第一期仍可用内存 store 加 JSON 文件持久化；如果需要可靠恢复，再引入 SQLite。不要把 API key 明文返回给前端。

## 6. 数据模型

```ts
type ModelProviderKind =
  | 'anthropic-compatible'
  | 'openai-compatible'
  | 'gemini'
  | 'grok'

type LlmProviderConfig = {
  id: string
  ownerId: string
  name: string
  provider: ModelProviderKind
  baseUrl?: string
  apiKeyRef: string
  models: {
    fast?: string
    balanced?: string
    strong?: string
  }
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

type GameProject = {
  id: string
  ownerId: string
  name: string
  idea: string
  targetPlatform: 'web' | 'unity' | 'godot' | 'custom'
  workspacePath: string
  status: 'draft' | 'running' | 'ready' | 'failed' | 'archived'
  createdAt: string
  updatedAt: string
}

type GameRun = {
  id: string
  projectId: string
  modelConfigId: string
  status: 'queued' | 'running' | 'requires_action' | 'completed' | 'failed' | 'canceled'
  currentPhase?: string
  phases: Array<{
    id: string
    title: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  }>
  createdAt: string
  updatedAt: string
}

type Artifact = {
  id: string
  projectId: string
  runId: string
  kind: 'gdd' | 'tech_design' | 'implementation_plan' | 'source_file' | 'test_report' | 'preview'
  title: string
  path?: string
  url?: string
  mimeType?: string
  createdAt: string
}
```

`ownerId` 第一阶段可固定为本地用户或现有 UUID，后续多用户时不改表意。

## 7. Model Settings 设计

Web dashboard 替代 TUI `/login`，支持以下配置：

- Provider 类型：Anthropic Compatible、OpenAI Compatible、Gemini、Grok。
- Base URL。
- API Key。
- Fast/Balanced/Strong 模型映射。
- 默认配置选择。
- Test Connection。
- Masked display：前端只能看到截断后的 key。

运行 workflow 时，`workflow-runner` 将默认 `LlmProviderConfig` 转成现有 runtime 语义：

| Provider | Runtime 设置 |
|---|---|
| Anthropic Compatible | `modelType: 'anthropic'`，`ANTHROPIC_BASE_URL`，`ANTHROPIC_AUTH_TOKEN`，`ANTHROPIC_DEFAULT_*_MODEL` |
| OpenAI Compatible | `modelType: 'openai'`，`OPENAI_BASE_URL`，`OPENAI_API_KEY`，`OPENAI_DEFAULT_*_MODEL` |
| Gemini | `modelType: 'gemini'`，`GEMINI_BASE_URL`，`GEMINI_API_KEY`，`GEMINI_DEFAULT_*_MODEL` |
| Grok | `modelType: 'grok'`，Grok provider 当前支持的 base/model/key env |

如果 runtime 内复用 OpenAI client，保存 OpenAI 配置后必须清理 `clearOpenAIClientCache()`，避免旧 key/base URL 污染下一次请求。

## 8. Game Generation Workflow

第一期 workflow 固定为可观察状态机：

1. `Idea Intake`：归纳用户 idea，生成项目 brief。
2. `GDD`：生成 Game Design Document。
3. `Technical Design`：生成技术设计、目录结构、target platform 约束。
4. `Implementation Plan`：拆解任务，列出可验证步骤。
5. `Implementation`：写代码、资源占位、项目配置。
6. `Build/Test`：运行构建和测试，收集报告。
7. `Preview`：生成或发现可预览地址。
8. `Iteration`：基于测试/预览结果修复问题，最多执行有限轮。

每个阶段产生结构化事件：

```ts
type RunEvent =
  | { type: 'phase_started'; runId: string; phase: string }
  | { type: 'phase_completed'; runId: string; phase: string }
  | { type: 'artifact_created'; runId: string; artifactId: string }
  | { type: 'tool_started'; runId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool_completed'; runId: string; toolName: string; resultSummary: string }
  | { type: 'permission_requested'; runId: string; requestId: string }
  | { type: 'run_failed'; runId: string; message: string }
  | { type: 'run_completed'; runId: string }
```

前端只消费事件类型和 artifact 索引，不解析 agent 文本来判断状态。

## 9. Agent 边界

新增 game-specific agent 定义，不改共享层：

| Agent | 职责 |
|---|---|
| `game-producer` | 管理阶段、做取舍、汇总状态 |
| `game-designer` | GDD、核心循环、关卡、数值、体验 |
| `tech-designer` | 技术设计、目录结构、平台约束 |
| `game-implementer` | 代码实现 |
| `qa-playtester` | 构建、测试、可玩性检查、缺陷报告 |

Agent 输出通过 schema 或明确 artifact 写入约定交付。不要在工具或共享逻辑中硬编码某个测试 idea、项目名、日志内容或 fixture 文案。

## 10. UI 设计原则

遵循 `.impeccable.md`：

- 温暖、克制、技术工作台风格。
- 避免营销式 hero 和泛 AI 渐变。
- 信息密度足够，但层级清楚。
- 使用 Claude orange 作为主品牌线索。
- Run Detail 是工作台，不是聊天页复制品。

Run Detail 推荐三栏：

```text
左：阶段 / runs / agents
中：事件流 + 对话输入
右：Artifacts / Permissions / Preview
```

移动端可折叠为 tabs。

## 11. CLI/TUI 迁移策略

分三步：

1. **保留**：CLI/TUI 原样可用，Web dashboard 先复用远程控制能力。
2. **降级**：新增 headless worker 启动路径，dashboard 创建 run 时不需要用户打开 REPL。
3. **隐藏**：文档和默认命令指向 dashboard，CLI/TUI 标记为 compatibility/debug。

不要第一期删除 REPL。删除条件：

- Web 已覆盖模型配置、会话创建、消息输入、权限审批、计划审批、artifact 浏览、MCP 基础配置。
- headless worker 可稳定恢复中断 run。
- typecheck/build/test 覆盖核心路径。

## 12. 权限与安全

- API key 不明文返回前端。
- 权限审批保持按 tool invocation 维度，不做全局无提示放行。
- Web 操作权限与现有 `canUseTool` 语义对齐。
- 本地单用户模式仍需要 CSRF/UUID/token 的基本保护。
- Run 写文件只能写入 project workspace，不允许从 Web 请求任意路径写入。

## 13. 测试策略

后端：

- model config CRUD、mask、default selection。
- provider config 到 runtime env/settings 的映射。
- project/run/artifact store。
- run event reducer。
- permission request/response flow。

前端：

- Model Settings 表单校验。
- New Game 创建 run。
- Run Detail 接收 SSE 并更新阶段。
- Artifact tabs 渲染。
- Permission panel approve/reject。

集成：

- 用 mock AgentAdapter 跑完整 idea → artifacts workflow。
- 用真实文件系统临时目录验证 artifact path 不越界。
- 至少跑 `bun run typecheck` 和相关 `bun test`。

## 14. 第一阶段实施切片

MVP 只交付一个闭环：

1. Web Model Settings 可保存一个 OpenAI-compatible 或 Anthropic-compatible 配置。
2. Web New Game 可输入 idea 并创建 project/run。
3. workflow 生成三个文档 artifact：`GDD.md`、`TECH_DESIGN.md`、`IMPLEMENTATION_PLAN.md`。
4. Run Detail 展示阶段进度和 artifact 列表。
5. 代码实现阶段先生成 Web/HTML5 游戏项目。
6. 后端运行 build/test，Preview tab 展示可访问 URL 或失败报告。

## 15. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 直接删除 TUI 导致大面积回归 | 先 Web-first，TUI 兼容保留 |
| RCS 当前 store 是内存 | 第一阶段可接受；进入稳定版前加文件/SQLite 持久化 |
| API key 存储不安全 | keyRef + masked response；本地 MVP 也不明文返回 |
| provider 配置污染进程缓存 | 保存后清理 provider client cache；run 级 env 隔离 |
| workflow 输出不可控 | schema + artifact contract，不解析自然语言 |
| 平台绑定 | `targetPlatform` 数据字段保留多平台，第一期默认 web |

## 16. 第一阶段默认决策

1. 第一版按本地单用户实现，`ownerId` 固定映射到现有 Web UUID，数据模型保留多用户扩展点。
2. API key 第一版使用受限权限文件或本地加密文件保存，所有 Web API 响应只返回 masked value；系统 keychain 作为后续增强。
3. 第一版默认生成 Web/HTML5 游戏以完成预览闭环，但所有业务数据使用 `targetPlatform`，不在共享逻辑中绑定 Web。
4. 保留现有 RCS remote-control 能力，并把它收进新 Dashboard 的 Sessions/Workers 区域；不维护两套无关 Web UI。

# BGS

[![GitHub Stars](https://img.shields.io/github/stars/Phantomxm2021/BeeGameStudio?style=flat-square&logo=github&color=yellow)](https://github.com/Phantomxm2021/BeeGameStudio/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/Phantomxm2021/BeeGameStudio?style=flat-square&color=green)](https://github.com/Phantomxm2021/BeeGameStudio/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/Phantomxm2021/BeeGameStudio?style=flat-square&color=orange)](https://github.com/Phantomxm2021/BeeGameStudio/issues)
[Source and third-party notices](./NOTICE.md)
[![Last Commit](https://img.shields.io/github/last-commit/Phantomxm2021/BeeGameStudio?style=flat-square&color=blue)](https://github.com/Phantomxm2021/BeeGameStudio/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord)](https://discord.gg/uApuzJWGKX)

> BGS — PhantomLab 的 AI 游戏开发工作台。

BGS（BeeGameStudio）由 PhantomLab 开发和维护。本仓库基于 [claude-code-best/claude-code](https://github.com/claude-code-best/claude-code) 扩展，不是 Anthropic 官方产品。上游代码及第三方组件的来源、版权与许可证声明保留；BGS 的产品品牌不改变这些代码的权利归属。

[Peri Code](https://github.com/KonghaYao/peri)：Claude Code 兼容的 Rust Agent，多年大模型经验匠心制作，国内大模型（DeepSeek/GLM）精调，CPU/内存极致优化，在开发版/树莓派上也能跑 CC 一样的体验。

[本地文档](./docs/) | [留影文档在这里](./Friends.md) | [Discord 群组，群主在线答疑](https://discord.gg/uApuzJWGKX)

| 特性                        | 说明                                                                                                                         | 文档                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **BGS 群控技术**         | Pipe IPC 多实例协作：同机 main/sub 自动编排 + LAN 跨机器零配置发现与通讯，`/pipes` 选择面板 + `Shift+↓` 交互 + 消息广播路由 | [Pipe IPC](./docs/features/uds-inbox.md) / [LAN](./docs/features/lan-pipes.md)                |
| **ACP 协议一等一支持**      | 支持接入 Zed、Cursor 等 IDE，支持会话恢复、Skills、权限桥接                                                                  | [文档](./docs/features/acp-zed.md)                                                                                  |
| **Remote Control 私有部署** | Docker 自托管远程界面, 可以手机上看 CC                                                                                       | [文档](./docs/features/remote-control-self-hosting.md)                                                              |
| **Langfuse 监控**           | 企业级 Agent 监控, 可以清晰看到每次 agent loop 细节, 可以一键转化为数据集                                                    | [文档](./docs/features/langfuse-monitoring.md)                                                                      |
| **Web Search**              | 内置网页搜索工具, 支持 bing 和 brave 搜索                                                                                    | [文档](./docs/features/web-browser-tool.md)                                                                         |
| **Poor Mode**               | 穷鬼模式，关闭记忆提取和键入建议,大幅度减少并发请求                                                                          | /poor 可以开关                                                                                                                            |
| **Channels 频道通知**       | MCP 服务器推送外部消息到会话（飞书/Slack/Discord/微信等），`--channels plugin:name@marketplace` 启用                         | [文档](./docs/features/channels.md)                                                                                 |
| **自定义模型供应商**        | OpenAI/Anthropic/Gemini/Grok 兼容  (`/login`)                                                                                          | [文档](./docs/features/all-features-guide.md)                                                                        |
| Voice Mode                  | 语音输入，支持豆包语言输入（`/voice doubao`）                                                                   | [文档](./docs/features/voice-mode.md)                                                                               |
| Computer Use                | 屏幕截图、键鼠控制                                                                                                           | [文档](./docs/features/computer-use.md)                                                                             |
| Chrome Use                  | 浏览器自动化、表单填写、数据抓取                                                                                             | [自托管](./docs/features/chrome-use-mcp.md) [原生版](./docs/features/claude-in-chrome-mcp.md) |
| Sentry                      | 企业级错误追踪                                                                                                               | [文档](./docs/internals/sentry-setup.mdx)                                                                            |
| GrowthBook                  | 企业级特性开关                                                                                                               | [文档](./docs/internals/growthbook-adapter.mdx)                                                                      |
| /dream 记忆整理             | 自动整理和优化记忆文件                                                                                                       | [文档](./docs/features/auto-dream.md)                                                                               |

- 🚀 [想要启动项目](#-快速开始源码版)
- 🐛 [想要调试项目](#vs-code-调试)
- 📖 [想要学习项目](#teach-me-学习项目)

## 安装与更新

公开 npm 发布身份尚未核实；当前使用下方的源码启动方式。若使用维护者提供的发行包，按该发行渠道的说明安装和更新，不运行未实现的 CLI 自更新命令。

发行包的入口为 `bee-game-studio`（Node.js）和 `bee-game-studio-bun`（Bun）。`ccb`／`ccb-bun` 仅保留为已有用户的兼容别名。

远程控制服务地址与令牌由部署者提供；本仓库不承诺存在公共 BGS 远程服务，不提供猜测生成的域名或示例认证令牌。

维护者打包使用 `bun run release:pack --output /path/to/output`：在临时目录构建一个新版本，只打包该版本、安装脚本与已声明的版权说明。不会清空运行中的 `dist`，也不会打包其历史版本。检查生成的 `.tgz` 后才可显式发布；直接从开发工作区 `npm pack`／`npm publish` 会被拒绝。该命令不代表已完成整体许可证核验。

## ⚡ 快速开始(源码版)

### ⚙️ 环境要求

一定要最新版本的 bun 啊, 不然一堆奇奇怪怪的 BUG!!! bun upgrade!!!

- 📦 [Bun](https://bun.sh/) >= 1.3.11

**安装 Bun：**

```bash
# Linux 和 macOS
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

**安装后的操作：**

1. **让当前终端识别 `bun` 命令**

   安装脚本会把 `~/.bun/bin` 写入对应的 shell 配置文件。macOS 默认 zsh 环境通常会看到：

   ```text
   Added "~/.bun/bin" to $PATH in "~/.zshrc"
   ```

   可以按安装脚本提示重启当前 shell：

   ```bash
   exec /bin/zsh
   ```

   如果你使用 bash，重新加载 bash 配置：

   ```bash
   source ~/.bashrc
   ```

   Windows PowerShell 用户关闭并重新打开 PowerShell 即可。

2. **验证 Bun 是否可用**

   ```bash
   bun --help
   bun --version
   ```

3. **如果已经安装过 Bun，更新到最新版本**

   ```bash
   bun upgrade
   ```

- ⚙️ 常规的配置 CC 的方式, 各大提供商都有自己的配置方式

### 📍 命令执行位置

- 安装或检查 Bun 的命令可以在任意目录执行：
  `curl -fsSL https://bun.sh/install | bash`、`bun --help`、`bun --version`、`bun upgrade`
- 安装本项目依赖、启动开发模式、构建项目时，必须先进入本仓库根目录，也就是包含 `package.json` 的目录。

### 📥 安装

```bash
cd /path/to/claude-code
bun install
```

### ▶️ 运行

```bash
# 开发模式, 看到版本号 888 说明就是对了
bun run dev

# 构建
bun run build
```

构建采用 code splitting 多文件打包（`build.ts`），每个版本保存在 `dist/build-*`，`dist/cli.js` 指向当前版本。旧版本保留供运行中的进程使用，不属于发行包。备用 Vite 构建位于 `dist-vite`，不清空默认运行目录。

构建版本提供 Bun 和 Node 启动入口。私有源发布须使用上面的独立发行包流程。

如果遇到 bug 请直接提一个 issues, 我们优先解决

### 🐝 BeeGame 本地验证

BeeGame Web UI、runtime host、billing backend、skills backend 可以一条命令一起启动：

```bash
npm run beegame:dev
```

默认地址：

- Frontend: `http://127.0.0.1:62173`
- Runtime host: `http://127.0.0.1:62174`
- Billing backend: `http://127.0.0.1:62175`
- Skills backend: `http://127.0.0.1:62176`
- Resource backend: `http://127.0.0.1:62177`

该命令会自动注入本地服务地址：

- runtime 使用 `BEEGAME_BILLING_MODE=remote`
- runtime 连接 `http://127.0.0.1:62175` 的 billing backend
- runtime 连接 `http://127.0.0.1:62176` 的 skills backend
- frontend 指向本地 runtime host

如果端口被占用，脚本会在默认端口后面自动寻找可用端口，并把最终端口同步写入各子进程环境变量。需要手动指定端口时：

```bash
npm run beegame:dev -- \
  --frontend-port 62173 \
  --runtime-port 62174 \
  --billing-port 62175 \
  --skills-port 62176 \
  --resources-port 62177
```

只调试单个服务时仍可使用：

```bash
npm run dashboard:dev
npm run billing:dev
npm run skills:dev
```

### Shared runtime authority

The shared runtime under `src/` and the upstream-shared packages is generated
from the pinned snapshot recorded in
[`config/upstream-core-alignment.json`](config/upstream-core-alignment.json).
Bee Game Studio business behavior belongs in `apps/`,
`packages/agent-workflow*`, or `packages/beegame-*`; do not patch the
synchronized runtime to add product workflow, watchdog, prompt, permission, or
storage policy.

Before merging a core-related change, run:

```bash
bun run core:audit -- --upstream /absolute/path/to/the-pinned-checkout
```

Ordinary synchronized files should have `0 differences`. Files explicitly
listed in `rootExceptions` require a manual upstream merge: `core:sync` preserves
them, while `core:audit` still reports their differences (and remains nonzero
until those differences are resolved). An exception is not evidence of upstream
alignment. Deliberate upstream upgrades require a reviewed pin change in the
manifest. Product-identity substitutions and manual-merge exceptions must also be
declared there. The runtime configuration directory uses the single key
`BEEGAME_CONFIG_DIR`; do not add a legacy fallback or a second configuration
root.

内部运行配置使用 BGS 命名：

| 配置 | 名称 |
| --- | --- |
| 默认模型档位 | `BGS_DEFAULT_FAST_MODEL`、`BGS_DEFAULT_BALANCED_MODEL`、`BGS_DEFAULT_STRONG_MODEL` |
| 模型名称、描述及能力 | 上述变量的 `_NAME`、`_DESCRIPTION`、`_SUPPORTED_CAPABILITIES` |
| 供应商与云平台开关 | `BGS_USE_OPENAI/GEMINI/GROK/BEDROCK/VERTEX/FOUNDRY`（六个独立变量） |
| 简化模式 | `BGS_SIMPLE` |
| 禁用自动记忆／非必要流量 | `BGS_DISABLE_AUTO_MEMORY`、`BGS_DISABLE_NONESSENTIAL_TRAFFIC` |
| 工具子进程凭据隔离 | `BGS_SUBPROCESS_ENV_SCRUB` |
| 宿主保留模型路由／跳过 Chrome MCP 安装 | `BGS_PROVIDER_MANAGED_BY_HOST`、`BGS_SKIP_CHROME_MCP_SETUP` |
| API Unix Socket 通道 | `BGS_API_UNIX_SOCKET` |
| 远程 SSE／Cowork 插件／原生搜索／PowerShell | `BGS_USE_CCR_V2`、`BGS_USE_COWORK_PLUGINS`、`BGS_USE_NATIVE_FILE_SEARCH`、`BGS_USE_POWERSHELL_TOOL` |

原生旧名仅在 CLI 启动、设置及宿主配置入口转换，已有配置不必立即迁移；同一输入同时含新旧名时，新名优先（包括空值及 `0`）。API 凭据、OAuth、外部服务地址及真实模型 ID 不随品牌改名。此变更不改写现有用户配置文件，也不改变第三方版权声明。

独立面板在启动 CLI 前加载私有环境文件，继承供应商运行环境、认证及代理地址，不把凭据或带凭据的端点写进面板命令；加载时暂时关闭 Shell 跟踪，随后恢复。仅使用文件配置时原生 `--settings` 路径保持不变；若存在显式内联配置，只在原配置根目录写入私密的 flag-settings 副本，合并文件与内联内容，不复制整份会话 settings，不改变相对权限／Hook 路径基准。配置根目录不可写时会明确失败，不悄悄丢弃配置。POSIX 临时目录权限为 `0700`、文件为 `0600`（Windows ACL 尚未验证）。启动或关闭失败保留追踪与私密文件；确认面板关闭后才清理文件，清理失败可重试且不会重复杀进程。团队删除同样关闭空闲面板；工作树只通过 Git 删除已注册且干净的目录，不递归删除无法核实的路径。Windows 启动超时保留启动身份，关闭重试核对身份以降低 PID 复用造成误杀的风险。退出清理失败／超时会提示，强制杀死父进程仍可能留下私有文件。Windows 与真实 SSH 场景尚需平台实测，合成测试不代表该边界已验证。

普通提示词及非 Anthropic 兼容供应商路径使用 BGS／PhantomLab 身份；真实 Anthropic 系列服务保留服务敏感前缀，API、认证和版权声明不伪装为自有服务。

宿主管理路由时，settings 的 `modelType`、Unix socket、mTLS 与 TLS 配置不能覆盖宿主选择。独立面板先清除已知旧供应商开关，再加载父会话的私有环境；保留 `--setting-sources`（包括空值）、开发运行时 define／feature 参数，显式内联 Agent 可通过 `--agents @file` 私密交接。团队成员修改使用现有跨进程文件锁和原子替换，登记失败回收已启动成员，启动中取消不返回成功。新成员记录保存实际 socket、私有文件位置及 Windows 启动指纹（不保存凭据或编码命令）；缺少回收定位的旧记录不会猜测删除目标，会保留记录并报告失败。强制退出前尚未完成登记的启动、Windows 真实进程树与文件 ACL、真实 SSH 仍未完整实测，不能据合成测试承诺无残留。本轮未重启服务或发布构建。

`/feedback`／`/bug` 暂只显示不可用提示：当前没有 BGS 反馈接收服务，不收集或上传报告／会话，也不调用模型生成反馈标题。此处不改变其他第三方功能的真实服务名称与协议。

### 🐝 BeeGame SaaS 首次部署

BeeGame Web Dashboard 的 SaaS 部署使用 Supabase Auth/RLS。首次部署时不要求数据库里已经有用户账号；推荐流程是先预置平台 owner 邮箱，再让 owner 用同一个邮箱正常注册或登录。

1. 在 Supabase SQL Editor 执行最新的 [`docs/beegame-supabase-schema.sql`](docs/beegame-supabase-schema.sql)。
2. 在可信任的部署机器上执行一次 owner bootstrap：

   ```bash
   BEEGAME_BOOTSTRAP_OWNER_EMAILS=owner@example.com \
   BEEGAME_SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key \
   bun run supabase:bootstrap-owner
   ```

3. 打开 BeeGame 前端，用 `BEEGAME_BOOTSTRAP_OWNER_EMAILS` 里的邮箱注册或登录。
4. 系统会在用户创建或读取当前用户权限时领取 owner invite，并授予平台 owner 权限。
5. owner 进入系统设置的平台页配置平台默认模型、搜索、运行时等全局配置。

`BEEGAME_SUPABASE_SERVICE_ROLE_KEY` 只能放在可信服务端边界内：一次性部署 bootstrap 命令，或 `BEEGAME_BILLING_MODE=server` 的远端 billing backend。不要把 service-role key 放进前端构建、dashboard dev server、用户本地客户端，或 `BEEGAME_BILLING_MODE=remote` 的本地 runtime host。

如果 owner 邮箱已经先注册过，再补跑 `supabase:bootstrap-owner`，让该用户重新登录或刷新页面即可领取 owner invite。更完整的上线检查见 [`docs/beegame-saas-preflight.md`](docs/beegame-saas-preflight.md)。

### 👤 新人配置 /login

首次运行后，在 REPL 中输入 `/login` 命令进入登录配置界面，选择 **Anthropic Compatible** 即可对接第三方 API 兼容服务（无需 Anthropic 官方账号）。
选择 OpenAI 和 Gemini 对应的栏目都是支持相应协议的

需要填写的字段：

| 📌 字段      | 📝 说明       | 💡 示例                      |
| ------------ | ------------- | ---------------------------- |
| Base URL     | API 服务地址  | `https://api.example.com/v1` |
| API Key      | 认证密钥      | `sk-xxx`                     |
| Haiku Model  | 快速模型 ID   | `claude-haiku-4-5-20251001`  |
| Sonnet Model | 均衡模型 ID   | `claude-sonnet-4-6`          |
| Opus Model   | 高性能模型 ID | `claude-opus-4-6`            |

- ⌨️ **Tab / Shift+Tab** 切换字段，**Enter** 确认并跳到下一个，最后一个字段按 Enter 保存

> ℹ️ 支持所有 Anthropic API 兼容服务（如 OpenRouter、AWS Bedrock 代理等），只要接口兼容 Messages API 即可。

## Feature Flags

所有功能开关通过 `FEATURE_<FLAG_NAME>=1` 环境变量启用，例如：

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

各 Feature 的详细说明见 [`docs/features/`](docs/features/) 目录，欢迎投稿补充。

## VS Code 调试

TUI (REPL) 模式需要真实终端，无法直接通过 VS Code launch 启动调试。使用 **attach 模式**：

### 步骤

1. **终端启动 inspect 服务**：

   ```bash
   bun run dev:inspect
   ```

   会输出类似 `ws://localhost:8888/xxxxxxxx` 的地址。
2. **VS Code 附着调试器**：

   - 在 `src/` 文件中打断点
   - F5 → 选择 **"Attach to Bun (TUI debug)"**

## Teach Me 学习项目

我们新加了一个 teach-me skills, 通过问答式引导帮你理解这个项目的任何模块。(调整 [sigma skill 而来](https://github.com/sanyuan0704/sanyuan-skills))

```bash
# 在 REPL 中直接输入
/teach-me Claude Code 架构
/teach-me React Ink 终端渲染 --level beginner
/teach-me Tool 系统 --resume
```

### 它能做什么

- **诊断水平** — 自动评估你对相关概念的掌握程度，跳过已知的、聚焦薄弱的
- **构建学习路径** — 将主题拆解为 5-15 个原子概念，按依赖排序逐步推进
- **苏格拉底式提问** — 用选项引导思考，而非直接给答案
- **错误概念追踪** — 发现并纠正深层误解
- **断点续学** — `--resume` 从上次进度继续

### 学习记录

学习进度保存在 `.claude/skills/teach-me/` 目录下，支持跨主题学习者档案。

## 相关文档及网站

- **本地文档**：[docs/](docs/)；运行 `bun run docs:dev` 预览。
- **源码仓库**：[Phantomxm2021/BeeGameStudio](https://github.com/Phantomxm2021/BeeGameStudio)。
- 部分技术文章继承自上游分析，文中第三方产品和协议名称不代表 BGS 品牌或 PhantomLab 原创。

## Contributors

<a href="https://github.com/Phantomxm2021/BeeGameStudio/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=Phantomxm2021%2FBeeGameStudio&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Phantomxm2021/BeeGameStudio&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Phantomxm2021/BeeGameStudio&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Phantomxm2021/BeeGameStudio&type=date&legend=top-left" />
 </picture>
</a>

## 致谢

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — 豆包 ASR 语音识别 SDK，为 Voice Mode 提供无需 Anthropic OAuth 的语音输入方案

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。

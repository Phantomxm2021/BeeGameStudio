# Claude Code Best V5 (CCB)

[![GitHub Stars](https://img.shields.io/github/stars/bee-game-studio/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/bee-game-studio/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/bee-game-studio/claude-code?style=flat-square&color=green)](https://github.com/bee-game-studio/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/bee-game-studio/claude-code?style=flat-square&color=orange)](https://github.com/bee-game-studio/claude-code/issues)
[![GitHub License](https://img.shields.io/github/license/bee-game-studio/claude-code?style=flat-square)](https://github.com/bee-game-studio/claude-code/blob/main/LICENSE)
[![Last Commit](https://img.shields.io/github/last-commit/bee-game-studio/claude-code?style=flat-square&color=blue)](https://github.com/bee-game-studio/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord)](https://discord.gg/uApuzJWGKX)

> Which Claude do you like? The open source one is the best.

牢 A (Anthropic) 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 完整复原的工程化项目。虽然很难绷, 但是它叫做 CCB(踩踩背)... 而且, 我们实现了企业版或者需要登陆 Claude 账号才能使用的特性, 并在此基础上扩展了更多好玩的特性。

[Peri Code](https://github.com/KonghaYao/peri)：Claude Code 兼容的 Rust Agent，多年大模型经验匠心制作，国内大模型（DeepSeek/GLM）精调，CPU/内存极致优化，在开发版/树莓派上也能跑 CC 一样的体验。

[文档在这里](https://ccb.agent-aura.top/) | [留影文档在这里](./Friends.md) | [Discord 群组，群主在线答疑](https://discord.gg/uApuzJWGKX)

| 特性                        | 说明                                                                                                                         | 文档                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude 群控技术**         | Pipe IPC 多实例协作：同机 main/sub 自动编排 + LAN 跨机器零配置发现与通讯，`/pipes` 选择面板 + `Shift+↓` 交互 + 消息广播路由 | [Pipe IPC](https://ccb.agent-aura.top/docs/features/uds-inbox) / [LAN](https://ccb.agent-aura.top/docs/features/lan-pipes)                |
| **ACP 协议一等一支持**      | 支持接入 Zed、Cursor 等 IDE，支持会话恢复、Skills、权限桥接                                                                  | [文档](https://ccb.agent-aura.top/docs/features/acp-zed)                                                                                  |
| **Remote Control 私有部署** | Docker 自托管远程界面, 可以手机上看 CC                                                                                       | [文档](https://ccb.agent-aura.top/docs/features/remote-control-self-hosting)                                                              |
| **Langfuse 监控**           | 企业级 Agent 监控, 可以清晰看到每次 agent loop 细节, 可以一键转化为数据集                                                    | [文档](https://ccb.agent-aura.top/docs/features/langfuse-monitoring)                                                                      |
| **Web Search**              | 内置网页搜索工具, 支持 bing 和 brave 搜索                                                                                    | [文档](https://ccb.agent-aura.top/docs/features/web-browser-tool)                                                                         |
| **Poor Mode**               | 穷鬼模式，关闭记忆提取和键入建议,大幅度减少并发请求                                                                          | /poor 可以开关                                                                                                                            |
| **Channels 频道通知**       | MCP 服务器推送外部消息到会话（飞书/Slack/Discord/微信等），`--channels plugin:name@marketplace` 启用                         | [文档](https://ccb.agent-aura.top/docs/features/channels)                                                                                 |
| **自定义模型供应商**        | OpenAI/Anthropic/Gemini/Grok 兼容  (`/login`)                                                                                          | [文档](https://ccb.agent-aura.top/docs/features/all-features-guide)                                                                        |
| Voice Mode                  | 语音输入，支持豆包语言输入（`/voice doubao`）                                                                   | [文档](https://ccb.agent-aura.top/docs/features/voice-mode)                                                                               |
| Computer Use                | 屏幕截图、键鼠控制                                                                                                           | [文档](https://ccb.agent-aura.top/docs/features/computer-use)                                                                             |
| Chrome Use                  | 浏览器自动化、表单填写、数据抓取                                                                                             | [自托管](https://ccb.agent-aura.top/docs/features/chrome-use-mcp) [原生版](https://ccb.agent-aura.top/docs/features/claude-in-chrome-mcp) |
| Sentry                      | 企业级错误追踪                                                                                                               | [文档](https://ccb.agent-aura.top/docs/internals/sentry-setup)                                                                            |
| GrowthBook                  | 企业级特性开关                                                                                                               | [文档](https://ccb.agent-aura.top/docs/internals/growthbook-adapter)                                                                      |
| /dream 记忆整理             | 自动整理和优化记忆文件                                                                                                       | [文档](https://ccb.agent-aura.top/docs/features/auto-dream)                                                                               |

- 🚀 [想要启动项目](#-快速开始源码版)
- 🐛 [想要调试项目](#vs-code-调试)
- 📖 [想要学习项目](#teach-me-学习项目)

## ⚡ 快速开始(安装版)

不用克隆仓库, 从 NPM 下载后, 直接使用

```sh
npm i -g bee-game-studio

# bun 安装比较多问题, 推荐 npm 装
# bun  i -g bee-game-studio
# bun pm -g trust bee-game-studio @claude-code-best/mcp-chrome-bridge

ccb # 以 nodejs 打开 claude code
ccb-bun # 以 bun 形态打开
ccb update # 更新到最新版本
CLAUDE_BRIDGE_BASE_URL=https://remote-control.bee-game-studio.win/ CLAUDE_BRIDGE_OAUTH_TOKEN=test-my-key ccb --remote-control # 我们有自部署的远程控制
```

> **安装/更新失败？** 先 `npm rm -g bee-game-studio` 清理旧版本，再 `npm i -g bee-game-studio@latest`。仍失败则指定版本号：`npm i -g bee-game-studio@<版本号>`

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

构建采用 code splitting 多文件打包（`build.ts`），产物输出到 `dist/` 目录（入口 `dist/cli.js` + 约 450 个 chunk 文件）。

构建出的版本 bun 和 node 都可以启动, 你 publish 到私有源可以直接启动

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

- **在线文档（Mintlify）**: [ccb.agent-aura.top](https://ccb.agent-aura.top/) — 文档源码位于 [`docs/`](docs/) 目录，欢迎投稿 PR
- **DeepWiki**: [https://deepwiki.com/bee-game-studio/claude-code](https://deepwiki.com/bee-game-studio/claude-code)

## Contributors

<a href="https://github.com/bee-game-studio/claude-code/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=bee-game-studio%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=bee-game-studio/claude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=bee-game-studio/claude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=bee-game-studio/claude-code&type=date&legend=top-left" />
 </picture>
</a>

## 致谢

- [doubaoime-asr](https://github.com/starccy/doubaoime-asr) — 豆包 ASR 语音识别 SDK，为 Voice Mode 提供无需 Anthropic OAuth 的语音输入方案

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。

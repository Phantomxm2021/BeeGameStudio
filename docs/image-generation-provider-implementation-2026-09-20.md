# 独立图片 Provider 与平台设置

## 当前状态（2026-09-20 后续接通）

以下“本批”和“后续增量”保留实施记录，当前状态以本节为准。

### 工作流配置读取修复

根因已确认：开发启动脚本按安全设计剥除 runtime 的 Supabase service-role key，而旧 loadRuntimeImageConfig 却强制使用该 key 直读平台表。因此手工测试进程能够读配置，不代表工作流进程也能够；失败发生在 billing reserve 和模型调用之前。

修复不恢复 runtime 数据库管理权限，也不修改 Agent。运行时沿用 Dashboard 的存储模式：本地模式读取同一个平台文件；远程模式通过现有 Billing 服务的内部图片配置接口读取同一张 beegame_image_generation_settings 表、同一 id=platform 行。复用现有服务间凭据，拒绝普通用户令牌和浏览器 Origin；无新增服务、数据库表、工作流阶段或重试。配置中的凭据保持存储加密形态传递，仅在原生宿主解密，不进入 Agent。

服务记录配置来源、数据库主机、HTTP 状态和行是否存在；runtime 错误区分服务未配置/网络/鉴权、数据库 HTTP、缺失行、解密或 schema 失败、Provider Key 缺失，并生成 diagnosticId。数据库状态使用 databaseHttpStatus，不冒充图片上游 upstreamStatus。配置失败不启动计费或生成，也不回退到另一套默认配置。

实际只读验证：使用根目录 ENV 和开发启动计划产生的无 service-role runtime 环境，经过真实内部路由和实际 Supabase 读取，HTTP 200、platform 行存在，活动配置 cloudflare / gpt-image-2.5-flare，Provider Key 与 billing 已配置。未调用图片模型、未计费、未更改项目。本验证不是已运行进程完成部署或完整生图验收。

### 自动 Prompt 记录（当前实现）

生图入口收到真实请求后，自动在对应项目的 `assets/ai-generation-prompts.md` 记录 prompt、requestId、请求参数和当前非敏感模型配置，并追加返回结果或失败诊断。同一 requestId 归在一条记录中；记录接收/返回不等于新提交上游，恢复收据不虚报为新生成。配置读取失败也留下事实，未知配置不猜测。

Agent 无须抄写日志、维护该文档或提交额外用途/路径字段。最终采用的资源文件、加工关系及运行绑定仍只由 Manifest 管理。记录文件不参与执行、恢复或计费；原有私有收据仍不保存 prompt，防重复付费语义保持不变。这里新增的是用户请求的项目内可读记录，不是向通用服务器日志输出 prompt。

文档仅记录白名单字段并脱敏凭据、能力地址、签名 URL；记录失败明确报告，但不能丢弃已生成图片或触发重试。未调用生图时不生成空文档；不覆盖或虚构历史记录。不新增 Agent、工作流阶段或审批。

下文“尚未完成/仍待实现/本批未开放”等表述仅描述当时批次，不能当作当前缺口清单。当前 CLI 入口、私有收据、计费与自动记录已接通代码；具体 provider 的真实可用性和项目交付仍须独立验收。

### 四个独立 Provider 与全局设置窗口

- 支持 OpenAI、OpenRouter、Vercel AI Gateway、Cloudflare AI Gateway。Vercel 使用 image-only 的 OpenAI Images 协议；Cloudflare 本次使用 OpenAI provider-native 代理路径，不是 Workers AI，也不自动猜测/切换上游协议。
- Vercel、OpenRouter、OpenAI 和 Cloudflare 均使用管理员填写的完整请求 URL，宿主原样发送，不追加 `/images`、`/images/generations` 或其他路径。
- Cloudflare 当前适配的是官方 `/accounts/{account_id}/ai/run` REST 协议：Authorization 使用 Cloudflare API Token，body 使用 `{ model, input: { ... } }`；模型发送为 `openai/gpt-image-2.5-flare`，响应中的 `result.image` URL 会由宿主下载并校验 PNG。Cloudflare Gateway 的 OpenAI 代理 URL 属于另一种协议，不能混用。
- 平台配置保存为 `{ activeProvider, providers }`；四份 URL、模型、凭据、尺寸、质量和费率互不复制。旧单配置在读取时归入原 Provider，第一次保存转为新结构；现有 Key 不迁入其他 Provider。复用原 JSONB 设置行，无新增数据库表/迁移。
- GET 可按 provider 读取而不启用；保存当前 Provider 才启用。运行时只取 activeProvider 的配置。两个 Key 分别加密，公开 API 只返回 hasApiKey/hasUpstreamApiKey。
- 修复 PATCH 默认值覆盖：未提交字段不再被 schema 默认值补齐，避免“Key 留空保留”实际变成清空。只有显式空字符串清除相应 Key。
- UI 使用现有 ProjectSelect、Switch、分栏输入和窗口底部共享“保存设置”；移除面板内部保存按钮和成功提示。保存中统一禁用，成功关闭窗口，失败使用同款 destructive 状态并保留表单；切换 Provider 保留独立草稿且不自动保存。
- 新 Provider 默认无 Key、无费率，不擅自套用 OpenRouter 费率；缺失或不能识别的 usage 仍不按免费处理。真实生成/计费兼容性需在用户配置后独立验收，本次不发起付费请求。
- 验证：后端图片模块 22 项、前端面板/全局设置 35 项通过，前后端类型检查通过。已用根 ENV 重启部署；Chrome 验证四选项、Vercel/Cloudflare 独立空凭据、窗口固定底部保存及保存中禁用。保留原 OpenRouter 值保存后窗口关闭，重新打开与运行时读取均确认原 URL/模型/费率和已配置 Key 保留。未向新增供应商发送生成请求。

协议依据：[Vercel image-only API](https://vercel.com/docs/ai-gateway/modalities/image-generation/openai)、[Cloudflare OpenAI route](https://developers.cloudflare.com/ai-gateway/usage/providers/openai/)、[Cloudflare Gateway authentication](https://developers.cloudflare.com/ai-gateway/configuration/authentication/)。

### OpenRouter 独立 Provider

新增显式 `openrouter` 选项，与 `openai` 并列。所有 Provider 使用管理员填写的完整 endpoint，不探测路径、不回退重发，不替换管理员的 URL、模型或 Key。

OpenRouter 按响应 `usage.cost` 的美元实际费用和管理员配置的 `creditsPerUsd` 结算；本次批准比例为 $1 = 100 Credits，不加价。缺失费用不按零处理，也不回退猜测 token 费用。单次预留不等于供应商侧的硬费用上限。代码回归使用模拟响应；真实图片生成验收尚未完成。

### 本次真实单请求验收（2026-09-20）

- 根 ENV 启动全部开发服务；Chrome 已显示 OpenRouter、原地址/模型及 100 Credits/USD，保存的加密 Key 原样保留。
- 使用生产的原生 curl 入口、ImageGenerationService、私有 attempt 存储及运行中 Billing 服务；隔离测试标识 `openrouter-image-acceptance-20260920`。没有启动游戏 Agent 或更改游戏项目。
- 请求仅提交一次：预留 237ms，上游调用 947ms 后 rejected，释放 236ms；包括账单读取共 1645ms。没有输出图片，不能判定生图验收通过。
- 账单 released，实际扣费 0，100 Credits 预留全部释放，钱包剩余预留 0。证据保存在 `/private/tmp/bgs-openrouter-acceptance-20260920/report.json`。
- 后续只读检查：Key 查询 HTTP 200、余额限制剩余 $50；模型 endpoint 查询 HTTP 200，支持 medium 与 transparent。不能据此归因为用户配置错误，也不能认定所有生成参数必定被接受。
- 暴露并修复 BGS 观测缺陷：attempt 曾丢弃 ImageProviderError.status；现持久化 HTTP 状态并传递至宿主日志，重启恢复仍保留。没有记录密钥、prompt 或不可信错误正文。原请求状态不可补造，因此其具体拒绝根因仍未确认。
- 修复后图片模块 17 项模拟测试及后端类型检查通过。没有自动提交第二次生成请求；下一次真实请求仍需作为明确的新测试执行。

### 上游响应日志补齐

按用户要求增加 `upstream-response` 宿主日志：实际 URL、provider/model、HTTP status、耗时、request ID、content type；失败记录脱敏响应正文（包括非 JSON 网关错误，最多 8192 字符并标记截断），成功只记录图片数量及 usage，不打印图片 base64。隐藏凭据、完整 prompt 与回显请求字段。响应正文留在宿主日志，不返回 Agent，不改变请求或重试行为。19 项图片回归测试通过，包含 JSON/HTML 错误日志和敏感字段脱敏。

此前 OpenRouter 配置和路径均指向 `https://openrouter.ai/api/v1/images`，与官方 Image API 文档一致；不能仅凭此前 rejected 认定 URL 错误。现已改为所有 Provider 使用完整 URL 原样发送。此前已丢弃的响应正文无法恢复。本次 Cloudflare 适配只完成模拟协议测试，真实图片请求需先明确 Cloudflare 无 usage.cost 时的内部计费规则。

- 已接通资源 Worker 的原生 Bash/curl 入口，无自定义 Agent 工具、审核代理或自动重试流程。Agent 自行决定搜索、选材、prompt 和图片用途；内建/网络素材优先的既有原则不变。
- 临时回环接口绑定当前用户/项目，拒绝浏览器 Origin 和额外请求字段。Key、服务计费凭据不进入 Agent 环境或项目。停止/发送失败关闭入口，已提交的付费响应允许完成持久化，不能假称取消即免费。
- 宿主通过 Provider 模块生成图片，持久化后完整解码。原始 usage 和 request ID 保存在私有 receipt 中，不在 Manifest 伪造来源；Agent 使用现有 Manifest 契约登记文件、hash、尺寸及 AI 来源。
- 新增管理员图片费率字段，单位为 Credits / 百万 tokens；另配置单次预留与项目总预算。费率默认未配置，不自行决定商业收费。模型不匹配、计费未配置、预留失败时不会调用供应商。
- 图片预留/结算/释放复用现有钱包，通过服务鉴权与 PostgreSQL 事务执行。重复请求不重复扣费；已有账单但本地结果丢失时禁止重新生成。结算使用预留时的费率快照。
- 图片未知结果、缺失/不支持的 usage、解码失败、费用超预留：保留结果/预留并报告失败，需人工核对，不自动退费或新建请求。**尚无自动对账/管理员处置界面**，不应把这类请求当作生成成功交付。
- 同时修复充值先读后写覆盖并发消费的问题，改为事务内增加额度，不修改原有充值金额规则。
- 分阶段日志记录 reserve、generate-or-recover、price-usage、settle/release 的开始/结束、耗时和脱敏失败分类；不输出 Key 或 prompt 原文。

### 部署与实际验证

设置 404 根因是前端热更新、新后端路由未被旧进程加载。已使用根 ENV 重启开发服务，登录 Chrome 验证配置页面恢复。

`image-generation-billing-migration-2026-09-20.sql` 已在当前 Supabase SQL Editor 执行成功；REST 只读检查图片表、预留字段与两个 RPC 均已生效。未执行真实充值/扣费或生成，不改写已有管理员 Key/费率。

本地验证：资源 Worker/图片模块/图片计费接口 31 项测试通过；设置页和设置菜单回归通过；前后端与计费服务类型检查通过。隔离 PostgreSQL（PGlite）执行迁移并验证重复部署、授权、幂等、身份冲突、余额保护、预算、结算、释放、充值保留消费与预留。复验脚本：`scripts/test-image-billing-sql.ts`，临时安装测试依赖，不新增产品运行依赖。

尚待真实验收：管理员配置正确图片费率/预算后，用一次明确的小图片生成验证供应商实际 usage、图片视觉质量及 Agent 的 Manifest 登记。模拟 PNG 和 SQL 测试不能替代这一步。

## 本批范围

在现有 workflow 服务中隔离为 src/image-generation 模块，不新增服务、不修改原生 Agent、不复用或改写对话模型配置。

- ImageGenerationProvider 接口负责生成请求与图片结果；首个 OpenAI 实现使用 Images API。后续供应商在此边界接入，不让工作流判断各家请求格式。
- 默认模型 gpt-image-2.5-flare，管理员可改模型、完整请求 URL、Key、默认质量和尺寸。宿主不追加任何路径。
- 平台 → AI 生图：Key 不回显，留空保留，显式清除才删除。前后端均限制管理入口；数据库 RLS 仅平台 owner 可读写。
- 远程 Base URL 要求 HTTPS，禁止 URL 内嵌凭据、查询参数和 fragment；允许本机 HTTP 兼容服务。请求不跟随重定向，不记录上游错误正文。
- 一次请求 n=1，无 SDK 自动重试。网络失败、5xx 或无法恢复图片标为未知结果，不认为费用为零。保留原始 usage 和供应商 request ID；这些不是已结算账单。
- Key 复用已有服务端加密机制。云模式使用独立 beegame_image_generation_settings 表，本地使用平台数据目录下的加密文件，不放项目目录。

官方接口依据：https://developers.openai.com/api/reference/cli/resources/images/methods/generate
默认模型依据：https://developers.openai.com/api/docs/models/gpt-image-2.5-flare

## 部署

已有数据库需执行 image-generation-settings-migration-2026-09-20.sql；新部署主 schema 已包含该表。复用根 ENV 的 BEEGAME_CONFIG_ENCRYPTION_KEY；不在文档或项目中填写真实 Key。

本批没有执行远程数据库迁移或重启服务，没有填入真实凭据，没有调用付费图片 API。

## 验证边界与下一步

Provider/config/API 定向测试和前端配置组件/设置菜单回归覆盖：默认值、自定义端点和模型、Key 留空保留/清除、加密及不回显、管理员权限、未知结果不重试、设置入口显示。前后端类型检查通过；前端使用 ignoreDeprecations=6.0 适配已安装 TypeScript 的旧 baseUrl 提示。

尚未完成：真实管理员页面部署验收、图片 CLI/资源 Agent 入口、持久化 attempt 与结果恢复、预算/预留/幂等结算、生成后解码加工与 Manifest 登记、真实供应商图片验收。模块没有开放用户付费生成路由，保存配置不会触发生成或收费。

不把本批模块/设置完成描述为整个资源生成规划完成。

## 后续增量：单次请求结果恢复

新增 `src/image-generation/attempt.ts`，独立于 Agent 和工作流：

- 由宿主传入用户、项目、请求标识；相同标识只提交一次。相同标识修改生成参数报冲突，不悄悄重生成。
- 宿主私有目录保存请求摘要、状态、图片、原始 usage 和供应商请求 ID；不保存 Key 或 prompt 原文。目录不得放入 Agent 可写的项目目录。
- 收到结果先保存，再完整解码 PNG。解码失败保留原始结果，不自动再次调用供应商。
- 同进程并发共享结果；重启后已有图片可以恢复。提交状态未明确完成或网络结果未知时返回 unknown，不将重启视为可重复付费的依据。
- 该模块只处理结果恢复，不代表已经结算，不开放用户生图接口，也不替代钱包授权。操作系统断电持久性、实际多进程故障注入尚未验收。

5 个定向测试覆盖并发、恢复、参数冲突、项目隔离、未知/拒绝结果、损坏 PNG 和另一实例发现 pending 的处理。Provider/config/API 测试另补最长允许 Key 加密后的读取回归。

计费检查结论：现有钱包只有文本 tokens 扣费接口，没有图片预留/结算能力。不能将图片 usage 填入文本扣费接口，也不能在 CLI 已开放后再补收费边界。图片 Credits 换算仍需明确配置，不自行设定商业费率。

仍待实现：钱包图片预留与幂等结算、授权后的 Agent CLI 入口、生成文件交付与 Manifest 衔接、部署验收。没有运行真实生成或重启项目。

## 后续真实验收记录：Cloudflare（2026-09-20）

- 当前活动配置已通过 Runtime 读取；Provider 使用完整 /accounts/{account_id}/ai/run URL，原样发送 Cloudflare 的 model + input envelope。
- 真实请求只提交一次，返回 HTTP 401 Authentication error；没有生成图片，也没有产生图片费用。
- 同一 Token 的 Cloudflare Token verify 返回 HTTP 200、状态 active；但目标账户的 Workers AI 模型查询返回 HTTP 403，账户列表对该 Token 不可见。根因是 Token 没有目标账户的 Workers AI Read 权限、账户 ID 不属于该 Token，或两者之一。
- 该结果排除了 URL 拼接、请求 envelope 和图片参数错误。Cloudflare /ai/run 需要账户级 Workers AI 权限；仅配置 AI Gateway 管理权限不足。
- 此次测试绕过内部钱包，仅验证供应商 Provider；Cloudflare 响应不提供 usage.cost，在明确内部固定计费规则前不执行完整钱包结算测试。

# BeeGame 存储分域与 Cloudflare R2 迁移方案

> 状态：2026-07-22 架构审计后修订。本文描述目标架构与渐进迁移边界；不能把现有 `cloud-artifacts` 临时 HTML Worker 当作正式项目存储实现。

## 0. 审计结论

总体方向成立，但原方案在开始实现前必须补齐以下约束：

- R2 是对象存储，不是 Claude Code 的工作目录。Agent 活动工作区继续使用每用户、每 Session 隔离的本地卷或持久卷；R2 只保存上传对象、不可变快照、资源、构建与交付产物。
- Resource Library 的“文件夹路径”是可编辑的逻辑路径，R2 `object_key` 是不可变物理定位。重命名或移动文件不能默认复制 R2 对象。
- 现有业务表已经保存 `supabase://...`、Storage URL 或相对路径。迁移必须先增加可空的 `storage_object_id`，并保留 Legacy Locator 读取；不能要求一次性回填后才能上线。
- R2 预签名 URL 只能在 S3 API 域名使用，不能使用自定义域名。正式发布读取应通过发布 Worker/自定义域名，私有上传与下载则走 S3 预签名 URL。
- 部署必须先完整上传和校验不可变版本，再以数据库状态切换为可见；不能逐文件覆盖一个正在被用户访问的发布目录。
- Multipart ETag 不能当作文件 SHA-256。Checksum 必须记录算法和值，大小、对象存在性和内容校验分别处理。
- 当前 `packages/cloud-artifacts` 是公开、短期、单 HTML 的临时产物服务，鉴权和生命周期均不满足多租户游戏项目要求，保持独立且不进入本次正式存储链路。

## 1. 目标

BeeGame 不对 Supabase Storage 进行全量迁移，而是根据文件所属业务域拆分存储：

- 用户域、账户域、平台域的小型媒体继续存放在 Supabase Storage。
- 游戏项目域、资源域、构建和交付文件统一存放在 Cloudflare R2。
- Supabase Database 继续作为权限、归属、索引和文件元数据的唯一事实来源。
- 新增的项目域存储通过 Storage Router 接入 R2；既有 Supabase Storage 账户媒体链路保持原样。

核心规则：

> 用户域、账户域和平台域媒体保留在 Supabase Storage；游戏项目域文件统一存入 Cloudflare R2。

### Supabase 不变原则

本方案不对保留在 Supabase Storage 的内容做任何存储层变更：

- 不迁移文件。
- 不新建、删除、合并或重命名现有 Bucket。
- 不改变现有对象 Key 和目录结构。
- 不改变现有公开/私有属性。
- 不改变现有 RLS、Storage Policy 和访问规则。
- 不改变现有上传、下载、替换和删除接口行为。
- 不要求为现有账户媒体批量搬迁或重写 URL。

Cloudflare R2 是项目域的新存储边界，不是 Supabase 账户媒体存储的替代品。

文件不能仅根据扩展名分类，必须根据业务归属分类。例如：

- 用户背景图属于账户域，保留在 Supabase Storage。
- 游戏截图属于项目域，存入 R2。
- 工作室 Logo 属于组织域，保留在 Supabase Storage。
- 游戏内 UI Logo 属于项目资源，存入 R2。

## 2. Supabase Storage 保留范围

以下文件继续存放在 Supabase Storage：

- 用户头像
- 用户背景图
- 工作室 Logo
- 团队头像
- 平台图标
- 账户级小型媒体
- 组织级小型媒体
- 注册、邀请和账户配置过程中的临时媒体

以上内容继续使用当前已经存在的 Supabase Bucket。现有 Bucket 名称、路径规则和 Policy 全部保持不变，本方案不定义新的 Supabase Bucket，也不要求调整现有 Bucket。

约束：

- 单文件体积原则上控制在 10–20 MB 以内。
- 不允许存放游戏项目代码、游戏资源、构建产物和版本快照。
- 继续使用 Supabase Auth、RLS 和 Storage Policy 控制访问。

## 3. Cloudflare R2 迁移范围

以下文件统一存放在 Cloudflare R2：

- 游戏项目源代码的不可变快照与导出归档（不包含 Agent 正在编辑的活动工作区）
- 用户上传的游戏资源
- 图片、音频、模型和动画
- Sprite、Sprite Sheet、Sprite Atlas
- Tilemap、Tileset 和地图数据
- AI 生成的游戏资源
- 项目导出 ZIP
- 构建产物
- HTML5 或 Web 游戏发布版本
- 游戏截图、录屏和宣传资源
- 完整构建日志
- Agent 原始诊断日志
- 项目历史版本和快照
- Resource Library Pack、元素、依赖和预览文件

建议初期使用以下逻辑 Bucket 角色。物理 Bucket 名由环境配置决定，不写死在业务代码中：

| Bucket | 内容 |
|---|---|
| `project-private` | 项目上传、项目资源、不可变源码快照和导出归档 |
| `resource-private` | Resource Library Pack、元素、依赖和预览源文件 |
| `delivery` | 构建产物、不可变部署版本、ZIP、截图和录屏 |
| `log-private` | 构建日志、Agent 日志和诊断文件 |

生产环境优先为不同逻辑角色使用独立物理 Bucket 和独立 API Token，避免 Resource Library 服务获得项目快照或日志的跨域权限。开发环境可以把多个逻辑角色映射到同一 R2 Bucket，但对象前缀和服务凭证边界仍必须保留。

后续可根据规模拆分为：

- `beegame-projects`
- `beegame-assets`
- `beegame-builds`
- `beegame-exports`
- `beegame-previews`
- `beegame-history`
- `beegame-logs`

## 4. R2 对象路径规范

公共存储层规范正式发布版本与 Resource Library Pack 的对象路径：

```text
deployments/{deploymentId}/files/...
deployments/{deploymentId}/manifest.json
packs/{packId}/objects/{storageObjectId}/payload
```

除部署版本和 Resource Library Pack 外，本方案不规定以下内容在 R2 中的对象路径：

- 游戏项目源代码
- 项目资源
- AI 生成资源
- 构建中间产物
- 项目导出 ZIP
- 截图、录屏和宣传资源
- 日志
- 历史版本和快照

这些对象的 Key 由各自业务服务在创建对象记录时生成，客户端不能提交完整 Bucket 或 Key。Storage Router 只根据数据库中的 `bucket_role`、`bucket` 和 `object_key` 执行存储操作，不根据文件名推断、不在读取时重写。

Resource Library 使用单一资源 Bucket，并以 Pack 前缀做物理分区；不为每个 Pack 创建 Bucket。`packId` 和 `storageObjectId` 都由服务端提供，用户文件名与可编辑文件夹路径不会进入物理 Key。这样可以按 Pack 前缀执行巡检、归档和生命周期治理，同时避免逻辑文件夹重命名触发对象复制。

对象 Key 与用户可见路径必须分离：

- `object_key`：服务端生成的不可变物理定位，推荐包含不可猜测对象 ID。
- `logical_path`：项目或 Pack 内可重命名、移动的逻辑路径。
- 重命名或移动默认只修改 `logical_path` 和业务元数据。
- 只有发布组装、跨 Bucket 迁移或显式复制才创建新 `object_key`。

部署路径规则：

- `deploymentId` 必须由服务端生成并绑定到部署记录。
- 一个 `deploymentId` 对应一个不可变发布版本。
- 权限判断依据数据库中的部署归属，不依据客户端提供的路径。
- 发布撤销或删除只能影响对应的 `deployments/{deploymentId}/...`。

## 5. 统一文件元数据

在 Supabase Database 建立统一的 `storage_objects` 表：

```text
id
scope_type
scope_id
owner_user_id
project_id
pack_id
provider
bucket_role
bucket
object_key
logical_path
original_filename
mime_type
byte_size
checksum_algorithm
checksum_value
etag
object_kind
version_id
status
visibility
metadata
created_at
updated_at
deleted_at
```

枚举建议：

```text
scope_type: user | studio | platform | project | pack | deployment | session
provider: supabase | r2
status: pending | uploading | verifying | ready | failed | deleted
visibility: private | project | organization | public
```

数据库约束：

- `(provider, bucket, object_key)` 对未删除记录唯一。
- `byte_size >= 0`，Checksum 必须同时包含算法和值。
- 项目、Pack、部署和 Session Scope 必须具有相应归属外键或可验证引用。
- `ready` 对象才允许签发下载 URL 或进入构建、发布和资源选择。
- 业务表以可空 `storage_object_id` 逐步接入；迁移期仍可读取 Legacy Locator。
- `storage_objects` 保存定位和事实，不取代 Pack、元素、部署等业务表。

项目域的新业务代码只保存 `storage_object_id`，不能长期保存：

- R2 公共 URL
- 临时签名 URL

现有 Supabase 账户媒体的数据结构和 URL 保存方式不在本次迁移范围内，不强制改造或回填 `storage_objects`。

## 6. Storage Router

新增项目域存储路由层。它负责将新的项目域文件路由到 R2，但不得接管或改写现有 Supabase 账户媒体流程：

```text
业务模块
   ↓
Storage Router
   ├── user/studio/platform → 保持现有 Supabase 实现，不改动
   └── project/pack/build/deployment → Cloudflare R2
```

建议提供以下接口：

```ts
createUploadIntent()
createMultipartUploadIntent()
completeUpload()
abortUpload()
createDownloadUrl()
copyObject()
deleteObject()
headObject()
verifyObject()
```

业务接口使用 `storageObjectId`，不向客户端暴露任意 `listObjects(bucket, prefix)` 能力。对象列举仅供迁移、对账和管理员治理任务使用。

新增项目域路由必须依据明确的业务字段：

```ts
route({
  scopeType: "project",
  objectKind: "game_asset"
})
// Cloudflare R2
```

禁止根据扩展名、MIME Type 或文件大小推断业务归属。用户、工作室和平台媒体继续调用当前 Supabase Storage 代码路径，不要求迁移到 Storage Router。

## 7. 上传流程

### 7.1 账户级小型媒体

账户级小型媒体继续使用现有 Supabase Storage 上传、鉴权、读取和删除流程。本方案不修改其 Bucket、对象路径、Policy、数据库结构或接口行为。

### 7.2 项目文件和大型资源

1. 客户端向 BeeGame 申请上传任务。
2. BeeGame 验证项目权限、文件类型和用户配额。
3. 创建 `pending` 状态的对象记录。
4. 服务端生成绑定到单一 Bucket、Key、方法和 Content-Type 的 R2 预签名 URL；大文件由服务端建立 Multipart Upload 并逐 Part 签名。
5. 客户端直接上传至 R2。
6. 客户端通知服务端上传完成。
7. 服务端通过 HEAD 校验对象存在性、大小和约定元数据；内容 Checksum 由可信上传端提交并由后台验证任务复核。
8. 将对象状态更新为 `ready`。

大型文件上传应支持：

- Multipart Upload
- 断点续传
- 上传进度
- 单文件重试
- 取消上传
- 刷新后恢复
- Checksum 校验
- 并发上传限制

补充约束：

- R2 当前不支持 S3 HTML Form `POST` 预签名上传，浏览器直传使用预签名 `PUT`。
- 预签名 URL 是 Bearer 凭证，必须短时有效且不得写入日志、Manifest 或数据库长期字段。
- 浏览器直传必须配置精确 Origin、方法和 Header 的 R2 CORS，不能使用无边界 `*`。
- Upload Intent 必须包含服务端生成的对象 ID、幂等键、过期时间、期望大小和允许的 Content-Type。
- 完成回调重复提交必须幂等；超时任务和 Multipart 残片由生命周期任务清理。

## 8. 下载与发布

### 8.1 私有项目资源

- R2 Bucket 默认保持私有。
- BeeGame 根据项目权限生成短期签名 URL。
- 客户端不能获取 R2 API 密钥。
- 签名 URL 不得写入项目 Manifest 或游戏源代码。

### 8.2 发布游戏

发布版本使用不可变路径：

```text
deployments/{deploymentId}/...
```

发布游戏内部资源使用相对路径：

```text
./assets/models/player.glb
./assets/audio/fire.wav
```

最终游戏不能依赖临时签名 URL。发布版本通过专用发布 Worker 和 BeeGame 自定义域名对外提供访问；`r2.dev` 只用于开发验证。发布 Worker 负责入口文档、SPA fallback、Content-Type、安全响应头和缓存策略。

发布原子性：

1. 为服务端生成的高熵 `deploymentId` 创建 `publishing` 记录。
2. 上传到新的不可变 `deployments/{deploymentId}/files/...`。
3. 生成并校验包含路径、大小和 Checksum 的 `manifest.json`。
4. 所有文件就绪后，将数据库部署记录一次性切换为 `succeeded`。
5. 只有 `succeeded` 版本能被发布 Worker 解析；失败版本不可见且可安全清理。
6. 已发布对象不覆盖。更新游戏必须创建新的 `deploymentId`。

### 8.3 Resource Library

Agent 探索资源时只返回：

- Pack 元数据
- 元素元数据
- 预览信息
- 文件格式
- 依赖关系
- Pack 和 Element ID

只有 Agent 明确选择并执行导入后，服务端才生成短期资源下载授权。

## 9. 非全量迁移策略

### 第一阶段：停止新增项目文件进入 Supabase Storage

- 新项目域文件直接进入 R2。
- 新账户域媒体继续使用当前 Supabase Storage Bucket 和现有流程。
- 旧文件继续保留在原位置。
- 读取时根据 `storage_objects.provider` 决定来源。

### 第二阶段：迁移活跃项目文件

优先迁移：

1. 当前活跃项目资源
2. 当前发布版本
3. 最近项目快照
4. 大体积构建产物
5. 项目导出 ZIP
6. 完整构建日志

暂不迁移：

- 用户头像
- 用户背景图
- 工作室 Logo
- 团队头像
- 其他账户级小型媒体
- 已删除项目
- 长期无人访问的冷项目

### 第三阶段：按访问迁移

旧项目对象首次被访问时：

1. 通过 Legacy Locator 从 Supabase Storage 读取。
2. 创建新的 R2 `storage_objects` 记录并后台复制。
3. 校验文件大小和 Checksum。
4. 在业务表中原子切换 `storage_object_id`，旧定位保留为迁移审计事实。
5. 后续访问改为 R2。
6. 经过安全观察期后删除 Supabase Storage 副本。

不得原地修改同一条对象记录的 `provider/bucket/object_key` 来表示复制过程，否则失败时会丢失可信源定位。

### 第四阶段：批量迁移冷数据

后台迁移任务必须支持：

- 分批执行
- 暂停与恢复
- 幂等重试
- 单对象失败隔离
- 完整审计记录
- Checksum 校验
- 源文件延迟删除

## 10. 迁移状态机

```text
queued
→ copying
→ verifying
→ ready_to_cutover
→ cutover_complete
→ source_deleted
```

失败状态：

```text
copy_failed
verification_failed
cutover_failed
delete_source_failed
```

规则：

- R2 校验成功前不得删除 Supabase Storage 原文件。
- 只有进入 `r2_primary` 后才允许清理源文件。
- 删除源文件失败不能影响 R2 文件使用。
- 所有迁移操作必须幂等。
- 禁止通过文件名判断迁移状态。
- 数据库记录是迁移状态的唯一事实来源。

## 11. 权限模型

Supabase 继续负责：

- 用户身份
- 项目归属
- 团队成员关系
- Pack 管理权限
- 对象元数据
- 审计日志

R2 不直接理解 BeeGame 用户权限。

R2 操作流程：

```text
用户请求
→ Supabase Auth 身份解析
→ 项目或团队权限校验
→ 查询 storage_objects
→ 生成限定 Bucket、Key 和有效期的授权
```

服务凭证按职责拆分：

| 服务 | 权限 |
|---|---|
| 上传服务 | 操作数据库授权的上传对象 |
| 构建服务 | 读取数据库授权的项目对象并写入构建对象 |
| 部署服务 | 读取授权的构建对象并写入 `deployments/{deploymentId}/...` |
| Resource Library 服务 | 操作数据库授权的 Pack 对象 |
| 日志服务 | 写入数据库授权的日志对象 |

任何服务都不应持有无边界的跨 Bucket 用户级管理权限。S3 API Token 只存在于服务端秘密管理中；浏览器只获得单对象、单操作、短时授权。

## 12. 生命周期管理

- 上传失败的临时分片：1–3 天清理。
- 临时预览文件：7–30 天清理。
- 完整构建日志：压缩并按保留周期归档。
- 项目导出 ZIP：按用户设置或过期时间清理。
- 旧构建产物：保留当前版本和有限历史版本。
- 已删除项目：进入软删除期，期满后清理。
- 发布版本：显式撤销前保持不可变。
- 项目快照：按照套餐和配额保留。

数据库保留删除墓碑，防止对象被错误重新发现。

## 13. 实施顺序

### 当前实现检查点（2026-07-22）

- 已实现 provider-neutral R2 Driver、业务 Scope 路由和 fail-closed 配置。
- 已建立 `storage_objects`、上传意图和迁移任务的数据库基础与 RLS 加固。
- Resource Library 新文件和封面可写入 R2；旧 Supabase 对象保持双读。
- 项目资源的持久化副本可写入 R2；Claude Code 活动工作区仍保持隔离文件系统。
- Web 部署以不可变 `deploymentId` 上传全部文件，逐对象校验后最后写入部署 Manifest。
- 已提供 Resource Library 预演/执行迁移、Pack 物理分区重排和 R2 正向一致性巡检；迁移读取使用显式分页，不受 Supabase REST 默认 1000 行限制。
- Resource Library R2 对象按 `packs/{packId}/objects/{storageObjectId}/payload` 分区，用户文件夹继续由 `logical_path` 管理；2026-07-22 的历史迁移与旧平铺键重排队列均已归零，2,591 个登记对象通过全量存在性、大小和 Checksum 元数据检查，另有 100 个对象通过下载内容 SHA 抽检。
- 已提供幂等 `bun run r2:bootstrap`：自动采用平台 Bucket 默认名、检查并创建缺失 Bucket；该命令只在部署初始化时使用 Cloudflare 管理 Token，运行时服务不持有此权限。
- `r2:bootstrap` 会为项目、资源与交付 Bucket 配置受限浏览器 CORS；本地 Studio Origin 自动加入，生产 Origin 复用 `BEEGAME_API_CORS_ORIGINS`，额外 Origin 可通过 `BEEGAME_R2_CORS_ORIGINS` 配置。私有对象仍必须使用短期签名 URL。
- 历史 Resource Pack 缺失 Owner 时迁移会 fail-closed；只有唯一工作区 Owner 可被确定性回填，并写入资源审计事件。
- 尚未完成浏览器直传 Upload Intent、Multipart 恢复、项目快照/导出、完整日志迁移和 R2 反向孤儿扫描。

### P0：建立存储边界

- 修订并冻结本文中的业务域、活动工作区和 Legacy Locator 边界。
- 建立 provider-neutral Storage Core；业务服务依赖接口，不直接拼接 Supabase 或 R2 URL。
- 建立 `storage_objects` 表。
- 建立 Upload Intent、审计记录与幂等状态转换。
- 实现项目域 Storage Router。
- 明确业务 Scope 路由规则。
- 新项目域上传全部进入 R2。
- 保持旧 Supabase Storage 文件可读取。
- 保持账户域、组织域和平台域现有 Supabase Bucket、Key、Policy 与接口完全不变。
- 实现身份、项目权限和签名 URL。
- 禁止新增的 R2 项目域业务代码直接拼接永久 Storage URL。
- 活动 Claude Code 工作区仍使用隔离文件系统；只在明确快照/导出时写入 R2。

### P1：打通项目完整链路

- Resource Library Pack 和元素写入 R2。
- 项目资源上传写入 R2。
- 构建服务从 R2 获取项目资源。
- 构建产物和部署版本写入 R2。
- 项目导出 ZIP 写入 R2。
- 支持 Multipart、重试、进度和刷新恢复。
- 发布游戏使用相对资源路径。
- 部署使用不可变对象集、部署 Manifest 和数据库原子切换。

### P2：渐进迁移和治理

- 增加迁移任务表和后台 Worker。
- 按访问迁移活跃项目。
- 批量迁移历史项目文件。
- 增加 Checksum 对账。
- 增加孤儿对象扫描。
- 增加生命周期和配额管理。
- 增加成本、流量和失败率监控。

## 14. 验收标准

- 用户头像仍上传到 Supabase Storage。
- 工作室 Logo 和团队头像仍上传到 Supabase Storage。
- 保留内容使用的 Supabase Bucket 名称与迁移前完全一致。
- 保留内容的 Supabase 对象 Key、RLS、Storage Policy 和现有接口行为完全一致。
- 游戏模型、音频、Sprite 和 Tilemap 上传到 R2。
- 同为 PNG，用户背景图进入 Supabase，游戏贴图进入 R2。
- 旧 Supabase 项目文件仍可以正常读取。
- 迁移失败不会删除 Supabase 原文件。
- 其他用户无法访问不属于自己的 R2 项目对象。
- 签名 URL 过期后无法继续访问。
- 发布游戏不依赖临时签名 URL。
- 删除项目不会删除用户头像等账户媒体。
- Supabase Storage 停止接收新项目文件后，项目仍能正常构建。
- 数据库、Supabase Storage 和 R2 可以进行一致性巡检。
- Pack 内重命名或移动元素不会复制 R2 对象，且预览、依赖和 Agent 导入仍可正常解析。
- R2 配置缺失时服务启动明确失败或保持旧链路，不允许部分写入后静默回退到另一 Provider。
- 同一个 Upload Intent 重试不会生成重复业务对象；失败完成回调不会把对象标记为 `ready`。
- 部署上传中途失败时，旧发布版本继续可用，新版本不可见。

## 15. 最终架构

```text
Supabase
├── Auth
├── Database
├── RLS
├── 文件元数据
├── 用户头像
├── 用户背景图
├── 工作室 Logo
├── 团队头像
└── 账户级、平台级小型媒体

Cloudflare R2
├── 项目源代码的不可变快照与导出归档
├── 游戏资源
├── Resource Library
├── AI 生成资源
├── 构建产物
├── 发布版本
├── 项目导出 ZIP
├── 截图和录屏
├── 项目快照
└── 完整日志

BeeGame Storage Router
├── 新项目域路由
├── 权限验证
├── 上传授权
├── 下载签名
├── 对象校验
├── 迁移状态
└── 审计记录
```

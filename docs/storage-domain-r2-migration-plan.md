# BeeGame 存储分域与 Cloudflare R2 迁移方案

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

- 游戏项目源代码
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

建议初期使用以下 Bucket：

| Bucket | 内容 |
|---|---|
| `beegame-project-data` | 项目代码、项目资源、资源库文件和快照 |
| `beegame-deliveries` | 构建产物、部署版本、ZIP、截图和录屏 |
| `beegame-logs` | 构建日志、Agent 日志和诊断文件 |

后续可根据规模拆分为：

- `beegame-projects`
- `beegame-assets`
- `beegame-builds`
- `beegame-exports`
- `beegame-previews`
- `beegame-history`
- `beegame-logs`

## 4. R2 对象路径规范

公共存储层只规范正式发布版本的对象路径：

```text
deployments/{deploymentId}/...
```

除部署版本外，本方案不规定以下内容在 R2 中的对象路径：

- 游戏项目源代码
- 项目资源
- Resource Library Pack 与元素
- AI 生成资源
- 构建中间产物
- 项目导出 ZIP
- 截图、录屏和宣传资源
- 日志
- 历史版本和快照

这些对象的 Key 由各自业务服务管理，Storage Router 只根据数据库中的 `bucket` 和 `object_key` 执行存储操作，不推断、不重写、不统一其目录结构。

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
bucket
object_key
original_filename
mime_type
byte_size
checksum
object_kind
version_id
status
visibility
created_at
updated_at
deleted_at
```

枚举建议：

```text
scope_type: user | studio | platform | project | pack
provider: supabase | r2
status: pending | ready | failed | deleted
visibility: private | project | organization | public
```

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
completeUpload()
createDownloadUrl()
copyObject()
deleteObject()
listObjects()
verifyObject()
```

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
4. 服务端生成 R2 预签名 URL 或 Multipart Upload 凭据。
5. 客户端直接上传至 R2。
6. 客户端通知服务端上传完成。
7. 服务端校验对象大小、Checksum 和存在性。
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

最终游戏不能依赖临时签名 URL。发布版本可通过 Cloudflare CDN、自定义域名或 BeeGame 发布域名对外提供访问。

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

1. 从 Supabase Storage 读取。
2. 后台复制到 R2。
3. 校验文件大小和 Checksum。
4. 更新 `storage_objects.provider`。
5. 后续访问改为 R2。
6. 经过安全观察期后删除 Supabase Storage 副本。

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
supabase_only
→ copying_to_r2
→ r2_verified
→ r2_primary
→ supabase_source_deleted
```

失败状态：

```text
copy_failed
verification_failed
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

任何服务都不应持有无边界的跨 Bucket 用户级管理权限。

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

### P0：建立存储边界

- 建立 `storage_objects` 表。
- 实现项目域 Storage Router。
- 明确业务 Scope 路由规则。
- 新项目域上传全部进入 R2。
- 保持旧 Supabase Storage 文件可读取。
- 保持账户域、组织域和平台域现有 Supabase Bucket、Key、Policy 与接口完全不变。
- 实现身份、项目权限和签名 URL。
- 禁止新增的 R2 项目域业务代码直接拼接永久 Storage URL。

### P1：打通项目完整链路

- Resource Library Pack 和元素写入 R2。
- 项目资源上传写入 R2。
- 构建服务从 R2 获取项目资源。
- 构建产物和部署版本写入 R2。
- 项目导出 ZIP 写入 R2。
- 支持 Multipart、重试、进度和刷新恢复。
- 发布游戏使用相对资源路径。

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
├── 项目源代码
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

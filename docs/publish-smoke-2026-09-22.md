# 独立发布实测（2026-09-22）

## 结论

最新结果：真实构建、R2 上传、数据库登记、Worker 公开访问和浏览器交互均通过。以下保留首次失败与修复过程；本次验证没有覆盖产品发布面板完整端到端流程。

## 范围

- 独立项目：`project_publish_smoke_nfNVyd`，名称「独立发布测试（可删除）」。
- 临时源代码：`/private/tmp/bgs-publish-smoke.nfNVyd/site`。
- 四个静态文件：HTML、CSS、JS、SVG；无私人数据、无游戏内容、无模型调用。
- 使用生产 `BeeGameDeploymentManager` 和 R2 publisher，隔离保存部署记录，真实上传。
- 没有使用现有游戏，没有伪造 workflow 验收状态，没有放开产品发布门禁。
- 本次验证的是构建/存储/公开托管链路，不代表发布面板完整端到端验证。

## 观察结果

1. 本地浏览器显示测试页，JavaScript 状态文本正常，计数按钮从 0 变为 1，SVG `complete && naturalWidth > 0` 为真。
2. 真实部署 ID：`deploy_b36221b262074f699dfe01bc9e960001`。
3. 构建命令 `npm run build`，构建及上传约 14.9 秒。
4. 四个文件及 manifest 已上传至 `beegame-delivery`，上传代码返回 succeeded。
5. 实际打开返回链接，显示的是 Bee Game Studio 官网的 `Page not found`，并非测试页。
6. Cloudflare 只读配置查询：delivery 桶的 `domains/custom` 返回空列表；`domains/managed` 返回 `enabled: false`。
7. 环境中发布地址配置为 `https://beegame.studio`，但该地址没有把部署路径路由到 delivery 桶。

## 修复

R2 publisher 上传后，匿名读取公开入口，检查 HTTP 状态、HTML 类型和内容 SHA-256；错误网站即使返回 HTTP 200 也不能算发布成功。失败使用已有上传回收路径，不附带用户认证头，不自动重试。

回归：R2 publisher、deployment manager、project deployment routes 合计 16 项通过、75 个断言。覆盖 HTTP 200 但内容错误的域名及失败后的对象回收。

## 待处理

- 等用户选择独立发布域名或授权开启 delivery 桶的测试公共访问。未修改 DNS、桶公开权限或私有桶。
- 域名配置后继续验证公开 HTML/CSS/JS/SVG 和按钮交互；当前不能提供有效的公开测试链接。
- 新增校验代码尚未加载到运行中的 runtime；没有在本轮擅自重启。
- 首次测试留下的四个文件和 manifest 保留供核对，未删除；旧代码记录的 succeeded 仅代表上传，本报告的公开访问失败结论优先。

## Worker 接入修订

后续检查纠正了上面的基础设施判断：`game.beegame.studio` **已经绑定**现有 `beegame-delivery` Worker，Worker 使用 `DELIVERY_BUCKET` 私有绑定读取同名桶。桶未开放公共访问是正确配置，无须开放 r2.dev 或重绑官网。

已调整：

- 根目录 `.env.local` 发布地址改为 `https://game.beegame.studio`。
- 存储对象 `scope_id` 改为项目 ID，部署 ID 继续保留在对象路径和 `metadata.deployment_id`；对齐数据库公开查询规则。
- 构建、上传完成后先保存 Worker 所需的发布记录，再匿名验证公开页面；本地展示保持 publishing 直到检查完成。失败保存 failed、清空 URL，撤销 Worker 的数据库放行条件。
- 项目发布入口和会话发布入口共用相同顺序。
- 18 项回归、85 个断言通过。服务端类型检查仅报告既有的 `ui-editor-image-save.test.ts:42` 类型错误。

真实复测版本：`deploy_0d78d0e52786492db4e9e608c8529a4c`。文件/Manifest 上传正常，归属字段核对正确；独立测试缺失的会话元数据已补齐。

经用户明确授权临时登记该测试版本为公开后的诊断结果：

- 匿名 `beegame_is_deployment_public` 返回 HTTP 200 / true。
- 自定义域名和 `beegame-delivery.nswell.workers.dev` 都返回 404。
- R2 账号、桶和 Manifest 文件内容核对正确。
- 诊断失败后已撤回为 failed，公开查询重新返回 false。
- Worker 的两个 Supabase Secret 无法通过只读 API 比较值。拟同步为当前系统配置，等待用户单独授权；尚未修改云端配置。

因此目前尚未通过公开访问验收，也尚未重启本地 runtime。上述早期“无需 Worker、开放桶”的方向不适用。

## Worker 配置修正后的最终复测

经用户明确授权，仅将现有 Worker 的 `SUPABASE_URL` / `SUPABASE_ANON_KEY` 同步为根目录当前配置；Cloudflare API 返回成功。没有修改 Worker 代码、DNS、桶绑定、公开访问规则或 R2 桶权限。

- 原测试版本在两个 Worker 域名均由 404 恢复为 HTTP 200，内容校验通过。这将最后一个阻塞定位到 Worker 的 Supabase 连接配置（旧 Secret 不可读，不能进一步断言两个字段中具体哪一个有误）。
- 随后对独立测试项目重新走完整生产构建/上传/登记/验证代码，不依赖手工登记旧版本。
- 新部署：`deploy_74f4a51e707b4e4e9cd5a0b6b3a0d6a4`，状态 succeeded，耗时约 15.5 秒。
- 公开地址：`https://game.beegame.studio/deployments/deploy_74f4a51e707b4e4e9cd5a0b6b3a0d6a4/files/index.html`。
- Chrome 实测：SVG 正常显示，样式正常，JavaScript 已加载，按钮点击从 0 变为 1。
- 无模型调用，无现有游戏内容变更。独立测试版本保留供用户查看。
- 用户随后授权重启，runtime 已重启，端口 62174，健康检查 HTTP 200；未自动续跑 workflow。
- 四个公开文件均为 HTTP 200，MIME 正确，SHA-256 与本地构建一致；`missing-test.js` 返回 404。
- 为通过 runtime 工作区边界校验，将独立夹具复制到 `Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/publication-smoke--nfNVyd` 并更新该测试项目和会话元数据。没有放宽路径限制或修改任何现有游戏。
- 重启后的发布历史接口 HTTP 200，能读取新成功版本及正确 Worker URL。
- readiness 接口 HTTP 200 / destination=remote；该手工静态夹具没有运行生成 workflow，因此 allowed=false / `Delivery workflow has not started.` 是预期结果，没有伪造游戏验收记录来解锁面板。产品面板“从已验收游戏点击发布”的完整端到端测试仍未覆盖。

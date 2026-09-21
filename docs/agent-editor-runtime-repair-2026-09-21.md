# Agent / Chat / Editor 系统修复核对

样本：mushroom-platform-quest--9b076afc632c。仅只读检查项目与日志；未修改项目源码、JSON、HUD、资源或 workflow 状态，未发起模型调用。

## 已证实根因与修复

| 问题 | 日志或代码事实 | 系统修复 |
| --- | --- | --- |
| 临时文件 Write / Read 不一致 | 1304 的 Bash 使用 TMPDIR，1345 的 Read 被工作区边界拒绝；原生离线实测确认 sandbox-runtime 再次把 TMPDIR 覆盖成 /tmp/claude | 会话使用项目内独立临时目录；原生 sandbox adapter 将 getClaudeTempDir() 映射到依赖实际读取的 CLAUDE_TMPDIR。不开放整个 /tmp |
| 大图 Read 失败 | 2234、2950；2400×2100 的独立测试图片可重现 | Sharp 保留为外部运行时依赖，避免打包后找不到原生库；同图自动缩小读取成功 |
| Todo 重复 | 同一资源阶段早期无 workflowRunId，后期有；恢复又改变 sourceSessionId | 按项目＋阶段＋子 Agent 归属维护最新快照；不把传输会话、可选 run 字段作为列表身份 |
| 截图不可见 | tool_result 中 image 数据在转换为纯文本时丢失 | 保存真实图片返回块为受鉴权的附件引用，在工具调用组外展示；不猜 Bash 输出路径，不读取任意本机图片 |
| 历史附件消失 | 一轮结束会删除共享 .beegame-attachments | 移除整目录清理；上传失败仍只回滚本次文件 |
| 偏好语言未传到通用 runner | runner 收到 language 却未使用 | 使用原生 append-system-prompt 传递可见回复语言；原生子 Agent 继承此设置。不翻译或伪造 provider 的隐藏推理 |
| 后台 Agent 权限请求被直接否决 | BGS 有 stdio 权限处理能力，但通用 runner 没有声明 supportsBackgroundPermissionRequests | 后台请求也交给同一权限处理入口；没有自动批准或关闭沙箱 |
| Credits 长时间不变 | 刷新依赖 workflow token 变化；图片扣费、延迟入账不触发 | 可见页面每 5 秒核对权威余额，焦点恢复/扣费通知刷新；合并并发请求，不改计价 |
| 资源检索信息缺失 | 访问桥未开放资源服务已有的语义 facet 查询 | 开放两个已有只读 catalog POST 查询，公开标签/格式筛选与返回 facets；选择仍由 Agent 决定 |
| UI sheet 显示整图 | 有名帧找不到时退回整张图片；方向条带仅生成默认方向 | 不再把整图冒充指定帧，显示缺失元数据诊断；按各方向真实偏移裁剪 |
| Editor 操作/展示 | UI 滚轮默认为平移；screen 用 root 名称；Scene 切换浮在画布外；未设置 2D renderOrder | UI 鼠标滚轮缩放、中键平移，保留 Mac 双指/捏合；screen 用文档 id；Scene 切换收进菜单；2D Renderer 使用 sortingOrder，Inspector 可编辑 |
| 预览 CORS | OPTIONS 直接转给游戏服务器；代理把 BGS cookie/authorization 也转给游戏代码 | 鉴权后由代理回应预检；不向游戏服务器转发 BGS 凭据。保留 iframe 隔离 |
| Implementation 被 memory 阻断 | run 于 08:05:26Z failed，唯一 scope mismatch 是原生 .runtime/.../memory/feedback_build_nodeenv.md | changedPaths 只描述项目交付文件，排除项目外原生活动文件与会话 scratch；完整活动仍留在原生日志，权限由执行层负责 |

## 不能混为系统修复的事项

- 1390 的 cp 缺文件：前一个图像处理命令把错误输出丢弃，且用 echo done 掩盖失败。1433 的 exit 13 无 stderr，不足以断言具体原因。
- 4108、4298、4472：生成的 pixelize.py 数组越界。未替 Agent 改脚本，也未改示例资源。
- 本项目 7 笔图片请求均为 1024×1024、medium；检查阶段的放大图片不是上游高规格生成。已有默认 medium 保留。提示区分素材画布与关卡尺寸，构图、拼接、分层仍由 Agent 决定。
- title-hero 请求 big_idle，PLAYER-SPRITES-01 没有注册帧表；只有 frameSize 不能推导命名帧位置。编辑器报告事实，不生成坐标或修改 HUD。
- 被弃用候选的最终资源登记、清理和分块构图由资源 Agent 负责；BGS 不自动删除 Agent 下载文件。已明确最终 Manifest/runtime 只保留选用项，scratch 与交付资产分离。
- 验证可由原生 Agent 自主委派，样本已实际使用。BGS 不额外指定多 Agent 执行计划、固定并发数或付费重试。

## 浏览器尚未完全验收

18509 有 SIGTRAP；35445 记录 CfT 的 Crashpad 路径 EPERM、socket directory / ProcessSingleton 创建失败。日志同时存在选错/不存在浏览器路径的问题。

临时目录与后台权限请求通道已修复，但不能声称所有 Chrome OS 限制已解除；需要修复激活后在实际权限下复测。不能全局关闭沙箱，也不能以开启同源 iframe 权限掩盖 CORS。

Playwright 官方明确区分默认 headless shell 与完整 Chromium channel，且要求匹配的浏览器版本：
https://playwright.dev/docs/browsers#chromium-headless-shell

## 验证与生效范围

- 原生 CLI 独立构建：9 项测试通过，包含真实沙箱 TMPDIR 写后 Read、大图缩放、越界拒绝、停止与输出排空；使用本地模拟模型，无付费调用。
- 运行接口/资源访问/附件/预览代理：30 项通过。
- 交付文件分类与产物修复回归：17 项通过。
- 前端 Chat/Atlas/UI/Scene/Todo 定向回归 87 项通过；Scene atlas/排序 11 项通过。
- 前端、工作流服务器、Scene Editor 类型检查通过。
- 未覆盖运行中的 dist，未重启服务。需经用户确认更新构建并重启后，才能验收实际页面；不自动继续或重试 workflow。

# Chat Document Attachments Design

## Goal

让 BeeGame 聊天输入框支持文档和图片附件：文档支持 PDF、DOC、DOCX、TXT、MD、CSV、XLS、XLSX、JSON、JSONL；图片支持 PNG、JPG/JPEG、WEBP；GIF 明确不支持。

## Current Constraint

当前附件协议名为 `ChatImageAttachmentPayload`，前端只读取图片并将附件渲染为 `<img>`，BeeGame 会话层也只接受图片附件。因此不能只扩大 `<input accept>`，必须让类型、转换、传输、历史消息和展示保持一致。

## Recommended Architecture

沿用现有消息的内联 Base64 传输方式，扩展为带 `type` 区分的图片/文件附件联合类型。由于当前运行时只支持文本和图片视觉输入，后端收到文档后会先写入当前会话的项目工作区，再把安全的相对路径加入 Agent 上下文：

- 图片附件保留 `type: 'image'`、MIME 类型、Base64 数据和文件名。
- 文档附件使用 `type: 'file'`、MIME 类型、Base64 数据和文件名。
- 前端统一按允许的 MIME 类型和扩展名校验，GIF 不在允许集合内。
- 文件仍通过现有聊天消息请求发送，不新增对象存储接口或平台绑定。
- 后端为每个会话创建受控附件目录，使用清洗后的文件名和服务端生成的唯一前缀，防止路径穿越和文件覆盖。
- Agent 上下文只包含文档的相对路径、原始文件名和 MIME 类型，Agent 通过现有文件工具读取文档。
- 预览区按 `type` 分流：图片显示缩略图，文档显示文件图标、文件名和类型。

## Allowed Types

| Category | Extensions | MIME types |
| --- | --- | --- |
| Image | `.png`, `.jpg`, `.jpeg`, `.webp` | `image/png`, `image/jpeg`, `image/webp` |
| Document | `.pdf` | `application/pdf` |
| Document | `.doc`, `.docx` | `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Document | `.txt`, `.md` | `text/plain`, `text/markdown` |
| Document | `.csv` | `text/csv` |
| Document | `.xls`, `.xlsx` | `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| Document | `.json` | `application/json` |
| Document | `.jsonl` | `application/jsonl`, `application/x-ndjson` |

浏览器或系统可能无法为扩展名提供准确 MIME，因此实现必须同时使用扩展名和 MIME 兜底；只有扩展名与允许集合一致时才接受未知 MIME 的文件。对明确的 GIF MIME 或 `.gif` 扩展名一律拒绝。

## User Experience

- 附件按钮的 `accept` 同时列出全部允许的图片和文档格式。
- 选择或粘贴图片时保留现有图片处理逻辑；粘贴文档只接受 `DataTransfer.files` 中的允许文件，不把普通文本剪贴板内容当作附件。
- 选择不支持的文件时不进入附件列表，并通过现有错误/提示机制告知用户。
- 图片附件继续使用缩略图卡片；文档附件使用非图片文件卡片，展示文件名和可读类型，保留删除按钮。
- 发送按钮的可发送条件从“文本或图片附件”扩展为“文本或任意附件”。
- 历史消息同样按附件类型渲染，避免文档被当作图片加载。

## Safety and Limits

- 限制单个附件大小，避免 Base64 造成请求体失控；限制值复用项目现有上传约束，若无现成约束则设置为 10 MiB 并集中定义。
- 限制单条消息附件数量，复用现有多选行为，不引入第二套队列。
- 校验只依赖结构化的 MIME、扩展名和文件对象属性，不使用关键词匹配文件内容。
- 后端会话层只将 `type: 'image'` 的附件转换为视觉输入；`type: 'file'` 必须先物化到会话附件目录，再以结构化路径上下文传递，不能伪装成图片。
- 会话结束或附件清理时删除服务端生成的临时附件，避免把用户上传内容长期留在运行目录。

## Testing

- 类型测试：允许的图片/文档通过，GIF、未知扩展名和不匹配类型拒绝。
- ChatPanel 测试：文件选择器的 `accept`、文档读取、图片/文档卡片展示、删除和发送条件。
- API/adapter 测试：图片和文档附件在请求体中保持类型、MIME、文件名和 Base64 数据。
- 会话服务测试：文档附件被写入安全目录并生成相对路径上下文，路径穿越、覆盖和不支持类型被拒绝；图片不写入文档目录。
- 历史消息测试：图片使用图片节点，文档使用文件卡片，不触发图片加载。
- 回归验证：前端全量 Vitest 与生产构建。

## Out of Scope

- 不在本次工作中解析 DOCX/XLSX 内容。
- 不在本次工作中新增对象存储或文档索引服务。
- 不支持 GIF、视频、音频、压缩包和可执行文件。

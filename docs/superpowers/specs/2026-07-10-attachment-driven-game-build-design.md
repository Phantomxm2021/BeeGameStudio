# Attachment-Driven Game Build Design

## Goal

让用户可以通过上传 GDD、图片或两者组合来构建游戏：完整 GDD 经过确认后直接进入构建，不再重复生成创意方案；图片先反推游戏设计文档，确认后再构建；不完整 GDD 只补齐缺失信息，不覆盖用户已有内容。

## Scope

本次只扩展 Landing/Idea Intake 的入口流程，复用现有项目创建、GDD 产物和构建链路。聊天框的通用图片/文档附件能力已经存在，本设计定义这些附件如何成为“构建输入”。不新增对象存储、不在浏览器解析 DOCX/XLSX、不改变现有纯文本创意输入流程。

## User Flow

```text
上传附件
    ↓
识别输入来源（GDD / 图片 / 混合）
    ↓
分析 GDD 完整度或从图片反推设计
    ↓
展示结构化摘要、缺失项、冲突和置信度
    ↓
用户确认 / 修改 / 移除附件
    ↓
保存确认后的 GDD
    ↓
进入现有游戏构建流程
```

纯文本创意没有附件时继续走原有 idea intake，不进入本流程。

## Structured Analysis Contract

分析结果使用结构化协议，不由前端通过关键词匹配决定流程：

```ts
type AttachmentBuildSource = 'gdd' | 'image' | 'mixed'
type AttachmentBuildCompleteness = 'complete' | 'partial' | 'unknown'

type AttachmentBuildAnalysis = {
  sourceType: AttachmentBuildSource
  completeness: AttachmentBuildCompleteness
  confirmedFacts: Array<{ field: string; value: string; source: string }>
  inferredDesign: Array<{
    field: string
    value: string
    confidence: 'high' | 'medium' | 'low'
    source: string
  }>
  missingFields: Array<{ field: string; reason: string }>
  conflicts: Array<{
    field: string
    gddValue: string
    imageValue: string
    resolution: 'needs_user_choice'
  }>
  gddDraft: string
}
```

规则：

- GDD 的明确内容进入 `confirmedFacts`，不得被图片推断覆盖。
- 图片只产生 `inferredDesign`；低置信度推断必须可见并等待确认。
- 混合输入以 GDD 为事实源，图片用于补充视觉、角色、场景、UI 和资产方向。
- `complete` 只表示构建所需的最小设计字段已明确，不代表文档覆盖所有可能章节。
- `partial` 时保留原文并只列出缺失字段；用户补充后重新分析增量内容。

## State Machine

Landing 的附件构建状态为：

- `idle`：无附件，或用户仍在编辑输入。
- `analyzing`：附件已提交，后端/Agent 正在分析。
- `needs_confirmation`：已生成完整 GDD 摘要或图片反推草案，等待用户确认。
- `needs_input`：输入不完整，显示缺失字段并允许继续补充。
- `ready_to_build`：用户已确认 GDD 和所有冲突选择。
- `building`：调用现有项目创建/构建入口，禁止重复提交。
- `failed`：分析或构建失败，保留附件和用户输入，提供重试与移除附件操作。

状态迁移必须由后端返回的结构化结果和用户操作驱动，不能根据展示文案或文件名猜测。

## UI Design

上传入口保留现有回形针按钮，但当用户从 Landing 上传附件时，按钮附近显示附件卡片：文件名、类型、大小和移除操作。提交后输入区切换为分析状态，显示“正在读取 GDD”或“正在从图片整理设计”等状态信息。

分析完成后显示确认面板：

- 顶部显示输入来源和完整度。
- 中间显示可编辑的 GDD 摘要/草案。
- 明确事实、图片推断、缺失字段和冲突分组展示。
- 低置信度推断带有待确认标记。
- 主按钮根据状态显示“确认并开始构建”“补充信息”“重新分析”。
- 混合输入冲突必须提供单字段选择，不能静默覆盖。

## API and Data Flow

前端通过现有附件协议把附件传给 BeeGame intake 接口，并增加一个结构化输入模式，例如 `inputMode: 'idea' | 'attachments'`。后端将文档物化到当前会话附件目录，将图片作为视觉输入，把分析结果规范化为 `AttachmentBuildAnalysis`。

确认后前端提交 `gddDraft` 和确认记录，后端保存 GDD 产物并调用现有构建入口。完整 GDD 不再调用“生成候选创意”的分支；图片反推和不完整 GDD 只在确认后进入构建。

确认记录需要包含用户对冲突和低置信度推断的选择，便于重试、审计和恢复：

```ts
type AttachmentBuildConfirmation = {
  analysisId: string
  accepted: boolean
  selectedConflicts: Record<string, 'gdd' | 'image' | 'custom'>
  editedGddDraft: string
}
```

## Error Handling and Safety

- 不支持类型或超过大小限制：在上传阶段拒绝，不发起分析。
- 分析超时：回到 `failed`，保留附件，可重试，不重复创建项目。
- GDD 无法读取：展示具体文件失败，不把空内容当作完整 GDD。
- 图片低置信度：允许用户编辑/补充，不自动推进构建。
- 混合输入冲突：必须显式选择或编辑后确认。
- 构建提交使用分析 ID 和客户端请求 ID 去重，确保重复点击只产生一次构建。
- 后端继续使用会话附件目录和现有路径隔离；分析结果中只展示安全相对路径，不泄漏 API Key 或内部绝对路径。

## Testing

- 纯文本输入保持原有 idea intake 行为。
- 完整 GDD 返回 `complete`，确认后跳过候选创意生成并只触发一次构建。
- 不完整 GDD 返回 `partial`，确认前显示缺失字段，补充后可重新分析。
- 单张图片返回反推 GDD 草案和置信度，确认后保存 GDD 再构建。
- GDD + 图片以 GDD 为事实源，冲突必须进入确认面板。
- 不支持附件、分析失败、超时和重复确认都有可恢复状态。
- 前端测试覆盖状态面板、编辑、移除、冲突选择和按钮锁定。
- 后端测试覆盖结构化分析协议、附件来源分流、跳过 idea intake、GDD 保存和请求去重。

## Out of Scope

- 不自动替用户解决 GDD 与图片之间的冲突。
- 不把低置信度图片推断直接当作构建事实。
- 不在本次工作中实现完整的多轮 GDD 编辑器或版本对比系统。
- 不改变聊天框中已经支持的附件类型和传输协议。

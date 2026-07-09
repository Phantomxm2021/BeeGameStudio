# Chat Document Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 BeeGame 聊天输入框安全支持 PNG/JPG/WEBP 图片和 PDF、DOC/DOCX、TXT、MD、CSV、XLS/XLSX、JSON、JSONL 文档，并让 Agent 能读取文档附件。

**Architecture:** 将当前图片专用附件改为图片/文件联合类型，客户端仍以 Base64 通过现有聊天请求发送。后端验证后把文档写入会话工作区的受控附件目录，并在 Agent 文本上下文中提供安全相对路径；图片继续转换为视觉输入。前端选择、粘贴、预览、发送和历史消息全部基于附件类型分流。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, BeeGame session manager, Bun/Conda project commands.

---

### Task 1: 建立共享附件协议和文件校验边界

**Files:**
- Create: `apps/frontend/src/services/chatAttachments.ts`
- Modify: `apps/frontend/src/services/api.ts:24-31`
- Modify: `apps/frontend/src/types/message.ts:60-74`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts` attachment payload types
- Test: `apps/frontend/src/services/chatAttachments.test.ts`

- [ ] **Step 1: Write the failing type and validation tests**

测试覆盖：PNG/JPG/WEBP、PDF、DOC/DOCX、TXT/MD、CSV、XLS/XLSX、JSON、JSONL 通过；GIF、视频、压缩包、未知扩展名和明确 MIME/扩展名冲突被拒绝；未知 MIME 但允许扩展名的系统文件可通过；超过 10 MiB 的文件被拒绝；读取结果生成 `type: 'image' | 'file'`、`mediaType`、`filename` 和 Base64 数据。

- [ ] **Step 2: Run the focused test and verify it fails for the missing shared module**

Run:

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/chatAttachments.test.ts
```

Expected: FAIL because `chatAttachments.ts` and the document attachment union do not exist yet.

- [ ] **Step 3: Implement the minimal shared contract**

在 `chatAttachments.ts` 集中定义：

```ts
export type ChatImageAttachmentPayload = {
  type: 'image'
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: string
  filename?: string
}

export type ChatFileAttachmentPayload = {
  type: 'file'
  mediaType: string
  data: string
  filename: string
}

export type ChatAttachmentPayload = ChatImageAttachmentPayload | ChatFileAttachmentPayload
```

同时导出允许扩展名/MIME 集合、`isSupportedChatFile(file)`、`filesToChatAttachments(files)` 和 `MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024`。类型定义在 `api.ts` 重新导出或引用，避免 API、消息和组件各自维护 MIME 联合类型。

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/chatAttachments.test.ts
conda run -n xrmoddemiurge npm run build
```

Expected: focused tests pass and TypeScript compilation passes.

- [ ] **Step 5: Commit the protocol boundary**

```bash
git add apps/frontend/src/services/chatAttachments.ts apps/frontend/src/services/chatAttachments.test.ts apps/frontend/src/services/api.ts apps/frontend/src/types/message.ts apps/frontend/src/services/beeGameAdapter.ts
git commit -m "feat: define chat document attachment protocol"
```

### Task 2: 接入聊天输入框的选择、粘贴和附件卡片

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.tsx`
- Modify: `apps/frontend/src/components/Demiurge/RightSidebar.tsx`
- Test: `apps/frontend/src/components/Demiurge/RightSidebar.test.tsx`
- Test: `apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.test.tsx`

- [ ] **Step 1: Write failing UI tests**

增加测试验证：两个 BeeGame file input 的 `accept` 包含允许图片和文档格式但不含 GIF；选择 `report.jsonl` 产生文件附件；选择 PNG 产生图片附件；选择 GIF 不调用新增附件回调；附件区对图片渲染 `img`，对文档渲染文件卡片并显示文件名；删除文档只删除对应附件；仅有文档附件时发送按钮可用。

- [ ] **Step 2: Run focused UI tests and verify the document cases fail**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/RightSidebar.test.tsx src/components/Demiurge/Sidebar/ChatPanel.test.tsx
```

Expected: document selection and document-card assertions fail because the panel only accepts and renders image attachments.

- [ ] **Step 3: Implement the UI integration**

将 `ChatPanel` 的 `imageAttachments`、`onAddImageAttachments`、`onRemoveImageAttachment` 改为通用 `attachments`；两个输入框使用同一份允许格式字符串；选择和粘贴统一调用 `filesToChatAttachments`；附件卡片按 `attachment.type` 分流，文档不构造 `data:*;base64` 的 `<img>`；发送条件改为 `chatInput.trim() || attachments.length > 0`。`RightSidebar` 状态和回调同步改名，但保留现有去重和删除行为。

- [ ] **Step 4: Run focused UI tests and the existing attachment regression tests**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/RightSidebar.test.tsx src/components/Demiurge/Sidebar/ChatPanel.test.tsx
```

Expected: all focused tests pass, including existing image paste/deduplication coverage.

- [ ] **Step 5: Commit the composer changes**

```bash
git add apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.tsx apps/frontend/src/components/Demiurge/RightSidebar.tsx apps/frontend/src/components/Demiurge/RightSidebar.test.tsx apps/frontend/src/components/Demiurge/Sidebar/ChatPanel.test.tsx
git commit -m "feat: support document attachments in chat composer"
```

### Task 3: 让消息和历史记录正确展示文档附件

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/Sidebar/ChatComponents.tsx`
- Modify: `apps/frontend/src/store/chatStore.ts`
- Modify: `apps/frontend/src/viewModels/displayModels.ts`
- Test: `apps/frontend/src/components/Demiurge/Sidebar/ChatComponents.test.tsx`

- [ ] **Step 1: Write failing history-rendering tests**

构造包含图片和 JSONL/PDF 文件附件的用户消息，断言图片只渲染图片节点，文档渲染文件卡片、文件名和 MIME/类型信息，且文档不会产生 `img[src^="data:"]`。

- [ ] **Step 2: Run the focused test and verify the document rendering fails**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/Sidebar/ChatComponents.test.tsx
```

Expected: document message currently attempts image rendering or lacks a document card.

- [ ] **Step 3: Implement type-aware message mapping and rendering**

让 display model、store merge 和消息归一化保留 `ChatAttachmentPayload` 联合类型；`ChatComponents` 对 `type: 'image'` 保留现有 `<img>`，对 `type: 'file'` 使用文件图标、文件名、可读扩展名和稳定 key，不读取文档 Base64 到 DOM。

- [ ] **Step 4: Run focused history tests**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/Sidebar/ChatComponents.test.tsx
```

Expected: image and document history rendering tests pass.

- [ ] **Step 5: Commit message rendering changes**

```bash
git add apps/frontend/src/components/Demiurge/Sidebar/ChatComponents.tsx apps/frontend/src/store/chatStore.ts apps/frontend/src/viewModels/displayModels.ts apps/frontend/src/components/Demiurge/Sidebar/ChatComponents.test.tsx
git commit -m "feat: render document chat attachments"
```

### Task 4: 扩展 BeeGame 会话层并安全物化文档

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing server tests**

测试发送包含文件附件的 BeeGame turn：允许类型被写入会话附件目录并生成相对路径上下文；文件名包含 `../`、绝对路径或覆盖同名文件时仍被隔离；GIF、未知扩展名、空数据和超大数据被拒绝；图片仍只进入视觉 prompt，不生成文档文件。

- [ ] **Step 2: Run focused server tests and verify failure**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
```

Expected: the new document attachment cases fail because the session manager accepts only `BeeGameImageAttachment` and filters all non-images.

- [ ] **Step 3: Implement the server attachment contract**

扩展服务端附件联合类型和校验函数；在 `send`/turn 启动前完成大小、MIME、扩展名和 Base64 校验；用服务端生成的唯一前缀和 `basename` 生成安全文件名；把文档写入会话工作区下的受控目录；为 prompt 文本追加结构化的附件路径说明；图片继续由 `buildBeeGamePromptInput` 生成视觉输入。清理逻辑在会话结束和异常路径中删除临时文档。

- [ ] **Step 4: Run focused server tests and typecheck**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
conda run -n xrmoddemiurge npm run build
```

Expected: server attachment tests pass and the monorepo TypeScript build passes.

- [ ] **Step 5: Commit server support**

```bash
git add packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git commit -m "feat: make document attachments available to BeeGame sessions"
```

### Task 5: 全量回归与安全验证

**Files:**
- Modify: none expected after Tasks 1-4
- Test: `apps/frontend/src/**/*.test.ts`, `apps/frontend/src/**/*.test.tsx`, `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Run the frontend full test baseline**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run
```

Expected: all frontend test files pass.

- [ ] **Step 2: Run server-focused and project build checks**

```bash
conda run -n xrmoddemiurge npm run build
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git diff --check
```

Expected: build and server tests pass; `git diff --check` produces no output.

- [ ] **Step 3: Verify the file policy manually without exposing contents**

检查允许列表中存在 JSON/JSONL，图片允许列表不含 GIF，服务端路径处理使用 `basename`/服务端唯一前缀，测试输出不打印 Base64 或 API Key。

- [ ] **Step 4: Commit only after all checks are green**

```bash
git status --short
git log -5 --oneline
```

Expected: working tree clean and the attachment commits visible at the top of the current branch.

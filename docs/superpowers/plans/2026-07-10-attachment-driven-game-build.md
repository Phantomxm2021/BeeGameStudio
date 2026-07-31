# Attachment-Driven Game Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Landing 支持 GDD、图片和混合附件分析，完整 GDD 确认后跳过创意方案生成，图片反推 GDD 后确认再进入现有构建流程。

**Architecture:** 在前后端增加结构化 `AttachmentBuildAnalysis` 协议。前端负责附件选择、分析状态和确认面板；后端复用已存在的会话附件读取能力，由模型按来源类型返回完整度、事实、推断、缺失项、冲突和 GDD 草案。确认后的 GDD 作为构建 brief 的显式字段传入现有项目创建/构建链路，纯文本输入保持原有 idea intake。

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Bun test, Hono, BeeGame session manager, existing credit/idempotency services.

---

### Task 1: 定义前后端结构化分析协议

**Files:**
- Create: `apps/frontend/src/services/attachmentBuild.ts`
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/services/api.ts`
- Create: `packages/agent-workflow-server/src/beegame/attachment-build.ts`
- Test: `apps/frontend/src/services/attachmentBuild.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-attachment-build.test.ts`

- [ ] **Step 1: Write failing contract tests**

前端测试先断言 `AttachmentBuildAnalysis` 的来源、完整度、事实、推断、缺失项、冲突和 `gddDraft` 可被规范化；后端测试断言完整 JSON 会保留确认事实、未知枚举会被拒绝、低置信度推断必须带 confidence。

- [ ] **Step 2: Run focused tests and verify missing-module failures**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/attachmentBuild.test.ts
bun test packages/agent-workflow-server/src/__tests__/beegame-attachment-build.test.ts
```

Expected: both suites fail because the shared analysis protocol does not exist.

- [ ] **Step 3: Implement shared protocol and normalization**

在两个 runtime 中定义同构协议：

```ts
type AttachmentBuildSource = 'gdd' | 'image' | 'mixed'
type AttachmentBuildCompleteness = 'complete' | 'partial' | 'unknown'
type AttachmentBuildAnalysis = {
  analysisId: string
  sourceType: AttachmentBuildSource
  completeness: AttachmentBuildCompleteness
  confirmedFacts: Array<{ field: string; value: string; source: string }>
  inferredDesign: Array<{ field: string; value: string; confidence: 'high' | 'medium' | 'low'; source: string }>
  missingFields: Array<{ field: string; reason: string }>
  conflicts: Array<{ field: string; gddValue: string; imageValue: string; resolution: 'needs_user_choice' }>
  gddDraft: string
}
```

前后端都拒绝未知来源、完整度和置信度；前端提供 `normalizeAttachmentBuildAnalysis`，后端提供相同约束的解析函数，不能通过文件名或展示文案推断流程。

- [ ] **Step 4: Run focused contract tests and typecheck**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/attachmentBuild.test.ts
bun test packages/agent-workflow-server/src/__tests__/beegame-attachment-build.test.ts
conda run -n xrmoddemiurge npm run typecheck
```

Expected: all protocol tests and typecheck pass.

- [ ] **Step 5: Commit the contract**

```bash
git add apps/frontend/src/services/attachmentBuild.ts apps/frontend/src/services/attachmentBuild.test.ts apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/api.ts packages/agent-workflow-server/src/beegame/attachment-build.ts packages/agent-workflow-server/src/__tests__/beegame-attachment-build.test.ts
git commit -m "feat: define attachment build analysis contract"
```

### Task 2: 增加后端附件分析入口和输入分流

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

新增 `/api/beegame-intake/analyze-attachments` 的同步测试和 job 轮询测试：GDD 文档返回 `sourceType: 'gdd'`；图片返回 `sourceType: 'image'`；两者返回 `mixed`；完整 GDD 不返回候选创意选项，而返回 `gddDraft` 和 `complete`；缺失信息返回 `partial`；重复 `clientRequestId` 不重复扣费或启动分析。

- [ ] **Step 2: Run route tests and verify the endpoint is missing**

```bash
bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'attachment analysis|analyze-attachments'
```

Expected: the new requests return 404 or fail because the route and analysis job are not implemented.

- [ ] **Step 3: Implement the analysis job**

新增 `runBeeGameAttachmentAnalysis` 和 job 路由，复用统一的 realtime usage event 与 `clientRequestId` 幂等逻辑。分析前把附件物化到会话目录；构造结构化模型指令：

```text
sourceType=gdd: extract confirmed facts, assess minimum build completeness, preserve user facts, and return a GDD draft.
sourceType=image: infer design with confidence per field and list uncertainty; never present low-confidence guesses as facts.
sourceType=mixed: treat GDD facts as authoritative and return conflicts instead of silently overwriting them.
```

模型返回必须经过后端解析和 schema 校验；仅对模型实际产生的使用量记录幂等 usage event，分析失败或超时后清理附件目录并返回可重试错误。

- [ ] **Step 4: Run route tests and existing intake regression tests**

```bash
bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'attachment analysis|analyze-attachments|idea intake'
conda run -n xrmoddemiurge npm run typecheck
```

Expected: new analysis cases and existing idea intake cases pass.

- [ ] **Step 5: Commit backend analysis**

```bash
git add packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git commit -m "feat: analyze attachment-driven game inputs"
```

### Task 3: 接入 Landing 附件分析 API 和构建 brief

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `apps/frontend/src/components/Demiurge/LandingView.tsx`
- Test: `apps/frontend/src/components/Demiurge/LandingView.test.tsx`
- Test: `apps/frontend/src/services/beeGameAdapter.test.ts`

- [ ] **Step 1: Write failing adapter and Landing tests**

覆盖以下行为：调用附件分析 API 并保留 `analysisId`；完整 GDD 进入 `needs_confirmation` 而不是 `options_ready`；图片进入 `needs_confirmation` 且展示推断项；不完整 GDD 进入 `needs_input`；确认时传递 `editedGddDraft`、冲突选择和 `analysisId`；确认按钮在请求期间禁用，失败后可重试。

- [ ] **Step 2: Run focused tests and verify the new flow is absent**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/LandingView.test.tsx src/services/beeGameAdapter.test.ts --reporter=dot
```

Expected: the new attachment analysis assertions fail while all existing text intake assertions remain intact.

- [ ] **Step 3: Add adapter methods and Landing state machine**

在 adapter 增加：

```ts
analyzeAttachmentBuild(input: {
  idea?: string
  attachments: ChatAttachmentPayload[]
  language: Language
  thinkingMode: BeeGameThinkingMode
  clientRequestId: string
}): Promise<AttachmentBuildAnalysis>
```

在 `LandingView` 增加 `attachmentBuildPhase`、`attachmentBuildAnalysis`、`attachmentBuildError`、`attachmentBuildAttachments` 和确认编辑状态；有附件时 `handleStart` 走分析流程，无附件时保持现有 `runIdeaIntake`。只在 `ready_to_build` 才调用现有 `bootstrapProjectFromBrief`，完整 GDD 不生成 `intake.options`。

- [ ] **Step 4: Run focused tests and frontend build**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/LandingView.test.tsx src/services/beeGameAdapter.test.ts --reporter=dot
conda run -n xrmoddemiurge npm run build
```

Expected: new attachment flow tests and existing Landing tests pass; production build succeeds.

- [ ] **Step 5: Commit Landing integration**

```bash
git add apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/beeGameAdapter.test.ts apps/frontend/src/components/Demiurge/LandingView.tsx apps/frontend/src/components/Demiurge/LandingView.test.tsx
git commit -m "feat: route Landing attachments into build analysis"
```

### Task 4: 实现分析确认面板和 GDD 直达构建

**Files:**
- Create: `apps/frontend/src/components/Demiurge/Landing/AttachmentBuildReview.tsx`
- Create: `apps/frontend/src/components/Demiurge/Landing/AttachmentBuildReview.test.tsx`
- Modify: `apps/frontend/src/components/Demiurge/LandingView.tsx`
- Modify: `apps/frontend/src/i18n/locales/en.json`
- Modify: `apps/frontend/src/i18n/locales/zh.json`

- [ ] **Step 1: Write failing review-panel tests**

断言面板展示来源、完整度、GDD 摘要、确认事实、图片推断、置信度、缺失项和冲突；可编辑 GDD 草案；冲突支持 GDD/图片/自定义选择；分析失败支持重试；确认过程中按钮禁用；确认后只触发一次 `onConfirm`。

- [ ] **Step 2: Run the review-panel tests and verify the component is missing**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/Landing/AttachmentBuildReview.test.tsx
```

Expected: FAIL because the review component does not exist.

- [ ] **Step 3: Implement the review panel and translations**

组件接收 `analysis`、`isSubmitting`、`onChangeDraft`、`onSelectConflict`、`onRetry`、`onConfirm`，只通过结构化字段渲染，不根据字段名关键词匹配。`LandingView` 在 `needs_confirmation`/`needs_input`/`failed` 状态挂载该面板；确认后把 `gddDraft` 写入 build brief，并进入既有 production settings/构建阶段。

- [ ] **Step 4: Run panel, Landing, and build checks**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/components/Demiurge/Landing/AttachmentBuildReview.test.tsx src/components/Demiurge/LandingView.test.tsx --reporter=dot
conda run -n xrmoddemiurge npm run build
```

Expected: all review and Landing tests pass and the build succeeds.

- [ ] **Step 5: Commit the confirmation UI**

```bash
git add apps/frontend/src/components/Demiurge/Landing/AttachmentBuildReview.tsx apps/frontend/src/components/Demiurge/Landing/AttachmentBuildReview.test.tsx apps/frontend/src/components/Demiurge/LandingView.tsx apps/frontend/src/i18n/locales/en.json apps/frontend/src/i18n/locales/zh.json
git commit -m "feat: add attachment build review flow"
```

### Task 5: 保存确认后的 GDD 并接入直接构建语义

**Files:**
- Modify: `apps/frontend/src/services/beeGameAdapter.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Test: `apps/frontend/src/services/beeGameAdapter.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write failing direct-build tests**

测试确认完整 GDD 后：保存 GDD 产物、携带 `analysisId` 和确认记录、跳过 `generateBeeGameIntakeOptions`、只启动一次构建；图片反推 GDD 同样先保存再构建；重复确认请求按 `clientRequestId` 返回同一结果。

- [ ] **Step 2: Run focused direct-build tests and verify the old build path is used**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/beeGameAdapter.test.ts
bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'confirmed GDD|direct build|analysisId'
```

Expected: new assertions fail because the existing build brief has no confirmed GDD/analysis metadata path.

- [ ] **Step 3: Implement confirmed GDD persistence and idempotent direct build**

扩展 build brief：`confirmedGdd`、`buildSource`、`analysisId`、`confirmation`；后端保存 `GDD.md` 或现有 GDD 产物记录后，直接进入项目构建。完整 GDD 不调用 idea intake option generator；所有确认请求使用 client request id 做幂等。

- [ ] **Step 4: Run direct-build tests and existing build regressions**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run src/services/beeGameAdapter.test.ts
bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'confirmed GDD|direct build|analysisId|bootstrap'
conda run -n xrmoddemiurge npm run typecheck
```

Expected: direct-build and existing bootstrap tests pass.

- [ ] **Step 5: Commit direct build support**

```bash
git add apps/frontend/src/services/beeGameAdapter.ts apps/frontend/src/services/beeGameAdapter.test.ts packages/agent-workflow-server/src/app.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts
git commit -m "feat: build games directly from confirmed GDDs"
```

### Task 6: 全量回归、状态恢复和安全检查

**Files:**
- Modify: none expected after Tasks 1-5
- Test: all frontend Vitest suites and attachment-related Bun suites

- [ ] **Step 1: Run the complete frontend baseline**

```bash
conda run -n xrmoddemiurge ./node_modules/.bin/vitest run --reporter=dot
```

Expected: all frontend tests pass, including plain-text intake, attachment composer and review-panel tests.

- [ ] **Step 2: Run backend analysis/build suites and typecheck**

```bash
bun test packages/agent-workflow-server/src/__tests__/beegame-attachment-build.test.ts
bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'attachment analysis|confirmed GDD|direct build|analysisId'
conda run -n xrmoddemiurge npm run typecheck
git diff --check
```

Expected: all attachment-driven suites pass, typecheck passes, and `git diff --check` is clean.

- [ ] **Step 3: Verify no secrets or unsafe paths are introduced**

确认分析日志不输出 Base64/API Key；附件路径只使用会话目录下的安全相对路径；确认记录不包含原始 secret；GIF 和不支持格式在前后端都被拒绝。

- [ ] **Step 4: Verify the final working tree**

```bash
git status --short
git log -8 --oneline
```

Expected: working tree clean and all attachment-driven build commits visible.

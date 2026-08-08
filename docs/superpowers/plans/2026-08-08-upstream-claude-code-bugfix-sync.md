# Upstream Claude Code Bugfix Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port every applicable runtime bugfix from `claude-code-best/claude-code` after local version `2.8.0` without overwriting BeeGame-specific behavior or introducing compatibility tracks.

**Architecture:** The upstream commit is the behavioral authority for each accepted bugfix. Apply fixes in upstream dependency order, preserve one local implementation per behavior, and use upstream tests or an equivalent focused regression before production changes. New upstream features, release metadata, documentation-only changes, issue templates, and platform defaults are outside this bugfix sync.

**Tech Stack:** TypeScript, Bun test, Vitest where declared by the package, Git upstream audit, Biome, TypeScript compiler.

---

## Accepted upstream bugfix matrix

| Area | Upstream authority | Local audit | Decision |
| --- | --- | --- | --- |
| UDS startup and macOS socket length | `d3121f0d` | Missing | Port |
| Null transcript messages | `2c801502` | Missing | Port |
| ACP POSIX wire paths | `106fd504` | Missing | Port |
| Windows Git Bash discovery and path safety | `7766597f`, `93ab1de3`, `6e413f8b`, `b7457527` | Missing | Port final upstream semantics |
| Null tool output and string rendering | `8246ffa3`, `cccd1ab4`, `5aa20afb` | Partially present | Port final upstream semantics only |
| Bounded session-message cache | `562da4c9` | Missing | Port |
| Stable attribution prompt prefix | `3edb1341` | Missing | Port |
| ExecuteTool null delegation and debug log ENOENT | `f9e77eb4` | Missing | Port |
| ChatGPT OAuth side queries | `1fa4bea6` | Missing | Port |
| Directory preflight for Read/Write/Edit | `fc207831` | Missing | Port |
| OpenAI cache scope, usage and model routing | `540e5fbf` | Partially diverged | Reconcile against upstream final semantics |
| Session-scoped cache-safe params | `73a07c69` | Missing | Port |
| Compact prompt security constraints | `e131914d` | Missing | Port |
| Custom perf-report config directory | `6dac3370` | Missing | Port |
| Workflow structured-output validation | `a4e96481`, `45c343fd` | Missing | Port both commits as one canonical boundary |
| Settings-based provider gates | `b9f1cff9` | Missing | Port |

Rejected from this sync: release-version commits, docs/contributor updates, issue templates, `.gitignore` maintenance, Artifact features, compact UI features, and Windows default-shell features. They are not bugfix prerequisites for the accepted runtime changes.

### Task 1: Establish RED coverage for exact upstream behaviors

**Files:**
- Modify/Create only the upstream test files named by the accepted commits.
- Add focused tests only where the upstream fix has no test.

- [x] **Step 1: Import upstream regression tests without production hunks**

  Import the exact test cases for UDS path bounds, Git Bash discovery, bounded session cache, ChatGPT side-query auth, cache-safe session invalidation, workflow structured output, provider gates, schema error paths, and task-id rendering.

- [x] **Step 2: Add focused coverage for untested upstream patches**

  Cover null transcript entries, ACP POSIX paths, null ExecuteTool delegation, directory preflight, debug directory recreation, compact security text, and custom perf-report directory behavior.

- [x] **Step 3: Verify RED by subsystem**

  Each test must fail for the missing upstream behavior before its production hunk is applied. Do not weaken assertions to fit local behavior.

### Task 2: Port storage, transcript, rendering, and worktree safety fixes

**Files:**
- `src/utils/sessionStorage.ts`
- `src/utils/messages.ts`
- `src/utils/messages/mappers.ts`
- `src/components/messages/**`
- `packages/builtin-tools/src/tools/{GoalTool,LocalMemoryRecallTool,VaultHttpFetchTool,ExecuteTool,EnterWorktreeTool,ExitWorktreeTool}/**`
- `src/Tool.ts`
- `src/utils/debug.ts`

- [x] **Step 1: Apply upstream final semantics in chronological order**
- [x] **Step 2: Remove superseded intermediate guards so only the final structural boundary remains**
- [x] **Step 3: Run focused tests and verify GREEN**

### Task 3: Port filesystem and cross-platform path fixes

**Files:**
- `src/setup.ts`
- `src/utils/udsMessaging.ts`
- `src/services/acp/bridge/paths.ts`
- `src/services/acp/utils.ts`
- `src/utils/windowsPaths.ts`
- `src/utils/permissions/pathValidation.ts`
- `src/utils/Shell.ts`
- `src/utils/doctorDiagnostic.ts`
- `packages/builtin-tools/src/tools/{FileReadTool,FileWriteTool,FileEditTool}/**`
- `src/commands/perf-issue/index.ts`

- [x] **Step 1: Apply the upstream path and directory checks without platform-specific BeeGame branching**
- [x] **Step 2: Run UDS, ACP, permissions, Windows path, file-tool, and perf-report tests**

### Task 4: Port context, cache, and compaction security fixes

**Files:**
- `src/constants/system.ts`
- `src/services/api/claude.ts`
- `src/utils/sideQuery.ts`
- `src/utils/cacheSafeParamsSlot.ts`
- `src/utils/forkedAgent.ts`
- `src/query/stopHooks.ts`
- `src/commands/{btw,clear,recap}/**`
- `src/services/compact/prompt.ts`

- [x] **Step 1: Remove the per-message attribution fingerprint exactly as upstream**
- [x] **Step 2: Move cache-safe params into the session-scoped canonical slot**
- [x] **Step 3: Preserve security constraints through compaction**
- [x] **Step 4: Run cache and compaction regressions**

### Task 5: Port workflow structured-output validation

**Files:**
- `packages/workflow-engine/src/engine/structuredOutput.ts`
- `packages/workflow-engine/src/engine/hooks.ts`
- `packages/workflow-engine/src/types.ts`
- `packages/workflow-engine/src/index.ts`
- `packages/workflow-engine/src/__tests__/**`

- [x] **Step 1: Validate schemas before journal replay or backend dispatch**
- [x] **Step 2: Validate live and journaled outputs at the same engine boundary**
- [x] **Step 3: Include JSON Pointer paths in canonical validation errors**
- [x] **Step 4: Run the complete workflow-engine suite**

### Task 6: Reconcile Provider and authentication fixes

**Files:**
- `src/utils/sideQuery.ts`
- `src/services/api/openai/**`
- `packages/@ant/model-provider/src/shared/**`
- `src/utils/model/**`
- `src/utils/auth.ts`
- `src/cli/handlers/auth.ts`
- `src/commands.ts`

- [x] **Step 1: Port ChatGPT OAuth side-query routing**
- [x] **Step 2: Reconcile OpenAI cache-key scope and usage mapping with the existing Provider terminal invariant**
- [x] **Step 3: Port settings-derived provider gates**
- [x] **Step 4: Run Provider, side-query, model-routing, and auth tests**

### Task 7: Full verification and pollution audit

- [x] **Step 1: Run affected package suites and TypeScript checks**
- [x] **Step 2: Run `git diff --check` and targeted formatting checks**
- [x] **Step 3: Confirm no example project, second implementation, feedback loop, compatibility parser, or hardcoded fixture entered production code**
- [x] **Step 4: Stop BeeGame service ports and report unrelated dirty changes separately**

# GitHub Core Snapshot Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared runtime core with pinned upstream commit `3bb6b5746238c418138eb96d57765d79012edd96`, allow only deterministic product-identity substitutions, and prevent future behavioral drift.

**Architecture:** A repository-owned manifest defines synchronized paths and exact branding substitutions. One Bun command audits or synchronizes those paths from a checkout of the pinned GitHub commit; Bee Game Studio compatibility remains outside the synchronized core. Offline verification precedes fixed-port Chrome acceptance.

**Tech Stack:** TypeScript, Bun, Git, JSON, TypeScript compiler, Bun test, controlled Chrome.

---

## File structure

- `config/upstream-core-alignment.json`: pinned repository, synchronized paths, exact substitutions, root exceptions.
- `scripts/upstream-core-alignment.ts`: manifest validation, audit, and exact synchronization.
- `scripts/__tests__/upstream-core-alignment.test.ts`: fail-closed unit tests.
- `package.json`: `core:audit`, `core:sync`, and combined BGS workspace integration.
- `src/**`, upstream-shared `packages/**`, and shared scripts: snapshot-controlled content.
- `packages/agent-workflow-server/**`, `packages/agent-workflow/**`, `packages/beegame-*/**`, `apps/frontend/**`: BGS-owned compatibility surface.

### Task 1: Define the pinned authority

**Files:**
- Create: `config/upstream-core-alignment.json`
- Create: `scripts/__tests__/upstream-core-alignment.test.ts`

- [ ] **Step 1: Write the RED manifest test**

```ts
import { describe, expect, test } from 'bun:test'
import { loadAlignmentManifest } from '../upstream-core-alignment'

describe('upstream core manifest', () => {
  test('pins upstream and excludes product trees', async () => {
    const value = await loadAlignmentManifest('config/upstream-core-alignment.json')
    expect(value.upstreamCommit).toBe('3bb6b5746238c418138eb96d57765d79012edd96')
    expect(value.synchronizedDirectories).toContain('src')
    expect(value.synchronizedDirectories).toContain('packages/workflow-engine')
    expect(value.synchronizedDirectories).not.toContain('packages/agent-workflow-server')
  })
})
```

- [ ] **Step 2: Run `bun test scripts/__tests__/upstream-core-alignment.test.ts`**

Expected: RED with missing `upstream-core-alignment` module.

- [ ] **Step 3: Create the manifest with exact synchronized directories**

```json
[
  "src",
  "packages/@ant",
  "packages/acp-link",
  "packages/agent-tools",
  "packages/audio-capture-napi",
  "packages/builtin-tools",
  "packages/cloud-artifacts",
  "packages/color-diff-napi",
  "packages/image-processor-napi",
  "packages/mcp-client",
  "packages/modifiers-napi",
  "packages/remote-control-server",
  "packages/url-handler-napi",
  "packages/weixin",
  "packages/workflow-engine"
]
```

Also synchronize shared root/build files and shared scripts that exist upstream. Global substitutions are limited to the internal package namespaces, `Claude Code Best` → `Bee Game Studio`, and the exact configuration key `CLAUDE_CONFIG_DIR` → `BEEGAME_CONFIG_DIR`. File-scoped substitutions may change package/update identity, product repository link, and OpenAI `originator`. They must not rewrite service domains, other environment variables, config-directory behavior, provider identifiers, or transport semantics. Declare `package.json`, `bun.lock`, and `tsconfig.json` as reasoned root integration exceptions.

- [ ] **Step 4: Commit**

```bash
git add config/upstream-core-alignment.json scripts/__tests__/upstream-core-alignment.test.ts
git commit -m "test: define pinned core alignment authority"
```

### Task 2: Implement deterministic audit and sync

**Files:**
- Create: `scripts/upstream-core-alignment.ts`
- Modify: `scripts/__tests__/upstream-core-alignment.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add RED tests for clean, modified, missing, local-only, binary, traversal, and symlink-escape cases**

```ts
const clean = await auditCoreAlignment({ manifest, upstreamRoot, localRoot })
expect(clean.differences).toEqual([])
expect(modified.differences).toContainEqual({ kind: 'modified', path: 'src/runtime.ts' })
expect(localOnly.differences).toContainEqual({ kind: 'local-only', path: 'src/local-only.ts' })
```

The branding test must prove an internal package namespace changes while `https://remote-control.claude-code-best.win/` remains unchanged.

- [ ] **Step 2: Implement these exports**

```ts
export type AlignmentDifference = {
  kind: 'missing' | 'local-only' | 'modified'
  path: string
}

export async function loadAlignmentManifest(path: string): Promise<AlignmentManifest>
export async function auditCoreAlignment(input: AlignmentInput): Promise<{ differences: AlignmentDifference[] }>
export async function syncCoreAlignment(input: AlignmentInput): Promise<void>
```

The implementation must verify upstream HEAD, confine paths to roots, enumerate POSIX paths bytewise, transform only valid UTF-8, compare binary bytes exactly, delete local-only synchronized files, add missing files, overwrite modified files, print every difference, and exit nonzero unless clean.

- [ ] **Step 3: Add CLI and package scripts**

```json
"core:audit": "bun run scripts/upstream-core-alignment.ts audit",
"core:sync": "bun run scripts/upstream-core-alignment.ts sync"
```

CLI usage:

```bash
bun run core:audit -- --upstream /absolute/upstream
bun run core:sync -- --upstream /absolute/upstream
```

- [ ] **Step 4: Verify and commit**

```bash
bun test scripts/__tests__/upstream-core-alignment.test.ts
git add scripts/upstream-core-alignment.ts scripts/__tests__/upstream-core-alignment.test.ts package.json
git commit -m "feat: audit pinned upstream core snapshot"
```

### Task 3: Replace the synchronized core

**Files:**
- Replace: `src/**`
- Replace: all synchronized packages and shared files declared by the manifest.

- [ ] **Step 1: Verify the upstream checkout**

```bash
git -C /private/tmp/claude-code-best-upstream-audit fetch origin main
git -C /private/tmp/claude-code-best-upstream-audit checkout --detach 3bb6b5746238c418138eb96d57765d79012edd96
git -C /private/tmp/claude-code-best-upstream-audit status --short
git -C /private/tmp/claude-code-best-upstream-audit rev-parse HEAD
```

Expected: clean status and exact pinned hash.

- [ ] **Step 2: Capture the current nonzero audit**

```bash
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
```

Expected: drift including `src/QueryEngine.ts`, provider termination changes, BGS config loaders, security imports, upstream-missing files, and local-only files.

- [ ] **Step 3: Synchronize and prove zero normalized drift**

```bash
bun run core:sync -- --upstream /private/tmp/claude-code-best-upstream-audit
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
```

Expected: `0 differences`.

- [ ] **Step 4: Verify forbidden core hooks are absent**

```bash
rg -n 'BEEGAME_|\.beegame|@bee-game-studio/security-core' src packages/@ant packages/acp-link packages/agent-tools packages/builtin-tools packages/mcp-client packages/workflow-engine
```

Expected: no runtime config/security-policy match.

- [ ] **Step 5: Commit the generated replacement**

```bash
git add -A src packages/@ant packages/acp-link packages/agent-tools packages/audio-capture-napi packages/builtin-tools packages/cloud-artifacts packages/color-diff-napi packages/image-processor-napi packages/mcp-client packages/modifiers-napi packages/remote-control-server packages/url-handler-napi packages/weixin packages/workflow-engine scripts build.ts biome.json bunfig.toml knip.json tsconfig.base.json vite.config.ts
git commit -m "refactor: align shared runtime core with upstream"
```

### Task 4: Reconcile the root workspace

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `tsconfig.json`

- [ ] **Step 1: Structurally reconcile `package.json`**

Preserve only BGS product identity, `apps/*`, BGS workspaces, and BGS service scripts. Align upstream version `2.8.4`, shared dependency versions, overrides, build/test scripts, and shared metadata. Remove root `@bee-game-studio/security-core` after synchronized imports disappear.

- [ ] **Step 2: Regenerate dependencies and audit namespace resolution**

```bash
bun install
rg -n '@claude-code-best/(agent-tools|builtin-tools|mcp-client|weixin|workflow-engine)' src packages scripts package.json
```

Expected: install succeeds and no internal upstream namespace remains. External `@claude-code-best/mcp-chrome-bridge` remains unchanged.

- [ ] **Step 3: Run `bun run typecheck`**

Expected: the duplicate declarations in `src/QueryEngine.ts` are gone. Record remaining BGS-owned caller failures exactly.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock tsconfig.json
git commit -m "build: reconcile BGS workspace with upstream core"
```

### Task 5: Adapt BGS callers outside the core

**Files:**
- Modify only compiler/test-identified files under `packages/agent-workflow-server/**`, `packages/agent-workflow/**`, `packages/beegame-*/**`, `apps/frontend/**`, and BGS-only scripts.

- [ ] **Step 1: Capture RED evidence**

```bash
bun run typecheck
bun test packages/agent-workflow-server/src
```

- [ ] **Step 2: Remove BGS launch dependence on removed core hooks**

Remove `BEEGAME_RUNTIME_MODEL_TYPE`, `BEEGAME_PROJECT_CONFIG_DIR_NAME`, core-loaded `.beegame` skills, and product security imports inside shared native tools. Keep the upstream configuration-directory behavior but mechanically rename its one environment key from `CLAUDE_CONFIG_DIR` to `BEEGAME_CONFIG_DIR`; do not emit, read, or fall back to both keys. Pass user-selected provider/model settings through upstream-supported settings/environment fields. Keep project state, workflow state, security checks, and skills in BGS-owned services.

- [ ] **Step 3: Adapt each changed API at the BGS caller**

Do not add core overloads, compatibility parsers, fallback tracks, or feature flags.

- [ ] **Step 4: Add boundary regressions**

```ts
expect(runtimeEnv.BEEGAME_RUNTIME_MODEL_TYPE).toBeUndefined()
expect(runtimeEnv.BEEGAME_PROJECT_CONFIG_DIR_NAME).toBeUndefined()
expect(runtimeEnv.BEEGAME_CONFIG_DIR).toBe(userSelectedConfigDir)
expect(runtimeEnv.CLAUDE_CONFIG_DIR).toBeUndefined()
expect(runtimeEnv.ANTHROPIC_MODEL).toBe(userSelectedModel)
```

Use actual upstream-supported variables per provider and assert original API/provider status, code, and message are forwarded.

- [ ] **Step 5: Verify and commit**

```bash
bun run typecheck
bun test packages/agent-workflow-server/src
bun test packages/agent-workflow/src packages/beegame-*/src
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
git add packages/agent-workflow packages/agent-workflow-server packages/beegame-* apps/frontend scripts
git commit -m "fix: adapt BGS boundary to upstream runtime"
```

Expected: tests pass and normalized core remains at zero differences.

### Task 6: Prevent silent core drift

**Files:**
- Create: `.github/workflows/core-alignment.yml`
- Modify: `README.md`

- [ ] **Step 1: Add CI pinned checkout and audit**

```yaml
- name: Clone pinned core
  run: |
    git clone --filter=blob:none https://github.com/claude-code-best/claude-code.git /tmp/claude-code-best
    git -C /tmp/claude-code-best checkout --detach 3bb6b5746238c418138eb96d57765d79012edd96
- name: Verify core authority
  run: bun run core:audit -- --upstream /tmp/claude-code-best
```

- [ ] **Step 2: Document the change rule**

Document deliberate pin upgrades, no BGS edits under synchronized paths, manifest-only branding, and mandatory `core:audit` before merge.

- [ ] **Step 3: Verify and commit**

```bash
bun test scripts/__tests__/upstream-core-alignment.test.ts
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
git diff --check
git add .github README.md
git commit -m "ci: prevent shared core behavioral drift"
```

### Task 7: Full offline verification

- [ ] **Step 1: Verify install and compile**

```bash
bun install --frozen-lockfile
bun run typecheck
```

- [ ] **Step 2: Run core and BGS suites**

```bash
bun test src packages/@ant packages/acp-link packages/agent-tools packages/builtin-tools packages/mcp-client packages/workflow-engine
bun test packages/agent-workflow packages/agent-workflow-server packages/beegame-* apps/frontend
```

- [ ] **Step 3: Run final pollution checks**

```bash
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
rg -n 'BEEGAME_RUNTIME_MODEL_TYPE|BEEGAME_PROJECT_CONFIG_DIR_NAME|CLAUDE_CONFIG_DIR|@bee-game-studio/security-core' src packages/@ant packages/acp-link packages/agent-tools packages/builtin-tools packages/mcp-client packages/workflow-engine
git diff --check
git status --short
```

Expected: compile/tests pass, zero normalized drift, no forbidden match, clean diff check.

### Task 8: Fixed-port controlled Chrome acceptance

**Files:**
- Evidence only under existing project/evidence conventions; never add the test idea or generated wording to production fixtures.

- [ ] **Step 1: Start and verify fixed ports**

Use frontend `62273`, runtime `62274`, billing `62275`, skills `62276`, resources `62277`. Confirm every listener with `lsof` before Chrome.

- [ ] **Step 2: Run actual UI acceptance**

Use controlled Chrome to create a new project from a fresh ordinary game idea, keep the user-selected provider/model unchanged, run the existing workflow, verify progressive native file writes, and wait for the complete persisted document set.

- [ ] **Step 3: Capture runtime evidence**

Record actual provider/model binding, prompt sizes, native tool inventory, thinking/completion reasons, original API errors, tokens per document and total, elapsed time, file-write events, and persisted byte counts.

- [ ] **Step 4: Audit the real documents**

Combine code evidence and document inspection. Report discipline coverage, responsibility boundaries, completeness, readability, direct development usefulness, redundancy, token optimization, and any remaining direct-runtime versus BGS difference.

- [ ] **Step 5: Final authority verification**

```bash
bun run core:audit -- --upstream /private/tmp/claude-code-best-upstream-audit
bun run typecheck
git diff --check
git status --short
```

Commit only repository-owned evidence allowed by policy; never commit secrets, credentials, or generated user project data.

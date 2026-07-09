# Generic Web Preview Refresh Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make managed Web previews obey a framework-neutral contract so React Refresh modules never execute without their HTML preamble, while Vite HMR is not half-proxied.

**Architecture:** Vite development clients run through a dedicated host entry that loads the project's own Vite config but disables HMR at the managed-preview boundary. The preview manager records that the client uses the Vite host, and the runtime proxy preserves the configured public base when forwarding HTML and module requests. Tests use a temporary generic React/Vite-shaped workspace and assert protocol behavior rather than project content.

**Tech Stack:** Bun/TypeScript, Vite Node API, Hono/Bun runtime proxy, Bun test, Vitest frontend tests, Chrome smoke verification.

---

### Task 1: Add failing generic preview contract tests

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/preview-manager.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Write a failing environment-isolation test**

Set the parent `NODE_ENV` to `production`, create a temporary manifest with a Vite `dev` script, capture the runner environment, and assert the client process receives `NODE_ENV=development` plus the dedicated host command.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run `bun test packages/agent-workflow-server/src/__tests__/preview-manager.test.ts`.
Expected: the captured command is the existing package-manager command and the environment remains `production`.

- [ ] **Step 3: Add a failing base-preserving proxy assertion**

Use a fake upstream that records its request URL and returns HTML containing a module entry. Start a managed Vite-shaped preview with `/previews/<session>/` as its base and assert the upstream receives that same prefix for the HTML and module requests.

- [ ] **Step 4: Run the route test and verify the expected failure**

Run `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'managed preview|proxy'`.
Expected: the upstream receives the stripped path instead of the configured public base.

### Task 2: Implement the isolated Vite preview host

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/vite-preview-host.ts`
- Modify: `packages/agent-workflow-server/src/beegame/preview-manager.ts`

- [ ] **Step 1: Add the host entry with explicit HMR policy**

The host must resolve `vite` from the preview workspace with `createRequire`, call `createServer` with `root`, `base`, `host`, `port`, `strictPort: true`, and `hmr: false`, then call `listen()` and `printUrls()`. It must forward SIGINT/SIGTERM to `server.close()`.

- [ ] **Step 2: Route only Vite development clients through the host**

When the selected script is `dev` and the manifest has Vite capability, construct `[process.execPath, <host-entry>, '--host', host, '--port', port, '--base', publicPath]`. Keep non-Vite clients and Vite production preview scripts on their existing package-manager path.

- [ ] **Step 3: Isolate the child environment**

Set `NODE_ENV=development` only on the managed Vite development client. Do not alter the runtime, billing, skills, server process, or future engine adapters.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run `bun test packages/agent-workflow-server/src/__tests__/preview-manager.test.ts` and the focused route tests. Expected: all assertions pass.

### Task 3: Preserve Vite base paths through the runtime proxy

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/preview-manager.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [ ] **Step 1: Expose a per-session public-path capability**

Store whether the selected client was started with `--base <publicPath>` and pass that capability to the proxy handler. Do not infer it from source text or a project name.

- [ ] **Step 2: Forward the complete public path when required**

For a base-configured client, forward `/previews/<session>/...` unchanged to the upstream Vite server. For clients without a base, retain the existing path stripping behavior.

- [ ] **Step 3: Keep HTML transform ownership with Vite**

The runtime proxy must forward Vite's transformed HTML and only append the existing console bridge. It must not synthesize React-specific code or inspect source text.

- [ ] **Step 4: Run route tests**

Run `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts --test-name-pattern 'proxy|base|iframe'`. Expected: HTML, TSX, CSS, and Vite client paths all resolve through the same base.

### Task 4: Add generic integration verification

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/preview-manager.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
- Create: `packages/agent-workflow-server/src/__tests__/fixtures/generic-react-preview/` only if the existing temporary-workspace helpers cannot express the contract

- [ ] **Step 1: Assert the HTML/module invariant**

Verify that a Vite dev host with HMR disabled does not produce a module requiring `$RefreshSig$`, and that the HTML response does not claim an HMR client. If HMR is enabled in a future adapter, assert the HTML contains the preamble before the entry module.

- [ ] **Step 2: Assert nested asset reachability**

Request a nested TSX module and stylesheet through the managed preview route and require status 200 for both, without matching filenames beyond the fixture's declared entry URLs.

- [ ] **Step 3: Run backend typecheck and focused suite**

Run `bun run typecheck` in `packages/agent-workflow-server`, then run the two focused test files. Expected: no type errors and no failures.

### Task 5: Verify the real stack without project-specific assertions

**Files:**
- No generated project files modified.

- [ ] **Step 1: Restart the local stack cleanly**

Stop the existing supervisor and preview descendants, confirm ports are free, then start the stack once.

- [ ] **Step 2: Start any available managed Web preview**

Use the dashboard control to start the current preview only as an integration subject; do not alter its source files.

- [ ] **Step 3: Verify browser protocol signals**

Confirm the iframe renders, nested module/CSS requests are successful, and browser logs contain none of `ReferenceError: $RefreshSig$`, preview module 404s, or Vite WebSocket upgrade errors.

- [ ] **Step 4: Run final diff hygiene checks**

Run `git diff --check`, inspect `git status --short`, and ensure only intended runtime/test/docs files changed; preserve all pre-existing user modifications.


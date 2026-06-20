# Web Dashboard MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Web dashboard slice that replaces `/login` with browser-based model configuration and establishes project/run/artifact foundations for game generation.

**Architecture:** Extend `packages/remote-control-server` rather than touching the shared `QueryEngine` or CLI/TUI. Add focused services and Web routes for model configs, projects, runs, and artifacts, then expose them through the existing React dashboard shell. The first executable slice is model configuration because later game runs need a selected provider.

**Tech Stack:** Bun, Hono, React 19, Vite, TypeScript strict mode, `bun:test`.

---

## File Map

New backend files:

- `packages/remote-control-server/src/services/model-config.ts`: in-memory model configuration service, validation, masking, runtime env mapping.
- `packages/remote-control-server/src/routes/web/model-configs.ts`: authenticated Web CRUD and test-connection endpoints for model configs.
- `packages/remote-control-server/src/services/dashboard-projects.ts`: project/run/artifact in-memory service for the dashboard MVP.
- `packages/remote-control-server/src/routes/web/dashboard-projects.ts`: project/run/artifact Web routes.
- `packages/remote-control-server/src/__tests__/model-config.test.ts`: service-level model config tests.
- `packages/remote-control-server/src/__tests__/model-config-routes.test.ts`: route-level model config tests.
- `packages/remote-control-server/src/__tests__/dashboard-projects.test.ts`: service-level project/run/artifact tests.

Modified backend files:

- `packages/remote-control-server/src/index.ts`: mount new Web routes.
- `packages/remote-control-server/src/store.ts`: call new service resets from `storeReset()` so tests isolate dashboard data.

New frontend files:

- `packages/remote-control-server/web/src/pages/Models.tsx`: Model Settings page.
- `packages/remote-control-server/web/src/pages/NewGame.tsx`: New Game form.
- `packages/remote-control-server/web/src/pages/RunDetail.tsx`: Run detail shell for phase/artifact display.

Modified frontend files:

- `packages/remote-control-server/web/src/api/client.ts`: API functions for model configs and dashboard project/run/artifact calls.
- `packages/remote-control-server/web/src/App.tsx`: route `/code/models`, `/code/new-game`, and `/code/runs/:runId`.
- `packages/remote-control-server/web/src/pages/Dashboard.tsx`: add entry points to New Game and Models.

## Task 1: Model Config Service

**Files:**
- Create: `packages/remote-control-server/src/services/model-config.ts`
- Create: `packages/remote-control-server/src/__tests__/model-config.test.ts`
- Modify: `packages/remote-control-server/src/store.ts`

- [ ] **Step 1: Write failing service tests**

Create `packages/remote-control-server/src/__tests__/model-config.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  createModelConfig,
  deleteModelConfig,
  getDefaultModelConfig,
  getModelConfig,
  listModelConfigs,
  mapModelConfigToRuntime,
  resetModelConfigs,
  updateModelConfig,
} from '../services/model-config'

describe('model config service', () => {
  beforeEach(() => {
    resetModelConfigs()
  })

  test('creates a masked default OpenAI-compatible config', () => {
    const config = createModelConfig('local-user', {
      name: 'OpenRouter',
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test-secret',
      models: {
        fast: 'openai/gpt-4.1-mini',
        balanced: 'anthropic/claude-sonnet-4',
        strong: 'anthropic/claude-opus-4',
      },
      isDefault: true,
    })

    expect(config.id).toMatch(/^llm_/)
    expect(config.ownerId).toBe('local-user')
    expect(config.apiKeyPreview).toBe('sk-t...cret')
    expect(config.apiKey).toBeUndefined()
    expect(getDefaultModelConfig('local-user')?.id).toBe(config.id)
  })

  test('keeps only one default config per owner', () => {
    const first = createModelConfig('local-user', {
      name: 'First',
      provider: 'anthropic-compatible',
      apiKey: 'first-secret',
      models: {},
      isDefault: true,
    })
    const second = createModelConfig('local-user', {
      name: 'Second',
      provider: 'gemini',
      apiKey: 'second-secret',
      models: { balanced: 'gemini-2.5-pro' },
      isDefault: true,
    })

    expect(getModelConfig(first.id)?.isDefault).toBe(false)
    expect(getDefaultModelConfig('local-user')?.id).toBe(second.id)
  })

  test('updates config without exposing the stored API key', () => {
    const config = createModelConfig('local-user', {
      name: 'Provider',
      provider: 'openai-compatible',
      apiKey: 'sk-original',
      models: {},
      isDefault: true,
    })

    const updated = updateModelConfig(config.id, {
      name: 'Provider Updated',
      apiKey: 'sk-replacement',
    })

    expect(updated?.name).toBe('Provider Updated')
    expect(updated?.apiKeyPreview).toBe('sk-r...ment')
    expect(updated?.apiKey).toBeUndefined()
  })

  test('lists configs by owner only', () => {
    createModelConfig('alice', {
      name: 'Alice',
      provider: 'openai-compatible',
      apiKey: 'alice-secret',
      models: {},
      isDefault: true,
    })
    createModelConfig('bob', {
      name: 'Bob',
      provider: 'gemini',
      apiKey: 'bob-secret',
      models: {},
      isDefault: true,
    })

    expect(listModelConfigs('alice').map(c => c.name)).toEqual(['Alice'])
  })

  test('maps OpenAI-compatible config to existing runtime env names', () => {
    const config = createModelConfig('local-user', {
      name: 'OpenAI Compat',
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'sk-secret',
      models: {
        fast: 'fast-model',
        balanced: 'balanced-model',
        strong: 'strong-model',
      },
      isDefault: true,
    })

    expect(mapModelConfigToRuntime(config.id)).toEqual({
      modelType: 'openai',
      env: {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://api.example.test/v1',
        OPENAI_API_KEY: 'sk-secret',
        OPENAI_DEFAULT_HAIKU_MODEL: 'fast-model',
        OPENAI_DEFAULT_SONNET_MODEL: 'balanced-model',
        OPENAI_DEFAULT_OPUS_MODEL: 'strong-model',
      },
    })
  })

  test('deletes configs and clears default lookup', () => {
    const config = createModelConfig('local-user', {
      name: 'Delete Me',
      provider: 'grok',
      apiKey: 'grok-secret',
      models: {},
      isDefault: true,
    })

    expect(deleteModelConfig(config.id)).toBe(true)
    expect(getModelConfig(config.id)).toBeUndefined()
    expect(getDefaultModelConfig('local-user')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config.test.ts
```

Expected: FAIL because `../services/model-config` does not exist.

- [ ] **Step 3: Implement service**

Create `packages/remote-control-server/src/services/model-config.ts` with exported functions from the test. Use `randomUUID()` for ids, keep the real key only inside a private in-memory record, and return public records with `apiKeyPreview` only.

- [ ] **Step 4: Reset service from store reset**

Modify `packages/remote-control-server/src/store.ts`:

```ts
import { resetModelConfigs } from './services/model-config'
```

Then update `storeReset()` to call `resetModelConfigs()`.

- [ ] **Step 5: Run service test and package typecheck**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config.test.ts
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
```

Expected: service tests pass and `tsc --noEmit` passes for the package.

- [ ] **Step 6: Commit**

```bash
git add packages/remote-control-server/src/services/model-config.ts packages/remote-control-server/src/__tests__/model-config.test.ts packages/remote-control-server/src/store.ts
git commit -m "feat: add dashboard model config service"
```

## Task 2: Model Config Web Routes

**Files:**
- Create: `packages/remote-control-server/src/routes/web/model-configs.ts`
- Create: `packages/remote-control-server/src/__tests__/model-config-routes.test.ts`
- Modify: `packages/remote-control-server/src/index.ts`

- [ ] **Step 1: Write failing route tests**

Create route tests that mount `app.route('/web', webModelConfigs)`, use `?uuid=browser-user`, and verify:

- `GET /web/model-configs` returns `[]`.
- `POST /web/model-configs` creates a masked config and never returns `apiKey`.
- `PATCH /web/model-configs/:id` can change default.
- `POST /web/model-configs/:id/test` returns `{ ok: true, provider, model }` when the config has at least one model.
- `DELETE /web/model-configs/:id` removes the config.

- [ ] **Step 2: Run route test and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config-routes.test.ts
```

Expected: FAIL because the route file does not exist.

- [ ] **Step 3: Implement route**

Create Hono routes using existing `uuidAuth`. Return 400 for invalid provider, invalid URL, missing name, or missing API key on create. The test endpoint is a local validation endpoint in this task; do not call external LLM APIs yet.

- [ ] **Step 4: Mount route**

Modify `packages/remote-control-server/src/index.ts` to import and mount:

```ts
import webModelConfigs from './routes/web/model-configs'
app.route('/web', webModelConfigs)
```

- [ ] **Step 5: Run route tests and package typecheck**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config-routes.test.ts
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
```

Expected: tests and package typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add packages/remote-control-server/src/routes/web/model-configs.ts packages/remote-control-server/src/__tests__/model-config-routes.test.ts packages/remote-control-server/src/index.ts
git commit -m "feat: expose dashboard model config routes"
```

## Task 3: Frontend Model Settings API

**Files:**
- Modify: `packages/remote-control-server/web/src/api/client.ts`
- Modify: `packages/remote-control-server/web/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Write failing frontend API tests**

Add tests that verify:

- `apiFetchModelConfigs()` calls `GET /web/model-configs`.
- `apiCreateModelConfig()` sends a JSON body containing provider/baseUrl/models/apiKey.
- active bearer token is sent in headers and not query params.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun test web/src/__tests__/api-client.test.ts
```

Expected: FAIL because API functions are missing.

- [ ] **Step 3: Implement API functions and types**

Add `ModelProviderKind`, `ModelConfig`, `ModelConfigInput`, and API functions to `web/src/api/client.ts`.

- [ ] **Step 4: Run tests and package typecheck**

Run:

```bash
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun test web/src/__tests__/api-client.test.ts
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
```

Expected: tests and package typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-control-server/web/src/api/client.ts packages/remote-control-server/web/src/__tests__/api-client.test.ts
git commit -m "feat: add dashboard model config client"
```

## Task 4: Model Settings Page

**Files:**
- Create: `packages/remote-control-server/web/src/pages/Models.tsx`
- Modify: `packages/remote-control-server/web/src/App.tsx`
- Modify: `packages/remote-control-server/web/src/pages/Dashboard.tsx`

- [ ] **Step 1: Add page and route**

Create a restrained settings page with provider selector, name, base URL, API key, fast/balanced/strong model inputs, save button, and existing config list with masked keys.

- [ ] **Step 2: Add dashboard entry point**

Add a `Models` button/link near the existing New Session action. Use existing button styling and avoid large marketing layout.

- [ ] **Step 3: Run package typecheck**

Run:

```bash
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
```

Expected: typecheck passes.

- [ ] **Step 4: Commit**

```bash
git add packages/remote-control-server/web/src/pages/Models.tsx packages/remote-control-server/web/src/App.tsx packages/remote-control-server/web/src/pages/Dashboard.tsx
git commit -m "feat: add model settings dashboard page"
```

## Task 5: Dashboard Project/Run/Artifact Foundation

**Files:**
- Create: `packages/remote-control-server/src/services/dashboard-projects.ts`
- Create: `packages/remote-control-server/src/__tests__/dashboard-projects.test.ts`

- [ ] **Step 1: Write failing service tests**

Tests should verify:

- Creating a game project stores `idea`, `targetPlatform`, and `workspacePath`.
- Creating a run initializes the documented phase list.
- Creating artifacts associates them to project/run and lists by run.
- Artifact paths outside the project workspace are rejected.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/dashboard-projects.test.ts
```

Expected: FAIL because service file does not exist.

- [ ] **Step 3: Implement service**

Use in-memory maps, stable status unions, and `node:path` containment checks. Do not run agents in this task.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/dashboard-projects.test.ts
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
```

Expected: tests and package typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add packages/remote-control-server/src/services/dashboard-projects.ts packages/remote-control-server/src/__tests__/dashboard-projects.test.ts
git commit -m "feat: add dashboard project run artifact service"
```

## Verification Notes

- Full repo `bun run typecheck` currently has a pre-existing baseline error in `src/services/lsp/passiveFeedback.ts:64`. For this implementation slice, use `packages/remote-control-server` typecheck as the required gate.
- Before final handoff, run:

```bash
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun run typecheck
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config.test.ts
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/model-config-routes.test.ts
/Users/nswell/.bun/bin/bun test packages/remote-control-server/src/__tests__/dashboard-projects.test.ts
cd packages/remote-control-server && /Users/nswell/.bun/bin/bun test web/src/__tests__/api-client.test.ts
```


# Direct Claude Layer Test Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a secret local environment file and a safe committed template for direct provider and Claude CLI diagnostics that do not depend on BeeGame runtime configuration.

**Architecture:** The committed example defines the complete seven-field contract. The local file contains operator-supplied values and is explicitly ignored by Git; no loader or product code changes are included.

**Tech Stack:** dotenv-compatible environment files, Git ignore rules, shell validation.

---

### Task 1: Add the isolated environment contract

**Files:**
- Modify: `.gitignore`
- Create: `.env.direct-claude-test.example`
- Create locally (ignored): `.env.direct-claude-test`

- [ ] **Step 1: Add the secret file to Git ignore rules**

Append exactly:

```gitignore
.env.direct-claude-test
```

- [ ] **Step 2: Create the committed example**

Create `.env.direct-claude-test.example` with:

```dotenv
DIRECT_PROVIDER=anthropic-compatible
DIRECT_BASE_URL=
DIRECT_API_KEY=
DIRECT_FAST_MODEL=
DIRECT_BALANCED_MODEL=
DIRECT_STRONG_MODEL=
DIRECT_STREAM_IDLE_TIMEOUT_MS=45000
```

- [ ] **Step 3: Create the operator file**

Create `.env.direct-claude-test` with the same keys and empty credential/model values. Do not copy values from BeeGame, Supabase, `.env.local`, or browser state.

- [ ] **Step 4: Verify the contract and secret isolation**

Run:

```bash
diff -u .env.direct-claude-test.example .env.direct-claude-test
git check-ignore .env.direct-claude-test
git diff --check
```

Expected: `diff` has no output, `git check-ignore` prints `.env.direct-claude-test`, and `git diff --check` has no output.

- [ ] **Step 5: Commit only the template and ignore rule**

```bash
git add .gitignore .env.direct-claude-test.example docs/superpowers/plans/2026-08-11-direct-claude-layer-test-env.md
git commit -m "test: add isolated claude model environment"
```

Expected: the ignored `.env.direct-claude-test` is not included in the commit.

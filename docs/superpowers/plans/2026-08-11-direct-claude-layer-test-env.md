# Direct Claude Layer Test Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a secret local environment file and safe committed template with isolated Anthropic and OpenAI-compatible configurations for direct provider and Claude CLI diagnostics that do not depend on BeeGame runtime configuration.

**Architecture:** The committed example defines separate protocol-specific field groups plus one shared timeout. The local file contains operator-supplied values and is explicitly ignored by Git; no loader or product code changes are included, and tests must fail rather than reuse credentials or models across protocols.

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

### Task 2: Isolate the OpenAI-compatible configuration

**Files:**
- Modify: `.env.direct-claude-test.example`
- Modify locally (ignored): `.env.direct-claude-test`

- [ ] **Step 1: Verify the OpenAI field group is absent**

Run:

```bash
test -z "$(sed -n '/^DIRECT_OPENAI_/p' .env.direct-claude-test.example)"
```

Expected: exit code `0`, proving the committed template has not yet isolated OpenAI-compatible settings.

- [ ] **Step 2: Add the isolated OpenAI field group to the template**

Append exactly before `DIRECT_STREAM_IDLE_TIMEOUT_MS`:

```dotenv
DIRECT_OPENAI_BASE_URL=
DIRECT_OPENAI_API_KEY=
DIRECT_OPENAI_FAST_MODEL=
DIRECT_OPENAI_BALANCED_MODEL=
DIRECT_OPENAI_STRONG_MODEL=
```

- [ ] **Step 3: Add the same empty field group to the ignored operator file**

Insert the same five keys into `.env.direct-claude-test` without copying any Anthropic values. Preserve all operator-supplied Anthropic values unchanged.

- [ ] **Step 4: Verify protocol isolation and secret safety**

Run:

```bash
test "$(sed -n '/^DIRECT_OPENAI_/p' .env.direct-claude-test.example | wc -l | tr -d ' ')" = "5"
test "$(sed -n '/^DIRECT_OPENAI_/p' .env.direct-claude-test | wc -l | tr -d ' ')" = "5"
git check-ignore .env.direct-claude-test
git diff --check
```

Expected: both counts equal `5`, Git reports `.env.direct-claude-test` as ignored, and the diff check has no output.

- [ ] **Step 5: Commit only the public contract and plan**

```bash
git add .env.direct-claude-test.example docs/superpowers/plans/2026-08-11-direct-claude-layer-test-env.md
git commit -m "test: isolate direct provider configurations"
```

Expected: the ignored `.env.direct-claude-test` is not included in the commit.

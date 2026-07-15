---
name: beegame-game-acceptance
description: Use when verifying a generated game project before user review, continuing after failed acceptance checks, or auditing implementation against the confirmed brief, player loop, UI/UX, art/audio direction, placeholder assets, and target-appropriate validation.
---

# BeeGame Game Acceptance

Use this skill as your own delivery discipline before you tell the user a game project is ready for review.

BeeGame is only the dashboard shell. Do not rely on BeeGame to judge gameplay quality, block progress, or infer completion from a turn ending. You are responsible for planning, implementing, checking, fixing, and reporting the real delivery state.

## Core Rule

Do not treat any of these as proof that the game is complete:

- An API turn ending.
- A confident summary message.
- Typecheck, lint, or build success by itself.
- Empty tests, tests with no meaningful assertions, or test flags that allow no tests.
- A class, script, prefab, scene, handler, asset, or document existing but not being wired into the playable path.

Only claim what you actually verified.

## Delivery Workflow

1. Read the confirmed brief and the project docs.
2. Inspect the project structure from the project directory.
3. Identify the project type from files and config, not from assumptions.
4. Use the project's own tooling and target platform. Do not force a specific package manager, engine, browser, test runner, or framework.
5. Verify that docs distinguish:
   - implemented in this delivery
   - roadmap or future work
6. Keep acceptance criteria in docs as requirements. Do not pre-check or mark them as passed inside planning docs.
   - Every checklist task must begin with `[requirement:stable-id]` or `[player-path:stable-id]`.
   - IDs are explicit document structure. Do not derive them from keywords, game names, or platform assumptions.
7. If production art/audio is not available, make placeholder assets or asset slots intentional, named, documented, and replaceable.
8. Run the checks that fit this project.
9. Exercise the real player path when the environment allows it.
10. Fix discovered problems and rerun the relevant checks.
11. Report evidence and known gaps honestly.

Run one validator for one implementation revision. After a failed result, change the implementation or approved documents before validating again. If the same finding repeats without a relevant change, report the concrete blocker or remaining work instead of spawning validators indefinitely or rewriting evidence.

After the final validation result, update checklist markers from that exact result first, then write `docs/acceptance/validation-report.json` last. Any subsequent project change makes the persisted report stale and requires validation of the affected behavior.

The terminal report must include `assetsRequired: true|false`, derived from the approved documents. If it is true, the canonical asset manifest is mandatory; never make a missing manifest disappear by claiming the project is asset-free.

## Player Path

For the target platform, verify the path a real player would take:

- Start or enter the experience.
- Understand the objective from UI, onboarding, level design, rules, or context.
- Perform the core action.
- Receive visible, audible, haptic, score, state, or other appropriate feedback.
- Reach win, fail, progression, scoring, or another meaningful outcome.
- Restart, continue, replay, recover, or otherwise keep playing.

If runtime interaction is unavailable, inspect the code path from input to state change to rendering/output and clearly mark runtime behavior as unverified.

## Docs And Assets

Compare docs and implementation. Report material mismatches, especially:

- A documented mechanic is absent or not wired.
- A documented UI screen or flow is missing.
- A documented asset directory, placeholder rule, or replacement path does not exist.
- A documented command fails or depends on undeclared tools.
- The README claims a setup or run path that does not work.
- Roadmap features are described as completed features.

Do not count clearly labeled roadmap items as failures.

First determine from the approved project documents whether the project requires managed assets. When it does, `assets/asset-manifest.json` is required; do not interpret a missing manifest as proof that the project is asset-free. A genuinely asset-free project does not need a manifest when that conclusion is consistent with its approved documents.

When `assets/asset-manifest.json` exists, treat it as the canonical BeeGame asset contract rather than a free-form asset inventory. Its root shape is:

```json
{
  "version": 1,
  "project_target": {
    "kind": "target kind",
    "engine": "target runtime or engine",
    "integration_mode": "filesystem|mcp|manual",
    "asset_format_capabilities": ["supported-format"]
  },
  "slots": []
}
```

Each slot requires a stable `id` and project-relative `target.path`. A slot that may use the resource library must carry a structured `resource_requirement` with canonical `category`, `dimension`, non-empty `accepted_formats`, canonical usage `tags`, and `purpose`. Do not replace this contract with project-specific `assets`, `models`, `audio`, `procedural`, or slot-map roots. Do not mark a slot `integrated` merely because metadata exists: verify binding provenance, copied files, code references, packaging, and runtime loading.

Use the canonical manifest vocabulary supplied in the current BeeGame build prompt or validator system prompt; never guess enum values. `delivery_mode` distinguishes `managed-file`, `embedded`, and `procedural` slots. `uploaded_files` contains actual resource files only. `target.path` identifies the integration destination or embedded/procedural source, while `integration_evidence.references` records code or scene references separately. `required` defaults to true, and every required slot must have observable runtime-load evidence before delivery can pass.

## Evidence

For each command, runtime action, editor check, or manual verification you use as evidence, record:

- working directory
- exact command or action
- exit code or observed result
- conclusion

Give every evidence observation a stable id. For a player path, also record the declared player-path id, exact action, observable assertion, result, and any project-relative evidence artifact. Asset `runtime_event_ids` may reference only these observed runtime evidence ids. A function existing, a source file compiling, or a test printing success without an assertion is not player-path runtime evidence.

Prefer unfiltered command output when exit status matters. If you summarize output, keep enough detail for the user to understand what passed or failed.

Do not write `Working`, `Complete`, `Passed`, `Fixed`, or equivalent language for a claim unless it has matching evidence from this delivery. If evidence is missing, mark it as unverified or a known gap.

## Report Format

When reporting readiness, use these sections:

```text
Status: Ready for review | Needs more work | Blocked

Implemented:
- ...

Verified with evidence:
- cwd=... command/action=... result=... conclusion=...

Player path:
- Start:
- Objective:
- Core action:
- Feedback:
- Win/fail/progression:
- Restart/continue:

Docs and assets:
- Implemented in this delivery:
- Roadmap/future work:
- Placeholder assets or slots:
- Material mismatches:

Not verified / Known gaps:
- ...

Next Step:
- ...
```

Use `Ready for review` only when the game can be experienced through the intended player path. Use `Needs more work` when you found fixable issues. Use `Blocked` only when the environment prevents a necessary verification step and you cannot decide without user action or external tools.

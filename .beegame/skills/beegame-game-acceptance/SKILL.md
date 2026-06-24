---
name: beegame-game-acceptance
description: Validate generated BeeGame projects before completion. Use when a game project is claimed done, when auditing a delivered project, when continuing after build/test failures, or when checking whether implementation matches the confirmed brief, docs, player loop, UI/UX, art/audio direction, placeholder assets, and target-appropriate project validation across Web, Unity, Godot, native, or other engines.
---

# BeeGame Game Acceptance

Use this skill to decide whether a generated game project is actually complete enough to hand to the user.

## Core Rule

Do not treat an API `end_turn`, a summary message, a typecheck pass, or a build pass as completion.

Completion requires evidence that the project can be used in its own workspace and that the core player loop from the confirmed brief works.

## Acceptance Workflow

1. Identify the project type from its files, manifests, engine config, README, and docs.
2. Read the confirmed brief, README, and project docs before judging the implementation.
3. Inspect the project structure and dependency/tooling setup from the project directory.
4. Choose target-appropriate validation from the project itself.
5. Run validation commands directly from the project directory. Do not pipe them through `head`, `tail`, `sed`, or similar filters when the exit status matters.
6. Verify the core player loop with runtime interaction, engine/editor checks, project tests, or direct code-level evidence when runtime execution is unavailable.
7. Compare docs and README claims against implemented files and behavior.
8. Return `PASS`, `FAIL`, or `BLOCKED` with evidence.

## Tooling Rule

Use the project's own tooling and conventions. Do not force a package manager, browser tool, engine, framework, or test runner unless the project already uses it.

Examples:

- If the project has `package.json`, inspect scripts and declared dependencies before choosing commands.
- If the project is Unity, inspect Unity project structure and available editor/build/test commands.
- If the project is Godot, inspect `project.godot` and available Godot CLI checks.
- If the project is native, mobile, Python, Rust, or another stack, use that stack's project-declared checks.

## Evidence Requirements

For every command or runtime check used as evidence, record:

- `cwd`
- exact command or action
- exit code or observed result
- key output or observed behavior
- conclusion

If a command is declared in README, package scripts, build config, or docs but cannot run, that is evidence against completion.

## Pass Rules

Return `PASS` only when all applicable items are true:

- The project can be installed, opened, or run using its own documented setup.
- Declared check/build/test commands pass, or unsupported commands are removed from docs/scripts instead of being advertised.
- The core player loop is verified: start, objective clarity, main action, feedback, win/fail/progression, and restart/continue/replay as appropriate.
- README run instructions match the actual project.
- Docs do not claim implemented features that are absent from code.
- UI/UX flow is implemented enough for a player to start, understand, play, fail or win, and recover.
- Art direction and audio direction exist when relevant to the brief.
- Placeholder assets or asset slots are present, organized, named intentionally, and replaceable.
- No critical blocker prevents the user from experiencing the intended game.

## Fail And Blocked Rules

Return `FAIL` when the project can be inspected or run enough to prove it does not satisfy the brief or acceptance rules.

Common fail cases:

- The game cannot start or enter the main experience.
- The main player action is not wired.
- Win/fail/progression cannot be reached.
- README commands are wrong.
- Declared scripts or dependencies are missing.
- Docs claim features that code does not implement.
- Placeholder assets are absent despite being required by the brief.

Return `BLOCKED` only when the environment prevents a required verification step and there is not enough evidence to decide pass or fail.

Common blocked cases:

- Required engine/editor/runtime is unavailable.
- Dependencies cannot be installed due to network or registry access.
- Required credentials or licensed assets are unavailable.

When blocked, state the exact blocker and the next command or user action needed.

## Docs-To-Code Check

Compare docs and README against implementation. List every material mismatch.

Treat these as material mismatches:

- A documented mechanic is absent or nonfunctional.
- A documented UI screen or flow is missing.
- A documented asset directory or naming convention does not exist.
- A documented command fails or depends on undeclared tools.
- A documented platform/input mode is not implemented.

Do not fail for clearly labeled future work, roadmap items, or optional extensions unless they are required by the confirmed brief.

## Player Loop Check

Verify the player loop in the most appropriate way available for the project.

The evidence must answer:

- Can the player start or enter the experience?
- Is the objective understandable from UI, onboarding, level design, or controls?
- Can the player perform the main action?
- Does the game provide immediate feedback?
- Is there pressure, risk, challenge, or meaningful choice?
- Can the player reach win, fail, progression, or scoring?
- Can the player restart, continue, replay, or recover?

If runtime interaction is not possible, use code-level evidence and tests, then mark any unverified runtime behavior clearly.

## Report Format

Return this report:

```text
Verdict: PASS | FAIL | BLOCKED

Project:
- Path:
- Detected type:
- Brief/docs read:

Evidence:
- [command/action] cwd=... exit/result=... conclusion=...

Player Loop:
- Start:
- Objective:
- Main action:
- Feedback:
- Win/fail/progression:
- Restart/replay:

Docs And Assets:
- README accuracy:
- Design docs alignment:
- Placeholder assets/slots:
- Art/audio/UI coverage:

Issues:
- [severity] [file/path] Problem and impact

Required Fixes:
- Fix needed before PASS, or "None"

Blocked:
- Exact blocker and next action, or "None"
```

Keep the report concise. Lead with blockers and critical failures before minor polish.

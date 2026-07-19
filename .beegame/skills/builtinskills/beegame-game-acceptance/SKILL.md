---
name: beegame-game-acceptance
description: Use when independently verifying that a generated or modified game follows its approved project documents and is genuinely playable on its intended target.
---

# Game Delivery Acceptance

Use this skill before claiming that a game project is complete or ready to deploy.

BeeGame is only the dashboard shell. Claude Code owns planning, implementation, validation, repair, and the truthful final result. Do not rely on a UI phase, a turn ending, a confident summary, or a successful compile as proof of delivery.

## Source Of Truth

1. Read the confirmed brief and all approved project documents in the workspace.
2. Derive the required player-visible behavior, target constraints, assets, and acceptance paths from those documents.
3. Treat clearly labelled future work as future work. Do not silently expand or reduce the approved delivery.
4. If the documents materially contradict one another or do not define an observable outcome, report the exact blocker. Do not invent a second specification.

## Independent Validation

1. Inspect the project itself; do not trust the implementer's summary, an earlier report, transcript, or claimed test result.
2. Discover the target and native commands from project files. Do not assume Web, Unity, Godot, Unreal, a package manager, test runner, or engine from the project name.
3. Run the checks that belong to that project and retain their exact working directory, command or action, exit status, and observed output.
4. If permission for a required native capability is denied, record that capability once and return `blocked`. Do not retry the same operation through equivalent commands, wrappers, aliases, or shell indirections.
5. Exercise every required player path with observable assertions. At minimum, verify the applicable sequence of starting the experience, understanding the objective, performing the core action, receiving feedback, reaching a meaningful state or outcome, and continuing or restarting.
6. Compilation, type checking, source inspection, or the existence of a component is not runtime proof. If required behavior cannot be observed in the available environment, mark it blocked or unverified rather than guessing.
7. Verify every cited implementation and test path in the current revision. A test name counts only when its current assertions exercise the mapped requirement. Do not accept a traceability table, stale report, file name, or symbol as execution evidence.
8. Verify that required assets exist in the built or packaged result and are actually referenced and loadable at runtime. Validate `assets/asset-manifest.json` against the canonical contract exposed by the current BeeGame runtime instead of duplicating a schema inside this Skill. Do not impose a platform-specific format or loader.
9. Verify that build/typecheck outputs are isolated from authored source directories. Generated siblings must not be able to shadow the sources that were reviewed and tested.

## Result Discipline

- `passed`: the current revision follows the approved documents and every required player path was observed to work.
- `failed`: a concrete, reproducible mismatch or broken player path was observed.
- `blocked`: an external capability or user decision is genuinely required to complete validation.

For every failure or blocker, report the exact document requirement, observed command or interaction, actual result, and why it prevents delivery. Do not modify project files when acting as an independent validator. The implementing Claude session decides how to repair findings and must validate the changed revision again.

Never manufacture a green result by weakening tests, rewriting evidence, omitting failed behavior, or treating an unchanged revision as newly verified.

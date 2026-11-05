---
name: git-workflow
description: Perform or diagnose requested Git branching, staging, commits, merge/rebase conflicts and history recovery. Use for a concrete version-control task or repository workflow decision, not as a required step in ordinary game implementation. 中文：受托 Git 操作、分支提交、冲突处理与历史恢复，按问题读取。
---

<!-- Adapted from omer-metin/skills-for-antigravity. Changed for task-scoped use; upstream opinionated process and automatic validation/remediation are not installed. -->

# Git Workflow

Use the repository's existing conventions and the actual requested operation.
Inspect the current branch, working tree and index before deciding which Git
state should change. Preserve unrelated staged and unstaged work. A workflow
example does not authorize committing, pushing, discarding work or rewriting
history, and does not override the user's request or repository instructions.

Read the method relevant to the current question:

- [Branching, commits and integration](references/patterns.md): choose merge,
  rebase or cherry-pick from history ownership; stage an intended change; use
  commit conventions already adopted by the repository.
- [Conflicts and recovery](references/sharp_edges.md): identify an in-progress
  operation, recover a reachable commit, or diagnose stash, detached HEAD,
  ignore rules and submodule state without assuming a clean working tree.
- [Inspect the intended Git result](references/validations.md): review the index,
  conflict resolution or target refs for the operation actually requested.

This Skill supplies Git methods, not a branch-per-task rule, commit schedule,
PR/release gate, hook installation or automatic repository cleanup.

## Source

Adapted from [omer-metin/skills-for-antigravity/git-workflow](https://github.com/omer-metin/skills-for-antigravity/tree/e8dcf4e8737921a10088bd5c9eb65e81f74c051f/skills/git-workflow),
revision `e8dcf4e8737921a10088bd5c9eb65e81f74c051f` (retrieved 2026-11-03), under the included
[Apache 2.0 license](LICENSE.txt). The entry and references have been rewritten
to retain technical guidance without upstream blanket process requirements.

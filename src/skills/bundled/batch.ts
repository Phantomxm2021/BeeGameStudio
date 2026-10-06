import { AGENT_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/AgentTool/constants.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/AskUserQuestionTool/prompt.js'
import { ENTER_PLAN_MODE_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/EnterPlanModeTool/constants.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/ExitPlanModeTool/constants.js'
import { SKILL_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/SkillTool/constants.js'
import { getIsGit } from '../../utils/git.js'
import { registerBundledSkill } from '../bundledSkills.js'

const WORKER_INSTRUCTIONS = `After implementing the assigned unit:
1. **Review** — Check the changes for reuse, quality and efficiency; use \`${SKILL_TOOL_NAME}\` with \`skill: "simplify"\` when useful, not as a mandatory nested review.
2. **Verify** — Run focused tests and the applicable e2e recipe from the coordinator. Investigate failures and preserve unrelated changes.
3. **Deliver** — Follow the task's requested delivery. Commit, push or create a PR only when those actions are included in the user's authorization; local implementation does not imply publication.
4. **Report** — Summarize the completed behavior, checks and remaining gaps. Include a PR URL only if one was requested and actually created.`

function buildPrompt(instruction: string): string {
  return `# Batch: Parallel Work Orchestration

You are orchestrating a large, parallelizable change across this codebase.

## User Instruction

${instruction}

## Phase 1: Research and Plan (Plan Mode)

Call the \`${ENTER_PLAN_MODE_TOOL_NAME}\` tool now to enter plan mode, then:

1. **Understand the scope.** Launch one or more subagents (in the foreground — you need their results) to deeply research what this instruction touches. Find all the files, patterns, and call sites that need to change. Understand the existing conventions so the migration is consistent.

2. **Decompose into independent units.** Choose the number from actual independent work and the authorized scope, not a fixed agent count. Each unit must:
   - Be independently implementable in an isolated git worktree (no shared state with sibling units)
   - Be mergeable on its own without depending on another unit's PR landing first
   - Be roughly uniform in size (split large units, merge trivial ones)

   Split at real module or behavior boundaries. Do not create extra units merely to use more agents.

3. **Determine the e2e test recipe.** Figure out how a worker can verify its change actually works end-to-end — not just that unit tests pass. Look for:
   - A \`claude-in-chrome\` skill or browser-automation tool (for UI changes: click through the affected flow, screenshot the result)
   - A \`tmux\` or CLI-verifier skill (for CLI changes: launch the app interactively, exercise the changed behavior)
   - A dev-server + curl pattern (for API changes: start the server, hit the affected endpoints)
   - An existing e2e/integration test suite the worker can run

   If you cannot find a concrete e2e path, use the \`${ASK_USER_QUESTION_TOOL_NAME}\` tool to ask the user how to verify this change end-to-end. Offer 2–3 specific options based on what you found (e.g., "Screenshot via chrome extension", "Run \`bun run dev\` and curl the endpoint", "No e2e — unit tests are sufficient"). Do not skip this — the workers cannot ask the user themselves.

   Write the recipe as a short, concrete set of steps that a worker can execute autonomously. Include any setup (start a dev server, build first) and the exact command/interaction to verify.

4. **Write the plan.** In your plan file, include:
   - A summary of what you found during research
   - A numbered list of work units — for each: a short title, the list of files/directories it covers, and a one-line description of the change
   - The e2e test recipe (or "skip e2e because …" if the user chose that)
   - The exact worker instructions you will give each agent (the shared template)

5. Call \`${EXIT_PLAN_MODE_TOOL_NAME}\` to present the plan for approval.

## Phase 2: Spawn Workers (After Plan Approval)

Once the plan's parallel work is authorized, use the \`${AGENT_TOOL_NAME}\` tool for its independent units. Use \`isolation: "worktree"\` for concurrent edits that would otherwise share mutable files, and \`run_in_background: true\` where useful. Limit concurrency to the actual task and runtime constraints.

For each agent, the prompt must be fully self-contained. Include:
- The overall goal (the user's instruction)
- This unit's specific task (title, file list, change description — copied verbatim from your plan)
- Any codebase conventions you discovered that the worker needs to follow
- The e2e test recipe from your plan (or "skip e2e because …")
- The worker instructions below, copied verbatim:

\`\`\`
${WORKER_INSTRUCTIONS}
\`\`\`

Use \`subagent_type: "general-purpose"\` unless a more specific agent type fits.

## Phase 3: Track Progress

After launching all workers, render an initial status table:

| # | Unit | Status | PR |
|---|------|--------|----|
| 1 | <title> | running | — |
| 2 | <title> | running | — |

As background-agent completion notifications arrive, update the table with actual completion or failure, remaining gaps and any requested PR links. Do not treat a missing PR as failure when local delivery was requested.

When all agents have reported, summarize verified units and unresolved work. A created PR is not proof that the change works or has been merged.
`
}

const NOT_A_GIT_REPO_MESSAGE = `This is not a git repository. The \`/batch\` command requires a git repo for isolated worktrees. Initialize a repo first, or run this from inside an existing one.`

const MISSING_INSTRUCTION_MESSAGE = `Provide an instruction describing the batch change you want to make.

Examples:
  /batch migrate from react to vue
  /batch replace all uses of lodash with native equivalents
  /batch add type annotations to all untyped function parameters`

export function registerBatchSkill(): void {
  registerBundledSkill({
    name: 'batch',
    description:
      'Plan and coordinate independent units of a large-scale change, with scoped verification and the requested delivery.',
    whenToUse:
      'Use when the user wants to make a sweeping, mechanical change across many files (migrations, refactors, bulk renames) that can be decomposed into independent parallel units.',
    argumentHint: '<instruction>',
    userInvocable: true,
    disableModelInvocation: true,
    async getPromptForCommand(args) {
      const instruction = args.trim()
      if (!instruction) {
        return [{ type: 'text', text: MISSING_INSTRUCTION_MESSAGE }]
      }

      const isGit = await getIsGit()
      if (!isGit) {
        return [{ type: 'text', text: NOT_A_GIT_REPO_MESSAGE }]
      }

      return [{ type: 'text', text: buildPrompt(instruction) }]
    },
  })
}

import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { lstat, readFile, realpath } from 'node:fs/promises'
import type { AgentDefinition } from '@bee-game-studio/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { validateDesignReviewReceipt } from '@bee-game-studio/agent-workflow/design-review-result'
import type { Command } from '../types/command.js'
import { randomUUID } from 'node:crypto'
import type { Tool, ToolUseContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { AGENT_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/AgentTool/constants.js'
import { findToolByName } from '../Tool.js'
import { runNativeAssignments } from './native-assignments.js'
import { runTools } from '../services/tools/toolOrchestration.js'
import { sleep } from '../utils/sleep.js'

export const DESIGN_REVIEW_AGENT = 'bgs-design-review'
// An operational ceiling, not an acceptance score or a limit on required fixes.
// Limits unfinished native execution, not the number of semantic correction passes.
export const DESIGN_REVIEW_MAX_TURNS = 32

/** Deliver the selected Skill methods, not a second ownership prompt. Reading
 * a linked reference must not depend on the model remembering a tool call. */
export async function designReviewReference(skillRoot: string | undefined, documents: readonly string[]) {
  if (!skillRoot) throw new Error('Required BGS review Skill has no reference directory')
  const path = join(skillRoot, 'references/document-checks.md')
  const body = await readFile(path, 'utf8')
  const sections = body.split(/(?=^## )/m)
  const selected = [...new Set(documents)].map(name => {
    const section = sections.find(section => section.startsWith('## ' + name + '\n'))
    if (!section?.trim()) throw new Error('Required BGS review method section is unavailable: ' + name)
    return section.trim()
  })
  return `Loaded game-design-check methods from ${path} (not ownership or a quality verdict):\n\n` + selected.join('\n\n')
}

// Write creates parent directories for an exactly authorized missing UI output.
// Resolve existing ancestors first; a missing folder must not hide a symlink.
async function canonicalWriteTarget(path: string): Promise<string> {
  try { return join(await realpath(dirname(path)), basename(path)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      if ((await lstat(dirname(path))).isSymbolicLink()) throw new Error('Dangling parent symlink')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return join(await canonicalWriteTarget(dirname(path)), basename(path))
  }
}

// Use the native agent's existing tool selection. Do not advertise tools that
// this role's execution boundary will invariably reject.
export function designReviewToolNames(step: NativeProjectTurnInput['reviewStep']) {
  return ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write', ...(step === 'revise' ? ['Edit'] : [])]
}

/** Same Bash executor and permissions, but a model-visible checker interface
 * instead of the general software-development shell manual. */
export function designReviewTools(tools: readonly Tool[]): Tool[] {
  return tools.map(tool => tool.name !== 'Bash' ? tool : {
    ...tool,
    apiSchemaCacheScope: DESIGN_REVIEW_AGENT,
    searchHint: 'BGS design checks and static visual samples',
    prompt: async () => 'Use the supplied BGS design check interfaces from the project root. Read-only commands: bun .beegame/delivery/check-content.mjs with documented arguments, or bun .beegame/delivery/calculate-balance.mjs --help. For an assigned Art/UI HTML/SVG sample, node .beegame/delivery/inspect-design.mjs --visual-sample SAVED_PATH WIDTH HEIGHT --preview-api CURRENT_URL renders static markup with scripts/external requests disabled and writes only its private capture cache; Read the returned image. Use the exact current sample paths and Preview URL from the assignment. In revise only, calculate-balance.mjs may regenerate an affected appendix with the exact authorized existing model/output paths; no --verify, extra scripts or arbitrary shell. One literal cd to this workspace followed by && and a supported command is allowed. Do not append echo, pipes, redirects or probes. Use Read/Glob/Grep for source files; do not inspect bundled implementation or diagnose the platform. A scope rejection is not a tool outage. Reuse unchanged host checks and observations. A static capture or successful checker is not a semantic, aesthetic or runtime verdict.',
  })
}

/** Configure the existing independent review, not another review stage.
 * Native agent skill preload records the actual body in the child transcript.
 */
export async function designReviewAgents(
  agents: AgentDefinition[], turn: NativeProjectTurnInput | undefined,
  workspace: string, commands: Command[],
): Promise<AgentDefinition[]> {
  if (!turn?.reviewDocuments) return agents
  if (!turn.reviewStep || !turn.reviewResultPath || !turn.reviewWorkspace || !turn.reviewReceiptContext)
    throw new Error('BGS review requires a host-owned bounded step and result path')
  const path = turn.reviewContextPath
  if (!path || !isAbsolute(path))
    throw new Error('BGS review requires its original task context inside the workspace')
  const skill = commands.find(command => command.type === 'prompt' && command.name === 'game-design-check')
  if (!skill || skill.type !== 'prompt')
    throw new Error('Required BGS review Skill is unavailable: game-design-check')
  const [root, source] = await Promise.all([realpath(workspace), realpath(path)])
  const part = relative(root, source)
  if (part === '..' || part.startsWith('../') || isAbsolute(part))
    throw new Error('BGS review requires its original task context inside the workspace')
  if (await realpath(turn.reviewWorkspace) !== root) throw new Error('BGS review workspace does not match the native workspace')
  const receipt = resolve(turn.reviewResultPath)
  const receiptPart = relative(root, join(await realpath(dirname(receipt)), receipt.slice(receipt.lastIndexOf('/') + 1)))
  if (!receiptPart.startsWith('.beegame/tmp/') || !receiptPart.endsWith('.txt')) throw new Error('BGS review receipt must stay in its workspace temporary task input')
  const methodDocuments = [...turn.reviewDocuments, ...(turn.reviewReceiptContext.findings ?? [])
    .filter(finding => finding.documents.some(name => turn.reviewDocuments!.includes(name)))
    .flatMap(finding => finding.sources.map(source => source.document))]
  const methods = await designReviewReference(skill.skillRoot, methodDocuments)
  const reviewer: AgentDefinition = {
    agentType: DESIGN_REVIEW_AGENT,
    source: 'flagSettings', model: 'inherit', skills: ['game-design-check'],
    tools: designReviewToolNames(turn.reviewStep),
    maxTurns: DESIGN_REVIEW_MAX_TURNS, disallowedTools: [AGENT_TOOL_NAME],
    whenToUse: 'The independent Review/Revision owner for the current BGS document batch.',
    getSystemPrompt: () => [
      'You perform the host-owned ' + turn.reviewStep + ' step for ' + turn.reviewDocuments!.join(', ') + '.',
      'Read the original requirements, exact current assignment, document responsibilities and available tools directly from ' + path + '. This temporary task input is not a retained document authority. A coordinator summary is not a replacement for it.',
      'The original assignment defines the current step and document ownership; game-design-check supplies checking methods, not additional authority. Its applicable document-check reference sections are loaded below from the Skill source. Inspect and verify are read-only except their exact result file and private static-sample capture cache; only revise may change recorded affected documents, their version-bound handoff sidecars and exact supporting files authorized in the original assignment. Static sample inspection does not execute project scripts or establish runtime quality. Do not claim a source was inspected merely because its name is available.',
      'Use saved drafts and delivered owner decisions, not writer reasoning or predicted findings. Execute only this assigned step; do not dispatch another agent or start another review/revision loop. A missing owner decision is not permission to choose a non-owner default.',
      'Use the supplied handoff contract and host diagnostics. Follow the actual tool interface; a Bash scope denial is not a tool outage. Do not probe the environment or bundled checker implementation. Reuse unchanged checks and evidence.',
      'After the assigned checks, use Write for the whole receipt at the exact milestone path. Follow its field definitions in the original assignment; correct rejected receipt fields without repeating unchanged checks. complete means this step executed, not document quality certified; blocked means unavailable required decisions/evidence or unfinished work. Report execution failures rather than invent document findings. Reaching the execution limit is not completion; partial file changes do not release the documents.',
      methods,
    ].join('\n\n'),
  }
  return [...agents.filter(agent => agent.agentType !== DESIGN_REVIEW_AGENT), reviewer]
}

/** Tool permission boundary, not another model's promise to stay read-only. */
export function designReviewPermissions(turn: NativeProjectTurnInput, original: CanUseToolFn, dispatchId: string): CanUseToolFn {
  const bounded: CanUseToolFn = async (tool, input, context, message, toolUseID, force) => {
    const deny = (message = 'Outside the current bounded BGS design review step.') => Promise.resolve({ behavior: 'deny' as const, message,
      decisionReason: { type: 'other' as const, reason: 'Host-owned BGS review step scope' } })
    if (tool.name === AGENT_TOOL_NAME) {
      if (toolUseID !== dispatchId) return deny()
    } else if (['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'].includes(tool.name)) {
      // Existing permissions still adjudicate source access/network requests.
    } else if (tool.name === 'Bash') {
      if (!await allowedReviewCommand(String(input.command ?? ''), turn))
        return deny('BGS review permits read-only checker commands, the supplied static Art/UI sample capture command and, in revise only, the numerical helper with exact authorized model/output paths, from this project root. Run: bun .beegame/delivery/check-content.mjs --help, or use the supplied static-sample signature and current Preview URL. Remove echo, pipes, redirects, scripts and other shell commands. This is a command-scope rejection, not a tool outage.')
    } else if (['Write', 'Edit'].includes(tool.name)) {
      if (!turn.reviewWorkspace || !turn.reviewResultPath || typeof input.file_path !== 'string') return deny()
      const path = resolve(turn.reviewWorkspace, input.file_path)
      try {
        const target = await canonicalWriteTarget(path)
        const root = await realpath(turn.reviewWorkspace)
        const part = relative(root, target)
        if (part === '..' || part.startsWith('../') || isAbsolute(part)) return deny()
        const receipt = join(await realpath(dirname(turn.reviewResultPath)), basename(turn.reviewResultPath))
        const allowed = [receipt, ...(turn.reviewStep === 'revise'
          ? [...(turn.reviewWritableDocuments ?? []).map(name => join(root, 'docs', name)), ...(turn.reviewWritableFiles ?? []).map(file => resolve(root, file))] : [])]
        if (!allowed.includes(target)) {
          // A mistyped receipt name is a rejected target, not invalid JSON or
          // evidence that the saved corrections must be undone.
          if (dirname(target) === dirname(receipt)) return deny(
            'Review receipt path mismatch. Expected Write.file_path: ' + JSON.stringify(receipt) +
            '; received workspace-relative path: ' + JSON.stringify(part) +
            '. Copy the exact expected path and resubmit the same receipt with Write. ' +
            'No file was written or receipt content validated. Do not undo document corrections, probe directories or rerun unchanged checks.')
          return deny()
        }
        try { if (await realpath(path) !== target) return deny() } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return deny()
          try { if ((await lstat(path)).isSymbolicLink()) return deny() }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return deny() }
        }
        if (target === receipt) {
          if (tool.name !== 'Write' || typeof input.content !== 'string' || !turn.reviewReceiptContext)
            return deny('Submit the entire Review receipt with Write, using first line complete or blocked followed by the review JSON. Partial receipt edits are not supported.')
          const issues = validateDesignReviewReceipt(input.content, turn.reviewReceiptContext)
          if (issues.length) return deny('Review receipt not saved:\n' + issues.join('\n') +
            '\nCorrect the listed receipt fields and resubmit with Write in this same step. Do not rerun unchanged checks. Tool failures belong in the normal reply, not fabricated design-document findings; resolved contains only recorded finding IDs.')
        }
      } catch { return deny() }
    } else return deny()
    return original(tool, input, context, message, toolUseID, force)
  }
  bounded.supportsBackgroundPermissionRequests = original.supportsBackgroundPermissionRequests
  return bounded
}

// Recognize only a harmless cwd prefix; this is not a general shell parser.
async function allowedReviewCommand(command: string, turn: NativeProjectTurnInput) {
  const workspace = turn.reviewWorkspace
  if (!workspace) return false
  const prefix = /^cd (?:'([^']+)'|"([^"$`\\]+)"|([A-Za-z0-9_./-]+)) && (.+)$/.exec(command)
  if (prefix) {
    const path = prefix[1] ?? prefix[2] ?? prefix[3]!
    try { if (await realpath(resolve(workspace, path)) !== await realpath(workspace)) return false }
    catch { return false }
    command = prefix[4]!
  }
  if (/^bun \.beegame\/delivery\/(?:check-content\.mjs(?: [A-Za-z0-9_./-]+)*|calculate-balance\.mjs --help)$/.test(command)) return true
  const sample = /^node \.beegame\/delivery\/inspect-design\.mjs --visual-sample (docs\/visual\/(ART_DIRECTION|UI_UX_SPEC)\/[A-Za-z0-9_./-]+\.(?:html|svg)) ([1-9][0-9]*) ([1-9][0-9]*) --preview-api http:\/\/127\.0\.0\.1:[0-9]+\/[a-f0-9]{64}$/.exec(command)
  if (sample) {
    if (sample[1]!.split('/').includes('..') || Number(sample[3]) > 16384 || Number(sample[4]) > 16384) return false
    const assigned = turn.reviewStep === 'inspect' ? turn.reviewDocuments : Object.keys(turn.reviewReceiptContext?.sourceHeadings ?? {})
    return Boolean(assigned?.includes(sample[2] + '.md'))
  }
  if (turn.reviewStep !== 'revise') return false
  const calculation = /^bun \.beegame\/delivery\/calculate-balance\.mjs (docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js)) (docs\/calc\/[A-Za-z0-9_./-]+\.md)$/.exec(command)
  if (!calculation) return false
  let canonicalWorkspace: string
  try { canonicalWorkspace = await realpath(workspace) } catch { return false }
  for (const path of calculation.slice(1)) {
    if (!path || !(turn.reviewWritableFiles ?? []).includes(path)) return false
    try { if (await realpath(resolve(canonicalWorkspace, path)) !== resolve(canonicalWorkspace, path)) return false }
    catch { return false }
  }
  return true
}

/** Run the existing review milestone, not a model-selected optional tool call. */
export async function* runNativeDesignReview(
  turn: NativeProjectTurnInput, context: ToolUseContext, canUseTool: CanUseToolFn,
  execute: typeof runTools = runTools, pause: (ms: number) => Promise<unknown> = sleep,
): AsyncGenerator<Message, string[]> {
  if (!turn.reviewDocuments || !turn.reviewContextPath ||
      !context.options.agentDefinitions.activeAgents.some(agent => agent.agentType === DESIGN_REVIEW_AGENT))
    throw new Error('BGS scheduled review requires its configured native reviewer')
  if (!findToolByName(context.options.tools, AGENT_TOOL_NAME))
    throw new Error('BGS scheduled review requires the native subagent tool')
  if (context.abortController.signal.aborted) throw new Error('BGS scheduled review cancelled')
  const id = 'bgs-review-' + randomUUID()
  return yield* runNativeAssignments([{
    type: 'tool_use', id, name: AGENT_TOOL_NAME, caller: { type: 'direct' },
    input: { subagent_type: DESIGN_REVIEW_AGENT, description: 'Review ' + turn.reviewDocuments.join(', '),
      prompt: 'Perform the current independent Review/Revision using the original assignment at ' + turn.reviewContextPath + '.' },
  }], 'BGS scheduled independent Review/Revision (execution only, not a quality judgment).', {
    ...context, requireCanUseTool: true,
  },
    designReviewPermissions(turn, canUseTool, id), execute, pause)
}

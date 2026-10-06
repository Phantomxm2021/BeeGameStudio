import { isAbsolute, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { nativeWritingAuthors, parseNativeDirectionAuthors } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { AGENT_TOOL_NAME } from '@bee-game-studio/builtin-tools/tools/AgentTool/constants.js'
import type { AgentDefinition } from '@bee-game-studio/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { findToolByName, type ToolUseContext, type Tool } from '../Tool.js'
import type { Message } from '../types/message.js'
import { getCwd } from '../utils/cwd.js'
import { runTools } from '../services/tools/toolOrchestration.js'
import { sleep } from '../utils/sleep.js'
import { runNativeAssignments } from './native-assignments.js'

/** Reuse native tools, permissions, cancellation, transcripts and skill preload.
 * Fixed writing assignments return their own handoffs, without a parent check. */
export async function* runNativeDirectionAuthors(
  rawInput: unknown,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  execute: typeof runTools = runTools,
  pause: (ms: number) => Promise<unknown> = sleep,
): AsyncGenerator<Message, string[]> {
  const input = parseNativeDirectionAuthors(rawInput)
  if (!input) throw new Error('Missing BGS direction-author input')
  const assigned = nativeWritingAuthors(input.batch)
  for (const path of [input.contextPath, ...Object.values(input.contextPaths ?? {})]) {
    const contextRelative = relative(getCwd(), path)
    if (!isAbsolute(path) || contextRelative === '..' ||
        contextRelative.startsWith('../') || isAbsolute(contextRelative))
      throw new Error('BGS author context must be inside the current workspace')
  }
  if (!findToolByName(context.options.tools, AGENT_TOOL_NAME))
    throw new Error('BGS direction authors require the native subagent tool')
  for (const author of assigned) {
    for (const skill of author.skills) {
      if (!context.options.commands.some(command => command.type === 'prompt' && command.name === skill))
        throw new Error('Required BGS author Skill is unavailable: ' + skill)
    }
  }
  if (context.abortController.signal.aborted) throw new Error('BGS author dispatch cancelled')
  const authors: AgentDefinition[] = assigned.map(author => ({
    agentType: author.agentType,
    source: 'flagSettings',
    model: 'inherit',
    skills: [...author.skills],
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash', 'WebFetch', 'WebSearch'],
    disallowedTools: [AGENT_TOOL_NAME],
    whenToUse: 'The scheduled writing owner of docs/' + author.document,
    getSystemPrompt: () => [
      'You are the sole writing owner of docs/' + author.document + ' in the current BGS writing batch.',
      // Scoped task files already contain the full responsibility. Retain the
      // inline role only for the legacy shared-input interface.
      ...(input.contextPaths ? [] : [input.responsibilities[author.document]!]),
      'Read the original confirmed brief, assigned ownership boundaries and phase restrictions from ' + (input.contextPaths?.[author.document] ?? input.contextPath) + '. This temporary file is task input, not retained document authority. Read the saved GDD draft and relevant saved specialist decisions; do not treat pending parallel decisions as facts.',
      'Use the preloaded Skills as writing methods, not authority to change your assignment or phase. Save your assigned draft and its .beegame/design-handoffs/<document stem>.json index. Only the UI owner also begins the linked content/ui layout files required by its assignment; Content completes these same files in place, not a second copy. Keep unavailable bindings pending; do not claim resource delivery or create the package index, Scene/VFX or runtime code here. Static visual references and partial HTML samples are not mandatory. Do not create a temporary game, duplicate coordinate tables or an unnecessary calculation appendix. Do not delegate ownership or replace another author’s draft. Keep document language from the original brief.',
      'Save the complete assigned draft and return its path, usable decisions and unresolved dependencies, not a quality PASS. One joint independent Review/Revision follows completion of all eight documents; do not invoke game-design-check during authoring. Preserve saved-file and reference correctness and resolve necessary decisions you own.',
      'Use the supplied command signatures and selected platform sections. Read additional documentation only for an unresolved design decision. Native transcripts, checker implementation and environment probes are not design sources. Retrieve independent sources together and reuse unchanged results. Scheduled pending documents may retain relative Markdown links marked as pending; do not remove source links to evade an unfinished dependency.',
    ].join('\n\n'),
  }))
  const authorTypes = new Set(authors.map(author => author.agentType))
  const activeAgents = [...context.options.agentDefinitions.activeAgents.filter(author => !authorTypes.has(author.agentType)), ...authors]
  const authorContext: ToolUseContext = { ...context, requireCanUseTool: true, options: { ...context.options,
    agentDefinitions: { ...context.options.agentDefinitions, activeAgents } } }
  const calls: ToolUseBlock[] = assigned.map(author => ({
    type: 'tool_use', id: 'bgs-author-' + randomUUID(), name: AGENT_TOOL_NAME, caller: { type: 'direct' },
    input: { subagent_type: author.agentType, description: 'Write ' + author.document,
      prompt: 'Complete your assigned docs/' + author.document + ' draft from the original confirmed brief and current sources. Read ' + (input.contextPaths?.[author.document] ?? input.contextPath) + ' for the full original requirements and current milestone. Preserve other authors’ ownership and hand off only actual saved work and its limits.' },
  }))
  const permissions = designAuthorPermissions(canUseTool, new Set(calls.map(call => call.id)))
  const handoffs: string[] = []
  // Only the independent direction-setting batch is parallel. Scene precedes
  // Balance; Asset Plan precedes final Tech consumption. Each is a fresh child.
  const groups = (input.batch ?? 1) === 1 ? [calls] : calls.map(call => [call])
  for (const group of groups) {
    handoffs.push(...yield* runNativeAssignments(group,
      'BGS scheduled professional writing owners (execution only, not a quality judgment).',
      authorContext, permissions, execute, pause))
  }
  return handoffs
}

/** Apply after the native worker tool-pool rebuild, not just on parent tools. */
export function designAuthorTools(tools: readonly Tool[]): Tool[] {
  return tools.map(tool => tool.name !== 'Bash' ? tool : {
    ...tool, apiSchemaCacheScope: 'bgs-design-author',
    prompt: async () => 'Use the BGS design commands and source paths supplied in the assignment. Bash may execute necessary design calculations or collect authoritative evidence under native permissions. Use Read/Glob/Grep for current sources and Write/Edit for document changes, not shell scripts that bypass saved-file read tracking. On an Edit match failure, retrieve the exact affected saved clause once and correct that string; do not guess successive replacements. Retrieve selected format sections directly with --format sectionNames, without pipelines. The host assigns versions and checks the completed writing group; do not run --design-handoff on unfinished drafts or pending siblings. Do not explore the environment, inspect bundled checker implementation or recover facts from native transcripts. Reuse supplied tool contracts and unchanged results. Tool scope failures are not evidence that the platform is unavailable.',
  })
}

/** Prevent the observed author log/source probes, not general shell sandboxing.
 * Original native permissions still adjudicate every allowed operation. */
export function designAuthorPermissions(original: CanUseToolFn, dispatchIds: ReadonlySet<string>): CanUseToolFn {
  const bounded: CanUseToolFn = async (tool, input, context, message, toolUseID, force) => {
    const target = String(tool.name === 'Bash' ? input.command ?? '' : input.file_path ?? input.path ?? '')
    if (tool.name === 'Bash' && /check-content\.mjs\s+--design-handoff(?:\s|$)/.test(target))
      return { behavior: 'deny', message: 'The host checks the completed writing group and assigns document versions after your saved handoff. Do not repair pending sibling files or add version fields to satisfy this premature whole-group check. Save your owned draft/index and return the actual handoff. --design-handoff-help remains available for a concrete contract question.',
        decisionReason: { type: 'other', reason: 'Host-owned completed-draft check' } }
    const nativeLog = /(?:\.beegame\/config(?:\/|$)|\.claude\/projects(?:\/|$)|\.jsonl(?:\b|$))/.test(target)
    // Direct file tools identify their source. A helper path in Bash does not:
    // it also occurs in legitimate loops and compound checker invocations.
    // Leave shell adjudication to the existing native permissions, not a
    // second, incomplete shell grammar. This is not a shell-read sandbox.
    const checkerSource = tool.name !== 'Bash' && /(?:check-content|calculate-balance)\.mjs/.test(target)
    if (tool.name === AGENT_TOOL_NAME ? !dispatchIds.has(toolUseID) : nativeLog || checkerSource)
      return { behavior: 'deny', message: 'Authoring uses current design sources and the supplied command interface, not native logs or bundled checker implementation. Use the original task context, docs, handoff sidecars and selected format sections. Report an unavailable required input instead of probing the environment.',
        decisionReason: { type: 'other', reason: 'BGS design author source scope' } }
    return original(tool, input, context, message, toolUseID, force)
  }
  bounded.supportsBackgroundPermissionRequests = original.supportsBackgroundPermissionRequests
  return bounded
}

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Run } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { readVersion } from '../packages/agent-workflow-server/src/beegame/workflow-v3/checks'

// Opt-in synthetic model transport, shared by local regression and remote
// debug acceptance. Emits native tool calls; NEVER writes source or host PASS.
// Not an LLM, a professional review, or a production model adapter.
export function createOfflineNativeReviewFixture(root: string, readRun: () => Promise<Run | undefined>) {
  const requests: { attemptId: string; tool?: string; toolResultAccepted?: boolean; answer?: string }[] = []
  const counts = new Map<string, number>()
  const question = 'Choose the confirmed synthetic play-button height?'
  const frame = (event: { type: string; [key: string]: unknown }) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  const provider = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path.endsWith('/count_tokens')) return Response.json({ input_tokens: 10 })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const run = await readRun(), attempt = run?.attempts.find(a => a.attemptId === run.writer?.attemptId)
    if (!run || !attempt || run.workspacePath !== root) return Response.json({ error: 'No synthetic active writer' }, { status: 409 })
    const task = run.tasks[attempt.taskId]!.spec
    const count = (counts.get(attempt.attemptId) ?? 0) + 1
    counts.set(attempt.attemptId, count)
    const body = await request.json() as { model: string; messages: { content: unknown }[] }
    const previous = body.messages.at(-1)?.content
    const results = Array.isArray(previous) ? previous.filter(v => v?.type === 'tool_result') : []
    if (count > 1 && (!results.length || results.some(v => v.is_error === true)))
      return Response.json({ error: 'Actual native tool did not succeed; fixture will not invent completion' }, { status: 409 })
    let call: { name: string; input: unknown } | undefined, answer: string | undefined
    const sourcePath = task.id === 'notes' ? 'notes.json' : task.id === 'recovery' ? 'recovery.json' : 'content/ui/menu.json'
    if (count === 1) call = { name: 'Skill', input: { skill: 'bgs-builtins:gameplay-programmer' } }
    else if (count === 2) call = { name: 'Read', input: { file_path: join(root, sourcePath) } }
    else if (task.repairOf && count === 3) call = { name: 'AskUserQuestion', input: { questions: [{ header: 'F1', question, multiSelect: false,
      options: [{ label: '80', description: '80 pixels' }, { label: '96', description: '96 pixels' }] }] } }
    else if (task.repairOf && count === 4) {
      // Decisions reach the Run at settlement, not during the live turn. Read
      // the ACTUAL native Question result; never preset the choice or host data.
      const resultText = results.map(v => typeof v.content === 'string' ? v.content : JSON.stringify(v.content)).join('\n')
      const selected = ['80', '96'].filter(value => resultText.includes(`"${question}"="${value}"`))
      if (selected.length !== 1) return Response.json({ error: 'No actual native answer' }, { status: 409 })
      answer = selected[0]!
      const height = Number(answer)
      const doc = JSON.parse(await readFile(join(root, sourcePath), 'utf8'))
      doc.data.nodes.find((n: { id: string }) => n.id === 'play').layout.size[1] = height
      call = { name: 'Write', input: { file_path: join(root, sourcePath), content: JSON.stringify(doc) } }
    } else if (task.reviewReport && count === 3) {
      const source = await readVersion(root, sourcePath), quote = await readFile(join(root, sourcePath), 'utf8')
      const report = { requirementsRevision: run.requirements.revision, planRevision: run.planRevision,
        findings: task.reviewOf ? [] : [{ id: 'F1', requirementId: task.requirementIds[0], ownerTaskId: 'game', severity: 'blocker',
          sources: [{ ...source, quote }], impact: 'The initial saved height has not been selected from the confirmed user options',
          close: 'Ask user, save selected height, rebuild and verify rule plus actual UI size/position consumption',
          verifyWith: ['rule-tests', 'build', 'runtime-smoke', 'ui-data-consumption'], needsUserDecision: true }],
        closed: task.reviewOf ? [{ id: 'F1', repairAttemptId: run.tasks.game!.attemptId, sources: [{ ...source, quote }],
          observed: 'Current source has the actual retained user answer and the owner has fresh host build/rule/UI-consumption evidence' }] : [],
        observations: task.previewIssues!.map(id => ({ id, disposition: 'finding', findingIds: ['F1'], reason: 'Synthetic report for the retained user observation, not model judgement' })),
        limitations: ['Deterministic offline transport only; actual host validates provenance and consumer checks; not game quality or LLM review ability'] }
      call = { name: 'Write', input: { file_path: join(root, task.reviewReport), content: JSON.stringify(report) } }
    }
    requests.push({ attemptId: attempt.attemptId, ...(call ? { tool: call.name } : {}), ...(count > 1 ? { toolResultAccepted: true } : {}), ...(answer ? { answer } : {}) })
    const id = 'offline-native-' + requests.length
    return new Response(frame({ type: 'message_start', message: { id, type: 'message', role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }) +
      frame({ type: 'content_block_start', index: 0, content_block: call ? { type: 'tool_use', id, name: call.name, input: {} } : { type: 'text', text: '' } }) +
      frame({ type: 'content_block_delta', index: 0, delta: call ? { type: 'input_json_delta', partial_json: JSON.stringify(call.input) } : { type: 'text_delta', text: 'Synthetic native work ended; actual host checks decide status.' } }) +
      frame({ type: 'content_block_stop', index: 0 }) + frame({ type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) +
      frame({ type: 'message_stop' }), { headers: { 'content-type': 'text/event-stream' } })
  } })
  return { provider, requests, counts, question, env: {
    BEEGAME_CONFIG_DIR: join(root, '.beegame/host/offline-native-config'), BEEGAME_MODEL_TYPE: 'anthropic', ANTHROPIC_AUTH_TOKEN: 'offline',
    ANTHROPIC_BASE_URL: provider.url.origin, BGS_DEFAULT_BALANCED_MODEL: 'claude-sonnet-4-6',
    BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
  } }
}

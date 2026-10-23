// Observations only. Never sends messages, changes state or edits Agent documents.
import { join, basename } from 'node:path'
const root = import.meta.dir
const workspace = join(root, 'projects/users/spatial-test/priority-cli-breakout-20261001')
const tools: Record<string, number> = {}, skills = new Set<string>(), seen = new Set<string>()
const calculations: any[] = [], activity: any[] = [], nativeSessions = new Set<string>()
const delegations: any[] = []
let successfulGeometryOutputs = 0
for (const file of new Bun.Glob('.beegame/config/projects/**/*.jsonl').scanSync({ cwd: workspace, dot: true })) {
  for (const line of (await Bun.file(join(workspace, file)).text()).split('\n')) {
    let row: any; try { row = JSON.parse(line) } catch { continue }
    if (row.sessionId && !file.includes('/subagents/')) nativeSessions.add(row.sessionId)
    for (const block of row.message?.content ?? []) {
      if (block.type === 'tool_use' && !seen.has(block.id)) {
        seen.add(block.id); tools[block.name] = (tools[block.name] ?? 0) + 1
        if (block.name === 'Skill') skills.add(block.input?.skill)
        if (block.name === 'Agent' || block.name === 'Task') delegations.push({ timestamp: row.timestamp,
          toolUseId: block.id, description: block.input?.description, type: block.input?.subagent_type,
          background: block.input?.run_in_background, resume: Boolean(block.input?.resume) })
        const entry = { timestamp: row.timestamp, tool: block.name,
          actor: file.includes('/subagents/') ? basename(file, '.jsonl') : 'main',
          ...(block.name === 'Read' || block.name === 'Write' || block.name === 'Edit'
            ? { file: basename(block.input?.file_path ?? '') } : {}) }
        activity.push(entry)
        if (block.name === 'Bash' && /--layout-draft|--camera-draft|--layout\b|--design-layouts|resolveUiNodesForViewport|resolveSceneCameraView/.test(block.input?.command ?? ''))
          calculations.push({ timestamp: row.timestamp, toolUseId: block.id,
            command: (block.input?.command ?? '').replaceAll(workspace, '.').slice(0, 360) })
      }
      if (block.type === 'tool_result' && !block.is_error &&
          /layout-draft-inspection|camera-framing-draft-inspection|scene-layout-draft-inspection/.test(JSON.stringify(block.content)))
        successfulGeometryOutputs++
    }
  }
}
let state: any
for (const file of new Bun.Glob('dashboard/project-delivery/*/state.json').scanSync({ cwd: root })) state = await Bun.file(join(root, file)).json()
let usage: any[] = []; try { usage = await Bun.file(join(root, 'usage.json')).json() } catch {}
let stages: any[] = []; try { stages = await Bun.file(join(root, 'stages.json')).json() } catch {}
const totals = (rows: any[]) => rows.reduce((a, row) => ({ input: a.input + Number(row.usage?.input_tokens ?? 0),
  cachedInput: a.cachedInput + Number(row.usage?.cache_read_input_tokens ?? 0),
  cacheWrite: a.cacheWrite + Number(row.usage?.cache_creation_input_tokens ?? 0),
  output: a.output + Number(row.usage?.output_tokens ?? 0) }), { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 })
const documents = [...new Bun.Glob('docs/*.md').scanSync({ cwd: workspace })].map(file => basename(file))
console.log(JSON.stringify({ state: state && { phase: state.phase, status: state.status, authorBatch: state.authorBatch }, documents, nativeSessions: [...nativeSessions], tools, skills: [...skills], delegations,
  calculationCalls: calculations, successfulGeometryOutputs, usage: totals(usage),
  usageUnknownOnSuccessfulRequests: usage.filter(row => row.status === 200 && !row.usageKnown).length,
  documentActivity: activity.filter(row => ['Read', 'Write', 'Edit'].includes(row.tool)),
  stages: stages.map(row => ({ label: row.label, elapsedSeconds: row.elapsedSeconds,
    ...totals(usage.filter(item => item.stage === row.label)) })), recentActivity: activity.sort((a,b) => a.timestamp.localeCompare(b.timestamp)).slice(-8) }, null, 2))

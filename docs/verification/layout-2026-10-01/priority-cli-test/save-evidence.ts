// Post-run observation only: no model calls or changes to the tested project.
import { mkdir, cp, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { checkDesignLayouts } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/design-layout-check'
import { parseBeeGameContentDocument } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/game-content-schema'
import { readUiLayoutCamera } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/ui-layout-audit'
import { inspectUiLayout, summarizeUiLayoutInspection } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/scene-editor/src/ui-layout-inspection'

const root = import.meta.dir
const workspace = join(root, 'projects/users/spatial-test/priority-cli-breakout-20261001')
const destination = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/docs/verification/layout-2026-10-01/priority-cli-test'
const summary = await Bun.file(join(root, 'summary.json')).json()
const sourceHashes = await Bun.file(join(root, 'source-hashes.json')).json()
const sourceChangesDuringRun: string[] = []
const repo = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
for (const [file, hash] of Object.entries(sourceHashes))
  if (createHash('sha256').update(Buffer.from(await Bun.file(join(repo, file)).arrayBuffer())).digest('hex') !== hash)
    sourceChangesDuringRun.push(file)
await mkdir(destination) // Existing evidence is never overwritten.
for (const name of ['inputs.json', 'usage.json', 'stages.json', 'source-hashes.json', 'run.ts', 'inspect.ts', 'save-evidence.ts'])
  await copyFile(join(root, name), join(destination, name))
await cp(join(workspace, 'docs'), join(destination, 'final/docs'), { recursive: true })
for (const [source, target] of [['content/ui', 'final/content/ui'], ['.beegame/tmp', 'drafts']] as const) {
  try { await cp(join(workspace, source), join(destination, target), { recursive: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
for (const name of ['after-author-1', 'after-author-2', 'after-author-3', 'after-author-4', 'after-author-5', 'after-review', 'before-review', 'before-review-ui']) {
  try { await cp(join(root, name), join(destination, name), { recursive: true }) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
const observer = Bun.spawn(['bun', join(root, 'inspect.ts')], { stdout: 'pipe', stderr: 'pipe' })
const observation = JSON.parse(await new Response(observer.stdout).text())
if (await observer.exited) throw Error('Observer failed')
const hostGeometry = checkDesignLayouts(workspace, { orientation: 'Landscape', dimension: '2D' })
const calculatorCalls = new Map<string, any>(), calculatorResults: any[] = []
const transcriptRows: any[] = []
for (const file of new Bun.Glob('.beegame/config/projects/**/*.jsonl').scanSync({ cwd: workspace, dot: true }))
  for (const line of (await Bun.file(join(workspace, file)).text()).split('\n')) {
    try { transcriptRows.push(JSON.parse(line)) } catch {}
  }
for (const row of transcriptRows) for (const block of row.message?.content ?? [])
  if (block.type === 'tool_use' && block.name === 'Bash' && /--camera-draft|--layout-draft|--design-layouts/.test(block.input?.command ?? ''))
    calculatorCalls.set(block.id, { timestamp: row.timestamp, id: block.id,
      command: block.input.command.replaceAll(workspace, '.') })
const seenResults = new Set<string>()
for (const row of transcriptRows) for (const block of row.message?.content ?? [])
  if (block.type === 'tool_result' && calculatorCalls.has(block.tool_use_id) && !seenResults.has(block.tool_use_id)) {
    seenResults.add(block.tool_use_id)
    calculatorResults.push({ ...calculatorCalls.get(block.tool_use_id), resultTimestamp: row.timestamp,
      isError: block.is_error ?? false, content: block.content })
  }
await writeFile(join(destination, 'calculation-evidence.json'), JSON.stringify(calculatorResults, null, 2))
const geometry: any[] = []
for (const file of new Bun.Glob('content/ui/*.json').scanSync({ cwd: workspace })) {
  const document = parseBeeGameContentDocument(await Bun.file(join(workspace, file)).json())
  if (document.kind !== 'ui-hud' && document.kind !== 'ui-screen') continue
  const metadata = document.data.nodes.find(node => node.id === document.data.rootId)!.data!
  const viewports = [...new Map([metadata.referenceResolution, ...metadata.targetViewports as any[]].map((pair: any) => [pair.join('x'), pair])).values()] as [number, number][]
  for (const [width, height] of viewports) {
    const nodes = inspectUiLayout(document.data.nodes, document.data.rootId, { width, height }, readUiLayoutCamera(workspace, document))
    geometry.push({ file, viewport: [width, height],
      misplacedContainers: document.data.nodes.filter(node => node.data?.container && !node.layout?.container).map(node => node.id),
      summary: summarizeUiLayoutInspection(nodes), nodes })
  }
}
await writeFile(join(destination, 'independent-geometry.json'), JSON.stringify({ hostGeometry, runtimeVerified: false, fontMeasured: false, geometry }, null, 2))
const evidenceHashes: Record<string, string> = {}
for (const file of new Bun.Glob('**/*').scanSync({ cwd: destination, onlyFiles: true }))
  evidenceHashes[file] = createHash('sha256').update(Buffer.from(await Bun.file(join(destination, file)).arrayBuffer())).digest('hex')
await writeFile(join(destination, 'test-record.json'), JSON.stringify({ ...observation,
  model: summary.model, elapsedSeconds: summary.elapsedSeconds, requestCount: summary.requestCount,
  failure: summary.failure ?? null, stopped: summary.stopped, hostGeometry,
  independentSemanticAcceptance: 'Requires independent source audit; phase advancement does not certify document quality.',
  nativeReportedReviewComplete: observation.state?.phase === 'resources', resourceTurnDispatched: false,
  scope: 'Real native CLI via sendProjectConversation; constructed confirmed brief, no frontend intake or game runtime test.',
  billing: 'Provider tokens only, not wallet Credits. No credit cap; unknown usage is not zero.',
  unknownUsageRequests: summary.usageRows.filter((row: any) => !row.usageKnown),
  evidenceHashes, rawProtectedEvidenceRoot: root,
  sourceChangesDuringRun,
}, null, 2))
console.log(JSON.stringify({ destination, state: observation.state, hostGeometry, usage: observation.usage,
  overlapCandidates: geometry.map(row => ({ file: row.file, viewport: row.viewport, summary: row.summary })),
}, null, 2))

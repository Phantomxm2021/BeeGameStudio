// Reproducible post-run checks of frozen evidence. No model calls or project edits.
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { inspectUiLayout, summarizeUiLayoutInspection } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/scene-editor/src/ui-layout-inspection'
import { initializeUiLayout } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/scene-editor/src/ui-container-layout'
import { resolveSceneCameraView } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/scene-editor/src/scene-camera'

const evidence = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/docs/verification/layout-2026-10-01/priority-cli-test'
const frozen = join(evidence, 'final')
const balance = await Bun.file(join(frozen, 'docs/BALANCE_DESIGN.md')).text()
const scene = await Bun.file(join(frozen, 'docs/LEVEL_SCENE_DESIGN.md')).text()
const assets = await Bun.file(join(frozen, 'docs/ASSET_PLAN.md')).text()
await initializeUiLayout()
function release(key: string) {
  const line = balance.split('\n').find(line => line.startsWith('|') && line.includes('`' + key + '`'))!
  const match = line?.match(/\|\s*\*\*([\d.]+)\*\*/)
  if (!match) throw Error('Release value unavailable: ' + key)
  return Number(match[1])
}
function matchNumbers(source: string, pattern: RegExp) {
  const match = source.match(pattern)
  if (!match) throw Error('Source changed: ' + pattern)
  return match.slice(1).map(Number)
}
const v = release('ballSpeedPxPerSec'), vp = release('paddleKeyboardSpeedPxPerSec')
const angleMin = release('paddleBounce.angleMinDeg'), angleMax = release('paddleBounce.angleMaxDeg')
const [paddleWidth, paddleHeight] = matchNumbers(scene, /挡板 paddle 尺寸[^\n]*\*\*(\d+)×(\d+)\*\*/)
const [diameter] = matchNumbers(scene, /球 ball[^\n]*直径 \*\*(\d+)\*\*/)
const [paddleInitialX, paddleInitialY] = matchNumbers(scene, /挡板初始中心[^\n]*\*\*\((\d+),\s*(\d+)\)\*\*/)
const [brickRightColumnX] = matchNumbers(scene, /r6c10 中心 \((\d+),/)
const [brickBottom] = matchNumbers(scene, /砖阵整体外框[^\n]*y∈\[\d+,(\d+)\]/)
const radius = diameter / 2, paddleTop = paddleInitialY - paddleHeight / 2
const verticalDistance = paddleTop - radius - (brickBottom + radius)
const radians = angleMin * Math.PI / 180
const timeAtMinAngle = verticalDistance / (v * Math.cos(radians))
const ballXAtContact = brickRightColumnX + v * Math.sin(radians) * timeAtMinAngle
const minimumPaddleCenterForOverlap = ballXAtContact - paddleWidth / 2 - radius

const game = await Bun.file(join(frozen, 'content/ui/game-screen.json')).json()
const metadata = game.data.nodes.find((n: any) => n.id === game.data.rootId).data
const smallest = [...metadata.targetViewports].sort((a: number[], b: number[]) => a[0]*a[1]-b[0]*b[1])[0]
const camera = await Bun.file(join(evidence, 'drafts/breakout-camera.json')).json()
const gameNodes = inspectUiLayout(game.data.nodes, game.data.rootId, { width: smallest[0], height: smallest[1] }, { camera: { nodeId: metadata.layoutCamera.nodeId, input: camera } })
const viewBounds = gameNodes.find(n => n.id === metadata.layoutCamera.nodeId)!.bounds
const view = resolveSceneCameraView(camera, { width: viewBounds.right-viewBounds.left, height: viewBounds.bottom-viewBounds.top })
const hud = gameNodes.find(n => n.id === 'hud')!
const [allowedBandBottom] = matchNumbers(scene, /允许叠加带\*\*：y∈\[0,(\d+)\]/)
const allowedBandBottomOnScreen = viewBounds.top + view.rect.y + allowedBandBottom * view.rect.height / camera.viewport.height
const title = await Bun.file(join(frozen, 'content/ui/title-screen.json')).json()
const titleNodes = inspectUiLayout(title.data.nodes, title.data.rootId, { width: smallest[0], height: smallest[1] })
const titleSub = titleNodes.find(n => n.id === 'title-sub')!.bounds
const start = titleNodes.find(n => n.id === 'start-button')!.bounds
const rotate = await Bun.file(join(frozen, 'content/ui/rotate-prompt.json')).json()
const rotateNodes = inspectUiLayout(rotate.data.nodes, rotate.data.rootId, { width: 390, height: 844 })
const spriteMapping = ['paddle', 'ball'].map(name => {
  const line = assets.split('\n').find(line => line.startsWith('| `' + name + '` |'))!
  const [width, height, frameWidth, frameHeight] = matchNumbers(line, /\|\s*(\d+)×(\d+)\s*\|\s*(\d+)×(\d+)/)
  return { name, logicalCore: [width, height], fullFrame: [frameWidth, frameHeight],
    visibleCoreIfFullFrameDrawnAtLogicalSize: [width*width/frameWidth, height*height/frameHeight] }
})
const handoff = await Bun.file(join(evidence, 'handoff-evidence.json')).json()
const result = handoff.nativeResult
const usage = await Bun.file(join(evidence, 'usage.json')).json()
const completeUsage = usage.filter((r: any) => r.status === 200 && r.usageKnown && !r.error)
const totals = completeUsage.reduce((a: any, r: any) => ({ input: a.input+r.usage.input_tokens,
  cachedInput: a.cachedInput+r.usage.cache_read_input_tokens, output: a.output+r.usage.output_tokens }), { input: 0, cachedInput: 0, output: 0 })
const summary = await Bun.file(join(evidence, 'test-record.json')).json()
const record = {
  verdict: 'Independent document acceptance failed; native delivery also did not advance.',
  runtimeVerified: false, fontMeasured: false,
  numericCounterexample: { v, vp, angleMin, angleMax, diameter, paddleWidth, verticalDistance,
    assumption: 'Ball leaves bottom-row right-column at (840,303), downward/right; paddle starts at its initial center and moves immediately. No earlier anticipation is assumed.',
    timeAtMinAngle, timeAtMaxAngle: verticalDistance/(v*Math.cos(angleMax*Math.PI/180)),
    ballXAtContact, minimumPaddleCenterForOverlap,
    maximumPaddleCenterInWindow: paddleInitialX + vp*timeAtMinAngle,
    minimumPaddleTravelTime: (minimumPaddleCenterForOverlap-paddleInitialX)/vp,
    scope: 'Refutes the document worst-case proof, not a global claim that the game is unfair or impossible.' },
  worldScreenMismatch: { viewport: smallest, hudBounds: hud.bounds, allowedWorldBandBottom: allowedBandBottom,
    allowedBandBottomOnScreen, intrusionIntoTopWallBand: hud.bounds.bottom-allowedBandBottomOnScreen,
    scope: 'Violates the source no-top-wall-overlap allocation. Does not claim ball/brick occlusion or measured runtime visibility.' },
  spriteMapping: { rule: 'ASSET_PLAN section 2.2: glow is baked into the full frame, drawn at logical dimensions.',
    frames: spriteMapping, scope: 'Conditional consequence of the specified production/render mapping; no produced image or runtime was tested.' },
  otherGeometryObservations: {
    titleAtMinimum: { titleSub, startButton: start, rectangleVerticalIntersection: Math.max(0,Math.min(titleSub.bottom,start.bottom)-Math.max(titleSub.top,start.top)),
      scope: 'Different-parent allocated boxes intersect. Actual glyph overlap remains unmeasured; not an automatic blocking verdict.' },
    unsupportedDirectionMessageOnly: { viewport: [390,844], diagnostics: summarizeUiLayoutInspection(rotateNodes),
      scope: 'Only the required rotation message, not portrait gameplay adaptation; node overflow does not prove visible glyph clipping.' },
  },
  nativeHandoff: { elapsedSeconds: summary.elapsedSeconds, requestCount: summary.requestCount,
    failure: summary.failure, terminal: handoff.terminal.type,
    result: { subtype: result.payload.subtype, isError: result.payload.is_error, stopReason: result.payload.stop_reason, resultText: result.payload.result },
    markerReportedComplete: true, geometryRejected: false,
    explanation: 'Last stream failed; SDK result text empty, followed by turn.empty. Production advances only on turn.completed. Root cause of transport failure not established; no max-turns cap inferred.' },
  billing: { completeUsageRequestCount: completeUsage.length, completeUsage: totals,
    unknownUsageRequests: usage.filter((r: any) => !r.usageKnown).map((r: any) => ({id:r.id,status:r.status,error:r.error})),
    partialUsageRequests: usage.filter((r: any) => r.error && r.usageKnown),
    note: 'Request 213 has only an interrupted usage snapshot; do not treat output_tokens:1 as settled full usage or interpret SDK costUSD as account Credits.' },
}
await writeFile(join(evidence, 'independent-audit.json'), JSON.stringify(record, null, 2))
const script = await Bun.file(import.meta.path).text()
await writeFile(join(evidence, 'independent-audit.ts'), script)
await writeFile(join(evidence, 'audit-script-sha256.txt'), createHash('sha256').update(script).digest('hex') + '\n')
console.log(JSON.stringify(record, null, 2))

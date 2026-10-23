// Read-only inspection of this isolated experiment. Not a BGS delivery gate.
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const experiment = process.argv[2]
if (!experiment) throw Error('Supply the retained isolated experiment directory')
const summary = await Bun.file(join(experiment, 'summary.json')).json()
const stages = await Bun.file(join(experiment, 'stages.json')).json()
const output = import.meta.dir
const ui = await Bun.file(join(output, 'final/UI_UX_SPEC.md')).text()
const level = await Bun.file(join(output, 'final/LEVEL_SCENE_DESIGN.md')).text()
if (!ui.includes('宽 1100–1299') || !ui.includes('R2 = min(屏宽−24, 屏高−24)') ||
    !level.includes('位于棋盘外的固定带，不压占棋盘世界格位'))
  throw Error('The inspected source changed; reconsider the counterexamples before using this audit')
const totals = (rows: any[]) => rows.reduce((a, row) => ({
  input: a.input + Number(row.usage?.input_tokens ?? 0),
  cachedInput: a.cachedInput + Number(row.usage?.cache_read_input_tokens ?? 0),
  cacheWrite: a.cacheWrite + Number(row.usage?.cache_creation_input_tokens ?? 0),
  output: a.output + Number(row.usage?.output_tokens ?? 0),
}), { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 })
const seen = new Set<string>(), skills = new Set<string>(), tools: Record<string, number> = {}
let layoutReferenceReads = 0, sharedLayoutRuns = 0
for (const file of new Bun.Glob('projects/users/gdd-test/*/.beegame/config/projects/**/*.jsonl').scanSync({ cwd: experiment, dot: true })) {
  for (const line of (await Bun.file(join(experiment, file)).text()).trim().split('\n')) {
    const row = JSON.parse(line)
    if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    for (const call of row.message.content) {
      if (call.type !== 'tool_use' || seen.has(call.id)) continue
      seen.add(call.id); tools[call.name] = (tools[call.name] ?? 0) + 1
      if (call.name === 'Skill') skills.add(call.input?.skill)
      if (call.name === 'Read' && /layout-calculation\.md/.test(call.input?.file_path ?? '')) layoutReferenceReads++
      if (call.name === 'Bash' && /layout-draft|check-content\.mjs|resolveUiNodesForViewport|resolveSceneCameraView/.test(call.input?.command ?? '')) sharedLayoutRuns++
    }
  }
}
const cases = [[720, 960], [320, 568], [568, 320], [667, 375], [320, 160]].map(([width, height]) => {
  // UI_UX_SPEC §2 and §7, using zero safe-area inset for this counterexample.
  const small = Math.min(width, height) < 480, margin = small ? 16 : 24
  let board = Math.min(width - 2*margin, height - 80 - (small ? 140 : 160) - 48)
  let mode = '正常布局'
  if (board < 300) { mode = '棋盘优先'; board = Math.min(width - 2*margin, height - 80 - 24) }
  if (board < 285) { mode = '全悬浮'; board = Math.min(width - 24, height - 24) }
  return { width, height, mode, board, cell: board/21, meetsDeclaredMinimum: board/21 >= 13.5 }
})
const files = Array.from(new Bun.Glob('*.md').scanSync({ cwd: join(output, 'final') })).sort()
const sourceHashes = await Promise.all(files.map(async name => ({ name,
  sha256: createHash('sha256').update(new Uint8Array(await Bun.file(join(output, 'final', name)).arrayBuffer())).digest('hex') })))
const result = {
  scope: 'Fresh eight design documents and one BGS review/revision turn; no resource or implementation turn dispatched',
  initialUserMessage: '我想做一个贪吃蛇游戏。', model: 'ark-code-latest', skillSearchEnabled: true,
  mainSessions: new Set(stages.map((stage: any) => stage.sessionId)).size,
  reportedReviewComplete: true, independentDesignCheck: 'failed',
  elapsedSeconds: summary.elapsedSeconds, usage: totals(summary.usageRows),
  requestCount: summary.requestCount,
  requestsWithCompleteUsage: summary.usageRows.filter((row: any) => typeof row.usage?.output_tokens === 'number').length,
  stages: stages.map((stage: any) => ({ label: stage.label, elapsedSeconds: stage.elapsedSeconds,
    ...totals(summary.usageRows.filter((row: any) => row.id >= stage.firstRequest && row.id <= stage.lastRequest)) })),
  tools, skills: [...skills], layoutReferenceReads, sharedLayoutRuns, cases, sourceHashes,
  failures: [
    { id: 'layout-selection', source: 'UI_UX_SPEC §2.2', width: 1200, height: 900,
      triggerByFirstRule: 1200 >= 1100 && 1200/900 >= 1.1,
      excludedByLastRule: 1200 >= 1100 && 1200 <= 1299 },
    { id: 'hud-ownership', source: 'UI_UX_SPEC §2/§3.2 and LEVEL_SCENE_DESIGN §4',
      uiLimitedHeightPolicy: 'HUD overlays the board', scenePolicy: 'HUD reserves space outside the board' },
    { id: 'supported-space', source: 'UI_UX_SPEC §1/§2', width: 320, height: 160,
      widthOverHeight: 2, heightOverWidth: 0.5, cell: 136/21, requiredCellMinimum: 13.5,
      note: 'Both aspect conventions are inside the stated range; no safe-area inset is needed to reproduce this failure' },
  ],
  limitations: ['No rendered game, assets, runtime gameplay, aesthetic acceptance or XR device test',
    'Usage is provider-reported tokens; this record is not an account Credits settlement',
    'Token counting endpoint was unavailable in the isolated measurement proxy; CLI fallback was used'],
}
await Bun.write(join(output, 'test-record.json'), JSON.stringify(result, null, 2))
const cards = cases.map(row => {
  const scale = Math.min(1, 540/row.width), board = row.board*scale
  return `<section><h2>${row.width} × ${row.height} · ${row.mode}</h2><p>棋盘 ${row.board}；每格 ${row.cell.toFixed(2)} du <strong>${row.meetsDeclaredMinimum ? '达到13.5下限' : '低于13.5下限'}</strong></p>
    <div class="host" style="width:${row.width*scale}px;height:${row.height*scale}px">
    <div class="board" style="width:${board}px;height:${board}px;background-size:${board/21}px ${board/21}px">${row.mode === '全悬浮' ? '<span class="overlay">HUD 悬浮示意</span>' : ''}</div></div></section>`
}).join('')
await Bun.write(join(output, 'layout-counterexamples.html'), `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文档布局复算</title><style>
body{margin:24px;background:#10131a;color:#edf0f7;font:16px/1.6 system-ui}main{display:flex;flex-wrap:wrap;gap:24px}section{max-width:100%;border:1px solid #404756;border-radius:12px;padding:16px;box-sizing:border-box}h1,h2{line-height:1.3}.host{background:#1b2230;position:relative;max-width:100%;display:grid;place-items:center;border:1px solid #64748b}.board{position:relative;background-color:#203227;background-image:linear-gradient(#4a6355 1px,transparent 1px),linear-gradient(90deg,#4a6355 1px,transparent 1px);border:1px solid #6fc888;box-sizing:border-box}.overlay{position:absolute;right:0;top:0;border:2px solid #fb7185;background:#9f123966;color:white;padding:2px;font-size:12px}strong{color:#fda4af}p{max-width:900px}a{color:#93c5fd}
</style><h1>最终文档的布局复算</h1><p>这里只展示 UI_UX_SPEC 的区域公式，不是游戏画面或审美验收。HUD 的精确子节点矩形未定义；红框仅示意文档选择的悬浮关系，不能当作实际截图。</p><p>1200×900 同时满足“横向重排”与“不重排”规则。320×160 在声明范围内，却无法达到每格13.5的下限。对应源文件及复算记录均已留存。</p><main>${cards}</main></html>`)
console.log(JSON.stringify({ independentDesignCheck: result.independentDesignCheck, usage: result.usage,
  elapsedSeconds: result.elapsedSeconds, tools, sharedLayoutRuns, failures: result.failures.map(row => row.id) }))

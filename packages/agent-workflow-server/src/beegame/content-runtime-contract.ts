import { z } from 'zod/v4'

/** An outcome contract, not a renderer, test runner or Agent execution plan. */
export const CONTENT_RUNTIME_CHECKS = {
  'ui-layout': {
    properties: ['layout'],
    outcome: 'Changing an authored node position and size changes its actual runtime geometry. Include parent/anchor and applicable responsive variants; changing text alone is not layout verification. At relevant target viewports, verify active controls and overlays are fully in view; DOM presence or locator.isVisible alone does not prove this.',
  },
  'scene-layout': {
    properties: ['transform', 'tilemap'],
    outcome: 'Changing authored transforms changes the corresponding objects and their descendants in the target runtime, including rotation and scale in the correct 2D/3D coordinate space. Where Tilemaps exist, separately verify a cell/grid change. A working cell lookup does not establish hierarchy/transform consumption.',
  },
  'resource-binding': {
    properties: ['assetRef', 'frame', 'member'],
    outcome: 'Changing an authored resource/frame reference changes the rendered or played asset. Resolve the Manifest/TileSet/atlas mapping and actually decode the asset; HTTP 200 or a filename alone is insufficient.',
  },
} as const

export const CONTENT_RUNTIME_CONTRACT = {
  authority: 'content/index.json resolves document IDs to paths; authored Scene/UI/VFX data and assets/asset-manifest.json remain the editable source. Parsing fields without using them in the target runtime does not satisfy this contract.',
  responsive: 'Responsive rendering is not permission to replace authored layout with a second CSS/engine layout. Use uiLayoutContract.responsive and coordinates from this format. If authored data cannot express the intended layout, resolve that mismatch in the editable content/contract; do not silently ignore layout fields. Runtime behavior may update state and transforms, but does not replace their authored defaults.',
  scene: 'Scene data is not just a gameplay parameter table. Consume the authored node hierarchy, enabled state, local position/rotation/scale and relevant rendering components, camera and ordering. Resolve Tilemap gridNodeId, cellSize/cellGap, cells/tileId and TileSet asset/member/frame mappings instead of a fixed tile size or image path. Viewport/camera adaptation changes presentation, not the authored world or level arrangement. Runtime gameplay and data-defined procedural generation may update that initial world; they do not justify replacing it with an independently hard-coded scene.',
  implementation: 'Choose any framework, renderer and code structure. BGS parsing helpers are optional; the data semantics are not. Derived/compiled content is valid when source changes propagate after rebuilding.',
  verification: 'Verify representative source changes in a temporary copy or intercepted test response, without changing layout code. Compare before/after target-runtime results; restore the original data. A no-change or wrong-change result fails that binding. Report unverified when the target runtime cannot be observed. This does not prescribe tools, test order or delegation.',
  checks: CONTENT_RUNTIME_CHECKS,
} as const

const text = z.string().trim().min(1)
export const contentRuntimeCheckSchema = z.object({
  kind: z.enum(['ui-layout', 'scene-layout', 'resource-binding']),
  document: text, // workspace-relative registered content document
  nodeId: text,
  property: z.enum(['layout', 'transform', 'tilemap', 'assetRef', 'frame', 'member']),
  change: text,
  expected: text,
  observed: text,
  status: z.enum(['passed', 'failed', 'unverified']),
  evidencePaths: z.array(text).min(1),
}).superRefine((check, context) => {
  if (!(CONTENT_RUNTIME_CHECKS[check.kind].properties as readonly string[]).includes(check.property))
    context.addIssue({ code: 'custom', path: ['property'], message: `${check.kind} cannot be established by changing ${check.property}` })
})

export const CONTENT_RUNTIME_REPORT_INSTRUCTION = 'For authored content, verification.contentChecks records representative data-binding checks: {kind:"ui-layout"|"scene-layout"|"resource-binding",document:"content/<registered file>",nodeId,property:"layout"|"transform"|"tilemap"|"assetRef"|"frame"|"member",change,expected,observed,status:"passed"|"failed"|"unverified",evidencePaths:string[]}. Text fields describe the actual source change and before/after runtime result. Include ui-layout when screen/HUD data exists, scene-layout/transform when Scene data exists, an additional scene-layout/tilemap check when Tilemaps exist, and resource-binding when content references assets. A tile cell check cannot replace a parent/child transform check. Every check evidence path must also appear in the report evidencePaths. Failed or unverified bindings cannot be a delivery PASS. These are results, not an extra stage or required testing tool.'

/** Project-local shape check; runtime observations and evidence identity remain host-validated. */
export function acceptanceReportFormatCheckerSource(): string {
  const properties = Object.fromEntries(Object.entries(CONTENT_RUNTIME_CHECKS)
    .map(([kind, rule]) => [kind, rule.properties]))
  return `#!/usr/bin/env bun
import { readFileSync } from 'node:fs'

const properties = ${JSON.stringify(properties)}
const reportPath = process.argv[2] || '.beegame/delivery/acceptance.json'
const errors = []
let report
try { report = JSON.parse(readFileSync(reportPath, 'utf8')) }
catch (error) {
  console.error('Cannot read acceptance report: ' + (error instanceof Error ? error.message : String(error)))
  process.exit(1)
}
if (!report || typeof report !== 'object' || Array.isArray(report)) errors.push('Report must be an object')
else {
  if (Object.hasOwn(report, 'contentChecks')) errors.push('move top-level contentChecks to verification.contentChecks')
  const checks = report.verification?.contentChecks
  if (checks !== undefined && !Array.isArray(checks)) errors.push('verification.contentChecks must be an array')
  if (Array.isArray(checks)) {
    for (const [index, check] of checks.entries()) {
      const path = 'verification.contentChecks[' + index + ']'
      if (!check || typeof check !== 'object') { errors.push(path + ' must be an object'); continue }
      if (!Object.hasOwn(properties, check.kind)) errors.push(path + '.kind is unknown')
      else if (!properties[check.kind].includes(check.property))
        errors.push(path + '.property ' + JSON.stringify(check.property) + ' is invalid for ' + check.kind + '; use ' + properties[check.kind].join(' or '))
    }
  }
}
if (errors.length) {
  for (const error of errors) console.error(error)
  process.exit(1)
}
console.log('Content-check fields OK; the full report and runtime evidence are not verified by this command.')
`
}

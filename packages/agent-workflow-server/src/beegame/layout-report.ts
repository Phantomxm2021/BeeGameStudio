import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { LayoutDiagnostic, LayoutMeasurement } from './ui-layout-audit'
import { summarizeUiLayoutInspection } from '../../../scene-editor/src/ui-layout-inspection'
import type { inspectSceneLayout2d } from '../../../scene-editor/src/scene-layout-inspection'

/** Presentation only: never substitutes for the complete host check. */
export function formatLayoutReport(result: {
  valid: boolean; issues: string[]; diagnostics: LayoutDiagnostic[];
  coverage?: unknown; deferred?: string[]; inputs?: unknown;
  inputLocation?: unknown;
}, fullResultPath?: string): string {
  // Merge only identical failures/geometry. Different viewports, nodes,
  // measurements and close conditions must remain independently inspectable.
  const groups = new Map<string, { diagnostic: LayoutDiagnostic; scenes: Set<string>; count: number }>()
  for (const diagnostic of result.diagnostics) {
    const { scene, ...identity } = diagnostic
    const key = JSON.stringify(identity)
    const group = groups.get(key) ?? { diagnostic: identity, scenes: new Set<string>(), count: 0 }
    if (scene) group.scenes.add(scene)
    group.count++
    groups.set(key, group)
  }
  const represented = new Set(result.diagnostics.flatMap(d => [d.message,
    `${d.source}: ${d.message}`, `${d.source}:${d.scene ? ` Scene ${d.scene}` : ''} ${d.message}`]))
  const otherIssues = [...new Set(result.issues)].filter(issue => !represented.has(issue))
  const coverage = result.coverage && typeof result.coverage === 'object' && !Array.isArray(result.coverage)
    ? result.coverage as Record<string, unknown> : undefined
  const coveredUnverified = new Set(Array.isArray(coverage?.unverified) ? coverage.unverified : [])
  const additionalDeferred = [...new Set(result.deferred ?? [])].filter(item => !coveredUnverified.has(item))
  // Several failures (e.g. outside-viewport and flow-overflow) refer to the
  // same measured rectangle. Print that evidence once, never recompute it or
  // suppress a failure. References point backwards within this same report.
  const measurements = new Map<string, number>(), sceneLists = new Map<string, number>()
  const evidence = (label: string, value: unknown, seen: Map<string, number>, index: number) => {
    const key = JSON.stringify(value), previous = seen.get(key)
    if (previous !== undefined) return label + ': same as diagnostic #' + previous
    seen.set(key, index + 1)
    return label + ': ' + key
  }
  return [
    `Saved-input checks: ${result.valid ? 'PASS (reported scope only)' : 'FAIL'}`,
    'Not visual, font-fit, gameplay or runtime acceptance. ' + (fullResultPath
      ? 'All checked inputs and raw diagnostics are retained.' : 'Checked inputs and diagnostics are listed below.'),
    ...(fullResultPath ? [`Full result: ${fullResultPath}`] : []),
    ...(result.inputLocation ? ['Current source snapshot: ' + JSON.stringify(result.inputLocation)] : []),
    `Failures: ${result.diagnostics.length} occurrences, ${groups.size} distinct diagnostics, ${otherIssues.length} additional issues.`,
    ...[...groups.values()].map(({ diagnostic: d, scenes, count }, index) => [
      `${index + 1}. ${d.source ?? '(input)'}${d.node ? ' #' + d.node : ''} | ${d.viewport?.join('x') ?? 'input'} | ${d.kind}`,
      d.message,
      ...(scenes.size ? [evidence('Affected scenes', [...scenes], sceneLists, index)] : []),
      ...(count > 1 ? [`Identical occurrences: ${count}`] : []),
      ...(d.geometry ? [evidence('Measured geometry', d.geometry, measurements, index)] : []),
      ...(d.closeWhen ? ['Close when: ' + d.closeWhen] : []),
    ].join('\n')),
    ...otherIssues.map(issue => 'Issue: ' + issue),
    ...(additionalDeferred.length ? ['Deferred (not verified): ' + JSON.stringify(additionalDeferred)] : []),
    'Coverage: ' + JSON.stringify(result.coverage ?? {}),
    ...(result.inputs ? ['Check conditions: ' + JSON.stringify(result.inputs)] : []),
  ].join('\n')
}

/** One coordinate presentation for the CLI appendix and native layout tool. */
export function formatUiLayoutTable(nodes: ReturnType<typeof import('../../../scene-editor/src/ui-layout-inspection').inspectUiLayout>) {
  const cell = (value: unknown) => JSON.stringify(value ?? null).replaceAll('|', '&#124;').replaceAll('\n', ' ')
  return [
    '| ID | Parent | Active | Local position | Local size | Anchor | Pivot | Host bounds | Text fit |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...nodes.map(node => '| ' + [node.id, node.parentId, node.active, node.layout?.position, node.layout?.size,
      node.layout?.anchor, node.pivot, node.bounds, node.textFit].map(cell).join(' | ') + ' |'),
  ].join('\n')
}

/** Explain already computed geometry; never select a different layout or infer design intent. */
export function formatUiLayoutMeasurement(measurement: LayoutMeasurement, details = false) {
  const { nodes, variants } = measurement
  const observations = Object.fromEntries(Object.entries(summarizeUiLayoutInspection(nodes))
    .filter(([, values]) => values.length))
  const lines = [
    'Effective variants (compact by width; portrait applied after compact): ' + JSON.stringify(variants),
    'Spatial observations (overlapCandidates require design interpretation, not automatic failures): ' + JSON.stringify(observations),
  ]
  if (details) {
    const byId = new Map(nodes.map(node => [node.id, node]))
    const constraints = nodes.map(node => {
      const layout = node.layout ?? {}, parent = byId.get(node.parentId ?? '')
      const positionControlledBy = !node.active ? 'inactive' : !parent ? 'viewport root'
        : parent.layout?.container && !layout.item?.absolute ? 'flow:' + parent.id : 'anchor'
      return { id: node.id, positionControlledBy,
        ...(layout.container ? { container: layout.container } : {}),
        ...(layout.item ? { item: layout.item } : {}),
        ...(layout.minSize ? { minSize: layout.minSize } : {}),
        ...(layout.maxSize ? { maxSize: layout.maxSize } : {}) }
    })
    lines.push('Effective layout constraints (flow owns child position/size; edit constraints with native Edit): ' + JSON.stringify(constraints),
      'Local position/size is parent-local; Host bounds is in host logical pixels.', formatUiLayoutTable(nodes))
    const containment = nodes.filter(node => node.outsideParent || node.outsideContentArea)
      .map(node => ({ id: node.id, parent: node.parentGeometry }))
    if (containment.length) lines.push('Containment geometry: ' + JSON.stringify(containment))
  }
  return lines.join('\n')
}

/** Display shared static XY observations, never a second Scene solver. */
export function formatSceneLayoutInspection(inspection: ReturnType<typeof inspectSceneLayout2d>, details = false) {
  const { nodes } = inspection
  const lines = [
    'Coordinate system: ' + JSON.stringify(inspection.coordinateSystem),
    'Selected Camera: ' + JSON.stringify({ nodeId: inspection.cameraNodeId, ...inspection.camera, view: inspection.view }),
    'Required visibility: ' + JSON.stringify(inspection.requiredVisibility ?? { status: 'unverified', reason: 'No required-visible nodes declared.' }),
    'Spatial observations: ' + JSON.stringify({
      outsideCameraView: nodes.filter(node => node.enabled && node.fullyInside === false).map(node => node.id),
      geometryUnavailable: nodes.filter(node => node.enabled && node.geometryUnavailable)
        .map(node => ({ id: node.id, reason: node.geometryUnavailable })),
    }),
  ]
  if (details) {
    const cell = (value: unknown) => JSON.stringify(value ?? null).replaceAll('|', '&#124;').replaceAll('\n', ' ')
    lines.push('Local transforms are authored (omitted fields use identity); RectTransform offsets also affect world origins. World origin/bounds use Scene coordinates; projected bounds use viewport-local logical pixels. Rotation is in radians. Empty bounds are unknown or nonvisual, not visibility proof.',
      '| ID | Parent | Enabled | Local transform / RectTransform | World origin | World bounds | Projected bounds | Inside Camera | Unknown geometry |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...nodes.map(node => '| ' + [node.id, node.parentId, node.enabled,
        { transform: node.localTransform, rectTransform: node.rectTransform }, node.worldOrigin,
        node.worldBounds, node.screenBounds, node.fullyInside, node.geometryUnavailable].map(cell).join(' | ') + ' |'))
  }
  return lines.join('\n')
}

/** Workspace-local immutable result, not a second design authority. Reject
 * redirected directories rather than writing through a project symlink. */
export function retainLayoutReport(workspace: string, result: unknown): string {
  const root = realpathSync(workspace)
  let directory = root
  for (const name of ['.beegame', 'tmp', 'layout-reports']) {
    directory = join(directory, name)
    mkdirSync(directory, { recursive: true })
    if (realpathSync(directory) !== directory) throw new Error('Layout report directory must not be a symlink')
  }
  const path = join(mkdtempSync(join(directory, 'check-')), 'result.json')
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  return relative(root, path).split('\\').join('/')
}

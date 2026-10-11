import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { LayoutDiagnostic } from './ui-layout-audit'

/** Presentation only: never substitutes for the complete host check. */
export function formatLayoutReport(result: {
  valid: boolean; issues: string[]; diagnostics: LayoutDiagnostic[];
  coverage?: unknown; deferred?: string[]; inputs?: unknown;
  inputLocation?: unknown;
}, fullResultPath: string): string {
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
    'Not visual, font-fit, gameplay or runtime acceptance. All checked inputs and raw diagnostics are retained.',
    `Full result: ${fullResultPath}`,
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

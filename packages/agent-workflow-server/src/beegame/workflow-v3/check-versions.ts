import type { CHECK_IDS, CheckResult, TaskSpec } from './state'

// Producer and consumers share explicit driver versions. Byte freshness alone
// cannot promote evidence from a replaced checker. Bump the affected entry when
// its verification contract changes; do not hash the whole BGS release.
export const CHECK_VERSIONS = {
  'artifact-json': 'v3-slice.1',
  'content-schema': 'v3-slice.1',
  'content-structure': 'v3-content.2',
  'content-layout': 'v3-content.2',
  'content-resources': 'v3-content.3',
  build: 'v3-slice.1',
  'rule-tests': 'v3-slice.1',
  'runtime-smoke': 'v3-static-artifact.3',
  'delivery-package': 'v3-static-artifact.2',
  'ui-data-consumption': 'v3-ui-dom-consumption.7',
  'scene-data-consumption': 'v3-scene-visible-causality.1',
  'pixel-data-consumption': 'v3-canvas-image-consumption.3',
  'font-data-consumption': 'v3-dom-font-consumption.1',
  'audio-data-consumption': 'v3-html-audio-consumption.3',
} as const satisfies Record<(typeof CHECK_IDS)[number], string>
export const EDITABLE_BUILD_CHECK_VERSION = 'v3-editable-build.1' as const

export function currentCheckVersion(id: keyof typeof CHECK_VERSIONS, task?: Pick<TaskSpec, 'editableProject'>): string {
  return id === 'build' && task?.editableProject ? EDITABLE_BUILD_CHECK_VERSION : CHECK_VERSIONS[id]
}
export function isCurrentCheckVersion(check: Pick<CheckResult, 'id' | 'version'>, task?: Pick<TaskSpec, 'editableProject'>): boolean {
  if (!Object.hasOwn(CHECK_VERSIONS, check.id)) return false
  // Standalone consumer checks may receive either real build driver; when the
  // owning task is known, its declared build mode must match as well.
  if (check.id === 'build' && !task && check.version === EDITABLE_BUILD_CHECK_VERSION) return true
  return check.version === currentCheckVersion(check.id as keyof typeof CHECK_VERSIONS, task)
}

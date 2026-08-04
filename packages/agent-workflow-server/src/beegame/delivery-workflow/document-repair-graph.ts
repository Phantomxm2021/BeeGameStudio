import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DocumentRepairGroup,
  type DocumentReviewFinding,
  type FoundationDocumentPath,
} from './types'

export const INITIAL_FOUNDATION_UPSTREAM_PATHS: Record<
  FoundationDocumentPath,
  readonly FoundationDocumentPath[]
> = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': ['docs/GDD.md'],
  'docs/BALANCE_DESIGN.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/TECHNICAL_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
  ],
  'docs/ART_DIRECTION.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/UI_UX_SPEC.md': ['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md'],
  'docs/AUDIO_DESIGN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/UI_UX_SPEC.md',
  ],
  'docs/ASSET_PLAN.md': [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ],
}

export type DerivedRepairGroup = {
  groupId: string
  findings: DocumentReviewFinding[]
  affectedPaths: FoundationDocumentPath[]
  dependsOn: string[]
}

export function deriveFoundationRepairGroups(
  findings: DocumentReviewFinding[],
): DerivedRepairGroup[] {
  const canonicalFindings = findings.map(finding => ({
    finding,
    paths: CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
      finding.subjects.some(subject => subject.path === path),
    ),
  }))
  if (canonicalFindings.some(item => item.paths.length === 0))
    throw new Error('foundation repair finding has no canonical subject')

  const parents = canonicalFindings.map((_, index) => index)
  const root = (index: number): number => {
    let cursor = index
    while (parents[cursor] !== cursor) cursor = parents[cursor]!
    while (parents[index] !== index) {
      const next = parents[index]!
      parents[index] = cursor
      index = next
    }
    return cursor
  }
  const union = (left: number, right: number) => {
    const leftRoot = root(left)
    const rightRoot = root(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }
  for (let left = 0; left < canonicalFindings.length; left += 1) {
    for (let right = left + 1; right < canonicalFindings.length; right += 1) {
      if (
        canonicalFindings[left]!.paths.some(path =>
          canonicalFindings[right]!.paths.includes(path),
        )
      )
        union(left, right)
    }
  }

  const components = new Map<number, typeof canonicalFindings>()
  canonicalFindings.forEach((item, index) => {
    const component = components.get(root(index)) ?? []
    component.push(item)
    components.set(root(index), component)
  })
  const groups = [...components.values()]
    .map(component => ({
      findings: component.map(item => item.finding),
      affectedPaths: CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
        component.some(item => item.paths.includes(path)),
      ),
    }))
    .sort((left, right) => {
      const leftIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
        left.affectedPaths[0]!,
      )
      const rightIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
        right.affectedPaths[0]!,
      )
      return leftIndex - rightIndex
    })
    .map((group, index) => ({
      ...group,
      groupId: `repair-group-${index + 1}`,
      dependsOn: [] as string[],
    }))
  for (const group of groups) {
    group.dependsOn = groups
      .filter(candidate => candidate.groupId !== group.groupId)
      .filter(candidate =>
        group.affectedPaths.some(path =>
          INITIAL_FOUNDATION_UPSTREAM_PATHS[path].some(upstream =>
            candidate.affectedPaths.includes(upstream),
          ),
        ),
      )
      .map(candidate => candidate.groupId)
  }
  return groups
}

function exactStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== left.length || rightSet.size !== right.length)
    return false
  const a = [...leftSet].sort()
  const b = [...rightSet].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function repairPlanMatchesCanonicalGraph(
  groups: readonly DocumentRepairGroup[],
  derived: readonly DerivedRepairGroup[],
): boolean {
  if (!Array.isArray(groups) || groups.length > derived.length) return false
  return groups.every((group, index) => {
    const expected = derived[index]
    return Boolean(
      expected &&
        group.groupId === expected.groupId &&
        exactStringSet(
          group.findingIds,
          expected.findings.map(finding => finding.findingId),
        ) &&
        exactStringSet(group.affectedPaths, expected.affectedPaths) &&
        exactStringSet(group.dependsOn, expected.dependsOn),
    )
  })
}

export function assertRepairPlanMatchesGraph(
  groups: readonly DocumentRepairGroup[],
  derived: readonly DerivedRepairGroup[],
): void {
  if (!repairPlanMatchesCanonicalGraph(groups, derived))
    throw new Error('foundation repair plan does not match the canonical graph')
}

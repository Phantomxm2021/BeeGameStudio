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
  subjectPaths: FoundationDocumentPath[]
  candidatePaths: FoundationDocumentPath[]
  dependsOn: string[]
}

export function deriveFoundationRepairGroups(
  findings: DocumentReviewFinding[],
): DerivedRepairGroup[] {
  const canonicalFindings = findings.map(finding => {
    const paths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
      finding.subjects.some(subject => subject.path === path),
    )
    const evidencePaths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
      finding.evidence.some(reference => reference.path === path),
    )
    const highestFactOwner = CANONICAL_FOUNDATION_DOCUMENTS.find(
      candidate =>
        (paths.includes(candidate) || evidencePaths.includes(candidate)) &&
        paths.every(
          subjectPath =>
            subjectPath === candidate ||
            INITIAL_FOUNDATION_UPSTREAM_PATHS[subjectPath].includes(candidate),
        ),
    )
    return { finding, paths, evidencePaths, highestFactOwner }
  })
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
      const leftFinding = canonicalFindings[left]!
      const rightFinding = canonicalFindings[right]!
      if (
        leftFinding.paths.some(path => rightFinding.paths.includes(path)) ||
        (leftFinding.highestFactOwner !== undefined &&
          leftFinding.highestFactOwner === rightFinding.highestFactOwner) ||
        leftFinding.paths.some(path =>
          rightFinding.evidencePaths.includes(path),
        ) ||
        rightFinding.paths.some(path =>
          leftFinding.evidencePaths.includes(path),
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
      subjectPaths: CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
        component.some(item => item.paths.includes(path)),
      ),
    }))
    .sort((left, right) => {
      const leftIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
        left.subjectPaths[0]!,
      )
      const rightIndex = CANONICAL_FOUNDATION_DOCUMENTS.indexOf(
        right.subjectPaths[0]!,
      )
      return leftIndex - rightIndex
    })
    .map((group, index) => ({
      ...group,
      candidatePaths: CANONICAL_FOUNDATION_DOCUMENTS.filter(
        path =>
          group.subjectPaths.includes(path) ||
          INITIAL_FOUNDATION_UPSTREAM_PATHS[path].some(upstream =>
            group.subjectPaths.includes(upstream),
          ),
      ),
      groupId: `repair-group-${index + 1}`,
      dependsOn: [] as string[],
    }))
  for (const group of groups) {
    group.dependsOn = groups
      .filter(candidate => candidate.groupId !== group.groupId)
      .filter(candidate =>
        group.subjectPaths.some(path =>
          INITIAL_FOUNDATION_UPSTREAM_PATHS[path].some(upstream =>
            candidate.subjectPaths.includes(upstream),
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

export function repairGroupAffectedPaths(
  group: Pick<DocumentRepairGroup, 'pathDecisions'>,
): FoundationDocumentPath[] {
  return CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
    group.pathDecisions.some(pathDecision => pathDecision.path === path),
  )
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
        group.pathDecisions.length === repairGroupAffectedPaths(group).length &&
        expected.subjectPaths.every(path =>
          repairGroupAffectedPaths(group).includes(path),
        ) &&
        repairGroupAffectedPaths(group).every((path: FoundationDocumentPath) =>
          expected.candidatePaths.includes(path),
        ) &&
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

import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { resolveWorkspaceRelativePath } from './revision'

type ArtifactClass =
  | 'runtime-resource'
  | 'generated-output'

type Artifact = {
  path: string
  artifactClass: ArtifactClass
  format?: string
  budgets: Array<{ metric: string; limit: number; unit: string }>
}
type Variant = {
  id: string
  activation: { kind: string; groupId?: string }
  artifacts: Artifact[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nodesFrom(gameIr: unknown): Record<string, unknown>[] {
  const root = record(gameIr)
  const modules = Array.isArray(root?.modules) ? root.modules : []
  const resource = modules
    .map(record)
    .find(module => module?.moduleId === 'resource-realization')
  return Array.isArray(resource?.nodes)
    ? resource.nodes.map(record).filter(Boolean) as Record<string, unknown>[]
    : []
}

function edgeTarget(node: Record<string, unknown>, type: string): string | undefined {
  if (!Array.isArray(node.edges)) return undefined
  const edge = node.edges.map(record).find(candidate => candidate?.type === type)
  return typeof edge?.targetId === 'string' ? edge.targetId : undefined
}

function variantsFrom(gameIr: unknown, classes: ReadonlySet<string>): Variant[] {
  const nodes = nodesFrom(gameIr)
  const artifactsByVariant = new Map<string, Artifact[]>()
  for (const node of nodes) {
    if (node.kind !== 'resource-realization.delivery-artifact') continue
    const value = record(node.value)
    const artifactClass = value?.artifactClass
    if (!classes.has(String(artifactClass))) continue
    const variantId = edgeTarget(node, 'part-of')
    if (!variantId || typeof value?.path !== 'string') continue
    const artifacts = artifactsByVariant.get(variantId) ?? []
    artifacts.push({
      path: value.path,
      artifactClass: artifactClass as ArtifactClass,
      ...(typeof value.format === 'string' ? { format: value.format } : {}),
      budgets: Array.isArray(value.budgets)
        ? value.budgets.map(record).flatMap(budget =>
            typeof budget?.metric === 'string' &&
            typeof budget.limit === 'number' &&
            typeof budget.unit === 'string'
              ? [{ metric: budget.metric, limit: budget.limit, unit: budget.unit }]
              : [],
          )
        : [],
    })
    artifactsByVariant.set(variantId, artifacts)
  }
  return nodes.flatMap(node => {
    if (node.kind !== 'resource-realization.variant' || typeof node.id !== 'string')
      return []
    const activation = record(record(node.value)?.activation)
    if (!activation || typeof activation.kind !== 'string') return []
    return [{
      id: node.id,
      activation: {
        kind: activation.kind,
        ...(typeof activation.groupId === 'string'
          ? { groupId: activation.groupId }
          : {}),
      },
      artifacts: artifactsByVariant.get(node.id) ?? [],
    }]
  })
}

function artifactIssue(
  workspacePath: string,
  artifact: Artifact,
  registeredResourcePaths?: ReadonlySet<string>,
): string | undefined {
  if (
    registeredResourcePaths &&
    !registeredResourcePaths.has(artifact.path)
  )
    return 'unregistered'
  const absolute = resolveWorkspaceRelativePath(workspacePath, artifact.path)
  if (!absolute || !existsSync(absolute)) return 'missing'
  try {
    const stat = statSync(absolute)
    if (!stat.isFile() || stat.size === 0) return 'missing'
    if (
      artifact.format &&
      extname(artifact.path).slice(1).toLowerCase() !== artifact.format.toLowerCase()
    )
      return `format does not match .${extname(artifact.path).slice(1)}`
    const bytes = readFileSync(absolute)
    if (artifact.format && !hasFormatSignature(artifact.format, bytes))
      return `content is not valid ${artifact.format}`
    const limit = fileSizeLimit(artifact.budgets)
    if (limit !== undefined && stat.size > limit)
      return `size ${stat.size} bytes exceeds ${limit} bytes`
    return undefined
  } catch {
    return 'unreadable'
  }
}

function fileSizeLimit(
  budgets: Artifact['budgets'],
): number | undefined {
  const factors: Record<string, number> = {
    b: 1, byte: 1, bytes: 1,
    kb: 1_000, mb: 1_000_000,
    kib: 1_024, mib: 1_048_576,
  }
  const limits = budgets.flatMap(budget => {
    const metric = budget.metric.trim().toLowerCase().replaceAll('_', '-')
    const factor = factors[budget.unit.trim().toLowerCase()]
    return ['bytes', 'file-size', 'size'].includes(metric) && factor
      ? [budget.limit * factor]
      : []
  })
  return limits.length ? Math.min(...limits) : undefined
}

function hasFormatSignature(format: string, bytes: Buffer): boolean {
  const normalized = format.toLowerCase()
  if (normalized === 'png')
    return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  if (normalized === 'jpg' || normalized === 'jpeg')
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (normalized === 'gif')
    return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))
  if (normalized === 'webp')
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (normalized === 'wav')
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WAVE'
  if (normalized === 'ogg' || normalized === 'opus')
    return bytes.subarray(0, 4).toString('ascii') === 'OggS'
  if (normalized === 'glb')
    return bytes.subarray(0, 4).toString('ascii') === 'glTF'
  if (normalized === 'json') {
    try { JSON.parse(bytes.toString('utf8')); return true } catch { return false }
  }
  if (normalized === 'svg')
    return /<svg(?:\s|>)/iu.test(bytes.toString('utf8').slice(0, 4096))
  return true
}

/** Deterministically checks only the concrete delivery paths already chosen by IR. */
export function resourceIrDeliveryIssues(input: {
  gameIr: unknown
  workspacePath: string
  artifactClasses: readonly ArtifactClass[]
  registeredResourcePaths?: ReadonlySet<string>
}): string[] {
  const variants = variantsFrom(
    input.gameIr,
    new Set(input.artifactClasses),
  )
  const issues: string[] = []
  const complete = (variant: Variant) =>
    variant.artifacts.every(artifact =>
      !artifactIssue(
        input.workspacePath,
        artifact,
        input.registeredResourcePaths,
      ),
    )

  for (const variant of variants) {
    if (!variant.artifacts.length || variant.activation.kind === 'alternative')
      continue
    for (const artifact of variant.artifacts) {
      const issue = artifactIssue(
        input.workspacePath,
        artifact,
        input.registeredResourcePaths,
      )
      if (issue)
        issues.push(
          `IR delivery artifact is invalid: ${artifact.path} (${issue}).`,
        )
    }
  }

  const alternativeGroups = new Map<string, Variant[]>()
  for (const variant of variants) {
    if (variant.activation.kind !== 'alternative')
      continue
    const groupId = variant.activation.groupId
    if (!groupId) {
      issues.push(`IR alternative variant ${variant.id} has no groupId.`)
      continue
    }
    const group = alternativeGroups.get(groupId) ?? []
    group.push(variant)
    alternativeGroups.set(groupId, group)
  }
  for (const [groupId, group] of alternativeGroups)
    if (group.every(variant => variant.artifacts.length > 0) && !group.some(complete))
      issues.push(`No complete IR delivery variant exists for alternative group ${groupId}.`)
  return issues
}

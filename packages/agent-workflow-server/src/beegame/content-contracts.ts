import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { parseDocument } from 'yaml'
import type { BeeGameAssetManifest } from './asset-contracts'

export const BEEGAME_CONTENT_SCHEMA = 'beegame-content-v1' as const

export const BEEGAME_JSON_CONTENT_KINDS = [
  'resource-registry',
  'entity-definitions',
  'ui-configuration',
  'audio-configuration',
  'event-definitions',
  'wave-definitions',
  'numeric-configuration',
] as const

export const BEEGAME_YAML_CONTENT_KINDS = [
  'world-definition',
  'scene-definitions',
  'hierarchy-definition',
  'placement-definitions',
] as const

const JSON_CONTENT_KINDS = new Set<string>(BEEGAME_JSON_CONTENT_KINDS)
const YAML_CONTENT_KINDS = new Set<string>(BEEGAME_YAML_CONTENT_KINDS)

export type BeeGameContentHeader = {
  path: string
  id: string
  kind: string
  fulfills: string[]
  resources: string[]
}

export type BeeGameContentAudit = {
  valid: boolean
  files: BeeGameContentHeader[]
  validPaths: string[]
  invalidPaths: string[]
  hasGlobalIssues: boolean
  coveredRequirementIds: string[]
  referencedResourceIds: string[]
  issues: string[]
}

export function auditBeeGameContent(
  workspacePath: string,
  manifest: BeeGameAssetManifest,
): BeeGameContentAudit {
  const issues: string[] = []
  const target = manifest.project_target
  if (!target)
    return {
      valid: false,
      files: [],
      validPaths: [],
      invalidPaths: [],
      hasGlobalIssues: true,
      coveredRequirementIds: [],
      referencedResourceIds: [],
      issues: ['project_target is required before content preparation.'],
    }
  const workspace = resolve(workspacePath)
  const contentRoot = projectPath(workspace, target.content_root)
  if (
    !contentRoot ||
    !existsSync(contentRoot) ||
    !statSync(contentRoot).isDirectory()
  )
    return {
      valid: false,
      files: [],
      validPaths: [],
      invalidPaths: [],
      hasGlobalIssues: true,
      coveredRequirementIds: [],
      referencedResourceIds: [],
      issues: [`Content root does not exist: ${target.content_root}.`],
    }

  const requirementIds = new Set(manifest.requirements.map(item => item.id))
  const requiredRequirementIds = new Set(
    manifest.requirements
      .filter(item => item.required !== false)
      .map(item => item.id),
  )
  const resourceIds = new Set(manifest.resources.map(item => item.id))
  const verifiedResourceIds = new Set(
    manifest.resources
      .filter(item => item.status === 'verified')
      .map(item => item.id),
  )
  const files: BeeGameContentHeader[] = []
  const validPaths: string[] = []
  const invalidPaths: string[] = []
  const ids = new Set<string>()
  for (const absolute of listContentFiles(contentRoot)) {
    const issueStart = issues.length
    const path = relative(workspace, absolute).split(sep).join('/')
    const extension = extname(absolute).toLowerCase()
    let value: unknown
    try {
      const text = readFileSync(absolute, 'utf8')
      if (extname(absolute).toLowerCase() === '.json') value = JSON.parse(text)
      else {
        const document = parseDocument(text, { uniqueKeys: true })
        if (document.errors.length)
          throw new Error(document.errors.map(error => error.message).join(' '))
        value = document.toJS({ maxAliasCount: 0 })
      }
    } catch (error) {
      issues.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    if (!isRecord(value)) {
      issues.push(`${path}: content root must be an object.`)
      continue
    }
    const unknown = Object.keys(value).filter(
      key =>
        !['schema', 'id', 'kind', 'fulfills', 'resources', 'data'].includes(
          key,
        ),
    )
    if (unknown.length)
      issues.push(`${path}: unknown fields: ${unknown.join(', ')}.`)
    const schema = text(value.schema)
    const id = text(value.id)
    const kind = text(value.kind)
    const fulfills = stringList(value.fulfills)
    const resources = stringList(value.resources)
    if (schema !== BEEGAME_CONTENT_SCHEMA)
      issues.push(`${path}: schema must be ${BEEGAME_CONTENT_SCHEMA}.`)
    if (!id) issues.push(`${path}: id must be a trimmed non-empty string.`)
    else if (ids.has(id)) issues.push(`${path}: duplicate content id: ${id}.`)
    else ids.add(id)
    if (!kind) issues.push(`${path}: kind must be a trimmed non-empty string.`)
    else if (extension === '.json' && !JSON_CONTENT_KINDS.has(kind))
      issues.push(
        `${path}: JSON kind must be one of ${BEEGAME_JSON_CONTENT_KINDS.join(', ')}.`,
      )
    else if (extension !== '.json' && !YAML_CONTENT_KINDS.has(kind))
      issues.push(
        `${path}: YAML kind must be one of ${BEEGAME_YAML_CONTENT_KINDS.join(', ')}.`,
      )
    if (
      !Array.isArray(value.fulfills) ||
      fulfills.length !== value.fulfills.length
    )
      issues.push(
        `${path}: fulfills must be an array of unique non-empty strings.`,
      )
    if (
      !Array.isArray(value.resources) ||
      resources.length !== value.resources.length
    )
      issues.push(
        `${path}: resources must be an array of unique non-empty strings.`,
      )
    if (!('data' in value)) issues.push(`${path}: data is required.`)
    for (const requirementId of fulfills)
      if (!requirementIds.has(requirementId))
        issues.push(`${path}: unknown requirement: ${requirementId}.`)
    for (const resourceId of resources) {
      if (!resourceIds.has(resourceId))
        issues.push(`${path}: unknown resource: ${resourceId}.`)
      else if (!verifiedResourceIds.has(resourceId))
        issues.push(`${path}: resource is not verified: ${resourceId}.`)
    }
    if (id && kind) files.push({ path, id, kind, fulfills, resources })
    if (issues.length === issueStart) validPaths.push(path)
    else invalidPaths.push(path)
  }
  let hasGlobalIssues = false
  if (!files.length) {
    issues.push('Content root has no JSON or YAML content files.')
    hasGlobalIssues = true
  }

  const covered = new Set(files.flatMap(file => file.fulfills))
  const referenced = new Set(files.flatMap(file => file.resources))
  for (const id of requiredRequirementIds)
    if (!covered.has(id)) {
      issues.push(`Required requirement is not covered: ${id}.`)
      hasGlobalIssues = true
    }
  for (const resource of manifest.resources)
    if (!referenced.has(resource.id)) {
      issues.push(`Resource is not referenced by content: ${resource.id}.`)
      hasGlobalIssues = true
    }

  return {
    valid: issues.length === 0,
    files,
    validPaths,
    invalidPaths,
    hasGlobalIssues,
    coveredRequirementIds: [...covered],
    referencedResourceIds: [...referenced],
    issues,
  }
}

function listContentFiles(root: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) result.push(...listContentFiles(path))
    else if (
      entry.isFile() &&
      ['.json', '.yaml', '.yml'].includes(extname(entry.name).toLowerCase())
    )
      result.push(path)
  }
  return result.sort()
}

function projectPath(workspace: string, path: string): string | undefined {
  if (!path || isAbsolute(path)) return undefined
  const absolute = resolve(workspace, path)
  const fromWorkspace = relative(workspace, absolute)
  if (
    fromWorkspace === '..' ||
    fromWorkspace.startsWith(`..${sep}`) ||
    isAbsolute(fromWorkspace)
  )
    return undefined
  return absolute
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const values = value.flatMap(item => {
    const normalized = text(item)
    return normalized ? [normalized] : []
  })
  return [...new Set(values)]
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  BeeGameAssetManifestError,
  readBeeGameAssetManifestModulePathsSync,
  readBeeGameAssetManifestSync,
  type BeeGameAssetManifest,
} from './asset-contracts'
import {
  auditBeeGameContent,
  type BeeGameContentAudit,
} from './content-contracts'

export type AssetRequirementAudit = {
  id: string
  required: boolean
  issues: string[]
}

export type AssetResourceAudit = {
  id: string
  status: string
  sourceType: string
  rootPath: string
  filePaths: string[]
  provisional: boolean
  issues: string[]
}

export type AssetContractAudit = {
  present: boolean
  valid: boolean
  manifestPath: string
  requirements: AssetRequirementAudit[]
  resources: AssetResourceAudit[]
  content: BeeGameContentAudit
  issues: string[]
}

export function auditAssetContract(workspacePath: string): AssetContractAudit {
  const workspace = resolve(workspacePath)
  const manifestPath = resolve(workspace, 'assets', 'asset-manifest.json')
  const emptyContent: BeeGameContentAudit = {
    valid: false,
    files: [],
    validPaths: [],
    invalidPaths: [],
    hasGlobalIssues: false,
    coveredRequirementIds: [],
    referencedResourceIds: [],
    issues: [],
  }
  const empty: Omit<AssetContractAudit, 'present' | 'valid'> = {
    manifestPath,
    requirements: [],
    resources: [],
    content: emptyContent,
    issues: [],
  }
  if (!existsSync(manifestPath))
    return { present: false, valid: true, ...empty }

  let manifest: BeeGameAssetManifest
  try {
    manifest = readBeeGameAssetManifestSync(workspace)
  } catch (error) {
    const issues =
      error instanceof BeeGameAssetManifestError
        ? error.issues
        : [error instanceof Error ? error.message : String(error)]
    return { present: true, valid: false, ...empty, issues }
  }

  const registeredModulePaths = new Set(
    readBeeGameAssetManifestModulePathsSync(workspace),
  )
  for (const moduleKind of ['requirements', 'resources'] as const) {
    const moduleRoot = resolve(workspace, 'assets', 'manifest', moduleKind)
    if (!existsSync(moduleRoot)) continue
    for (const entry of readdirSync(moduleRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const path = `assets/manifest/${moduleKind}/${entry.name}`
      if (!registeredModulePaths.has(path))
        empty.issues.push(`Unregistered manifest module: ${path}`)
    }
  }

  const resources = manifest.resources.map(resource => {
    const issues: string[] = []
    for (const filePath of resource.file_paths) {
      const absolute = projectFile(workspace, filePath)
      if (!absolute) {
        issues.push(`File escapes the project: ${filePath}`)
        continue
      }
      if (!existsSync(absolute)) {
        issues.push(`File does not exist: ${filePath}`)
        continue
      }
      try {
        const stats = statSync(absolute)
        if (!stats.isFile()) issues.push(`Path is not a file: ${filePath}`)
        else if (!stats.size) issues.push(`File is empty: ${filePath}`)
        const expected = resource.local_file_hashes?.[filePath]
        if (expected && stats.isFile()) {
          const actual = createHash('sha256')
            .update(readFileSync(absolute))
            .digest('hex')
          if (actual !== expected)
            issues.push(`File hash does not match manifest: ${filePath}`)
        }
      } catch {
        issues.push(`File cannot be inspected: ${filePath}`)
      }
    }
    if (resource.status === 'failed' && !resource.error?.trim())
      issues.push('A failed resource must record an error.')
    if (resource.status === 'verified' && issues.length)
      issues.push('A verified resource must have intact local files.')
    return {
      id: resource.id,
      status: resource.status,
      sourceType: resource.source.type,
      rootPath: resource.root_path,
      filePaths: resource.file_paths,
      provisional: resource.provisional,
      issues,
    }
  })
  const content = auditBeeGameContent(workspace, manifest)
  const requirements = manifest.requirements.map(requirement => ({
    id: requirement.id,
    required: requirement.required !== false,
    issues: [] as string[],
  }))
  const issues = [
    ...empty.issues,
    ...resources.flatMap(resource =>
      resource.issues.map(issue => `${resource.id}: ${issue}`),
    ),
    ...content.issues,
  ]
  return {
    present: true,
    valid: issues.length === 0,
    manifestPath,
    requirements,
    resources,
    content,
    issues,
  }
}

function projectFile(workspace: string, filePath: string): string | undefined {
  if (!filePath || isAbsolute(filePath)) return undefined
  const absolute = resolve(workspace, filePath)
  const fromWorkspace = relative(workspace, absolute)
  if (
    fromWorkspace === '..' ||
    fromWorkspace.startsWith(`..${sep}`) ||
    isAbsolute(fromWorkspace)
  )
    return undefined
  return absolute
}

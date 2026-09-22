import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseSpriteSheet, validateSpriteSheetBounds } from '../../../scene-editor/src/sprite-sheet'
import { readTileSetResource } from './tilemap-contract'
import {
  BeeGameAssetManifestError,
  readBeeGameAssetManifestModulePathsSync,
  readBeeGameAssetManifestSync,
  type BeeGameAssetManifest,
} from './asset-contracts'

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
  bindings: Array<{ requirementId: string; resourceIds: string[] }>
  issues: string[]
}

export function auditAssetContract(workspacePath: string): AssetContractAudit {
  const workspace = resolve(workspacePath)
  const manifestPath = resolve(workspace, 'assets', 'asset-manifest.json')
  const empty: Omit<AssetContractAudit, 'present' | 'valid'> = {
    manifestPath,
    requirements: [],
    resources: [],
    bindings: [],
    issues: [],
  }
  if (existsSync(resolve(workspace, 'assets', 'content')))
    empty.issues.push(
      'Retired resource content root exists: assets/content. Move game content to the later content/ package stage.',
    )
  if (!existsSync(manifestPath))
    return { present: false, valid: empty.issues.length === 0, ...empty }

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
    if (resource.technical_facts?.artifactClass === 'content-definition')
      issues.push(
        'Game Content Package definitions must not be declared as resources; remove the content-definition from the Manifest.',
      )
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
        else if (filePath.toLowerCase().endsWith('.json')) {
          try {
            const value = JSON.parse(readFileSync(absolute, 'utf8'))
            if (value?.schema === 'beegame-tileset.v1') readTileSetResource(workspace, manifest, resource.id, filePath)
            const image = resource.file_paths.find(path => path === filePath.replace(/\.json$/i, '.png'))
            const imagePath = image && projectFile(workspace, image)
            if (imagePath && existsSync(imagePath)) {
              const sheet = parseSpriteSheet(value)
              if (sheet) {
                const bytes = readFileSync(imagePath)
                if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
                  throw new Error('Invalid PNG atlas')
                validateSpriteSheetBounds(sheet, bytes.readUInt32BE(16), bytes.readUInt32BE(20))
              }
            }
          } catch (error) { issues.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`) }
        }
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
  const requirements = manifest.requirements.map(requirement => ({
    id: requirement.id,
    required: requirement.required !== false,
    issues: [] as string[],
  }))
  const requirementAuditById = new Map(
    requirements.map(requirement => [requirement.id, requirement]),
  )
  const manifestRequirementById = new Map(
    manifest.requirements.map(requirement => [requirement.id, requirement]),
  )
  const resourceById = new Map(
    manifest.resources.map(resource => [resource.id, resource]),
  )
  const bindings = manifest.requirements.flatMap(requirement => {
    const resourceIds = manifest.resources
      .filter(resource => resource.fulfills.includes(requirement.id))
      .map(resource => resource.id)
    return resourceIds.length ? [{ requirementId: requirement.id, resourceIds }] : []
  })
  for (const requirement of manifest.requirements)
    if (
      requirement.required !== false &&
      !bindings.some(binding => binding.requirementId === requirement.id)
    )
      requirementAuditById
        .get(requirement.id)
        ?.issues.push('Required requirement has no resource binding.')
  for (const binding of bindings) {
    const allowed = manifestRequirementById.get(binding.requirementId)
      ?.acquisition_profile.sourcing_policy?.allowed_source_kinds
    if (!allowed) continue
    for (const resourceId of binding.resourceIds) {
      const sourceType = resourceById.get(resourceId)?.source.type
      if (sourceType && !allowed.includes(sourceType))
        requirementAuditById.get(binding.requirementId)?.issues.push(
          `Bound resource ${resourceId} uses disallowed source kind ${sourceType}.`,
        )
    }
  }
  const issues = [
    ...empty.issues,
    ...requirements.flatMap(requirement =>
      requirement.issues.map(issue => `${requirement.id}: ${issue}`),
    ),
    ...resources.flatMap(resource =>
      resource.issues.map(issue => `${resource.id}: ${issue}`),
    ),
  ]
  return {
    present: true,
    valid: issues.length === 0,
    manifestPath,
    requirements,
    resources,
    bindings,
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
  if (existsSync(absolute)) {
    const physical = relative(realpathSync(workspace), realpathSync(absolute))
    if (physical === '..' || physical.startsWith(`..${sep}`) || isAbsolute(physical)) return undefined
  }
  return absolute
}

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { inflateSync } from 'node:zlib'
import { candidateCoversObligation, type ResourceCoverageObligation } from '@bee-game-studio/beegame-resource-core'
import { inspectResourceBytes } from '../../../beegame-resource-server/src/resource-inspection'
import { parseSpriteSheet, validateSpriteSheetBounds } from '../../../scene-editor/src/sprite-sheet'
import { readTileSetResource } from './tilemap-contract'
import {
  BeeGameAssetManifestError,
  readBeeGameAssetManifestModulePathsSync,
  readBeeGameAssetManifestSync,
  type BeeGameAssetManifest,
  type BeeGameProjectResource,
} from './asset-contracts'

export type AssetRequirementAudit = {
  id: string
  required: boolean
  issues: string[]
  structure?: { status: 'passed' | 'failed' | 'unverified'; observations: string[] }
}

export type AssetResourceAudit = {
  id: string
  status: string
  sourceType: string
  rootPath: string
  filePaths: string[]
  provisional: boolean
  issues: string[]
  fileEvidence: Array<{ path: string; sha256: string; facts: Record<string, string | number | boolean> }>
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

/** PNG headers and dimensions can be valid while the image stream is broken. */
function assertPngPixelStream(bytes: Buffer): void {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error('Invalid PNG signature')
  const compressed: Buffer[] = []
  let offset = 8
  let ended = false
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset)
    if (size > bytes.length - offset - 12) throw new Error('Truncated PNG chunk')
    const kind = bytes.toString('ascii', offset + 4, offset + 8)
    if (kind === 'IDAT') compressed.push(bytes.subarray(offset + 8, offset + 8 + size))
    offset += size + 12
    if (kind === 'IEND') { ended = true; break }
  }
  if (!ended || !compressed.length) throw new Error('Missing PNG image data or end marker')
  try { inflateSync(Buffer.concat(compressed), { maxOutputLength: 256 * 1024 * 1024 }) }
  catch { throw new Error('PNG pixel stream cannot be decoded') }
}

export function auditAssetContract(workspacePath: string, resourceIds?: readonly string[]): AssetContractAudit {
  const workspace = resolve(workspacePath)
  const manifestPath = resolve(workspace, 'assets', 'asset-manifest.json')
  const empty: Omit<AssetContractAudit, 'present' | 'valid'> = {
    manifestPath,
    requirements: [],
    resources: [],
    bindings: [],
    issues: [],
  }
  if (resourceIds && !resourceIds.length) empty.issues.push('An explicit resource audit scope must not be empty.')
  if (!resourceIds && existsSync(resolve(workspace, 'assets', 'content')))
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
  for (const moduleKind of resourceIds ? [] : ['requirements', 'resources'] as const) {
    const moduleRoot = resolve(workspace, 'assets', 'manifest', moduleKind)
    if (!existsSync(moduleRoot)) continue
    for (const entry of readdirSync(moduleRoot, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const path = `assets/manifest/${moduleKind}/${entry.name}`
      if (!registeredModulePaths.has(path))
        empty.issues.push(`Unregistered manifest module: ${path}`)
    }
  }

  const selectedResources = resourceIds ? manifest.resources.filter(resource => resourceIds.includes(resource.id)) : manifest.resources
  for (const id of resourceIds ?? []) if (!selectedResources.some(resource => resource.id === id)) empty.issues.push(`Unknown resource: ${id}`)
  const resources = selectedResources.map(resource => {
    const issues: string[] = []
    const fileEvidence: AssetResourceAudit['fileEvidence'] = []
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
        else if (filePath.toLowerCase().endsWith('.png')) {
          try { assertPngPixelStream(readFileSync(absolute)) }
          catch (error) { issues.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`) }
        }
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
        if (stats.isFile() && stats.size) {
          const bytes = readFileSync(absolute)
          fileEvidence.push({ path: filePath, sha256: createHash('sha256').update(bytes).digest('hex'),
            facts: inspectResourceBytes(filePath, bytes) })
        }
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
      fileEvidence,
    }
  })
  const selectedRequirements = resourceIds ? manifest.requirements.filter(requirement => selectedResources.some(resource => resource.fulfills.includes(requirement.id))) : manifest.requirements
  const requirements: AssetRequirementAudit[] = selectedRequirements.map(requirement => ({
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
  const bindings = selectedRequirements.flatMap(requirement => {
    const resourceIds = selectedResources
      .filter(resource => resource.fulfills.includes(requirement.id))
      .map(resource => resource.id)
    return resourceIds.length ? [{ requirementId: requirement.id, resourceIds }] : []
  })
  for (const requirement of selectedRequirements)
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
  for (const requirement of selectedRequirements) {
    const row = requirementAuditById.get(requirement.id)!
    const bound = selectedResources.filter(resource => resource.fulfills.includes(requirement.id))
    const profile = requirement.acquisition_profile
    const obligations: ResourceCoverageObligation[] = profile.coverage?.length
      ? profile.coverage.map(part => ({ assetKinds: part.asset_kinds, usageTags: part.usage_tags,
          capabilities: part.capabilities, relationKinds: part.relation_kinds, embeddedKinds: part.embedded_kinds }))
      : [{ assetKinds: profile.asset_kinds, capabilities: profile.capabilities as ResourceCoverageObligation['capabilities'] }]
    const observations: string[] = []
    let unknown = !bound.length
    for (const [index, obligation] of obligations.entries()) {
      const candidates = bound.filter(resource => !obligation.assetKinds?.length || !resource.asset_kind ||
        obligation.assetKinds.some(kind => kind === resource.asset_kind))
      const declarations = candidates.map(resource => candidateCoversObligation({
        assetKind: resource.asset_kind, usageTags: resource.usage_tags ?? [], capabilities: resource.capabilities ?? [],
        relations: (resource.relation_kinds ?? []).map(kind => ({kind})),
        contentProfile: { components: [
          ...(resource.embedded_kinds ?? []).map(kind => ({kind})),
          ...(Array.isArray(resource.content_profile?.components)
            ? resource.content_profile.components.filter((item): item is {kind:string} => !!item && typeof item.kind === 'string') : []),
        ] },
      }, obligation))
      // Declared coverage and file evidence are separate. Missing labels alone
      // are not proof a format lacks the requested structure.
      const evidence = candidates.map((resource, index) => {
        const item = inspectObligation(resource, resources.find(row => row.id === resource.id)!, obligation)
        return !declarations[index] && item.status === 'passed'
          ? { status: 'unverified', reason: resource.id+': declared coverage incomplete' } : item
      })
      const status = evidence.some(item => item.status === 'passed') ? 'passed' :
        (evidence.length && evidence.every(item => item.status === 'failed')) || (bound.length && !candidates.length) ? 'failed' : 'unverified'
      observations.push('Part '+(index+1)+': '+status+(evidence.length ? '; '+evidence.map(item => item.reason).join('; ') : '; no declared binding covers this obligation'))
      if (status === 'failed') row.issues.push('Required structure has incompatible declared kinds or contradicts local file evidence for part '+(index+1)+'.')
      if (status === 'unverified') unknown = true
    }
    row.structure = { status: row.issues.length ? 'failed' : unknown ? 'unverified' : 'passed', observations }
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

function inspectObligation(resource: BeeGameProjectResource, audit: AssetResourceAudit, obligation: ResourceCoverageObligation) {
  if (audit.issues.length) return { status: 'failed', reason: resource.id+': invalid local files' } as const
  if (resource.provisional || resource.status !== 'verified' || !audit.fileEvidence.length)
    return { status: 'unverified', reason: resource.id+': provisional or unavailable file evidence' } as const
  const root = audit.fileEvidence.find(file => file.path === resource.root_path)
  const facts = root?.facts ?? {}
  const kind = resource.asset_kind ?? ''
  if (obligation.assetKinds?.length && !obligation.assetKinds.some(value => value === kind))
    return { status: 'unverified', reason: resource.id+': no compatible declared resource kind' } as const
  const png = !!facts.width && !!facts.height && root?.path.toLowerCase().endsWith('.png')
  const gltf = typeof facts.meshCount === 'number'
  let unknown = Boolean(facts.externalReferences), contradiction = false
  if (obligation.assetKinds?.length) {
    if (png) {
      if (!['image','texture','sprite','sprite-sheet','sprite-atlas'].includes(kind)) contradiction = true
    } else if (gltf) {
      const count = ({mesh:'meshCount',model:'meshCount',rig:'skinCount','animation-clip':'animationCount',
        'animation-library':'animationCount',material:'materialCount'} as Record<string,string>)[kind]
      if (count) contradiction ||= Number(facts[count]) === 0
      else unknown = true
    } else if (!(kind === 'data' && root?.path.endsWith('.json'))) unknown = true
  }
  const counts: Record<string,string> = {rigged:'skinCount',skinned:'skinCount','contains-animations':'animationCount',
    'contains-materials':'materialCount','contains-textures':'embeddedTextureCount','morph-targets':'morphTargetCount',
    mesh:'meshCount',skeleton:'skinCount','animation-clip':'animationCount',material:'materialCount',texture:'embeddedTextureCount'}
  for (const need of [...(obligation.capabilities ?? []), ...(obligation.embeddedKinds ?? [])]) {
    const count = counts[need]
    if (count && gltf) {
      if (!Number(facts[count])) {
        // External textures can exist without being embedded.
        if (need === 'contains-textures' && facts.externalReferences) unknown = true
        else contradiction = true
      }
    } else unknown = true
  }
  if (obligation.relationKinds?.length) unknown = true
  // An atlas's named rectangles establish addressing, never a timed sequence.
  // Unsupported facts stay unknown, including animation timing/rig compatibility.
  return { status: contradiction ? 'failed' : unknown ? 'unverified' : 'passed',
    reason: resource.id+': '+(contradiction ? 'required components absent from inspected root' :
      unknown ? 'required facts are not established by supported file inspection' : 'structural file/header facts only; runtime use/quality unverified') } as const
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

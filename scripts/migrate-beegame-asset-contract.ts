import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

type JsonRecord = Record<string, unknown>

export type AssetContractMigrationPlan = {
  workspace: string
  manifestPath: string
  runtimeAssetRoot: string
  manifest: JsonRecord
  moves: Array<{ from: string; to: string }>
  removedLegacyFields: string[]
}

/**
 * Offline-only migration for projects created before the canonical
 * requirements/imports/compositions contract. It is deliberately not imported
 * by the workflow server: normal requests must reject legacy state instead of
 * silently keeping a second runtime contract alive.
 */
export function planAssetContractMigration(input: {
  workspace: string
  runtimeAssetRoot: string
}): AssetContractMigrationPlan {
  const workspace = resolve(input.workspace)
  const manifestPath = resolveInside(workspace, 'assets/asset-manifest.json')
  const runtimeAssetRoot = normalizedRelativePath(input.runtimeAssetRoot)
  if (!runtimeAssetRoot) throw new Error('runtime asset root must be a concrete project-relative directory')
  const source = parseRecord(readFileSync(manifestPath, 'utf8'), 'asset manifest')
  const requirementsSource = Array.isArray(source.requirements)
    ? source.requirements
    : Array.isArray(source.slots)
      ? source.slots
      : undefined
  if (!requirementsSource) throw new Error('legacy manifest has no migratable requirements or slots array')

  const removedLegacyFields: string[] = []
  const requirements = requirementsSource.map((value, index) => {
    const record = asRecord(value)
    if (!record) throw new Error(`requirement ${index + 1} must be an object`)
    const id = text(record.id) || text(record.slot_id)
    if (!id) throw new Error(`requirement ${index + 1} has no stable id`)
    const resourceRequirement = asRecord(record.resource_requirement) ?? {}
    const acceptedFormats = strings(resourceRequirement.accepted_formats).length
      ? strings(resourceRequirement.accepted_formats)
      : strings(record.accepted_formats)
    const satisfiedBy = asRecord(record.satisfied_by)
    const canonical = {
      id,
      ...(text(record.name) ? { name: text(record.name) } : {}),
      ...(text(record.purpose) || text(record.description)
        ? { purpose: text(record.purpose) || text(record.description) }
        : {}),
      required: record.required !== false,
      status: record.status === 'blocked' ? 'blocked' : 'planned',
      ...(Object.keys(resourceRequirement).length || acceptedFormats.length
        ? { resource_requirement: { ...resourceRequirement, ...(acceptedFormats.length ? { accepted_formats: acceptedFormats } : {}) } }
        : {}),
      ...(satisfiedBy ? { satisfied_by: {
        import_ids: strings(satisfiedBy.import_ids),
        composition_ids: strings(satisfiedBy.composition_ids),
        project_references: [],
      } } : {}),
    }
    for (const field of Object.keys(record)) {
      if (!['id', 'name', 'purpose', 'required', 'status', 'resource_requirement', 'satisfied_by'].includes(field)) {
        removedLegacyFields.push(`requirements[${index}].${field}`)
      }
    }
    return canonical
  })

  const moves: AssetContractMigrationPlan['moves'] = []
  const imports = (Array.isArray(source.imports) ? source.imports : []).map((value, index) => {
    const record = asRecord(value)
    if (!record) throw new Error(`import ${index + 1} must be an object`)
    const id = text(record.id)
    const rootPath = normalizedRelativePath(text(record.root_path))
    if (!id || !rootPath) throw new Error(`import ${index + 1} has incomplete canonical identity`)
    const localFiles = strings(record.local_files).map(normalizedRelativePath)
    if (!localFiles.length || !localFiles.includes(rootPath)) throw new Error(`import ${id} has an incomplete local_files inventory`)
    const underRuntimeRoot = isWithinRelativeRoot(rootPath, runtimeAssetRoot)
    if (underRuntimeRoot) return { ...record, status: 'available', usage_evidence: undefined }
    const destinationRoot = join(runtimeAssetRoot, 'migrated', safeSegment(id))
    const sourceDirectory = dirname(rootPath)
    const relocated = localFiles.map(path => {
      const relativeFile = relative(sourceDirectory, path)
      if (!relativeFile || relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
        throw new Error(`import ${id} contains files outside its logical root directory`)
      }
      const destination = join(destinationRoot, relativeFile)
      moves.push({ from: path, to: destination })
      return destination
    })
    const relocatedRoot = relocated[localFiles.indexOf(rootPath)]!
    const dependencies = Array.isArray(record.dependencies)
      ? record.dependencies.map(dependency => {
        const item = asRecord(dependency)
        if (!item) return dependency
        const localPath = normalizedRelativePath(text(item.local_path))
        const position = localFiles.indexOf(localPath)
        return position >= 0 ? { ...item, local_path: relocated[position] } : item
      })
      : undefined
    return {
      ...record,
      status: 'available',
      root_path: relocatedRoot,
      local_files: relocated,
      ...(dependencies ? { dependencies } : {}),
      usage_evidence: undefined,
    }
  })

  const compositions = (Array.isArray(source.compositions) ? source.compositions : []).map(value => {
    const record = asRecord(value)
    return record ? { ...record, status: 'planned', integration_evidence: undefined } : value
  })
  const projectTarget = asRecord(source.project_target) ?? {}
  const manifest: JsonRecord = {
    version: 5,
    project_target: {
      ...(text(projectTarget.platform) ? { platform: text(projectTarget.platform) } : {}),
      ...(text(projectTarget.runtime) ? { runtime: text(projectTarget.runtime) } : {}),
      ...(text(projectTarget.integration_mode) ? { integration_mode: text(projectTarget.integration_mode) } : {}),
      ...(text(projectTarget.mcp_server) ? { mcp_server: text(projectTarget.mcp_server) } : {}),
      asset_format_capabilities: strings(projectTarget.asset_format_capabilities),
      ...(text(projectTarget.resource_library_usage) ? { resource_library_usage: text(projectTarget.resource_library_usage) } : {}),
      runtime_asset_root: runtimeAssetRoot,
    },
    requirements,
    imports,
    compositions,
  }
  if (source.slots !== undefined) removedLegacyFields.push('slots')
  for (const field of ['confirmedResourceLibraryUsage', 'asset_contract']) {
    if (source[field] !== undefined) removedLegacyFields.push(field)
  }
  return { workspace, manifestPath, runtimeAssetRoot, manifest, moves, removedLegacyFields }
}

export async function applyAssetContractMigration(plan: AssetContractMigrationPlan): Promise<string> {
  for (const move of plan.moves) {
    const from = resolveInside(plan.workspace, move.from)
    const to = resolveInside(plan.workspace, move.to)
    if (!existsSync(from)) throw new Error(`migration source does not exist: ${move.from}`)
    if (existsSync(to)) throw new Error(`migration destination already exists: ${move.to}`)
  }
  const backup = `${plan.manifestPath}.legacy-backup-${Date.now()}.json`
  await copyFile(plan.manifestPath, backup)
  const completedMoves: Array<{ from: string; to: string }> = []
  try {
    for (const move of plan.moves) {
      const from = resolveInside(plan.workspace, move.from)
      const to = resolveInside(plan.workspace, move.to)
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      completedMoves.push({ from, to })
    }
    await writeFile(plan.manifestPath, `${JSON.stringify(plan.manifest, null, 2)}\n`, 'utf8')
  } catch (error) {
    for (const move of completedMoves.reverse()) {
      await mkdir(dirname(move.from), { recursive: true })
      await rename(move.to, move.from)
    }
    await copyFile(backup, plan.manifestPath)
    throw error
  }
  return backup
}

function parseRecord(value: string, label: string): JsonRecord {
  const parsed = JSON.parse(value) as unknown
  const record = asRecord(parsed)
  if (!record) throw new Error(`${label} must be a JSON object`)
  return record
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

function normalizedRelativePath(value: string): string {
  let normalized = value.split('\\').join('/').replaceAll('//', '/')
  if (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (!normalized || isAbsolute(normalized) || normalized.split('/').includes('..')) return ''
  return normalized
}

function isWithinRelativeRoot(path: string, root: string): boolean {
  const fromRoot = relative(root, path)
  return Boolean(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)
}

function safeSegment(value: string): string {
  const result = [...value].map(character => {
    const code = character.codePointAt(0) ?? -1
    const isDigit = code >= 48 && code <= 57
    const isUppercase = code >= 65 && code <= 90
    const isLowercase = code >= 97 && code <= 122
    return isDigit || isUppercase || isLowercase || character === '_' || character === '.' || character === '-'
      ? character
      : '_'
  }).join('')
  return result || 'import'
}

function resolveInside(root: string, value: string): string {
  const result = resolve(root, value)
  const fromRoot = relative(root, result)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error('migration path must stay inside the workspace')
  }
  return result
}

if (import.meta.main) {
  const workspaceIndex = process.argv.indexOf('--workspace')
  const rootIndex = process.argv.indexOf('--runtime-asset-root')
  const workspace = workspaceIndex >= 0 ? process.argv[workspaceIndex + 1] : ''
  const runtimeAssetRoot = rootIndex >= 0 ? process.argv[rootIndex + 1] : ''
  if (!workspace || !runtimeAssetRoot) {
    throw new Error('Usage: bun run scripts/migrate-beegame-asset-contract.ts --workspace <absolute-path> --runtime-asset-root <relative-path> [--write]')
  }
  const plan = planAssetContractMigration({ workspace, runtimeAssetRoot })
  if (process.argv.includes('--write')) {
    const backup = await applyAssetContractMigration(plan)
    console.log(JSON.stringify({ migrated: true, backup, moves: plan.moves, removedLegacyFields: plan.removedLegacyFields }, null, 2))
  } else {
    console.log(JSON.stringify({ migrated: false, dryRun: true, moves: plan.moves, removedLegacyFields: plan.removedLegacyFields, manifest: plan.manifest }, null, 2))
  }
}

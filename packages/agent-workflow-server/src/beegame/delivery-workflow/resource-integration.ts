import { existsSync } from 'node:fs'
import {
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../asset-contracts'
import { auditAssetContract } from '../asset-contract-audit'
import { resolveWorkspaceRelativePath } from './revision'
import type { AtomicTask } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type ImplementationTerminal = Extract<
  WorkerTerminalResult,
  { workerType: 'implementation-worker' }
>

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function assertExistingPaths(workspacePath: string, paths: string[]): void {
  for (const path of paths) {
    const resolved = resolveWorkspaceRelativePath(workspacePath, path)
    if (!resolved || !existsSync(resolved))
      throw new Error(`resource integration evidence does not exist: ${path}`)
  }
}

function appendUnique(left: string[] | undefined, right: string[]): string[] {
  return [...new Set([...(left ?? []), ...right])]
}

function validateBindings(
  workspacePath: string,
  task: AtomicTask,
  terminal: ImplementationTerminal,
  manifest: BeeGameAssetManifest,
): void {
  const expectedImports = task.resourceImportIds ?? []
  const expectedCompositions = task.resourceCompositionIds ?? []
  const expectedRequirements = manifest.requirements
    .map(requirement => requirement.id)
    .filter(id => task.sourceRequirementIds.includes(id))

  if (
    !sameIds(
      terminal.resourceReferences.map(reference => reference.importId),
      expectedImports,
    )
  )
    throw new Error(
      'implementation resource references do not match the active task import IDs',
    )
  if (
    !sameIds(
      terminal.compositionIntegrations.map(value => value.compositionId),
      expectedCompositions,
    )
  )
    throw new Error(
      'implementation composition integrations do not match the active task composition IDs',
    )
  if (
    !sameIds(
      terminal.requirementSatisfactions.map(value => value.requirementId),
      expectedRequirements,
    )
  )
    throw new Error(
      'implementation requirement satisfactions do not match the active task manifest requirements',
    )

  const manifestImportIds = new Set(
    (manifest.imports ?? []).map(value => value.id),
  )
  const manifestCompositionIds = new Set(
    (manifest.compositions ?? []).map(value => value.id),
  )
  for (const reference of terminal.resourceReferences) {
    if (!manifestImportIds.has(reference.importId))
      throw new Error(
        `implementation references an unknown import: ${reference.importId}`,
      )
    assertExistingPaths(workspacePath, reference.references)
  }
  for (const integration of terminal.compositionIntegrations) {
    if (!manifestCompositionIds.has(integration.compositionId))
      throw new Error(
        `implementation references an unknown composition: ${integration.compositionId}`,
      )
    assertExistingPaths(workspacePath, [
      integration.recipePath,
      ...integration.references,
    ])
  }
  for (const satisfaction of terminal.requirementSatisfactions) {
    if (satisfaction.importIds.some(id => !expectedImports.includes(id)))
      throw new Error(
        `requirement ${satisfaction.requirementId} references an import outside the active task`,
      )
    if (
      satisfaction.compositionIds.some(id => !expectedCompositions.includes(id))
    )
      throw new Error(
        `requirement ${satisfaction.requirementId} references a composition outside the active task`,
      )
    assertExistingPaths(workspacePath, satisfaction.projectReferences)
  }
}

/**
 * The workflow service is the sole manifest integration writer. Workers report
 * target-native facts; this boundary validates them against the active task,
 * updates all related records together, and rolls back on audit failure.
 */
export async function applyImplementationResourceBindings(input: {
  workspacePath: string
  task: AtomicTask
  terminal: ImplementationTerminal
}): Promise<void> {
  const original = await readBeeGameAssetManifest(input.workspacePath)
  validateBindings(input.workspacePath, input.task, input.terminal, original)
  const updated: BeeGameAssetManifest = structuredClone(original)

  const referencesById = new Map(
    input.terminal.resourceReferences.map(value => [value.importId, value]),
  )
  updated.imports = (updated.imports ?? []).map(resourceImport => {
    const evidence = referencesById.get(resourceImport.id)
    if (!evidence) return resourceImport
    return {
      ...resourceImport,
      status: 'referenced',
      usage_evidence: {
        references: appendUnique(
          resourceImport.usage_evidence?.references,
          evidence.references,
        ),
        runtime_event_ids: appendUnique(
          resourceImport.usage_evidence?.runtime_event_ids,
          evidence.runtimeEventIds,
        ),
      },
    }
  })

  const integrationsById = new Map(
    input.terminal.compositionIntegrations.map(value => [
      value.compositionId,
      value,
    ]),
  )
  updated.compositions = (updated.compositions ?? []).map(composition => {
    const evidence = integrationsById.get(composition.id)
    if (!evidence) return composition
    return {
      ...composition,
      status: 'assembled',
      recipe: { ...(composition.recipe ?? {}), path: evidence.recipePath },
      integration_evidence: {
        references: appendUnique(
          composition.integration_evidence?.references,
          evidence.references,
        ),
        runtime_event_ids: appendUnique(
          composition.integration_evidence?.runtime_event_ids,
          evidence.runtimeEventIds,
        ),
      },
    }
  })

  const satisfactionsById = new Map(
    input.terminal.requirementSatisfactions.map(value => [
      value.requirementId,
      value,
    ]),
  )
  updated.requirements = updated.requirements.map(requirement => {
    const evidence = satisfactionsById.get(requirement.id)
    if (!evidence) return requirement
    return {
      ...requirement,
      status: 'planned',
      satisfied_by: {
        import_ids: appendUnique(
          requirement.satisfied_by?.import_ids,
          evidence.importIds,
        ),
        composition_ids: appendUnique(
          requirement.satisfied_by?.composition_ids,
          evidence.compositionIds,
        ),
        project_references: appendUnique(
          requirement.satisfied_by?.project_references,
          evidence.projectReferences,
        ),
      },
    }
  })

  const referencedImportIds = new Set(
    (updated.imports ?? [])
      .filter(resourceImport => resourceImport.status === 'referenced')
      .map(resourceImport => resourceImport.id),
  )
  const integratedCompositionIds = new Set(
    (updated.compositions ?? [])
      .filter(composition => composition.status === 'integrated')
      .map(composition => composition.id),
  )
  let promoted = true
  while (promoted) {
    promoted = false
    updated.compositions = (updated.compositions ?? []).map(composition => {
      if (
        composition.status !== 'assembled' ||
        !composition.recipe?.path ||
        (!composition.integration_evidence?.references?.length &&
          !composition.integration_evidence?.runtime_event_ids?.length)
      )
        return composition
      const ready = composition.members
        .filter(member => member.required !== false)
        .every(member =>
          member.import_id
            ? referencedImportIds.has(member.import_id)
            : member.composition_id
              ? integratedCompositionIds.has(member.composition_id)
              : true,
        )
      if (!ready) return composition
      promoted = true
      integratedCompositionIds.add(composition.id)
      return { ...composition, status: 'integrated' as const }
    })
  }
  updated.requirements = updated.requirements.map(requirement => {
    const bindings = requirement.satisfied_by
    const hasBinding = Boolean(
      bindings?.import_ids?.length ||
        bindings?.composition_ids?.length ||
        bindings?.project_references?.length,
    )
    const ready =
      hasBinding &&
      (bindings?.import_ids ?? []).every(id => referencedImportIds.has(id)) &&
      (bindings?.composition_ids ?? []).every(id =>
        integratedCompositionIds.has(id),
      )
    return ready
      ? { ...requirement, status: 'satisfied' as const }
      : requirement
  })

  await writeBeeGameAssetManifest(input.workspacePath, updated)
  const audit = auditAssetContract(input.workspacePath)
  if (audit.valid) return
  await writeBeeGameAssetManifest(input.workspacePath, original)
  throw new Error(
    `resource integration update failed canonical audit: ${audit.issues.join('; ')}`,
  )
}

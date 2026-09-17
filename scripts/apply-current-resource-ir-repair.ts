#!/usr/bin/env bun
/**
 * One-time repair for the diagnosed Moonlight Post resource/IR mismatch.
 * It uses the public immutable IR lifecycle; it never changes runtime bytes.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createGameIrLifecycle } from '../packages/agent-workflow-server/src/beegame/stage-modules/game-ir/private/lifecycle'
import { foundationPublicDigest } from '../packages/agent-workflow-server/src/beegame/foundation-public-result'
import { createDeliveryWorkflowController } from '../packages/agent-workflow-server/src/beegame/delivery-workflow/controller'
import { createRunStore } from '../packages/agent-workflow-server/src/beegame/delivery-workflow/run-store'
import { validateResourceDelivery } from '../packages/agent-workflow-server/src/beegame/resource-validation-cli'
import { readDownstreamIr } from '../packages/agent-workflow-server/src/beegame/delivery-workflow/downstream-ir'
import { resourceIrManifestIssues } from '../packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage'
import type { DeliveryRun } from '../packages/agent-workflow-server/src/beegame/delivery-workflow/types'

const workspacePath = resolve(process.argv[2] ?? '')
if (!workspacePath || workspacePath === resolve('.'))
  throw new Error('Pass the exact project workspace path.')
const storePath = join(workspacePath, '.beegame/workflow/run.json')
const initial = JSON.parse(await readFile(storePath, 'utf8')) as DeliveryRun
const link = initial.gameIrStage
if (initial.phase !== 'RESOURCE_PREPARATION' || initial.status === 'running' ||
    !link?.handle || link.outcome?.status !== 'completed')
  throw new Error('Repair requires an idle failed Resource Preparation run with published IR.')

const ir = createGameIrLifecycle(workspacePath, {
  runtimeConfiguration: { protocolVersion: 1, ownerId: initial.ownerId,
    async resolve() { throw new Error('IR correction must not run a CLI agent.') } },
  billing: { protocolVersion: 1, ownerId: initial.ownerId,
    async submitUsage() { throw new Error('IR correction must not submit usage.') } },
})
const original = await ir.readResult({ handle: link.handle, foundationRevision: link.foundationRevision })
const { taskId: _taskId, sourceRevision: _sourceRevision, ...candidateBody } = original.candidate
const draft = structuredClone({ ...candidateBody, schemaVersion: 'game-ir-direct-draft.v2' })
const sound = draft.assets.find(asset => asset.id === 'sfx_sprite_main')
if (!sound) throw new Error('sfx_sprite_main is absent from the published IR.')
const correctionRequired = !(
  Array.isArray(sound.capabilities) && sound.capabilities.length === 1 &&
  sound.capabilities[0] === 'audio-variants' &&
  Array.isArray(sound.coverage) && sound.coverage.length === 0
)
Object.assign(sound, { capabilities: ['audio-variants'], coverage: [] })

const controller = createDeliveryWorkflowController({
  workspacePath,
  ownerId: initial.ownerId,
  ir,
  workerPort: { async start() { throw new Error('Repair must not dispatch a worker.') },
    async submit() {}, async stop() {}, async status() { return { status: 'closed' as const } } },
})
try {
  if (correctionRequired) {
    await controller.reviseGameIr({
      expectedResultDigest: foundationPublicDigest(original.ready),
      draft,
    })
  }
} finally { await controller.dispose() }

const manifestPath = join(workspacePath, 'assets/asset-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
for (const relativePath of manifest.modules.resources) {
  const path = join(workspacePath, relativePath)
  const resource = JSON.parse(await readFile(path, 'utf8'))
  if (typeof resource.selection_reason === 'string') resource.selection_reason = [resource.selection_reason]
  if (resource.id === 'sfx_sprite_main') resource.capabilities = ['audio-variants']
  await writeFile(path, `${JSON.stringify(resource, null, 2)}\n`)
}
for (const relativePath of [manifest.modules.requirements].flat()) {
  const path = join(workspacePath, relativePath)
  const module = JSON.parse(await readFile(path, 'utf8'))
  for (const requirement of Array.isArray(module) ? module : module.requirements ?? []) {
    if (requirement.id !== 'sfx_sprite_main') continue
    requirement.acquisition_profile.capabilities = ['audio-variants']
    delete requirement.acquisition_profile.coverage
  }
  await writeFile(path, `${JSON.stringify(module, null, 2)}\n`)
}

const run = await createRunStore(workspacePath, initial.ownerId).load()
if (!run) throw new Error('Workflow vanished during repair.')
const expectedIr = await readDownstreamIr({ run, workspacePath, ir })
// A correction intentionally clears the old dispatch. Prove the pending next
// dispatch against the new IR without inventing a durable dispatch record.
const irIssues = resourceIrManifestIssues({ ...run, activeDispatch: {
  request: { contract: { gameIr: expectedIr } },
} } as DeliveryRun, workspacePath)
const result = validateResourceDelivery(workspacePath)
const nonDispatchIssues = result.issues.filter(issue =>
  issue !== 'The resource dispatch has no valid Game IR asset requirements.')
if (nonDispatchIssues.length || irIssues.length)
  throw new Error(`Repair published but validation failed: ${[...nonDispatchIssues, ...irIssues].join(' | ')}`)
console.log(JSON.stringify({ repair: { valid: true, requirementCount: result.requirementCount,
  resourceCount: result.resourceCount, elapsedMs: result.elapsedMs,
  publicationId: run?.gameIrStage?.outcome?.status === 'completed'
    ? run.gameIrStage.outcome.result.publicationId : undefined,
  status: run.status, phase: run.phase, dispatchPending: !run.activeDispatch } }, null, 2))

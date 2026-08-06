import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import {
  readBeeGameAssetManifest,
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../asset-contracts'
import {
  completeResourceTask,
  reconcileCurrentResourcePreparation,
  startResourcePreparation,
} from './resource-stage'
import {
  computeResourceContentDigest,
  computeResourceInventoryRevision,
} from './revision'
import { resolveResourceProductionTask } from './resource-task-resolver'
import type { DeliveryRun, DocumentReviewFindingSubject } from './types'

const roots: string[] = []
const TEST_ACQUISITION_PROFILE = { dimensions: ['agnostic'] as const, asset_kinds: ['data'] as const, usage_tags: [], capabilities: [], styles: [] }

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

describe('resource production task resolver', () => {
  test('derives the four tasks only from canonical artifacts and receipts', async () => {
    const workspace = await createWorkspace()
    let run = createRun()
    await expect(
      resolveResourceProductionTask({ run, workspacePath: workspace }),
    ).resolves.toMatchObject({ task: 'RESOURCE_PLAN' })

    await writePlan(workspace)
    await expect(
      resolveResourceProductionTask({ run, workspacePath: workspace }),
    ).resolves.toMatchObject({ task: 'RESOURCE_INVENTORY' })

    await writeInventory(workspace)
    const revision = await computeResourceInventoryRevision(workspace)
    run = {
      ...run,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT',
        inventoryReceipt: {
          revision,
          catalogObserved: true,
          bindings: [
            { requirementId: 'world.visual', resourceIds: ['world-resource'] },
          ],
          acceptedAt: new Date().toISOString(),
        },
      },
    }
    await expect(
      resolveResourceProductionTask({ run, workspacePath: workspace }),
    ).resolves.toMatchObject({ task: 'RESOURCE_CONTENT' })

    await writeContent(workspace)
    await expect(
      resolveResourceProductionTask({ run, workspacePath: workspace }),
    ).resolves.toMatchObject({ task: 'RESOURCE_GATE' })

    await writeFile(join(workspace, 'assets/runtime/world.dat'), 'changed')
    await expect(
      resolveResourceProductionTask({ run, workspacePath: workspace }),
    ).resolves.toMatchObject({
      task: 'RESOURCE_INVENTORY',
      inventoryReceiptValid: false,
    })
  })

  test('routes accepted resource findings by structured subject and current cursor', async () => {
    const workspace = await createWorkspace()
    await writePlan(workspace)
    await writeInventory(workspace)
    await writeContent(workspace)
    const base = await runWithReceipt(workspace)

    const contentRun = withResourceFinding(base, {
      path: 'assets/content/world.json',
      anchor: '$.data',
      contentId: 'world-content',
    })
    await expect(
      resolveResourceProductionTask({
        run: contentRun,
        workspacePath: workspace,
      }),
    ).resolves.toMatchObject({ task: 'RESOURCE_CONTENT' })

    const inventoryRun = withResourceFinding(base, {
      path: 'assets/asset-manifest.json',
      anchor: '$.resources[0]',
      resourceId: 'world-resource',
    })
    await expect(
      resolveResourceProductionTask({
        run: inventoryRun,
        workspacePath: workspace,
      }),
    ).resolves.toMatchObject({ task: 'RESOURCE_INVENTORY' })

    await expect(
      resolveResourceProductionTask({
        run: {
          ...inventoryRun,
          resourceProductionState: {
            ...inventoryRun.resourceProductionState,
            currentTask: 'RESOURCE_GATE',
          },
        },
        workspacePath: workspace,
      }),
    ).resolves.toMatchObject({ task: 'RESOURCE_GATE' })
  })

  test('turns a deterministic Gate failure into one retryable inventory task', async () => {
    const workspace = await createWorkspace()
    await writePlan(workspace)
    await writeInventory(workspace)
    await writeContent(workspace)
    const manifest = await readBeeGameAssetManifest(workspace)
    await writeBeeGameAssetManifest(workspace, {
      ...manifest,
      project_target: {
        ...manifest.project_target!,
        resource_library_usage: 'preferred',
      },
    })
    const run = await runWithReceipt(workspace)
    run.resourceProductionState.inventoryReceipt!.catalogObserved = false
    const result = await reconcileCurrentResourcePreparation({
      run: {
        ...run,
        phase: 'RESOURCE_PREPARATION',
        resourceProductionState: {
          ...run.resourceProductionState,
          currentTask: 'RESOURCE_GATE',
          contentReceipt: {
            contentDigest: await computeResourceContentDigest(workspace),
            acceptedAt: '2026-08-05T00:00:00.000Z',
          },
        },
      },
      workspacePath: workspace,
    })
    expect(result).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'needs_action',
      resourceProductionState: { currentTask: 'RESOURCE_INVENTORY' },
    })
    expect(result?.resourceProductionState.inventoryReceipt).toBeUndefined()
  })

  test('rejects a content request that reopens already verified inventory', async () => {
    const workspace = await createWorkspace()
    await writePlan(workspace)
    await writeInventory(workspace)
    const receiptRun = await runWithReceipt(workspace)
    const run: DeliveryRun = {
      ...receiptRun,
      phase: 'RESOURCE_PREPARATION',
      resourceProductionState: {
        ...receiptRun.resourceProductionState,
        currentTask: 'RESOURCE_CONTENT',
      },
    }
    await expect(
      completeResourceTask({
        run,
        workspacePath: workspace,
        terminal: {
          revision: run.revision.document,
          workerType: 'resource-content-author',
          status: 'needs_inventory',
          contentIds: [],
          writtenPaths: [],
          missingRequirementIds: ['world.visual'],
          taskMetrics: {
            catalogPayloadBytes: 0,
            catalogCallTypes: [],
            canonicalMutationCount: 0,
          },
        },
      }),
    ).rejects.toThrow(
      'resource content inventory request does not identify a real inventory gap',
    )
  })

  test('unlocks the content set when a global consistency issue needs repair', async () => {
    const workspace = await createWorkspace()
    await writePlan(workspace)
    await writeInventory(workspace)
    await mkdir(join(workspace, 'assets/content'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/content/world.json'),
      `${JSON.stringify({
        schema: 'beegame-content-v1',
        id: 'world-content',
        kind: 'resource-registry',
        fulfills: ['world.visual'],
        resources: [],
        data: {},
      })}\n`,
    )
    const receiptRun = await runWithReceipt(workspace)
    let request: unknown
    await startResourcePreparation({
      run: {
        ...receiptRun,
        phase: 'RESOURCE_PREPARATION',
        resourceProductionState: {
          ...receiptRun.resourceProductionState,
          currentTask: 'RESOURCE_CONTENT',
        },
      },
      workspacePath: workspace,
      dispatcher: {
        async dispatch(value) {
          request = value
          return value
        },
      },
    })
    expect(request).toMatchObject({
      workerType: 'resource-content-author',
      contract: {
        schema: 'beegame-content-v1',
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: ['world-resource'],
        inventoryBindings: [
          {
            requirementId: 'world.visual',
            resourceIds: ['world-resource'],
          },
        ],
        preservedPaths: [],
      },
    })
    expect(request).not.toHaveProperty('contract.manifestPath')
    expect(request).not.toHaveProperty('protectedPaths')
  })
})

function createRun(): DeliveryRun {
  return createTestDeliveryRun({
    runId: 'run-resource-resolver',
    projectId: 'project-resource-resolver',
    ownerId: 'owner-resource-resolver',
  })
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-resolver-'))
  roots.push(workspace)
  return workspace
}

async function writePlan(workspace: string): Promise<void> {
  await writeBeeGameAssetManifest(workspace, {
    version: 8,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional',
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [{ id: 'world.visual', required: true, acquisition_profile: TEST_ACQUISITION_PROFILE }],
    resources: [],
  })
}

async function writeInventory(workspace: string): Promise<void> {
  await mkdir(join(workspace, 'assets/runtime'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/world.dat'), 'resource')
  await registerBeeGameAuthoredResources(workspace, [
    {
      id: 'world-resource',
      root_path: 'assets/runtime/world.dat',
      file_paths: ['assets/runtime/world.dat'],
      provisional: true,
      reason: 'Independent test resource.',
      selection_reason: ['Exercises canonical inventory resolution.'],
      asset_kind: 'data',
    },
  ])
}

async function writeContent(workspace: string): Promise<void> {
  await mkdir(join(workspace, 'assets/content'), { recursive: true })
  await writeFile(
    join(workspace, 'assets/content/world.json'),
    `${JSON.stringify({
      schema: 'beegame-content-v1',
      id: 'world-content',
      kind: 'resource-registry',
      fulfills: ['world.visual'],
      resources: ['world-resource'],
      data: {
        bindings: [
          {
            requirementId: 'world.visual',
            resourceIds: ['world-resource'],
          },
        ],
      },
    })}\n`,
  )
}

async function runWithReceipt(workspace: string): Promise<DeliveryRun> {
  const run = createRun()
  return {
    ...run,
    resourceProductionState: {
      currentTask: 'RESOURCE_PLAN',
      inventoryReceipt: {
        revision: await computeResourceInventoryRevision(workspace),
        catalogObserved: true,
        bindings: [
          { requirementId: 'world.visual', resourceIds: ['world-resource'] },
        ],
        acceptedAt: new Date().toISOString(),
      },
    },
  }
}

function withResourceFinding(
  run: DeliveryRun,
  subject: DocumentReviewFindingSubject,
): DeliveryRun {
  return {
    ...run,
    documentReviewState: {
      ...run.documentReviewState,
      activeCycle: {
        cycleId: 'resource-cycle',
        originScope: 'complete',
        scope: 'complete',
        mode: 'initial',
        sourceRevision: 'source-resource-revision',
        requiredCheckIds: ['resource_content_consistency'],
        completedCheckIds: ['resource_content_consistency'],
        checks: [],
        checkEvidenceDigests: {},
        findings: [
          {
            findingId: 'resource-finding',
            checkId: 'resource_content_consistency',
            severity: 'blocking',
            owner: 'resource',
            evidence: [{ path: subject.path, anchor: subject.anchor }],
            subjects: [subject],
            observation: 'Canonical resource output requires repair.',
            blockingImpact: 'Delivery cannot proceed.',
            requiredOutcome: 'Repair the canonical subject.',
          },
        ],
        activeTarget: 'resource',
        acceptedSemanticResult: true,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
  }
}

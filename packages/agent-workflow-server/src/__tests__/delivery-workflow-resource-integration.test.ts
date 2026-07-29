import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../beegame/asset-contracts'
import { auditAssetContract } from '../beegame/asset-contract-audit'
import { applyImplementationResourceBindings } from '../beegame/delivery-workflow/resource-integration'
import { resourcePreparationAllowedPaths } from '../beegame/delivery-workflow/resource-stage'
import { startResourcePreparation } from '../beegame/delivery-workflow/resource-stage'
import { computeResourceRevision } from '../beegame/delivery-workflow/revision'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { parseWorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'
import type { AtomicTask, WorkerDispatchRequest } from '../beegame/delivery-workflow/types'
import { readWorkflowWorkerSessionIdsFromLogIndex } from '../beegame/session-manager'

describe('delivery workflow resource integration', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('uses the manifest runtime root as resource-preparation scope', async () => {
    workspace = await createWorkspace()

    expect(resourcePreparationAllowedPaths(workspace)).toEqual([
      'assets/asset-manifest.json',
      'public/runtime-assets/',
      '.beegame/workflow/evidence/',
    ])
  })

  test('recovers workflow worker provenance session IDs from the durable run log', async () => {
    workspace = await createWorkspace()
    const logDirectory = join(workspace, '.beegame/workflow/logs/run-1')
    await mkdir(logDirectory, { recursive: true })
    await writeFile(
      join(logDirectory, 'index.json'),
      JSON.stringify({
        version: 1,
        project: 'project',
        updatedAt: new Date().toISOString(),
        sessions: {
          'worker-session-1': { sessionId: 'worker-session-1' },
          'worker-session-2': { sessionId: 'worker-session-2' },
        },
      }),
    )

    expect(
      readWorkflowWorkerSessionIdsFromLogIndex(workspace, 'run-1'),
    ).toEqual(['worker-session-1', 'worker-session-2'])
  })

  test('retry repairs premature claims while preserving existing resource inventory', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    if (manifest.project_target)
      manifest.project_target.resource_library_usage = undefined
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      status: 'satisfied',
    }
    manifest.compositions![0] = {
      ...manifest.compositions![0]!,
      status: 'assembled',
      recipe: undefined,
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const requests: unknown[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
      confirmedBriefContext: JSON.stringify({
        resource_library_usage: 'preferred',
      }),
    })

    await startResourcePreparation({
      run: {
        ...base,
        phase: 'RESOURCE_PREPARATION',
        resourceRemediation: {
          sourceRevision: base.revision.document,
          attempt: 1,
          issues: ['canonical resource contract failed'],
          preserveImportIds: ['import-1'],
          preserveCompositionIds: ['composition-1'],
        },
      },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    const repaired = await readBeeGameAssetManifest(workspace)
    expect(repaired.project_target?.resource_library_usage).toBe('preferred')
    expect(repaired.requirements[0]?.status).toBe('planned')
    expect(repaired.imports?.map(value => value.id)).toEqual(['import-1'])
    expect(repaired.compositions?.[0]).toMatchObject({
      id: 'composition-1',
      status: 'planned',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      contract: {
        resourceAttemptMode: 'repair',
        remediation: {
          preserveImportIds: ['import-1'],
          preserveCompositionIds: ['composition-1'],
        },
      },
    })
  })

  test('restarts resource preparation fresh when no canonical manifest was persisted', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-resource-fresh-restart-'),
    )
    const requests: WorkerDispatchRequest[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })

    await startResourcePreparation({
      run: {
        ...base,
        phase: 'RESOURCE_PREPARATION',
        resourceRemediation: {
          sourceRevision: base.revision.document,
          attempt: 1,
          issues: ['previous attempt did not persist the canonical contract'],
          preserveImportIds: [],
          preserveCompositionIds: [],
        },
      },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'fresh',
      freshRestart: {
        attempt: 1,
        manifestState: 'missing',
        issues: ['previous attempt did not persist the canonical contract'],
      },
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'create and validate the canonical assets/asset-manifest.json foundation before the first import_elements call',
    )
  })

  test('rebuilds an invalid manifest instead of entering deterministic repair', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-resource-invalid-restart-'),
    )
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/asset-manifest.json'),
      JSON.stringify({ version: 5, project_target: {}, requirements: [] }),
    )
    const requests: WorkerDispatchRequest[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })

    await startResourcePreparation({
      run: {
        ...base,
        phase: 'RESOURCE_PREPARATION',
        resourceRemediation: {
          sourceRevision: base.revision.document,
          attempt: 1,
          issues: ['canonical contract requires recovery'],
          preserveImportIds: [],
          preserveCompositionIds: [],
        },
      },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    expect(requests).toHaveLength(1)
    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'fresh',
      freshRestart: { attempt: 1, manifestState: 'invalid' },
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
  })

  test('server reconciles implementation facts without invalidating approved resource identity', async () => {
    workspace = await createWorkspace()
    const revisionBefore = await computeResourceRevision(
      workspace,
      'document-revision',
    )
    const task: AtomicTask = {
      id: 'task-1',
      title: 'Integrate approved resource',
      sourceRequirementIds: ['requirement-1'],
      checklistIds: ['check-1'],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/integration.ts'],
      resourceImportIds: ['import-1'],
      resourceCompositionIds: ['composition-1'],
      verification: [
        {
          kind: 'test',
          commandOrAction: 'run project verification',
          expectedResult: 'resource is integrated',
        },
      ],
      status: 'running',
      attempt: 1,
      evidenceRefs: [],
    }
    const terminal = parseWorkerTerminalResult({
      workerType: 'implementation-worker',
      taskId: task.id,
      status: 'completed',
      revision: 'workspace-revision',
      changedPaths: ['src/integration.ts'],
      evidenceRefs: ['.beegame/workflow/evidence/task-1.md'],
      evidencePath: '.beegame/workflow/evidence/task-1.md',
      resourceReferences: [
        {
          importId: 'import-1',
          references: ['src/integration.ts'],
          runtimeEventIds: [],
        },
      ],
      compositionIntegrations: [
        {
          compositionId: 'composition-1',
          recipePath: 'src/integration.ts',
          references: ['src/integration.ts'],
          runtimeEventIds: [],
        },
      ],
      requirementSatisfactions: [
        {
          requirementId: 'requirement-1',
          importIds: ['import-1'],
          compositionIds: ['composition-1'],
          projectReferences: ['src/integration.ts'],
        },
      ],
    })
    if (terminal.workerType !== 'implementation-worker')
      throw new Error('unexpected terminal')

    await applyImplementationResourceBindings({
      workspacePath: workspace,
      task,
      terminal,
    })

    const manifest = await readBeeGameAssetManifest(workspace)
    expect(manifest.imports?.[0]).toMatchObject({
      id: 'import-1',
      status: 'referenced',
      usage_evidence: { references: ['src/integration.ts'] },
    })
    expect(manifest.compositions?.[0]).toMatchObject({
      id: 'composition-1',
      status: 'integrated',
      recipe: { path: 'src/integration.ts' },
    })
    expect(manifest.requirements[0]).toMatchObject({
      id: 'requirement-1',
      status: 'satisfied',
      satisfied_by: {
        import_ids: ['import-1'],
        composition_ids: ['composition-1'],
        project_references: ['src/integration.ts'],
      },
    })
    expect(auditAssetContract(workspace).valid).toBe(true)
    expect(await computeResourceRevision(workspace, 'document-revision')).toBe(
      revisionBefore,
    )

    await writeFile(
      join(workspace, 'public/runtime-assets/root.glb'),
      'changed',
    )
    expect(
      await computeResourceRevision(workspace, 'document-revision'),
    ).not.toBe(revisionBefore)
  })
})

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    join(tmpdir(), 'beegame-resource-integration-'),
  )
  await mkdir(join(workspace, 'assets'), { recursive: true })
  await mkdir(join(workspace, 'public/runtime-assets'), { recursive: true })
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(join(workspace, '.beegame/workflow/evidence'), {
    recursive: true,
  })
  await writeFile(join(workspace, 'public/runtime-assets/root.glb'), 'resource')
  await writeFile(
    join(workspace, 'src/integration.ts'),
    'export const integrated = true',
  )
  await writeFile(
    join(workspace, '.beegame/workflow/evidence/task-1.md'),
    'evidence',
  )
  const manifest: BeeGameAssetManifest = {
    version: 5,
    project_target: {
      asset_format_capabilities: ['glb'],
      resource_library_usage: 'preferred',
      runtime_asset_root: 'public/runtime-assets',
    },
    requirements: [
      {
        id: 'requirement-1',
        required: true,
        status: 'planned',
        resource_requirement: {
          accepted_formats: ['glb'],
          purpose: 'runtime responsibility',
        },
      },
    ],
    imports: [
      {
        id: 'import-1',
        source: {
          type: 'resource-library',
          pack_id: 'pack-1',
          pack_version: '1.0.0',
          element_id: 'element-1',
          element_path: 'root.glb',
        },
        status: 'available',
        root_path: 'public/runtime-assets/root.glb',
        local_files: ['public/runtime-assets/root.glb'],
        selected_at: new Date().toISOString(),
        selection_reason: ['approved responsibility'],
      },
    ],
    compositions: [
      {
        id: 'composition-1',
        kind: 'scene',
        assembly_mode: 'direct',
        status: 'planned',
        members: [{ import_id: 'import-1', role: 'runtime role' }],
      },
    ],
  }
  await writeBeeGameAssetManifest(workspace, manifest)
  return workspace
}

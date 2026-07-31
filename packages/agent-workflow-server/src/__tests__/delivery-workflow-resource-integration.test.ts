import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
  type BeeGameAssetManifest,
} from '../beegame/asset-contracts'
import { auditAssetContract } from '../beegame/asset-contract-audit'
import { applyImplementationResourceBindings } from '../beegame/delivery-workflow/resource-integration'
import {
  auditResourceInventoryPolicy,
  auditResourcesForPreparation,
  completeResourcePreparation,
  reconcileCurrentResourcePreparation,
  resourcePreparationAllowedPaths,
  startResourcePreparation,
} from '../beegame/delivery-workflow/resource-stage'
import { computeResourceRevision } from '../beegame/delivery-workflow/revision'
import { createInitialDeliveryRun } from '../beegame/delivery-workflow/run-store'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { parseWorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'
import type {
  AtomicTask,
  WorkerDispatchRequest,
} from '../beegame/delivery-workflow/types'
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
    ])
  })

  test('hands a valid fresh manifest to a new selection dispatch with a service-owned plan', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-plan-handoff-'))
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await mkdir(join(workspace, '.beegame/workflow/evidence'), {
      recursive: true,
    })
    await writeBeeGameAssetManifest(workspace, {
      version: 5,
      project_target: {
        asset_format_capabilities: ['png'],
        resource_library_usage: 'preferred',
        runtime_asset_root: 'public/assets',
      },
      requirements: [
        {
          id: 'enemy-visual',
          required: true,
          status: 'planned',
          resource_requirement: {
            accepted_formats: ['png'],
            asset_kinds: ['sprite'],
            import_budget: 1,
            no_match: 'authored-asset',
          },
        },
      ],
      imports: [],
      compositions: [],
    })
    const evidencePath =
      '.beegame/workflow/evidence/resource-preparation-fresh.json'
    await writeFile(join(workspace, evidencePath), 'evidence')
    const base = createInitialDeliveryRun({
      runId: 'run-plan-handoff',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const planned = await completeResourcePreparation({
      run: { ...base, phase: 'RESOURCE_PREPARATION' },
      workspacePath: workspace,
      terminal: {
        workerType: 'resource-preparer',
        attemptMode: 'fresh',
        revision: base.revision.document,
        status: 'completed',
        writtenPaths: ['assets/asset-manifest.json', evidencePath],
        importIds: [],
        compositionIds: [],
        evidencePath,
      },
      audit: auditResourcesForPreparation({ workspacePath: workspace }),
    })

    expect(planned).toMatchObject({
      phase: 'RESOURCE_PREPARATION',
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
    })
    const requests: WorkerDispatchRequest[] = []
    await startResourcePreparation({
      run: planned,
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })
    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'selection',
      selectionPlan: [
        {
          responsibilities: [{ requirementId: 'enemy-visual' }],
        },
      ],
    })
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

  test('retry continues unresolved selection while preserving existing resource inventory', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    if (manifest.project_target)
      manifest.project_target.resource_library_usage = undefined
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      status: 'satisfied',
    }
    manifest.requirements.push({
      id: 'runtime-native-font',
      required: true,
      status: 'planned',
      purpose: 'Use a target-native font strategy without importing a file.',
      source_decision: {
        type: 'system-provided',
        reasons: ['The target runtime provides the approved font strategy.'],
        decided_at: new Date().toISOString(),
      },
    })
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
          mode: 'repair',
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
    expect(repaired.requirements[1]).toMatchObject({
      id: 'runtime-native-font',
      purpose: 'Use a target-native font strategy without importing a file.',
      status: 'planned',
    })
    expect(repaired.requirements[1]).not.toHaveProperty('resource_requirement')
    expect(repaired.requirements[1]).not.toHaveProperty('satisfied_by')
    expect(repaired.requirements[1]?.source_decision?.type).toBe(
      'system-provided',
    )
    expect(repaired.imports?.map(value => value.id)).toEqual(['import-1'])
    expect(repaired.compositions?.[0]).toMatchObject({
      id: 'composition-1',
      status: 'planned',
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      contract: {
        resourceAttemptMode: 'selection',
        remediation: {
          preserveImportIds: ['import-1'],
          preserveCompositionIds: ['composition-1'],
        },
      },
    })
  })

  test('rejects zero-budget file selectors instead of silently changing their source lane', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements.push({
      id: 'authored-effect',
      required: true,
      status: 'planned',
      resource_requirement: {
        accepted_formats: ['glb'],
        import_budget: 0,
        purpose: 'Create this responsibility in the target implementation.',
        no_match: 'runtime-generated',
      },
      satisfied_by: { composition_ids: ['planned-effect-composition'] },
    })
    manifest.compositions?.push({
      id: 'planned-effect-composition',
      kind: 'scene',
      status: 'planned',
      members: [{ requirement_id: 'authored-effect', role: 'effect' }],
    })
    await writeBeeGameAssetManifest(workspace, manifest)
    const base = createInitialDeliveryRun({
      runId: 'run-authored-normalization',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })

    await startResourcePreparation({
      run: { ...base, phase: 'RESOURCE_PREPARATION' },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => request,
      },
    })

    const current = await readBeeGameAssetManifest(workspace)
    expect(
      current.requirements.find(item => item.id === 'authored-effect'),
    ).toMatchObject({
      resource_requirement: {
        import_budget: 0,
        no_match: 'runtime-generated',
      },
    })
    expect(await auditResourceInventoryPolicy(workspace)).toContain(
      'File-backed resource requirements have no import budget or current binding: authored-effect. Omit resource_requirement only after recording one exact final source decision, or declare an approved positive budget.',
    )
  })

  test('requires a durable source decision for every unbound authored responsibility', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    manifest.requirements.push({
      id: 'authored-audio',
      required: true,
      status: 'planned',
      purpose: 'Create the approved audio responsibility in the project.',
    })
    await writeBeeGameAssetManifest(workspace, manifest)

    expect(await auditResourceInventoryPolicy(workspace)).toContain(
      'Required non-library responsibilities have no exact durable source decision or current binding: authored-audio. Record one canonical source_decision for each responsibility before resource preparation can pass.',
    )

    const requests: WorkerDispatchRequest[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-authored-source-decision',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    await startResourcePreparation({
      run: { ...base, phase: 'RESOURCE_PREPARATION' },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })
    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'repair',
      remediation: {
        issues: [expect.stringContaining('authored-audio')],
      },
    })

    manifest.requirements[1] = {
      ...manifest.requirements[1]!,
      source_decision: {
        type: 'runtime-generated',
        reasons: ['The approved plan assigns this to target-native synthesis.'],
        decided_at: new Date().toISOString(),
      },
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    expect(await auditResourceInventoryPolicy(workspace)).toEqual([])
  })

  test('automatically resumes a canonical inventory in repair mode', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      status: 'satisfied',
      resource_requirement: undefined,
    }
    manifest.imports![0] = {
      ...manifest.imports![0]!,
      status: 'referenced',
    }
    manifest.compositions![0] = {
      ...manifest.compositions![0]!,
      status: 'planned',
      recipe: { path: 'src/integration.ts' },
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const requests: WorkerDispatchRequest[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })

    await startResourcePreparation({
      run: { ...base, phase: 'RESOURCE_PREPARATION' },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'repair',
      remediation: {
        preserveImportIds: ['import-1'],
        preserveCompositionIds: ['composition-1'],
      },
    })
    const repaired = await readBeeGameAssetManifest(workspace)
    expect(repaired.requirements[0]?.status).toBe('planned')
    expect(repaired.imports?.[0]?.status).toBe('available')
    expect(repaired.compositions?.[0]?.status).toBe('planned')
    expect(repaired.compositions?.[0]?.recipe).toBeUndefined()
  })

  test('blocks resource completion until every import is bound to the approved plan', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.compositions = []
    await writeBeeGameAssetManifest(workspace, manifest)
    const evidencePath = '.beegame/workflow/evidence/resource-preparation.json'
    await writeFile(join(workspace, evidencePath), 'evidence')
    const base = createInitialDeliveryRun({
      runId: 'run-1',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const run = { ...base, phase: 'RESOURCE_PREPARATION' as const }
    const resourceEvidence = {
      state: 'current' as const,
      actions: ['import_elements'],
      failedActions: [],
      successfulImportCount: 1,
      failedImportCount: 0,
      observedAt: new Date().toISOString(),
    }
    const terminal = {
      workerType: 'resource-preparer' as const,
      attemptMode: 'selection' as const,
      revision: run.revision.document,
      status: 'completed' as const,
      writtenPaths: [
        'assets/asset-manifest.json',
        'public/runtime-assets/root.glb',
        evidencePath,
      ],
      importIds: ['import-1'],
      compositionIds: [],
      evidencePath,
    }

    const blocked = await completeResourcePreparation({
      run,
      workspacePath: workspace,
      terminal,
      audit: auditResourcesForPreparation({
        workspacePath: workspace,
        resourceEvidence,
      }),
      resourceEvidence,
    })

    expect(blocked.status).toBe('needs_action')
    expect(blocked.blockedReason).toContain(
      'Resource imports are not bound to any current requirement or composition: import-1.',
    )
    expect(blocked.blockedReason).toContain(
      'resource selection has unresolved file-backed requirements: requirement-1',
    )
    expect(blocked.resourceRemediation).toMatchObject({
      mode: 'repair',
      issues: [expect.stringContaining('requirement-1')],
    })

    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const completed = await completeResourcePreparation({
      run,
      workspacePath: workspace,
      terminal,
      audit: auditResourcesForPreparation({
        workspacePath: workspace,
        resourceEvidence,
      }),
      resourceEvidence,
    })

    expect(completed.phase).toBe('DOCUMENT_REVIEW')
    expect(completed.status).toBe('running')
  })

  test('skips a stale remediation dispatch when durable canonical inventory passes after restart', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const resourceEvidence = {
      state: 'stale' as const,
      actions: ['import_elements'],
      failedActions: [],
      successfulImportCount: 1,
      failedImportCount: 0,
      observedAt: new Date().toISOString(),
    }
    const run = {
      ...createInitialDeliveryRun({
        runId: 'run-1',
        projectId: 'project-1',
        ownerId: 'owner-1',
        confirmedBriefDigest: 'brief-1',
      }),
      phase: 'RESOURCE_PREPARATION' as const,
      resourceEvidence,
      documentRemediation: {
        sourceRevision: 'old-resource-revision',
        evidencePath: '.beegame/workflow/evidence/old-review.json',
        attempt: 3,
        findings: [
          {
            id: 'old-review-finding',
            severity: 'blocking' as const,
            category: 'missing_spec' as const,
            remediationTarget: 'resource' as const,
            resourceAction: 'repair' as const,
            documents: ['assets/asset-manifest.json'],
            description: 'A superseded review finding.',
            requiredAction: 'Repeat a correction that is already complete.',
          },
        ],
      },
      resourceRemediation: {
        sourceRevision: 'old-resource-revision',
        attempt: 3,
        issues: ['A superseded reviewer correction.'],
        mode: 'repair' as const,
        preserveImportIds: ['import-1'],
        preserveCompositionIds: ['composition-1'],
      },
    }

    const reconciled = await reconcileCurrentResourcePreparation({
      run,
      workspacePath: workspace,
      resourceEvidence,
    })

    expect(reconciled).toMatchObject({
      status: 'running',
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_REVIEW',
      documentRemediation: undefined,
      resourceRemediation: undefined,
      evidence: {
        resourcePreparation: { status: 'passed' },
      },
    })
    const evidencePath = reconciled?.evidence.resourcePreparation?.path
    expect(evidencePath).toBe(
      '.beegame/workflow/evidence/resource-preparation-reconciled-run-1.json',
    )
    expect(
      JSON.parse(await readFile(join(workspace, evidencePath!), 'utf8')),
    ).toMatchObject({ status: 'passed', importCount: 1 })
  })

  test('continues valid partial inventory in selection mode instead of repair mode', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    manifest.requirements.push({
      id: 'requirement-2',
      required: true,
      status: 'planned',
      resource_requirement: {
        accepted_formats: ['glb'],
        purpose: 'second runtime responsibility',
        import_budget: 1,
        no_match: 'runtime-generated',
      },
    })
    await writeBeeGameAssetManifest(workspace, manifest)
    expect(auditAssetContract(workspace).valid).toBe(true)
    const requests: WorkerDispatchRequest[] = []
    const base = createInitialDeliveryRun({
      runId: 'run-partial-selection',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })

    await startResourcePreparation({
      run: { ...base, phase: 'RESOURCE_PREPARATION' },
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })

    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'selection',
      selectionPlan: [
        {
          responsibilities: [
            {
              requirementId: 'requirement-2',
              remainingImportBudget: 1,
            },
          ],
          noMatch: 'runtime-generated',
        },
      ],
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'This is a continuation over valid partial inventory.',
    )
  })

  test('discards stale reselection history when current partial inventory only needs selection', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    manifest.requirements.push({
      id: 'requirement-2',
      required: true,
      status: 'planned',
      resource_requirement: {
        accepted_formats: ['glb'],
        purpose: 'new unresolved responsibility',
        import_budget: 1,
        no_match: 'runtime-generated',
      },
    })
    await writeBeeGameAssetManifest(workspace, manifest)
    const base = createInitialDeliveryRun({
      runId: 'run-stale-reselection',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const requests: WorkerDispatchRequest[] = []

    await startResourcePreparation({
      run: {
        ...base,
        phase: 'RESOURCE_PREPARATION',
        resourceRemediation: {
          sourceRevision: base.revision.document,
          attempt: 7,
          issues: ['old catalog-call limit'],
          mode: 'reselection',
          preserveImportIds: ['import-1'],
          preserveCompositionIds: ['composition-1'],
          reselectImportIds: ['already-removed-import'],
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

    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'selection',
      selectionPlan: [
        { responsibilities: [{ requirementId: 'requirement-2' }] },
      ],
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
  })

  test('honors reviewer-requested reselection for a target-compatible current import', async () => {
    workspace = await createWorkspace()
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const base = createInitialDeliveryRun({
      runId: 'run-review-reselection',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const requests: WorkerDispatchRequest[] = []

    await startResourcePreparation({
      run: {
        ...base,
        phase: 'RESOURCE_PREPARATION',
        resourceRemediation: {
          sourceRevision: base.revision.document,
          attempt: 2,
          issues: ['The approved review requires replacing this import.'],
          mode: 'reselection',
          preserveImportIds: [],
          preserveCompositionIds: [],
          reselectImportIds: ['import-1'],
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

    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'reselection',
      remediation: {
        mode: 'reselection',
        issues: ['The approved review requires replacing this import.'],
        reselectImportIds: ['import-1'],
      },
      selectionPlan: [
        { responsibilities: [{ requirementId: 'requirement-1' }] },
      ],
    })
    const cleaned = await readBeeGameAssetManifest(workspace)
    expect(cleaned.imports).toEqual([])
    expect(cleaned.requirements[0]?.satisfied_by?.import_ids).toBeUndefined()
  })

  test('turns target-incompatible imports into a bounded reselection pass', async () => {
    workspace = await createWorkspace()
    const incompatiblePath = 'public/runtime-assets/root.fbx'
    await writeFile(join(workspace, incompatiblePath), 'fbx-data')
    const manifest = await readBeeGameAssetManifest(workspace)
    manifest.requirements[0] = {
      ...manifest.requirements[0]!,
      satisfied_by: { import_ids: ['import-1'] },
    }
    manifest.imports![0] = {
      ...manifest.imports![0]!,
      source: {
        ...manifest.imports![0]!.source,
        element_path: 'models/root.fbx',
      },
      root_path: incompatiblePath,
      local_files: [incompatiblePath],
    }
    await writeBeeGameAssetManifest(workspace, manifest)
    const evidencePath =
      '.beegame/workflow/evidence/resource-preparation-reselection.json'
    await writeFile(join(workspace, evidencePath), 'evidence')
    const base = createInitialDeliveryRun({
      runId: 'run-reselection',
      projectId: 'project-1',
      ownerId: 'owner-1',
      confirmedBriefDigest: 'brief-1',
    })
    const run = { ...base, phase: 'RESOURCE_PREPARATION' as const }
    const resourceEvidence = {
      state: 'current' as const,
      actions: ['import_elements'],
      failedActions: [],
      successfulImportCount: 1,
      failedImportCount: 0,
      observedAt: new Date().toISOString(),
    }
    const blocked = await completeResourcePreparation({
      run,
      workspacePath: workspace,
      terminal: {
        workerType: 'resource-preparer',
        attemptMode: 'reselection',
        revision: run.revision.document,
        status: 'failed',
        writtenPaths: [
          'assets/asset-manifest.json',
          incompatiblePath,
          evidencePath,
        ],
        importIds: ['import-1'],
        compositionIds: ['composition-1'],
        evidencePath,
      },
      audit: auditResourcesForPreparation({
        workspacePath: workspace,
        resourceEvidence,
      }),
      resourceEvidence,
    })

    expect(blocked.status).toBe('needs_action')
    expect(blocked.resourceRemediation).toMatchObject({
      mode: 'reselection',
      preserveImportIds: [],
      reselectImportIds: ['import-1'],
    })

    const requests: WorkerDispatchRequest[] = []
    await startResourcePreparation({
      run: blocked,
      workspacePath: workspace,
      dispatcher: {
        dispatch: async request => {
          requests.push(request)
          return request
        },
      },
    })
    expect(requests[0]?.contract).toMatchObject({
      resourceAttemptMode: 'reselection',
      selectionPlan: [
        {
          responsibilities: [
            {
              requirementId: 'requirement-1',
              remainingImportBudget: 1,
            },
          ],
          acceptedFormats: ['glb'],
          resourceRequirement: {
            accepted_formats: ['glb'],
            no_match: 'runtime-generated',
          },
          noMatch: 'runtime-generated',
        },
      ],
      remediation: {
        mode: 'reselection',
        preserveImportIds: [],
        reselectImportIds: ['import-1'],
      },
    })
    const cleaned = await readBeeGameAssetManifest(workspace)
    expect(cleaned.imports).toEqual([])
    expect(cleaned.requirements[0]?.satisfied_by?.import_ids).toBeUndefined()
    expect(cleaned.compositions?.[0]?.members).toEqual([])
    expect(await Bun.file(join(workspace, incompatiblePath)).text()).toBe(
      'fbx-data',
    )
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'targeted resource reselection pass',
    )
    expect(buildWorkerPrompt(requests[0]!)).toContain('start with browse_packs')
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'One import_elements selection may list multiple requirement_ids',
    )
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'return a concrete blocked result instead of fabricating a match',
    )
    expect(buildWorkerPrompt(requests[0]!)).toContain(
      'Do not author or modify any workflow evidence file',
    )
  })

  test('uses the single fresh manifest-planning path when no canonical manifest exists', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-resource-fresh-restart-'))
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
          mode: 'repair',
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
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
    expect(requests[0]?.contract).not.toHaveProperty('freshRestart')
    const freshPrompt = buildWorkerPrompt(requests[0]!)
    expect(freshPrompt).toContain(
      'Do not call ResourceLibrary in this dispatch',
    )
    expect(freshPrompt).toContain(
      'ResourceLibrary is intentionally unavailable',
    )
    expect(freshPrompt).toContain(
      '"integration_mode":["filesystem","mcp","manual"]',
    )
    expect(freshPrompt).toContain(
      '"mcp_server":"optional trimmed non-empty string; omit when unavailable, never null"',
    )
    expect(freshPrompt).toContain(
      '"requirementStatuses":["planned","satisfied","blocked"]',
    )
    expect(freshPrompt).toContain(
      '"resource_requirement":"required while selecting library content; forbidden with a final non-library source_decision"',
    )
    expect(freshPrompt).toContain(
      'Before selection, a file-backed requirement has resource_requirement and no source_decision',
    )
    expect(freshPrompt).toContain(
      'Every non-library source_decision must omit resource_requirement',
    )
    expect(freshPrompt).toContain(
      '"resourceNoMatchOutcomes":["authored-asset","runtime-generated","system-provided","silent","blocked"]',
    )
    expect(freshPrompt).toContain(
      '"no_match":{"required":true,"enum":["authored-asset","runtime-generated","system-provided","silent","blocked"]}',
    )
    expect(freshPrompt).toContain(
      'Every resource_requirement must contain import_budget and no_match',
    )
    expect(freshPrompt).toContain('"import_budget"')
    expect(freshPrompt).toContain('"no_match"')
    expect(freshPrompt).not.toContain('start with browse_packs')
  })

  test('rebuilds an invalid manifest through the same fresh planning path', async () => {
    workspace = await mkdtemp(
      join(tmpdir(), 'beegame-resource-invalid-restart-'),
    )
    await mkdir(join(workspace, 'assets'), { recursive: true })
    await writeFile(
      join(workspace, 'assets/asset-manifest.json'),
      JSON.stringify({
        version: 5,
        source_decisions: {},
        project_target: { asset_format_capabilities: ['glb'] },
        requirements: [{ id: 'requirement-1', import_budget: 1 }],
        imports: [],
        compositions: [],
      }),
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
          mode: 'repair',
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
    })
    expect(requests[0]?.contract).not.toHaveProperty('remediation')
    expect(requests[0]?.contract).not.toHaveProperty('freshRestart')
  })

  test('server reconciles implementation facts without invalidating approved resource identity', async () => {
    workspace = await createWorkspace()
    const prepared = await readBeeGameAssetManifest(workspace)
    const { resource_requirement: _selector, ...preparedRequirement } =
      prepared.requirements[0]!
    prepared.requirements[0] = {
      ...preparedRequirement,
      source_decision: {
        type: 'resource-library',
        basis: 'resource-import',
        reasons: ['The approved Resource Library import was selected.'],
        decided_at: new Date().toISOString(),
      },
      satisfied_by: {
        import_ids: ['import-1'],
        composition_ids: ['composition-1'],
      },
    }
    await writeBeeGameAssetManifest(workspace, prepared)
    const revisionBefore = await computeResourceRevision(
      workspace,
      'document-revision',
    )
    const task: AtomicTask = {
      id: 'task-1',
      title: 'Integrate approved resource',
      resourceRequirementIds: ['requirement-1'],
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
      verifiedArtifacts: ['src/integration.ts'],
      verificationResults: [
        {
          verificationIndex: 0,
          status: 'passed',
          observations: ['Project verification completed successfully.'],
        },
      ],
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

    const rollback = await applyImplementationResourceBindings({
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

    await rollback()
    const restored = await readBeeGameAssetManifest(workspace)
    expect(restored.imports?.[0]?.status).toBe('available')
    expect(restored.compositions?.[0]?.status).toBe('planned')
    expect(restored.requirements[0]?.status).toBe('planned')
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
          import_budget: 1,
          no_match: 'runtime-generated',
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

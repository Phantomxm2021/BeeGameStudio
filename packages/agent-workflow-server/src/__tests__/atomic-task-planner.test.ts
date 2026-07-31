import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AtomicTaskPlanError,
  buildAtomicTaskGraph,
  readAtomicTaskPlanningDocuments,
} from '../beegame/delivery-workflow/atomic-task-planner'
import { CANONICAL_PROJECT_DOCUMENTS } from '../beegame/delivery-workflow/types'
import type { WorkerTerminalResult } from '../beegame/delivery-workflow/worker-contracts'

describe('atomic task planner boundary', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('loads each revision-bound canonical document exactly once for the planner contract', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-planning-source-'))
    for (const path of CANONICAL_PROJECT_DOCUMENTS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), `content:${path}`)
    }

    expect(await readAtomicTaskPlanningDocuments(workspace)).toEqual(
      CANONICAL_PROJECT_DOCUMENTS.map(path => ({
        path,
        content: `content:${path}`,
      })),
    )
  })

  test('keeps gameplay tasks independent from resource requirements and allows one integration task to own several resources', () => {
    const terminal: Extract<
      WorkerTerminalResult,
      { workerType: 'atomic-task-planner' }
    > = {
      workerType: 'atomic-task-planner',
      status: 'completed',
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'gameplay',
          title: 'Implement approved gameplay behavior',
          resourceRequirementIds: [],
          checklistIds: ['check-1'],
          dependsOn: [],
          allowedPaths: ['src/'],
          expectedArtifacts: ['src/gameplay.ts'],
          verification: [
            {
              kind: 'test',
              commandOrAction: 'run gameplay test',
              expectedResult: 'approved behavior passes',
            },
          ],
          status: 'pending',
          attempt: 0,
          evidenceRefs: [],
        },
        {
          id: 'resources',
          title: 'Integrate approved resources',
          resourceRequirementIds: ['resource-1', 'resource-2'],
          checklistIds: [],
          dependsOn: ['gameplay'],
          allowedPaths: ['src/'],
          expectedArtifacts: ['src/resources.ts'],
          resourceImportIds: ['import-1', 'import-2'],
          resourceCompositionIds: ['composition-1'],
          verification: [
            {
              kind: 'asset',
              commandOrAction: 'inspect integration evidence',
              expectedResult: 'all approved resources are referenced',
            },
          ],
          status: 'pending',
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['resource-1', 'resource-2'],
        checklistIds: ['check-1'],
        importIds: ['import-1', 'import-2'],
        compositionIds: ['composition-1'],
        runtimeAssetRoot: 'public/assets',
        resourceBindings: [
          {
            requirementId: 'resource-1',
            sourceType: 'resource-library',
            importIds: ['import-1'],
            compositionIds: ['composition-1'],
            projectReferences: [],
          },
          {
            requirementId: 'resource-2',
            sourceType: 'resource-library',
            importIds: ['import-2'],
            compositionIds: [],
            projectReferences: [],
          },
        ],
      }),
    ).toHaveLength(2)
  })

  test('rejects resource IDs assigned outside the task resource responsibilities', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'invalid-resource-owner',
          title: 'Invalid resource ownership',
          resourceRequirementIds: ['resource-1'],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/'],
          expectedArtifacts: ['src/resources.ts'],
          resourceImportIds: ['import-2'],
          verification: [
            {
              kind: 'asset' as const,
              commandOrAction: 'inspect resource',
              expectedResult: 'resource exists',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['resource-1'],
        checklistIds: [],
        importIds: ['import-2'],
        compositionIds: [],
        runtimeAssetRoot: 'public/assets',
        resourceBindings: [
          {
            requirementId: 'resource-1',
            sourceType: 'resource-library',
            importIds: [],
            compositionIds: [],
            projectReferences: [],
          },
        ],
      }),
    ).toThrow(AtomicTaskPlanError)
  })

  test('rejects duplicated checklist and resource ownership', () => {
    const sharedTask = {
      title: 'Own one observable responsibility',
      resourceRequirementIds: ['resource-1'],
      checklistIds: ['check-1'],
      dependsOn: [],
      allowedPaths: ['src/'],
      expectedArtifacts: ['src/runtime.ts'],
      verification: [
        {
          kind: 'test' as const,
          commandOrAction: 'run owned tests',
          expectedResult: 'owned behavior passes',
        },
      ],
      status: 'pending' as const,
      attempt: 0,
      evidenceRefs: [],
    }
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        { ...sharedTask, id: 'owner-a' },
        {
          ...sharedTask,
          id: 'owner-b',
          expectedArtifacts: ['src/view.ts'],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['resource-1'],
        checklistIds: ['check-1'],
      }),
    ).toThrow('resource requirement must have exactly one owning atomic task')
  })

  test('reports every unowned task that does not feed owned work', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: ['state-support', 'detached-tests'].map(id => ({
        id,
        title: id,
        resourceRequirementIds: [],
        checklistIds: [],
        dependsOn: [],
        allowedPaths: [`src/${id}/`],
        expectedArtifacts: [`src/${id}/index.ts`],
        verification: [
          {
            kind: 'test' as const,
            commandOrAction: 'run owned tests',
            expectedResult: 'owned tests pass',
          },
        ],
        status: 'pending' as const,
        attempt: 0,
        evidenceRefs: [],
      })),
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: [],
      }),
    ).toThrow(
      'unowned atomic tasks must be prerequisites of owned work: detached-tests, state-support',
    )
  })

  test('allows an unowned support task only as a prerequisite of owned work', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'support',
          title: 'Create required shared runtime state',
          resourceRequirementIds: [],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/state/'],
          expectedArtifacts: ['src/state/store.ts'],
          verification: [
            {
              kind: 'test' as const,
              commandOrAction: 'run state tests',
              expectedResult: 'state tests pass',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
        {
          id: 'owned-behavior',
          title: 'Implement observable behavior',
          resourceRequirementIds: [],
          checklistIds: ['check-1'],
          dependsOn: ['support'],
          allowedPaths: ['src/game/'],
          expectedArtifacts: ['src/game/runtime.ts'],
          verification: [
            {
              kind: 'test' as const,
              commandOrAction: 'run behavior tests',
              expectedResult: 'behavior tests pass',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: ['check-1'],
      }),
    ).toHaveLength(2)
  })

  test('rejects parallel expected artifact ownership', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: ['owner-a', 'owner-b'].map((id, index) => ({
        id,
        title: id,
        resourceRequirementIds: [],
        checklistIds: [`check-${index + 1}`],
        dependsOn: [],
        allowedPaths: ['src/shared/'],
        expectedArtifacts: ['src/shared/runtime.ts'],
        verification: [
          {
            kind: 'test' as const,
            commandOrAction: 'run owned tests',
            expectedResult: 'owned tests pass',
          },
        ],
        status: 'pending' as const,
        attempt: 0,
        evidenceRefs: [],
      })),
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: ['check-1', 'check-2'],
      }),
    ).toThrow('expected artifact has parallel atomic task owners')
  })

  test('allows expected artifact revisions along one dependency lineage', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: ['base', 'integration'].map((id, index) => ({
        id,
        title: id,
        resourceRequirementIds: [],
        checklistIds: [`check-${index + 1}`],
        dependsOn: index ? ['base'] : [],
        allowedPaths: ['src/shared/'],
        expectedArtifacts: ['src/shared/runtime.ts'],
        verification: [
          {
            kind: 'test' as const,
            commandOrAction: 'run owned tests',
            expectedResult: 'owned tests pass',
          },
        ],
        status: 'pending' as const,
        attempt: 0,
        evidenceRefs: [],
      })),
    }

    expect(
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: ['check-1', 'check-2'],
      }),
    ).toHaveLength(2)
  })

  test('rejects a task that collapses different resource fulfillment types', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'mixed-assets',
          title: 'Mix incompatible resource outcomes',
          resourceRequirementIds: ['generated-scene', 'system-font'],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/', 'public/assets/'],
          expectedArtifacts: ['src/scene.ts', 'public/assets/font.woff2'],
          verification: [
            {
              kind: 'asset' as const,
              commandOrAction: 'inspect outputs',
              expectedResult: 'outputs exist',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['generated-scene', 'system-font'],
        checklistIds: [],
        runtimeAssetRoot: 'public/assets',
        resourceBindings: [
          {
            requirementId: 'generated-scene',
            sourceType: 'runtime-generated',
            importIds: [],
            compositionIds: [],
            projectReferences: [],
          },
          {
            requirementId: 'system-font',
            sourceType: 'system-provided',
            importIds: [],
            compositionIds: [],
            projectReferences: [],
          },
        ],
      }),
    ).toThrow('mixes resource fulfillment types')
  })

  test('rejects placeholder asset files for fileless fulfillment', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'silent-audio',
          title: 'Implement approved silent behavior',
          resourceRequirementIds: ['silent-audio'],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/audio/', 'public/assets/audio/'],
          expectedArtifacts: ['src/audio/silent.ts', 'public/assets/audio/placeholder.ogg'],
          verification: [
            {
              kind: 'test' as const,
              commandOrAction: 'test silent behavior',
              expectedResult: 'no audio request occurs',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['silent-audio'],
        checklistIds: [],
        runtimeAssetRoot: 'public/assets',
        resourceBindings: [
          {
            requirementId: 'silent-audio',
            sourceType: 'silent',
            importIds: [],
            compositionIds: [],
            projectReferences: [],
          },
        ],
      }),
    ).toThrow('assigns asset files to silent fulfillment')
  })

  test('requires authored assets under the canonical runtime root', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'authored-icon',
          title: 'Author the approved icon',
          resourceRequirementIds: ['authored-icon'],
          checklistIds: [],
          dependsOn: [],
          allowedPaths: ['src/ui/'],
          expectedArtifacts: ['src/ui/icon.ts'],
          verification: [
            {
              kind: 'asset' as const,
              commandOrAction: 'inspect icon',
              expectedResult: 'icon exists',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: ['authored-icon'],
        checklistIds: [],
        runtimeAssetRoot: 'public/assets',
        resourceBindings: [
          {
            requirementId: 'authored-icon',
            sourceType: 'authored-asset',
            importIds: [],
            compositionIds: [],
            projectReferences: [],
          },
        ],
      }),
    ).toThrow('owns authored assets but declares no artifact under public/assets')
  })

  test('rejects expected artifacts outside the task write scope', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'build',
          title: 'Build the approved delivery',
          resourceRequirementIds: [],
          checklistIds: ['check-1'],
          dependsOn: [],
          allowedPaths: ['vite.config.ts'],
          expectedArtifacts: ['dist/'],
          verification: [
            {
              kind: 'build' as const,
              commandOrAction: 'run build',
              expectedResult: 'build output exists',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: ['check-1'],
      }),
    ).toThrow(
      'atomic task build cannot write expected artifact outside its allowed paths: dist/',
    )
  })

  test('rejects implementation tasks that claim workflow-owned canonical artifacts', () => {
    const terminal = {
      workerType: 'atomic-task-planner' as const,
      status: 'completed' as const,
      revision: 'revision-1',
      evidencePath: '.beegame/workflow/evidence/plan.json',
      tasks: [
        {
          id: 'invalid-manifest-owner',
          title: 'Validate delivery inventory',
          resourceRequirementIds: [],
          checklistIds: ['check-1'],
          dependsOn: [],
          allowedPaths: ['assets/asset-manifest.json'],
          expectedArtifacts: ['assets/asset-manifest.json'],
          verification: [
            {
              kind: 'file' as const,
              commandOrAction: 'inspect canonical inventory',
              expectedResult: 'inventory is complete',
            },
          ],
          status: 'pending' as const,
          attempt: 0,
          evidenceRefs: [],
        },
      ],
    }

    expect(() =>
      buildAtomicTaskGraph(terminal, {
        resourceRequirementIds: [],
        checklistIds: ['check-1'],
      }),
    ).toThrow('workflow-owned canonical artifact')
  })
})

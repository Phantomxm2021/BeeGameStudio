import { describe, expect, test } from 'bun:test'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { buildWorkerPrompt } from './worker-prompts'

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('worker prompts', () => {
  test('derives checklist cardinality from observable scenarios without fixed business caps', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: ['docs/acceptance/gameplay-checklist.md'],
      contract: { documentSet: 'checklist' },
    })

    expect(prompt).toContain('distinct, independently observable acceptance condition explicitly present in a SCENARIO block')
    expect(prompt).toContain('Do not expand sentences, table rows, variants, prior checklist entries, or generic best practice')
    expect(countOccurrences(prompt, 'Author only the Checklist candidate at docs/acceptance/gameplay-checklist.md')).toBe(1)
    expect(prompt).not.toContain('24-40 checkbox tasks')
    expect(prompt).not.toContain('never exceed 64 checkbox tasks')
  })

  test('passes one fixed Game IR payload to every delivery worker', () => {
    const gameIr = {
      resultId: 'ir-result-1',
      foundationRevision: 'foundation-revision-1',
      publicationId: 'publication-1',
      modules: [
        {
          moduleId: 'gameplay',
          nodes: [
            {
              id: 'node-1',
              kind: 'rule',
              producerMode: 'mechanical',
              value: { label: 'Collect the light' },
              references: [],
              edges: [],
              bindings: {},
            },
          ],
        },
      ],
    }
    const workerTypes = [
      'document-author',
      'resource-planner',
      'content-author',
      'implementation-worker',
      'acceptance-validator',
    ] as const

    for (const workerType of workerTypes) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType,
        phase:
          workerType === 'document-author'
            ? 'DOCUMENT_REVIEW'
            : workerType === 'content-author'
              ? 'GAME_CONTENT'
            : workerType === 'implementation-worker'
                ? 'IMPLEMENTATION'
                : workerType === 'acceptance-validator'
                    ? 'ACCEPTANCE'
                    : 'RESOURCE_PREPARATION',
        revision: 'revision',
        allowedPaths:
          workerType === 'document-author'
            ? ['docs/acceptance/gameplay-checklist.md']
            : [],
        contract: {
          ...(workerType === 'document-author'
            ? { documentSet: 'checklist' }
            : {}),
          gameIr,
        },
      })

      expect(prompt).toContain('sole fixed Game IR version')
      expect(prompt).toContain(JSON.stringify(gameIr))
      expect(prompt.match(/"resultId":"ir-result-1"/g)).toHaveLength(1)
    }
  })

  test('resource planner uses the native file workflow without legacy manifest-tool instructions', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project',
      workspacePath: '/workspace', workerType: 'resource-planner',
      phase: 'RESOURCE_PREPARATION', revision: 'revision',
      allowedPaths: ['assets/asset-manifest.json', 'assets/manifest/requirements/'],
      contract: {
        resourceLibraryUsage: 'optional',
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })

    expect(prompt).toContain('Complete resource delivery in one normal CLI turn')
    expect(prompt).toContain('canonical Manifest, including requirement-to-resource bindings')
    expect(prompt).toContain('Work autonomously with the available native tools')
    expect(prompt).toContain('choose how to search, inspect, select, create and combine resources')
    expect(prompt).toContain('Do not use arbitrary placeholders')
    expect(prompt).toContain('never fabricate library provenance')
    expect(prompt).toContain('"indexFields":["version","project_target","modules"]')
    expect(prompt).toContain('"fulfills"')
    expect(prompt).toContain('"webSourceFields":["type","source_url","page_url","license","license_url","author","retrieved_at"]')
    expect(prompt).toContain('when acquisition_profile.coverage is present')
    expect(prompt).toContain('"coverage":{"type":"non_empty_array"')
    expect(prompt).not.toContain('indexExample')
    expect(prompt).toContain('omit dependencies for direct agent-authored resources')
    expect(prompt).toContain('host performs only deterministic contract validation')
    expect(prompt).not.toContain('AssetManifest is the only writer')
    expect(prompt).not.toContain('write JSON/YAML')
  })

  test('direct implementation consumes IR without rebuilding the specification or a test framework', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'implementation-worker', phase: 'IMPLEMENTATION', revision: 'revision',
      taskId: 'DIRECT_IMPLEMENTATION', allowedPaths: ['./'],
      contract: {
        task: { id: 'DIRECT_IMPLEMENTATION' },
        gameIr: { resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication', modules: [] },
      },
    })

    expect(prompt).toContain('Implement the injected fixed Game IR and contract.gameContent package')
    expect(prompt).toContain('load content/index.json')
    expect(prompt).toContain('Do not copy their editable values into source code')
    expect(prompt).toContain('Do not proactively reread all canonical documents')
    expect(prompt).toContain('do not create a new verification framework')
  })

  test('Scene/UI author is one direct CLI turn with no orchestration policy', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'content-author', phase: 'GAME_CONTENT', revision: 'revision',
      allowedPaths: ['content/'],
      contract: { gameIr: { resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication', modules: [] } },
    })
    expect(prompt).toContain('one normal CLI turn')
    expect(prompt).toContain('Scene2D and UI content package')
    expect(prompt).toContain('Do not embed asset paths or URLs')
    expect(prompt).not.toContain('subagent')
    expect(prompt).not.toContain('iteration')
  })

  test('resource repair is a focused host-error correction rather than replanning', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'resource-planner', phase: 'RESOURCE_PREPARATION', revision: 'revision',
      allowedPaths: ['assets/'],
      contract: {
        currentResourceIssues: ['resource binding is missing'],
        systemDeliveryContract: buildSystemDeliveryContract(),
        gameIr: { resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication', modules: [] },
      },
    })

    expect(prompt).toContain('Continue the same direct CLI resource task')
    expect(prompt).toContain('Fix the deterministic contract errors')
    expect(prompt).not.toContain('modules are intentionally omitted')
  })

  test('implementation repair receives the host rejection without a new workflow', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'implementation-worker', phase: 'IMPLEMENTATION', revision: 'revision',
      taskId: 'DIRECT_IMPLEMENTATION', allowedPaths: ['./'],
      contract: {
        currentImplementationIssues: ['required IR artifact is missing'],
        task: { id: 'DIRECT_IMPLEMENTATION' },
        gameIr: { resultId: 'result', foundationRevision: 'foundation', publicationId: 'publication', modules: [] },
      },
    })

    expect(prompt).toContain('Continue the same direct CLI implementation task')
    expect(prompt).toContain('Fix the deterministic host errors')
    expect(prompt).not.toContain('verification framework')
  })

  test('implementation uses one direct CLI task and leaves runtime to acceptance', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project',
      workspacePath: '/workspace', workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION', revision: 'revision', allowedPaths: ['src/'],
      contract: { task: { id: 'DIRECT_IMPLEMENTATION' } },
    })

    expect(prompt).toContain('Complete contract.task within allowedPaths')
    expect(prompt).toContain('Audit the completed implementation')
    expect(prompt).toContain('Runtime acceptance is a separate phase')
    expect(prompt).not.toContain('durable confirmed brief context')
    expect(prompt).not.toContain('SubmitImplementationResult')
  })

  test('acceptance ends through a plain CLI verdict rather than a custom tool', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project',
      workspacePath: '/workspace', workerType: 'acceptance-validator',
      phase: 'ACCEPTANCE', revision: 'revision', allowedPaths: [],
      contract: {},
    })

    expect(prompt).toContain('ACCEPTANCE: PASS')
    expect(prompt).toContain('ACCEPTANCE: FAIL')
    expect(prompt).toContain('TASK <id>: PASS|FAIL')
    expect(prompt).toContain('CONTENT <id>: PASS|FAIL')
    expect(prompt).toContain('ASSET <id>: PASS|FAIL')
    expect(prompt).toContain('Do not claim an ID without observing it')
    expect(prompt).not.toContain('SubmitValidationResult')
  })
})

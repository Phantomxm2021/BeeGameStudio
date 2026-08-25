import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { getGameDocumentContract } from './game-document-contracts'
import { buildSystemDeliveryContract } from './system-delivery-contract'

describe('worker prompts', () => {
  test('keeps the initial foundation author contract focused on the assigned document', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/TECHNICAL_DESIGN.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/TECHNICAL_DESIGN.md',
        upstreamDocumentPaths: [
          'docs/GDD.md',
          'docs/LEVEL_SCENE_DESIGN.md',
          'docs/BALANCE_DESIGN.md',
        ],
        completeDocumentContract: getGameDocumentContract(
          'docs/TECHNICAL_DESIGN.md',
        ),
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })

    expect(prompt).toContain('one resource loading path')
    expect(prompt).toContain('contract.systemDeliveryContract')
    expect(prompt).toContain('assets/asset-manifest.json')
    expect(prompt).toContain(
      'Canonical artifacts: docs/GDD.md, docs/LEVEL_SCENE_DESIGN.md, docs/BALANCE_DESIGN.md, docs/TECHNICAL_DESIGN.md',
    )
  })

  test('does not ask foundation models to echo service-owned terminal identity', () => {
    for (const workerType of ['foundation-fact-extractor', 'foundation-semantic-reviewer'] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType,
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision',
        allowedPaths: [],
        contract: {
          workerType,
          taskId: 'task',
          packetDigest: 'a'.repeat(64),
          modelTier: workerType === 'foundation-fact-extractor' ? 'fast' : 'balanced',
        },
      })
      const terminalInstruction = prompt
        .split('\n')
        .find(line => line.startsWith('Return exactly one native StructuredOutput'))
      expect(terminalInstruction).toBeDefined()
      for (const serviceOwnedField of ['runId', 'dispatchId', 'taskId', 'revision', 'packetDigest'])
        expect(terminalInstruction).not.toContain(serviceOwnedField)
    }
  })
})

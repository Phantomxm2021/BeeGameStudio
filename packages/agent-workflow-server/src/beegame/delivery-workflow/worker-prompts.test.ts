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
    expect(prompt).not.toContain('48,000 UTF-8 bytes')
    expect(prompt).toContain(
      'Canonical artifacts: docs/GDD.md, docs/LEVEL_SCENE_DESIGN.md, docs/BALANCE_DESIGN.md, docs/TECHNICAL_DESIGN.md',
    )
  })

  test('declares a closed H2 heading protocol for initial and parallel foundation authors', () => {
    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision',
        allowedPaths: ['docs/UI_UX_SPEC.md'],
        contract: {
          documentSet: 'foundation',
          authoringMode,
          foundationDocumentPath: 'docs/UI_UX_SPEC.md',
          completeDocumentContract: getGameDocumentContract(
            'docs/UI_UX_SPEC.md',
          ),
        },
      })
      const contract = JSON.parse(prompt.split('\n').at(-1)!) as {
        completeDocumentContract: {
          mechanicalMarkdownProtocol: {
            closedHeadingSet: string[]
            additionalH2: string
            supportingContent: string
          }
        }
      }
      const expectedH2s = [
        '## Executive Summary',
        ...getGameDocumentContract('docs/UI_UX_SPEC.md').sections.map(
          section => `## ${section.title}`,
        ),
        '## Production Materials',
      ]

      expect(contract.completeDocumentContract.mechanicalMarkdownProtocol).toMatchObject({
        closedHeadingSet: expectedH2s,
        additionalH2: 'forbidden',
        supportingContent: 'must be nested under one of the closed H2 headings',
      })
    }
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

  test('keeps packet workers on the immutable packet-only contract', () => {
    for (const workerType of ['foundation-fact-extractor', 'foundation-semantic-reviewer'] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace-secret',
        workerType,
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision',
        allowedPaths: [],
        contract: {
          workerType,
          taskId: 'task',
          packetDigest: 'a'.repeat(64),
          packet: {
            revision: 'revision',
            keys: workerType === 'foundation-fact-extractor'
              ? ['asset.covered_level_requirements']
              : ['GDD.player_loop'],
            sections: [],
            packetDigest: 'a'.repeat(64),
          },
          modelTier: workerType === 'foundation-fact-extractor' ? 'fast' : 'balanced',
          confirmedBriefContext: 'CONFIRMED_BRIEF_SENTINEL',
          workspacePath: '/workspace-secret',
          canonicalArtifacts: 'Canonical artifacts: sentinel',
          nativeToolProse: 'native tools, reasoning',
        },
      })
      expect(prompt).not.toContain('/workspace-secret')
      expect(prompt).not.toContain('CONFIRMED_BRIEF_SENTINEL')
      expect(prompt).not.toContain('Canonical artifacts: sentinel')
      expect(prompt).not.toContain('native tools, reasoning')
      expect(prompt).toContain('packet is the sole input')
      expect(prompt).toContain('Immutable packet contract')
      if (workerType === 'foundation-fact-extractor') {
        expect(prompt).toContain('asset.covered_level_requirements')
        expect(prompt).toContain('present requires key, status, and value; omit evidence and reason')
        expect(prompt).toContain('Absent requires only key and status and must omit value, evidence, and reason')
        expect(prompt).toContain('Uncertain requires key, status, and reason; omit evidence and value')
        expect(prompt).toContain('service binds immutable provenance')
        expect(prompt).toContain('left side of an explicit AssetPlan inventory mapping table')
        expect(prompt).toContain('never copy, transform, or infer values from asset.inventory_ids')
      } else {
        expect(prompt).toContain('GDD.player_loop')
        expect(prompt).toContain('PASS omits issues and reason')
        expect(prompt).toContain('ISSUES includes a non-empty issues array and omits reason')
        expect(prompt).toContain('UNDECIDABLE includes reason and omits issues')
      }
    }
  })

  test('states the canonical semantic remediation union without the removed question track', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-semantic-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        workerType: 'foundation-semantic-reviewer',
        taskId: 'task',
        packetDigest: 'a'.repeat(64),
        packet: {
          revision: 'revision',
          keys: ['GDD.player_loop'],
          sections: [],
          packetDigest: 'a'.repeat(64),
        },
        modelTier: 'balanced',
      },
    })

    expect(prompt).toContain('remediation must be exactly {"kind":"patch","sectionKeys":["..."]}')
    expect(prompt).toContain('{"kind":"patch","sectionKeys":["..."]}')
    expect(prompt).toContain('Do not wrap the result in `params` or add fields')
    expect(prompt).toContain('All patch sectionKeys must belong to the same canonical document; never mix document prefixes in one patch')
    expect(prompt).toContain('If a conflict spans documents, split it into separate Issues with independent single-document patch authority')
    expect(prompt).toContain('Source of Truth order GDD > Technical > Level/Balance/UI/Art > Asset Plan')
    expect(prompt).toContain('Choose that repair directly; never request a user choice or preserve alternatives')
    expect(prompt).toContain('A wording-only rewrite, synonym, alias, compatibility note, qualification, or restatement is not a repair')
  })

  test('gives revision semantic rechecks only the admitted Issue PASS or FAIL contract', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-semantic-reviewer',
      phase: 'DOCUMENT_REVIEW',
      taskId: 'task',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        workerType: 'foundation-semantic-reviewer',
        taskId: 'task',
        issueId: 'AUD-1',
        packetDigest: 'a'.repeat(64),
        packet: {
          issueId: 'AUD-1',
          expected: 'Boot transitions to MainMenu.',
          actual: 'The transition is absent.',
          sections: [],
        },
        modelTier: 'strong',
      },
    })

    expect(prompt).toContain('Recheck only the admitted Issue')
    expect(prompt).toContain('PASS or FAIL')
    expect(prompt).toContain('FAIL requires one structured diagnostic')
    expect(prompt).not.toContain('ISSUES includes')
    expect(prompt).not.toContain('Semantic Issue remediation')
  })

  test('keeps revision workers on the packet and one absolute staged path', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace-secret',
      workerType: 'foundation-document-reviser',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: ['.beegame/audit/foundation/revision/revision/docs/GDD.md'],
      contract: {
        workerType: 'foundation-document-reviser',
        taskId: 'task',
        revision: 'revision',
        round: 4,
        documentPath: 'docs/GDD.md',
        issueIds: ['issue-1'],
        sectionIds: ['section-1'],
        stagedPath: '.beegame/audit/foundation/revision/revision/docs/GDD.md',
        packet: {
          taskId: 'task',
          documentPath: 'docs/GDD.md',
          sections: [{ sectionId: 'section-1', content: 'IMMUTABLE_PACKET_SENTINEL' }],
          factConstraints: [{
            key: 'asset.covered_level_requirements',
            owner: { documentPath: 'docs/ASSET_PLAN.md', sectionId: 'inventory' },
            valueType: 'string[]',
            extractionInstruction: 'Read only labels on the left side of an explicit mapping table.',
            sourceOfTruthDirection: 'LEVEL owns requirements; ASSET_PLAN maps them to inventory.',
          }],
        },
        packetDigest: 'a'.repeat(64),
        priorFailureReason: 'revision changed an unauthorized section',
        confirmedBriefContext: 'CONFIRMED_BRIEF_SENTINEL',
        canonicalArtifacts: 'CANONICAL_ARTIFACT_SENTINEL',
      },
    })
    expect(prompt).toContain('IMMUTABLE_PACKET_SENTINEL')
    expect(prompt).toContain('packet sectionIds are the complete write authority')
    expect(prompt).toContain('related, risk, consistency, dependency, and production-material sections')
    expect(prompt).toContain('Automatic retry after the previous strict validation failure: revision changed an unauthorized section')
    expect(prompt).toContain('factConstraints')
    expect(prompt).toContain('left side of an explicit mapping table')
    expect(prompt).toContain('do not substitute a standalone fact declaration')
    expect(prompt).toContain('Unmarked Production Materials and audit appendices are outside the packet authority')
    expect(prompt).toContain('/workspace-secret/.beegame/audit/foundation/revision/revision/docs/GDD.md')
    expect(prompt).not.toContain('CONFIRMED_BRIEF_SENTINEL')
    expect(prompt).not.toContain('CANONICAL_ARTIFACT_SENTINEL')
    expect(prompt).not.toContain('Workspace root:')
    expect(prompt).not.toContain('Canonical artifacts:')
  })

  test('passes shared resource label rules to fact workers', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'foundation-fact-extractor',
      phase: 'DOCUMENT_REVIEW',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        workerType: 'foundation-fact-extractor',
        taskId: 'task',
        packetDigest: 'a'.repeat(64),
        packet: {
          revision: 'revision',
          keys: ['game.resources', 'ui.displayed_resources'],
          sections: [],
          packetDigest: 'a'.repeat(64),
        },
        modelTier: 'fast',
      },
    })
    expect(prompt).toContain('same canonical short labels')
    expect(prompt).toContain('parenthetical English aliases')
    expect(prompt).toContain('health pool')
  })
})

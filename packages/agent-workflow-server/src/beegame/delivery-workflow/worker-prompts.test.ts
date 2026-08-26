import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { getGameDocumentContract } from './game-document-contracts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

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
    expect(prompt).not.toContain('Workspace root:')
    expect(prompt).not.toContain('Writable paths:')
    expect(prompt).not.toContain('Canonical artifacts:')
    expect(prompt).not.toContain('Run: run')
    expect(prompt).not.toContain('Revision: revision')
  })

  test('declares a closed structured block payload for initial and parallel foundation authors', () => {
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
        completeDocumentContract: { authorOutput: Record<string, unknown> }
      }
      expect(contract.completeDocumentContract.authorOutput).toMatchObject({
        format: 'strict_structured_block_payload',
        exactCoverage: 'all IDs exactly once; no extra, missing or empty blocks',
      })
    }
  })

  test('aligns shared foundation authority instructions across all initial and parallel authors', () => {
    const expectedSharedInstructions = [
      'Use exactly one fact owner:',
      'Define each authoritative fact once',
      'Do not restate the confirmed brief, upstream authority or another section',
      'Downstream documents may specialize only already-authorized behavior and must not redefine upstream rules',
    ]

    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      for (const foundationDocumentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
        const prompt = buildWorkerPrompt({
          runId: 'run',
          ownerId: 'owner',
          projectId: 'project',
          workspacePath: '/workspace',
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          revision: 'revision',
          allowedPaths: [foundationDocumentPath],
          contract: {
            documentSet: 'foundation',
            authoringMode,
            foundationDocumentPath,
            completeDocumentContract: getGameDocumentContract(
              foundationDocumentPath,
            ),
          },
        })

        for (const instruction of expectedSharedInstructions)
          expect(prompt).toContain(instruction)
        expect(prompt).not.toContain('Workspace root:')
        expect(prompt).not.toContain('Writable paths:')
        expect(prompt).not.toContain('Canonical artifacts:')
        expect(prompt).not.toContain('Run: run')
        expect(prompt).not.toContain('Revision: revision')
      }
    }
  })

  test('requires derived views to reference owners instead of copying mutable facts', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/BALANCE_DESIGN.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
        completeDocumentContract: getGameDocumentContract(
          'docs/BALANCE_DESIGN.md',
        ),
      },
    })

    expect(prompt).toContain('Executive Summary is an authority index')
    expect(prompt).toContain(
      'Production Materials are derived compact views with owner references',
    )
    expect(prompt).toContain(
      'Do not copy mutable facts or independently maintained totals into derived views',
    )
  })

  test('does not preserve an upstream-unavailable branch when the path is present', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/BALANCE_DESIGN.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'parallel-draft',
        foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
        availableUpstreamPaths: ['docs/GDD.md'],
        completeDocumentContract: getGameDocumentContract(
          'docs/BALANCE_DESIGN.md',
        ),
      },
    })

    expect(prompt).toContain(
      'When an upstream path is present, use its committed authority; do not describe it as unavailable',
    )
    expect(prompt).not.toContain(
      'Record genuinely unavailable upstream decisions as explicit assumptions',
    )
  })

  test('records unavailable upstream decisions only when no upstream path is present', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/BALANCE_DESIGN.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'parallel-draft',
        foundationDocumentPath: 'docs/BALANCE_DESIGN.md',
        completeDocumentContract: getGameDocumentContract(
          'docs/BALANCE_DESIGN.md',
        ),
      },
    })

    expect(prompt).toContain(
      'Record genuinely unavailable upstream decisions as explicit assumptions',
    )
  })

  test('derives checklist cardinality from observable scenarios without fixed business caps', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/acceptance/gameplay-checklist.md'],
      contract: { documentSet: 'checklist' },
    })

    expect(prompt).toContain('one checkbox task for each independently observable approved scenario')
    expect(prompt).toContain('Merge only equivalent wave, enemy, input, resource, cue or table-row variants')
    expect(countOccurrences(prompt, 'Author only docs/acceptance/gameplay-checklist.md')).toBe(1)
    expect(prompt).not.toContain('24-40 checkbox tasks')
    expect(prompt).not.toContain('never exceed 64 checkbox tasks')
  })

  test('keeps output policy authority in the contract while avoiding repeated prose policy', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
      },
    })

    expect(prompt).toContain('"outputPolicy":{"sectionStyle":"final_owned_decisions"')
    expect(prompt).toContain('Complete every required section and production material')
    expect(prompt).not.toContain('Production materials are canonical compact views of owned decisions and must not repeat section narrative.')
    expect(prompt).not.toContain('Use no more than one worked example per formula or system boundary')
    expect(prompt).not.toContain('Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases.')
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
          revision: 'revision',
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
              : [],
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
      expect(prompt).toContain('Model packet contract')
      expect(countOccurrences(prompt, 'The packet is the sole input')).toBe(1)
      expect(countOccurrences(prompt, 'Do not read project files')).toBe(1)
      expect(countOccurrences(prompt, 'Return only the strict structured result')).toBe(1)
      expect(prompt).toContain('"workerType":"' + workerType + '"')
      expect(prompt).not.toContain('"taskId":"task"')
      expect(prompt).not.toContain('"revision":"revision"')
      expect(prompt).not.toContain(`"packetDigest":"${'a'.repeat(64)}"`)
      if (workerType === 'foundation-fact-extractor') {
        expect(prompt).toContain('asset.covered_level_requirements')
        expect(prompt).toContain('present requires key, status, and value; omit evidence and reason')
        expect(prompt).toContain('Absent requires only key and status and must omit value, evidence, and reason')
        expect(prompt).toContain('Uncertain requires key, status, and reason; omit evidence and value')
        expect(prompt).toContain('service binds immutable provenance')
        expect(prompt).toContain('left side of an explicit AssetPlan inventory mapping table')
        expect(prompt).toContain('never copy, transform, or infer values from asset.inventory_ids')
        expect(countOccurrences(prompt, 'service binds immutable provenance')).toBe(1)
        expect(countOccurrences(prompt, 'Do not call project tools')).toBe(0)
      } else {
        expect(prompt).toContain('PASS omits issues and reason')
        expect(prompt).toContain('ISSUES includes a non-empty issues array and omits reason')
        expect(prompt).toContain('UNDECIDABLE includes reason and omits issues')
        expect(countOccurrences(prompt, 'return Markdown')).toBe(1)
        expect(countOccurrences(prompt, 'additional fields')).toBe(1)
      }
    }
  })

  test('projects confirmation identity and same-admitted-outcome scope into the packet contract', () => {
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
        taskId: 'confirmation-task',
        sourceTaskId: 'semantic-task',
        kind: 'confirmation',
        packetDigest: 'a'.repeat(64),
        packet: {
          revision: 'revision',
          keys: ['GDD.player_loop'],
          sections: [],
          packetDigest: 'a'.repeat(64),
        },
        modelTier: 'strong',
      },
    })

    expect(prompt).toContain('strong independent confirmation')
    expect(prompt).toContain('same immutable packet')
    expect(prompt).toContain('same check')
    expect(prompt).toContain('your own supported PASS, ISSUES, or UNDECIDABLE outcome')
    expect(prompt).toContain('Do not inherit or preserve the source outcome')
    expect(prompt).toContain('Do not expand scope')
    expect(prompt).toContain('second audit track')
    expect(prompt).toContain('"kind":"confirmation"')
    expect(prompt).not.toContain('sourceTaskId')
  })

  test('keeps one worker title without service identity metadata', () => {
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
        revision: 'revision',
        packetDigest: 'a'.repeat(64),
        modelTier: 'fast',
      },
    })

    expect(countOccurrences(prompt, 'BeeGame delivery worker: foundation-fact-extractor')).toBe(1)
    expect(prompt).not.toContain('\nRevision: revision')
    expect(prompt).not.toContain('\nTask: task')
    expect(prompt).not.toContain('\nPacket digest: ')
    expect(prompt).not.toContain('"taskId":"task"')
    expect(prompt).not.toContain('"revision":"revision"')
    expect(prompt).not.toContain(`"packetDigest":"${'a'.repeat(64)}"`)
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
          sections: [{ ref: { documentPath: 'docs/GDD.md', sectionId: 'states_flow', heading: 'States', startLine: 1, endLine: 3, digest: 'b'.repeat(64) }, text: 'STATE_SECTION_SENTINEL' }],
          patchOperation: { kind: 'REPLACE', documentPath: 'docs/GDD.md', sectionId: 'states_flow', beforeDigest: 'c'.repeat(64), afterDigest: 'd'.repeat(64) },
        },
        modelTier: 'strong',
      },
    })

    expect(prompt).toContain('Recheck only the admitted Issue')
    expect(prompt).toContain('PASS or FAIL')
    expect(prompt).toContain('FAIL requires one structured diagnostic')
    expect(prompt).toContain('Boot transitions to MainMenu.')
    expect(prompt).toContain('The transition is absent.')
    expect(prompt).toContain('STATE_SECTION_SENTINEL')
    expect(prompt).toContain('"kind":"REPLACE"')
    expect(prompt).not.toContain('beforeDigest')
    expect(prompt).not.toContain('afterDigest')
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
          issueIds: ['issue-1'],
          sectionIds: ['section-1'],
          issues: [{ id: 'issue-1', severity: 'HIGH', type: 'semantic', source: { documentPath: 'docs/GDD.md', sectionId: 'section-1', heading: 'Section', startLine: 1, endLine: 2, digest: 'b'.repeat(64) }, expected: 'expected condition', actual: 'actual condition', remediation: { kind: 'patch', documentPath: 'docs/GDD.md', sectionIds: ['section-1'] } }],
          sections: [{ documentPath: 'docs/GDD.md', sectionId: 'section-1', heading: 'Section', startLine: 1, endLine: 2, digest: 'b'.repeat(64), text: 'IMMUTABLE_PACKET_SENTINEL' }],
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
    expect(prompt).toContain('issue-1')
    expect(prompt).toContain('expected condition')
    expect(prompt).toContain('actual condition')
    expect(prompt).toContain('"sectionIds":["section-1"]')
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
    expect(prompt).not.toContain('"baseDocumentDigest"')
    expect(prompt).not.toContain('"immutableDigests"')
    expect(prompt).not.toContain('"startLine"')
    expect(prompt).not.toContain('"endLine"')
    expect(prompt).not.toContain('"digest"')
  })

  test('projects packet workers to business evidence instead of service metadata', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', revision: 'revision', allowedPaths: [],
      contract: {
        workerType: 'foundation-semantic-reviewer', taskId: 'task', revision: 'revision', packetDigest: 'a'.repeat(64), modelTier: 'balanced',
        packet: {
          revision: 'revision', checkId: 'SEM.test', manifestDigest: 'b'.repeat(64), fullSectionIndexDigest: 'c'.repeat(64), fullFactStoreDigest: 'd'.repeat(64), deterministicReviewDigest: 'e'.repeat(64), selectedDeterministicPrefixDigest: 'f'.repeat(64), identity: 'g'.repeat(64), bytes: 999, context: { fresh: true, resume: false, sessionId: null },
          sections: [{ sectionKey: 'GDD#loop', ref: { documentPath: 'docs/GDD.md', sectionId: 'loop', startLine: 3, endLine: 8, digest: 'h'.repeat(64) }, bytes: 'FULL_SECTION_SENTINEL' }],
          facts: [{ key: 'game.loop', value: 'loop', source: { documentPath: 'docs/GDD.md', sectionId: 'loop', startLine: 3, endLine: 8, digest: 'i'.repeat(64) }, evidence: { documentPath: 'docs/GDD.md', sectionId: 'loop', startLine: 4, endLine: 4, digest: 'j'.repeat(64) } }],
          deterministicIssuePrefix: [],
        },
      },
    })

    expect(prompt).toContain('FULL_SECTION_SENTINEL')
    expect(prompt).toContain('"checkId":"SEM.test"')
    for (const marker of ['manifestDigest', 'fullSectionIndexDigest', 'fullFactStoreDigest', 'deterministicReviewDigest', 'selectedDeterministicPrefixDigest', 'identity', 'bytes', '"context"', 'startLine', 'endLine', 'digest', 'packetDigest'])
      expect(prompt).not.toContain(marker)
    expect(prompt).toContain('"documentPath":"docs/GDD.md"')
    expect(prompt).toContain('"sectionId":"loop"')
  })

  test('fails closed when packet evidence cannot be projected', () => {
    expect(() => buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', revision: 'revision', allowedPaths: [],
      contract: {
        packet: { sections: [{ sectionKey: 'GDD#loop', bytes: 'missing-ref' }], facts: [], deterministicIssuePrefix: [] },
      },
    })).toThrow(/model-facing semantic section item 0 is invalid/)

    expect(() => buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'foundation-document-reviser', phase: 'DOCUMENT_REVIEW', revision: 'revision', allowedPaths: ['docs/GDD.md'],
      contract: {
        stagedPath: 'docs/GDD.md',
        packet: { documentPath: 'docs/GDD.md', sectionIds: ['loop'], issues: [{ id: 'issue', expected: 'e', actual: 'a' }], sections: [], normalizedFacts: [] },
      },
    })).toThrow(/model-facing revision issue item 0 is invalid/)
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

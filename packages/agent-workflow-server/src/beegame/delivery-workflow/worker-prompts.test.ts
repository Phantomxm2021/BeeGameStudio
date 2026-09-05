import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { getGameDocumentContract } from './game-document-contracts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationAuthoringDocumentContract, FOUNDATION_AUTHORING_INSTRUCTION } from './foundation-authoring-contract'

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('worker prompts', () => {
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
      const contract = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!) as {
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

  test('derives one Markdown-table serialization rule for the evidence register', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
      allowedPaths: ['docs/ASSET_PLAN.md'],
      contract: {
        documentSet: 'foundation', authoringMode: 'initial', foundationDocumentPath: 'docs/ASSET_PLAN.md',
        completeDocumentContract: getGameDocumentContract('docs/ASSET_PLAN.md'),
      },
    })
    const serialized = JSON.parse(
      prompt.split('\n').find(line => line.startsWith('{'))!,
    ) as {
      completeDocumentContract: {
        mechanicalMarkdownProtocol: {
          productionMaterials: {
            entries: Array<{ materialId: string; format: string; serialization: string; serializationRule?: string }>
          }
        }
      }
    }
    const licenseRegister = serialized.completeDocumentContract.mechanicalMarkdownProtocol.productionMaterials.entries
      .find(material => material.materialId === 'license-register')

    expect(licenseRegister).toMatchObject({
      format: 'evidence_register',
      serialization: 'markdown_table',
    })
    expect(licenseRegister?.serializationRule).toContain('Markdown table only')
    expect(licenseRegister?.serializationRule).toContain('header row')
    expect(licenseRegister?.serializationRule).toContain('separator row')
    expect(licenseRegister?.serializationRule).toContain('do not use a fenced code block')
    expect(licenseRegister?.serializationRule).toContain('key-value list')
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
  test('keeps author configuration isolated while preserving Markdown output identities', () => {
    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
        const sharedBefore = JSON.stringify(getGameDocumentContract(path))
        const prompt = buildWorkerPrompt({
          runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
          workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
          allowedPaths: [path],
          contract: { documentSet: 'foundation', authoringMode, foundationDocumentPath: path,
            completeDocumentContract: getGameDocumentContract(path),
            systemDeliveryContract: buildSystemDeliveryContract(), availableUpstreamPaths: [],
            confirmedBriefContext: 'DUPLICATE_BRIEF_SENTINEL' },
        })
        const contract = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!)
        const view = contract.completeDocumentContract
        expect(view.documentAuthorityRule).toBe(foundationAuthoringDocumentContract(path).documentAuthorityRule)
        expect(view.mechanicalMarkdownProtocol.closedHeadingSet).toEqual([
          '## Executive Summary', ...getGameDocumentContract(path).sections.map(s => `## ${s.title}`),
          '## Production Materials',
        ])
        expect(view.mechanicalMarkdownProtocol.productionMaterials.entries.map((m: any) => [m.materialId, m.serialization]))
          .toEqual(getGameDocumentContract(path).productionMaterials.map(m => [m.materialId, m.serialization]))
        expect(countOccurrences(prompt, FOUNDATION_AUTHORING_INSTRUCTION)).toBe(1)
        expect(countOccurrences(prompt, view.documentAuthorityRule)).toBe(1)
        expect(countOccurrences(prompt, view.mergeReferenceRule)).toBe(1)
        expect(prompt).toContain('one complete raw Markdown')
        expect(prompt).toContain('Reviewer owns format, content and quality audit')
        expect(prompt).toContain('Do not call tools')
        expect(prompt).not.toContain('DUPLICATE_BRIEF_SENTINEL')
        expect(prompt).not.toContain('availableUpstreamPaths')
        expect(prompt).not.toContain('Workspace root:')
        expect(prompt).not.toContain('max_tokens')
        expect(prompt).not.toContain('roundDeadlineAt')
        expect(contract.systemDeliveryContract).toBeUndefined()
        expect(contract.authoringDeliveryContract !== undefined).toBe(path === 'docs/TECHNICAL_DESIGN.md' || path === 'docs/ASSET_PLAN.md')
        expect(JSON.stringify(getGameDocumentContract(path))).toBe(sharedBefore)
      }
    }
  })

  test('keeps Balance calculations auditable without reproducing upstream schedules', () => {
    const contract = foundationAuthoringDocumentContract('docs/BALANCE_DESIGN.md')
    const shared = getGameDocumentContract('docs/BALANCE_DESIGN.md')
    expect(contract.documentAuthorityRule).toContain('not upstream geometry or wave schedules')
    expect(contract.sections.map(section => section.sectionId)).toEqual(shared.sections.map(section => section.sectionId))
    expect(contract.sections.find(s => s.sectionId === 'tuning_validation')!.purpose).toContain('auditable chain from inputs through calculated or observed results to acceptance')
    expect(contract.sections.find(s => s.sectionId === 'tuning_validation')!.purpose).toContain('do not copy owner numeric inputs')
    expect(FOUNDATION_AUTHORING_INSTRUCTION).not.toContain('Before returning')
    expect(JSON.stringify(contract)).not.toContain('BALANCE_SECTIONS')
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

    expect(prompt).toContain('distinct, independently observable acceptance condition explicitly present in a SCENARIO block')
    expect(prompt).toContain('Do not expand sentences, table rows, variants, prior checklist entries, or generic best practice')
    expect(countOccurrences(prompt, 'Author only the Checklist candidate at docs/acceptance/gameplay-checklist.md')).toBe(1)
    expect(prompt).not.toContain('24-40 checkbox tasks')
    expect(prompt).not.toContain('never exceed 64 checkbox tasks')
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

  test('keeps revision workers on the packet without exposing a staged path', () => {
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
          issues: [{ id: 'issue-1', severity: 'HIGH', type: 'semantic', source: { documentPath: 'docs/GDD.md', sectionId: 'section-1', heading: 'Section', startLine: 1, endLine: 2, digest: 'b'.repeat(64) }, expected: 'expected condition', actual: 'actual condition', remediation: { kind: 'patch', scope: 'section', documentPath: 'docs/GDD.md', sectionIds: ['section-1'] } }],
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
    expect(prompt).toContain('packet sectionIds and packet.sections[].text are the complete current write authority')
    expect(prompt).toContain('Do not read the staged document')
    expect(prompt).toContain('Return only the complete replacement Markdown for every authorized section')
    expect(prompt).toContain('Do not include read-only evidence sections, JSON')
    expect(prompt).toContain('Automatic retry after the previous strict validation failure: revision changed an unauthorized section')
    expect(prompt).toContain('factConstraints')
    expect(prompt).toContain('left side of an explicit mapping table')
    expect(prompt).toContain('do not substitute a standalone fact declaration')
    expect(prompt).toContain('complete replacement Markdown')
    expect(prompt).not.toContain('sectionMarkdown')
    expect(prompt).not.toContain('/workspace-secret/.beegame/audit/foundation/revision/revision/docs/GDD.md')
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

  test('projects the complete canonical contract to a document-scope reviser', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'foundation-document-reviser', phase: 'FOUNDATION_REVISION', revision: 'revision', allowedPaths: ['stage.md'],
      contract: {
        scope: 'document', stagedPath: 'stage.md', sectionIds: [],
        packet: {
          scope: 'document', documentPath: 'docs/GDD.md', issueIds: ['issue-1'], sectionIds: [], sections: [], normalizedFacts: [], factConstraints: [],
          issues: [{ id: 'issue-1', expected: 'canonical structure', actual: 'first failure', source: { scope: 'document', documentPath: 'docs/GDD.md' }, remediation: { kind: 'patch', scope: 'document', documentPath: 'docs/GDD.md' } }],
          documentContract: { sections: [{ marker: '<!-- beegame-section:vision -->', heading: '## Vision' }], productionMaterials: { entries: [{ marker: '<!-- beegame-material:core-loop-diagram -->', heading: '### Core Loop Diagram', format: 'mermaid' }] } },
          document: { text: 'DOCUMENT_BYTES_STAY_IN_STAGE' },
        },
      },
    })
    expect(prompt).toContain('packet.documentContract is preservation authority')
    expect(prompt).toContain('Call ReadAssignedFoundationRevision exactly once with {}')
    expect(prompt).toContain('<!-- beegame-section:vision -->')
    expect(prompt).toContain('<!-- beegame-material:core-loop-diagram -->')
    expect(prompt).toContain('Repair only packet.issues')
    expect(prompt).toContain('preservation authority, not a second review checklist')
    expect(prompt).toContain('do not discover or repair unrelated defects')
    expect(prompt).not.toContain('DOCUMENT_BYTES_STAY_IN_STAGE')
  })

  test('rejects a legacy document-scope revision packet without the canonical contract', () => {
    expect(() => buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'foundation-document-reviser', phase: 'FOUNDATION_REVISION', revision: 'revision', allowedPaths: ['stage.md'],
      contract: {
        scope: 'document', stagedPath: 'stage.md', sectionIds: [],
        packet: {
          scope: 'document', documentPath: 'docs/GDD.md', issueIds: ['issue-1'], sectionIds: [], sections: [], normalizedFacts: [], factConstraints: [],
          issues: [{ id: 'issue-1', expected: 'canonical structure', actual: 'first failure', source: { scope: 'document', documentPath: 'docs/GDD.md' }, remediation: { kind: 'patch', scope: 'document', documentPath: 'docs/GDD.md' } }],
        },
      },
    })).toThrow('document-scoped foundation revision worker requires one complete canonical documentContract')
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
      workerType: 'foundation-document-reviser', phase: 'FOUNDATION_REVISION', revision: 'revision', allowedPaths: ['docs/GDD.md'],
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

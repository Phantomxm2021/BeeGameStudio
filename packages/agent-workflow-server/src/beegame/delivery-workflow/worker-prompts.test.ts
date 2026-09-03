import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { buildWorkerPrompt } from './worker-prompts'
import { getGameDocumentContract } from './game-document-contracts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { digestGameIrValue } from './game-ir/model'
import { sourceSectionsForGameIrProjectionSlice } from './game-ir/projection-slice-authority'

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function syntheticProjectionPacket(sliceId = 'gameplay.slice.0') {
  const compileRequest = {
    taskId: 'projection-task',
    foundation: {
      foundationRevision: 'revision',
      receiptDigest: 'r'.repeat(64),
    },
  }
  const selectors = sourceSectionsForGameIrProjectionSlice(sliceId)
  const sectionIndex = selectors.map((selector, index) => {
    const text = `SYNTHETIC_AUTHORITY_${index}`
    return {
      documentPath: selector.documentPath,
      sectionId: selector.sectionId,
      heading: selector.sectionId,
      startLine: index + 1,
      endLine: index + 1,
      digest: createHash('sha256').update(text).digest('hex'),
    }
  })
  return {
    schemaVersion: 'synthetic-projection-packet.v1',
    packetDigest: 'p'.repeat(64),
    source: {
      schemaVersion: 'game-ir-domain-source.v1',
      taskId: compileRequest.taskId,
      moduleId: 'gameplay',
      compileRequest,
      authoritySectionIndex: sectionIndex,
      sectionIndex,
      sectionBytes: Object.fromEntries(
        sectionIndex.map((section, index) => [
          `${section.documentPath}#${section.sectionId}`,
          `SYNTHETIC_AUTHORITY_${index}`,
        ]),
      ),
      sourceDigest: 's'.repeat(64),
    },
    semanticPacket: {},
    projectionContract: { moduleId: 'gameplay', nodes: [], relationships: [], sourceEvidence: {} },
    dependencies: {},
  }
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
        availableUpstreamPaths: [
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
    expect(prompt).not.toContain('availableUpstreamPaths')
  })

  test('passes only the canonical Foundation path namespace and one merge rule to both authoring modes', () => {
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
        expect(prompt).toContain(
          `Canonical Foundation documents: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}`,
        )
        expect(prompt).toContain(
          'Markdown cross-document references may use only these exact canonical Foundation paths',
        )
        const rule = getGameDocumentContract(
          foundationDocumentPath,
        ).mergeReferenceRule
        expect(prompt).toContain(rule)
        expect(countOccurrences(prompt, rule)).toBe(1)
        expect(prompt).not.toContain('docs/UIUX_DESIGN.md')
      }
    }
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
          completeDocumentContract:
            getGameDocumentContract('docs/UI_UX_SPEC.md'),
        },
      })
      const contract = JSON.parse(
        prompt.split('\n').find(line => line.startsWith('{'))!,
      ) as {
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

      expect(
        contract.completeDocumentContract.mechanicalMarkdownProtocol,
      ).toMatchObject({
        closedHeadingSet: expectedH2s,
        additionalH2: 'forbidden',
        supportingContent: 'must be nested under one of the closed H2 headings',
      })
    }
  })

  test('reserves every initial foundation material H3 for the final production section', () => {
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
          authoringMode: 'initial',
          foundationDocumentPath,
          completeDocumentContract: getGameDocumentContract(
            foundationDocumentPath,
          ),
        },
      })
      const serialized = JSON.parse(
        prompt.split('\n').find(line => line.startsWith('{'))!,
      ) as {
        completeDocumentContract: {
          mechanicalMarkdownProtocol: {
            productionMaterials: {
              heading: string
              reservedH3Headings: string[]
              placement: string
            }
          }
        }
      }

      expect(
        serialized.completeDocumentContract.mechanicalMarkdownProtocol
          .productionMaterials,
      ).toMatchObject({
        heading: '## Production Materials',
        reservedH3Headings: getGameDocumentContract(
          foundationDocumentPath,
        ).productionMaterials.map(material => `### ${material.title}`),
        placement:
          'each reserved H3 appears exactly once under the final ## Production Materials heading and never inline in an owning prose section',
      })
      expect(prompt).toContain(
        'Use each reserved production-material H3 exactly once under the final `## Production Materials` heading; never place one inline in an owning prose section',
      )
    }
  })

  test('aligns shared foundation authority instructions across all initial and parallel authors', () => {
    const expectedSharedInstructions = [
      'Use exactly one fact owner across the eight documents:',
      'Define each fact once',
      'Do not restate the confirmed brief or upstream authority',
      'downstream documents may specialize already-authorized behavior but must not redefine upstream rules',
    ]

    let sharedAuthorityInstruction: string | undefined
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
        const authorityStart = prompt.indexOf(
          'Use exactly one fact owner across the eight documents:',
        )
        const authorityEnd =
          prompt.indexOf('must not redefine upstream rules.', authorityStart) +
          'must not redefine upstream rules.'.length
        const authorityInstruction = prompt.slice(authorityStart, authorityEnd)
        expect(authorityInstruction).toContain(
          'Use only this document and the contract-declared committed upstream section projection as content authority.',
        )
        if (sharedAuthorityInstruction === undefined)
          sharedAuthorityInstruction = authorityInstruction
        else expect(authorityInstruction).toBe(sharedAuthorityInstruction)
        expect(prompt).not.toContain('Workspace root:')
        expect(prompt).not.toContain('Writable paths:')
        expect(prompt).not.toContain('Canonical artifacts:')
        expect(prompt).not.toContain('Run: run')
        expect(prompt).not.toContain('Revision: revision')
      }
    }
  })

  test('applies adaptive density and owner-only authority rules to every foundation author', () => {
    const sharedRules = [
      'Judge quality by distinct implementable decisions and traceability, not document length',
      'Use the minimum sufficient headings, tables, rows, diagrams and examples',
      'Do not expand a contract purpose phrase by phrase into H3 headings',
      'Represent each decision in one authoritative prose, table or diagram representation',
      'Do not narrate tables or diagrams',
      'Remove generic best-practice essays, derivations, tutorials, speculative alternatives and boilerplate',
      'Record a genuinely N/A item once with its reason and impact; never invent a system',
      'Do not impose fixed token, word, time, heading, table, row, diagram or example caps or targets',
      'Every material is an owner representation for its declared facts and contains the single canonical representation',
    ]
    const rules = {
      'docs/GDD.md':
        'Behavior, state and gameplay rules are authoritative here; numeric values only declare Balance ownership and do not create a duplicate parameter table.',
      'docs/LEVEL_SCENE_DESIGN.md':
        'One canonical coordinate/layout source owns coordinate, path, slot and trigger literals; other tables and diagrams reference it without duplicating them.',
      'docs/BALANCE_DESIGN.md':
        'The variable-parameter-table uniquely owns all numeric `var.*` and `param.*` IDs, units, values and ranges; Units/Variables and Entity/Ability Parameters sections retain only semantic context and relationships, while formulas, economy, progression and tuning facts remain in their owning sections.',
      'docs/TECHNICAL_DESIGN.md':
        'Cover runtime and data boundaries only; do not repeat gameplay, write tutorials or include large pseudocode blocks.',
      'docs/ART_DIRECTION.md':
        'Own visual language and visual acceptance conditions; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/UI_UX_SPEC.md':
        'One canonical responsive geometry/layout source owns layout; wireframes and flows reference it without repeating the screen-state catalog.',
      'docs/AUDIO_DESIGN.md':
        'Audio owns event-to-cue behavior and technical acceptance; Asset Plan owns resource IDs, production responsibility, sourcing, licensing and schedule facts.',
      'docs/ASSET_PLAN.md':
        'Asset materials share inventory IDs as their common key while each owns a distinct fact domain: inventory identity and semantic requirement mappings, responsibility, dependency/integration, source/licensing evidence, or milestone/maturity status.',
    } as const

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
        for (const rule of sharedRules) expect(prompt).toContain(rule)
        expect(prompt).toContain(rules[foundationDocumentPath])
        expect(countOccurrences(prompt, rules[foundationDocumentPath])).toBe(1)
        expect(prompt).toContain('complete raw Markdown body')
        expect(prompt).toContain('Do not call tools, return JSON')
        expect(prompt).toContain(
          'The Executive Summary indexes authority, while each material owns the facts declared by its serialized authority rule',
        )
        expect(prompt).not.toContain('authorityMode')
        expect(prompt).not.toContain('reference-only')
        expect(prompt).not.toContain('reference_only')
        expect(prompt).not.toContain('derived view')
        expect(prompt).not.toContain('parallel-author')
        expect(prompt).not.toContain('All Production Materials are derived')
        expect(
          countOccurrences(
            prompt,
            'Record a genuinely N/A item once with its reason and impact',
          ),
        ).toBe(1)
        expect(prompt).toContain(
          'Before returning, silently perform this internal closure check',
        )
        expect(prompt).toContain(
          'every H2 in mechanicalMarkdownProtocol.closedHeadingSet appears in order and exactly once',
        )
        expect(prompt).toContain(
          'every productionMaterials.entries H3 appears in order and exactly once',
        )
        expect(prompt).toContain(
          'retain every required heading for N/A content and state its reason and impact',
        )
        expect(prompt).toContain('do not output a check report')
        expect(prompt).not.toContain(
          'do not add a redundant final verification',
        )
        expect(prompt).not.toContain('strict_structured_block_payload')
        expect(prompt).not.toContain('native StructuredOutput object')
      }
    }
  })

  test('requires each material to contain one canonical owner representation', () => {
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

    expect(prompt).toContain('The Executive Summary indexes authority')
    expect(prompt).toContain(
      'Every material is an owner representation for its declared facts and contains the single canonical representation',
    )
    expect(prompt).toContain('one complete raw Markdown body')
    expect(prompt).toContain('one representation per fact')
    expect(prompt).not.toContain('authorityMode')
    expect(prompt).not.toContain('reference-only')
    expect(prompt).not.toContain('reference_only')
    expect(prompt).not.toContain('derived view')
    expect(prompt).not.toContain('parallel-author')
    expect(prompt).not.toContain('All Production Materials are derived')
  })

  test('serializes each material authority once for both raw-Markdown author modes', () => {
    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      for (const foundationDocumentPath of CANONICAL_FOUNDATION_DOCUMENTS) {
        const contract = getGameDocumentContract(foundationDocumentPath)
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
            completeDocumentContract: contract,
          },
        })

        expect(prompt).toContain('complete raw Markdown body')
        expect(prompt).toContain(
          'Every material is an owner representation for its declared facts and contains the single canonical representation',
        )
        expect(prompt).toContain('use one representation per fact')
        expect(prompt).toContain(
          'Record a genuinely N/A item once with its reason and impact',
        )
        expect(prompt).not.toContain('authorityMode')
        expect(prompt).not.toContain('reference-only')
        expect(prompt).not.toContain('reference_only')
        expect(prompt).not.toContain('derived view')
        for (const material of contract.productionMaterials) {
          expect(countOccurrences(prompt, material.authorityRule)).toBe(1)
          expect(
            countOccurrences(
              prompt,
              `"authorityRule":"${material.authorityRule}"`,
            ),
          ).toBe(1)
        }
      }
    }
  })

  test('derives one Markdown-table serialization rule for the evidence register', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision',
      allowedPaths: ['docs/ASSET_PLAN.md'],
      contract: {
        documentSet: 'foundation',
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/ASSET_PLAN.md',
        completeDocumentContract: getGameDocumentContract('docs/ASSET_PLAN.md'),
      },
    })
    const serialized = JSON.parse(
      prompt.split('\n').find(line => line.startsWith('{'))!,
    ) as {
      completeDocumentContract: {
        mechanicalMarkdownProtocol: {
          productionMaterials: {
            entries: Array<{
              materialId: string
              format: string
              serialization: string
              serializationRule?: string
            }>
          }
        }
      }
    }
    const licenseRegister =
      serialized.completeDocumentContract.mechanicalMarkdownProtocol.productionMaterials.entries.find(
        material => material.materialId === 'license-register',
      )

    expect(licenseRegister).toMatchObject({
      format: 'evidence_register',
      serialization: 'markdown_table',
    })
    expect(licenseRegister?.serializationRule).toContain('Markdown table only')
    expect(licenseRegister?.serializationRule).toContain('header row')
    expect(licenseRegister?.serializationRule).toContain('separator row')
    expect(licenseRegister?.serializationRule).toContain(
      'do not use a fenced code block',
    )
    expect(licenseRegister?.serializationRule).toContain('key-value list')
  })

  test('uses the same committed projection instruction regardless of upstream paths', () => {
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
      'Use only this document and the contract-declared committed upstream section projection as content authority.',
    )
    expect(prompt).not.toContain('unavailable upstream')
    expect(prompt).not.toContain('classify freshness')
  })

  test('keeps owner guidance concise without a Markdown semantic parser contract', () => {
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
        expect(prompt).toContain(
          'Define each fact once and use one representation per fact',
        )
        expect(prompt).toContain(
          'Delegate responsibilities to a not-yet-generated downstream document by its canonical `Document Path` and discipline in ordinary Markdown',
        )
        expect(prompt).toContain(
          'do not invent downstream facts, material IDs or inventory IDs',
        )
        expect(prompt).toContain(
          'do not create aliases, placeholders or alternate spellings',
        )
        expect(prompt).not.toContain('Use two ID classes')
        expect(prompt).not.toContain('reference-column')
        expect(prompt).not.toContain('Mermaid dotted labels')
        expect(prompt).not.toContain('symbol table')
        expect(prompt).not.toContain('authorityMode')
        expect(prompt).not.toContain('reference-only')
        expect(prompt).not.toContain('reference_only')
        expect(prompt).not.toContain('derived view')
      }
    }
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

    expect(prompt).toContain(
      'distinct, independently observable acceptance condition explicitly present in a SCENARIO block',
    )
    expect(prompt).toContain(
      'Do not expand sentences, table rows, variants, prior checklist entries, or generic best practice',
    )
    expect(
      countOccurrences(
        prompt,
        'Author only the Checklist candidate at docs/acceptance/gameplay-checklist.md',
      ),
    ).toBe(1)
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

    expect(prompt).toContain(
      '"outputPolicy":{"sectionStyle":"final_owned_decisions"',
    )
    expect(prompt).toContain(
      'Complete every required section and production material',
    )
    expect(prompt).not.toContain(
      'Production materials are canonical compact views of owned decisions and must not repeat section narrative.',
    )
    expect(prompt).not.toContain(
      'Use no more than one worked example per formula or system boundary',
    )
    expect(prompt).not.toContain(
      'Include only materially distinct boundary and acceptance scenarios; do not enumerate equivalent cases.',
    )
  })

  test('does not ask foundation models to echo service-owned terminal identity', () => {
    for (const workerType of [
      'foundation-fact-extractor',
      'foundation-semantic-reviewer',
    ] as const) {
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
          modelTier:
            workerType === 'foundation-fact-extractor' ? 'fast' : 'balanced',
        },
      })
      const terminalInstruction = prompt
        .split('\n')
        .find(line =>
          line.startsWith('Return exactly one native StructuredOutput'),
        )
      expect(terminalInstruction).toBeDefined()
      for (const serviceOwnedField of [
        'runId',
        'dispatchId',
        'taskId',
        'revision',
        'packetDigest',
      ])
        expect(terminalInstruction).not.toContain(serviceOwnedField)
    }
  })

  test('keeps packet workers on the immutable packet-only contract', () => {
    for (const workerType of [
      'foundation-fact-extractor',
      'foundation-semantic-reviewer',
    ] as const) {
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
            keys:
              workerType === 'foundation-fact-extractor'
                ? ['asset.covered_level_requirements']
                : [],
            sections: [],
            packetDigest: 'a'.repeat(64),
          },
          modelTier:
            workerType === 'foundation-fact-extractor' ? 'fast' : 'balanced',
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
      expect(prompt).toContain('model contract is the sole input')
      expect(prompt).toContain('Model packet contract')
      expect(
        countOccurrences(prompt, 'The model contract is the sole input'),
      ).toBe(1)
      expect(countOccurrences(prompt, 'Do not read project files')).toBe(1)
      expect(
        countOccurrences(prompt, 'Return only the strict structured result'),
      ).toBe(1)
      expect(prompt).toContain('"workerType":"' + workerType + '"')
      expect(prompt).not.toContain('"taskId":"task"')
      expect(prompt).not.toContain('"revision":"revision"')
      expect(prompt).not.toContain(`"packetDigest":"${'a'.repeat(64)}"`)
      if (workerType === 'foundation-fact-extractor') {
        expect(prompt).toContain('asset.covered_level_requirements')
        expect(prompt).toContain(
          'present requires key, status, and value; omit evidence and reason',
        )
        expect(prompt).toContain(
          'Absent requires only key and status and must omit value, evidence, and reason',
        )
        expect(prompt).toContain(
          'Uncertain requires key, status, and reason; omit evidence and value',
        )
        expect(prompt).toContain('service binds immutable provenance')
        expect(prompt).toContain(
          'left side of an explicit AssetPlan inventory mapping table',
        )
        expect(prompt).toContain(
          'never copy, transform, or infer values from asset.inventory_ids',
        )
        expect(
          countOccurrences(prompt, 'service binds immutable provenance'),
        ).toBe(1)
        expect(countOccurrences(prompt, 'Do not call project tools')).toBe(0)
      } else {
        expect(prompt).toContain('PASS omits issues and reason')
        expect(prompt).toContain(
          'ISSUES includes a non-empty issues array and omits reason',
        )
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
    expect(prompt).toContain(
      'your own supported PASS, ISSUES, or UNDECIDABLE outcome',
    )
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

    expect(
      countOccurrences(
        prompt,
        'BeeGame delivery worker: foundation-fact-extractor',
      ),
    ).toBe(1)
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

    expect(prompt).toContain(
      'remediation must be exactly {"kind":"patch","sectionKeys":["..."]}',
    )
    expect(prompt).toContain('{"kind":"patch","sectionKeys":["..."]}')
    expect(prompt).toContain('Do not wrap the result in `params` or add fields')
    expect(prompt).toContain(
      'All patch sectionKeys must belong to the same canonical document; never mix document prefixes in one patch',
    )
    expect(prompt).toContain(
      'If a conflict spans documents, split it into separate Issues with independent single-document patch authority',
    )
    expect(prompt).toContain(
      'Source of Truth order GDD > Technical > Level/Balance/UI/Art > Asset Plan',
    )
    expect(prompt).toContain(
      'Choose that repair directly; never request a user choice or preserve alternatives',
    )
    expect(prompt).toContain(
      'A wording-only rewrite, synonym, alias, compatibility note, qualification, or restatement is not a repair',
    )
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
          sections: [
            {
              ref: {
                documentPath: 'docs/GDD.md',
                sectionId: 'states_flow',
                heading: 'States',
                startLine: 1,
                endLine: 3,
                digest: 'b'.repeat(64),
              },
              text: 'STATE_SECTION_SENTINEL',
            },
          ],
          patchOperation: {
            kind: 'REPLACE',
            documentPath: 'docs/GDD.md',
            sectionId: 'states_flow',
            beforeDigest: 'c'.repeat(64),
            afterDigest: 'd'.repeat(64),
          },
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
          issues: [
            {
              id: 'issue-1',
              severity: 'HIGH',
              type: 'semantic',
              source: {
                documentPath: 'docs/GDD.md',
                sectionId: 'section-1',
                heading: 'Section',
                startLine: 1,
                endLine: 2,
                digest: 'b'.repeat(64),
              },
              expected: 'expected condition',
              actual: 'actual condition',
              remediation: {
                kind: 'patch',
                documentPath: 'docs/GDD.md',
                sectionIds: ['section-1'],
              },
            },
          ],
          sections: [
            {
              documentPath: 'docs/GDD.md',
              sectionId: 'section-1',
              heading: 'Section',
              startLine: 1,
              endLine: 2,
              digest: 'b'.repeat(64),
              text: 'IMMUTABLE_PACKET_SENTINEL',
            },
          ],
          factConstraints: [
            {
              key: 'asset.covered_level_requirements',
              owner: {
                documentPath: 'docs/ASSET_PLAN.md',
                sectionId: 'inventory',
              },
              valueType: 'string[]',
              extractionInstruction:
                'Read only labels on the left side of an explicit mapping table.',
              sourceOfTruthDirection:
                'LEVEL owns requirements; ASSET_PLAN maps them to inventory.',
            },
          ],
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
    expect(prompt).toContain(
      'packet sectionIds are the complete write authority',
    )
    expect(prompt).toContain(
      'related, risk, consistency, dependency, and production-material sections',
    )
    expect(prompt).toContain(
      'Automatic retry after the previous strict validation failure: revision changed an unauthorized section',
    )
    expect(prompt).not.toContain('changedSectionIds')
    expect(prompt).toContain('factConstraints')
    expect(prompt).toContain('left side of an explicit mapping table')
    expect(prompt).toContain('do not substitute a standalone fact declaration')
    expect(prompt).toContain(
      'Unmarked Production Materials and audit appendices are outside the packet authority',
    )
    expect(prompt).toContain(
      '/workspace-secret/.beegame/audit/foundation/revision/revision/docs/GDD.md',
    )
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
        revision: 'revision',
        packetDigest: 'a'.repeat(64),
        modelTier: 'balanced',
        packet: {
          revision: 'revision',
          checkId: 'SEM.test',
          manifestDigest: 'b'.repeat(64),
          fullSectionIndexDigest: 'c'.repeat(64),
          fullFactStoreDigest: 'd'.repeat(64),
          deterministicReviewDigest: 'e'.repeat(64),
          selectedDeterministicPrefixDigest: 'f'.repeat(64),
          identity: 'g'.repeat(64),
          bytes: 999,
          context: { fresh: true, resume: false, sessionId: null },
          sections: [
            {
              sectionKey: 'GDD#loop',
              ref: {
                documentPath: 'docs/GDD.md',
                sectionId: 'loop',
                startLine: 3,
                endLine: 8,
                digest: 'h'.repeat(64),
              },
              bytes: 'FULL_SECTION_SENTINEL',
            },
          ],
          facts: [
            {
              key: 'game.loop',
              value: 'loop',
              source: {
                documentPath: 'docs/GDD.md',
                sectionId: 'loop',
                startLine: 3,
                endLine: 8,
                digest: 'i'.repeat(64),
              },
              evidence: {
                documentPath: 'docs/GDD.md',
                sectionId: 'loop',
                startLine: 4,
                endLine: 4,
                digest: 'j'.repeat(64),
              },
            },
          ],
          deterministicIssuePrefix: [],
        },
      },
    })

    expect(prompt).toContain('FULL_SECTION_SENTINEL')
    expect(prompt).toContain('"checkId":"SEM.test"')
    for (const marker of [
      'manifestDigest',
      'fullSectionIndexDigest',
      'fullFactStoreDigest',
      'deterministicReviewDigest',
      'selectedDeterministicPrefixDigest',
      'identity',
      'bytes',
      '"context"',
      'startLine',
      'endLine',
      'digest',
      'packetDigest',
    ])
      expect(prompt).not.toContain(marker)
    expect(prompt).toContain('"documentPath":"docs/GDD.md"')
    expect(prompt).toContain('"sectionId":"loop"')
  })

  test('fails closed when packet evidence cannot be projected', () => {
    expect(() =>
      buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'foundation-semantic-reviewer',
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision',
        allowedPaths: [],
        contract: {
          packet: {
            sections: [{ sectionKey: 'GDD#loop', bytes: 'missing-ref' }],
            facts: [],
            deterministicIssuePrefix: [],
          },
        },
      }),
    ).toThrow(/model-facing semantic section item 0 is invalid/)

    expect(() =>
      buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'foundation-document-reviser',
        phase: 'DOCUMENT_REVIEW',
        revision: 'revision',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          stagedPath: 'docs/GDD.md',
          packet: {
            documentPath: 'docs/GDD.md',
            sectionIds: ['loop'],
            issues: [{ id: 'issue', expected: 'e', actual: 'a' }],
            sections: [],
            normalizedFacts: [],
          },
        },
      }),
    ).toThrow(/model-facing revision issue item 0 is invalid/)
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

  test('projects a Game IR projection packet to selected Markdown authority', () => {
    const packet = syntheticProjectionPacket()
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: {
          availablePriorNodes: [],
          requiredCurrentNodes: [{ id: 'state-start', kind: 'gameplay.state' }],
          admittedCurrentNodes: [{ id: 'state-admitted', kind: 'gameplay.state' }],
        },
        packet,
      },
    })
    expect(prompt).toContain('model contract is the sole input')
    expect(prompt).toContain('current dependency-frontier slice')
    expect(prompt).not.toContain('correctionDiagnostic')
    expect(prompt).toContain('SYNTHETIC_AUTHORITY_0')
    expect(prompt).toContain('state-admitted')
    expect(prompt).toContain('strictly after the final admitted current-prefix ID')
    expect(prompt).not.toContain('authoritySectionIndex')
    expect(prompt).not.toContain('semanticPacket')
    expect(prompt).not.toContain('packetDigest')
  })

  test('uses unambiguous edge rules and declares the durable edge DTO in the model contract', () => {
    const packet = syntheticProjectionPacket('gameplay.slice.1')
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.1',
        sliceContext: {
          availablePriorNodes: [],
          requiredCurrentNodes: [],
          admittedCurrentNodes: [],
        },
        packet,
      },
    })
    expect(prompt).toContain('SELECTED_AUTHORITY')
    expect(prompt).toContain('causes')
    expect(prompt).toContain('triggered-by')
    expect(prompt).toContain('edgeRules')
    expect(prompt).toContain(
      'edges[].type, edges[].targetId, and edges[].targetType',
    )
    expect(prompt).toContain('referencePolicy')
    expect(prompt).toContain('exact-edge-targets')
    expect(prompt).toContain('exact-single-index-reference')
    expect(prompt).toContain('formula-indexed-references')
    expect(prompt).toContain('indexedReferences')
    expect(prompt).toContain('ensure every reference is consumed')
    expect(prompt).toContain('requiredIndex')
    expect(prompt).not.toContain('projectionContract exposes relationships')
  })

  test('projects validation packets to candidate, source evidence, target and check data', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        kind: 'validation',
        correctionDiagnostic: {
          step: 'phase5/world-scene/validation',
          reason: 'prior validation output was incomplete',
        },
        packet: {
          schemaVersion: 'game-ir-world-scene-semantic-validation-packet.v1',
          packetDigest: 'a'.repeat(64),
          taskId: 'task',
          foundationRevision: 'rev',
          foundationReceiptDigest: 'b'.repeat(64),
          compileRequest: { taskId: 'task' },
          compileRequestDigest: 'c'.repeat(64),
          sourceDigest: 'd'.repeat(64),
          mechanicalReceiptDigest: 'e'.repeat(64),
          semanticReceiptDigest: 'f'.repeat(64),
          authoritySectionIndexDigest: '1'.repeat(64),
          authoritySectionIndex: [],
          sourceSections: [
            {
              ref: {
                documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
                sectionId: 'layout',
                heading: 'Layout',
                startLine: 1,
                endLine: 2,
                digest: '2'.repeat(64),
              },
              bytes: 'LEVEL_LAYOUT_SENTINEL',
            },
          ],
          priorModules: [
            {
              moduleId: 'gameplay',
              nodes: [
                {
                  id: 'state-start',
                  kind: 'gameplay.state',
                  value: { label: 'Start' },
                  references: [],
                  edges: [],
                },
              ],
            },
          ],
          moduleId: 'world-scene',
          moduleBytes: '{"moduleId":"world-scene","nodes":[]}',
          moduleDigest: '3'.repeat(64),
          targetManifestDigest: '4'.repeat(64),
          checkIds: ['projection.fidelity'],
          requiredTargets: ['world-scene.scene'],
          allowedEvidencePointers: [
            'section:docs/LEVEL_SCENE_DESIGN.md#layout@' + '2'.repeat(64),
          ],
        },
      },
    })
    const contract = JSON.parse(
      prompt
        .split('\n')
        .find(line => line.startsWith('Model packet contract: '))!
        .slice('Model packet contract: '.length),
    ) as Record<string, unknown> & { packet: Record<string, unknown> }
    expect(contract.packet).toEqual({
      candidate: {
        moduleId: 'world-scene',
        moduleBytes: '{"moduleId":"world-scene","nodes":[]}',
      },
      sourceSections: [
        {
          documentPath: 'docs/LEVEL_SCENE_DESIGN.md',
          sectionId: 'layout',
          heading: 'Layout',
          bytes: 'LEVEL_LAYOUT_SENTINEL',
        },
      ],
      priorModules: [
        {
          moduleId: 'gameplay',
          nodes: [
            {
              id: 'state-start',
              kind: 'gameplay.state',
              value: { label: 'Start' },
              references: [],
              edges: [],
            },
          ],
        },
      ],
      checkIds: ['projection.fidelity'],
      requiredTargets: ['world-scene.scene'],
      allowedEvidencePointers: [
        'section:docs/LEVEL_SCENE_DESIGN.md#layout@' + '2'.repeat(64),
      ],
    })
    expect(prompt).toContain('Perform only the assigned domain validation')
    expect(prompt).toContain(
      'correctionDiagnostic is present, use it only to correct the current operation output',
    )
    expect(prompt).not.toContain('service owns the slice cursor')
    expect(contract.correctionDiagnostic).toEqual({
      step: 'phase5/world-scene/validation',
      reason: 'prior validation output was incomplete',
    })
    expect(prompt).not.toContain('compileRequestDigest')
    expect(prompt).not.toContain('authoritySectionIndex')
    expect(prompt).not.toContain('moduleDigest')
    expect(prompt).not.toContain('targetManifestDigest')
  })

  test('projects Game IR slices as compact Markdown authority', () => {
    const packet = syntheticProjectionPacket()
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: { availablePriorNodes: [], requiredCurrentNodes: [], admittedCurrentNodes: [] },
        compileRequestDigest: digestGameIrValue(packet.source.compileRequest),
        foundationReadyReceiptDigest: packet.source.compileRequest.foundation.receiptDigest,
        packet,
      },
    })
    expect(prompt).toContain('SELECTED_AUTHORITY')
    expect(prompt).toContain('## Output contract')
    expect(prompt).toContain('SYNTHETIC_AUTHORITY_0')
    for (const forbidden of [
      'authoritySectionIndex',
      'sectionBytes',
      'packetDigest',
      'semanticPacket',
      'FORBIDDEN_FULL_PACKET_MARKER',
    ])
      expect(prompt).not.toContain(forbidden)
  })

  test('describes Markdown authority headings instead of the removed JSON projection fields', () => {
    const packet = syntheticProjectionPacket()
    const prompt = buildWorkerPrompt({
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath: '/workspace',
      workerType: 'game-ir-compiler',
      phase: 'GAME_IR_COMPILATION',
      revision: 'revision',
      allowedPaths: [],
      contract: {
        kind: 'projection',
        currentSlice: 'gameplay.slice.0',
        sliceContext: { availablePriorNodes: [], requiredCurrentNodes: [], admittedCurrentNodes: [] },
        packet,
      },
    })
    expect(prompt).toContain('## Current slice')
    expect(prompt).toContain('## Dependency context')
    expect(prompt).toContain('## Source fragments')
    expect(prompt).not.toContain('currentSlice.retryDiagnostic')
    expect(prompt).not.toContain('dependencyContext')
    expect(prompt).not.toContain('source.sections[].evidenceFragments')
  })

  test('accepts a legal record retry even when its ID is not a required current node', () => {
    const packet = syntheticProjectionPacket()
    const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        revision: 'revision',
        allowedPaths: [],
        contract: {
          kind: 'projection',
          currentSlice: 'gameplay.slice.0',
          sliceContext: { availablePriorNodes: [], requiredCurrentNodes: [], admittedCurrentNodes: [] },
          retryDiagnostic: {
            scope: 'record',
            sliceId: 'gameplay.slice.0',
            recordId: 'state-start',
            fragmentId: 'e0.0',
            reason: 'record failed',
          },
          packet,
        },
      })
    expect(prompt).toContain('state-start')
  })

  test('rejects unknown, extra, empty, and mismatched retry diagnostics', () => {
    const packet = syntheticProjectionPacket()
    const buildWithRetry = (retryDiagnostic: Record<string, unknown>) =>
      buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        revision: 'revision',
        allowedPaths: [],
        contract: {
          kind: 'projection',
          currentSlice: 'gameplay.slice.0',
          sliceContext: { availablePriorNodes: [], requiredCurrentNodes: [], admittedCurrentNodes: [] },
          retryDiagnostic,
          packet,
        },
      })
    for (const retryDiagnostic of [
      { scope: 'unknown', sliceId: 'gameplay.slice.0', reason: 'failed' },
      {
        scope: 'slice',
        sliceId: 'gameplay.slice.0',
        reason: 'failed',
        extra: true,
      },
      {
        scope: 'record',
        sliceId: 'gameplay.slice.0',
        recordId: '',
        fragmentId: 'e0.0',
        reason: 'failed',
      },
      { scope: 'slice', sliceId: 'gameplay.slice.1', reason: 'failed' },
    ])
      expect(() => buildWithRetry(retryDiagnostic)).toThrow(
        /retry diagnostic is invalid/,
      )
  })
})

import { describe, expect, test } from 'bun:test'
import { toJSONSchema } from 'zod/v4'
import { createNativeWorkflowResultTool } from './native-workflow-result-tools'
import { buildDocumentReviewReferenceIndex } from './delivery-workflow/document-review-input'
import {
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA,
} from './delivery-workflow/types'
import { documentReviewPacketSubmissionSchemaForContract } from './delivery-workflow/worker-contracts'

const finding = {
  findingId: 'CONTRACT-1',
  checkId: 'technical_feasibility' as const,
  severity: 'blocking' as const,
  owner: 'foundation' as const,
  evidence: [{ path: 'systemDeliveryContract', anchor: '/roots/content' }],
  subjects: [{ path: 'docs/TECHNICAL_DESIGN.md', anchor: 'Resources' }],
  observation: 'The documented delivery root conflicts with system authority.',
  blockingImpact: 'Implementation would have two content roots.',
  requiredOutcome: 'The document defines only the canonical root.',
}
function submission(
  systemReferenceId = 'ref-system',
  documentReferenceId = 'ref-document',
) {
  return {
    conclusion: 'The project contract conflicts with system authority.',
    evidence: [
      { referenceId: systemReferenceId },
      { referenceId: documentReferenceId },
    ],
    assessments: [],
    findings: [
      {
        findingId: finding.findingId,
        evidence: [{ referenceId: systemReferenceId }],
        subjects: [{ referenceId: documentReferenceId }],
        observation: finding.observation,
        blockingImpact: finding.blockingImpact,
        requiredOutcome: finding.requiredOutcome,
      },
    ],
  }
}

describe('native document review result tool', () => {
  test('exposes the complete packet item contract to the model JSON Schema', () => {
    const schema = toJSONSchema(
      documentReviewPacketSubmissionSchemaForContract({
        mode: 'initial',
        scope: 'foundation',
        currentCheckIds: [
          'gameplay_strategy_viability',
          'economy_progression_integrity',
        ],
      }),
    ) as Record<string, any>
    const item = schema.properties.checks.items
    expect(Object.keys(item.properties)).toEqual([
      'conclusion',
      'evidence',
      'assessments',
      'findings',
    ])
    expect(Object.keys(item.properties.assessments.items.properties)).toEqual([
      'criterion',
      'status',
      'evidence',
      'derivation',
      'conclusion',
    ])
    expect(item.properties.assessments.items.properties.criterion.enum).toEqual(
      expect.arrayContaining(['meaningful_choices', 'sources_and_sinks']),
    )
    expect(
      item.properties.assessments.items.properties.criterion.enum,
    ).toContain('outcome_bounds')
    expect(Object.keys(item.properties.findings.items.properties)).toEqual([
      'findingId',
      'evidence',
      'subjects',
      'observation',
      'blockingImpact',
      'requiredOutcome',
      'regressionPaths',
    ])
  })

  test('requires the durable Reviewer contract before exposing the tool', () => {
    expect(() =>
      createNativeWorkflowResultTool({
        workerType: 'document-reviewer',
        buildTool(value) {
          return value
        },
      }),
    ).toThrow('document reviewer submission contract is missing')
  })

  test('accepts every check against its explicit durable contract', async () => {
    const artifacts = [
      { path: 'reviewAuthority', content: 'Confirmed brief' },
      {
        path: 'systemDeliveryContract',
        content: '{"roots":{"content":"assets/content"}}\n',
      },
      { path: 'docs/GDD.md', content: '# Rules\n' },
    ]
    const references = buildDocumentReviewReferenceIndex(artifacts).references
    const authorityReferenceId = references.find(
      reference => reference.path === 'reviewAuthority',
    )!.referenceId
    const systemReferenceId = references.find(
      reference => reference.path === 'systemDeliveryContract',
    )!.referenceId
    const systemChecks = new Set([
      'cross_document_consistency',
      'technical_feasibility',
      'content_structure_fitness',
      'resource_content_consistency',
    ])
    for (const atomicCheckId of COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS) {
      let definition: Record<string, unknown> | undefined
      const evidenceReferenceId = systemChecks.has(atomicCheckId)
        ? systemReferenceId
        : authorityReferenceId
      const criteria =
        GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[
          atomicCheckId as keyof typeof GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA
        ] ?? []
      createNativeWorkflowResultTool({
        workerType: 'document-reviewer',
        documentReviewContract: {
          scope: 'complete',
          mode: 'initial',
          requiredCheckIds: [...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS],
          currentCheckIds: [atomicCheckId],
          artifacts,
        },
        buildTool(value) {
          definition = value
          return value
        },
      })
      const call = definition!.call as (value: unknown) => Promise<unknown>
      await expect(
        call({
          checks: [
            {
              ...(criteria.length
                ? {}
                : {
                    conclusion: 'The active check passes.',
                    evidence: [{ referenceId: evidenceReferenceId }],
                  }),
              assessments: criteria.map(criterion => ({
                criterion,
                status: 'pass',
                evidence: [{ referenceId: authorityReferenceId }],
                derivation: 'The cited authority supports this criterion.',
                conclusion: 'The criterion passes.',
              })),
              findings: [],
            },
          ],
        }),
      ).resolves.toEqual({
        data: { accepted: true, workerType: 'document-reviewer' },
      })
    }
  })

  test('accepts the two bounded gameplay review packets and rejects each packet atomically', async () => {
    const artifacts = [
      { path: 'reviewAuthority', content: 'Confirmed brief' },
      { path: 'docs/GDD.md', content: '# Rules\n' },
      { path: 'docs/LEVEL_SCENE_DESIGN.md', content: '# Levels\n' },
      { path: 'docs/BALANCE_DESIGN.md', content: '# Balance\n' },
    ]
    const referenceId = buildDocumentReviewReferenceIndex(
      artifacts,
    ).references.find(
      reference => reference.path === 'docs/GDD.md',
    )!.referenceId
    const packets = [
      ['gameplay_strategy_viability', 'economy_progression_integrity'],
      ['numeric_balance_feasibility', 'pacing_difficulty_coherence'],
    ] as const
    for (const currentCheckIds of packets) {
      let definition: Record<string, unknown> | undefined
      createNativeWorkflowResultTool({
        workerType: 'document-reviewer',
        documentReviewContract: {
          scope: 'foundation',
          mode: 'initial',
          requiredCheckIds: [...currentCheckIds],
          currentCheckIds: [...currentCheckIds],
          artifacts,
        },
        buildTool(value) {
          definition = value
          return value
        },
      })
      const checks = currentCheckIds.map(checkId => ({
        assessments: GAME_DESIGN_DOCUMENT_REVIEW_CRITERIA[checkId].map(
          criterion => ({
            criterion,
            status: 'pass' as const,
            evidence: [{ referenceId }],
            derivation: 'The cited authority supports this criterion.',
            conclusion: 'The criterion passes.',
          }),
        ),
        findings: [],
      }))
      const call = definition!.call as (value: unknown) => Promise<unknown>
      const firstAssessment = checks[0]!.assessments[0]!
      await expect(
        call({
          checks: [
            {
              ...checks[0],
              assessments: [
                {
                  criterion: firstAssessment.criterion,
                  result: firstAssessment.status,
                  evidence: [
                    { referenceId, note: 'This field is not canonical.' },
                  ],
                  derivation: firstAssessment.derivation,
                },
                ...checks[0]!.assessments.slice(1),
              ],
            },
            checks[1]!,
          ],
        }),
      ).rejects.toThrow()
      await expect(
        call({
          checks: checks.map((check, index) =>
            index === 1 ? { ...check, assessments: [] } : check,
          ),
        }),
      ).rejects.toThrow()
      await expect(call({ checks })).resolves.toEqual({
        data: { accepted: true, workerType: 'document-reviewer' },
      })
      await expect(
        call({
          checks: checks.map(check => ({
            ...check,
            assessments: check.assessments.map(assessment => ({
              ...assessment,
              derivation: assessment.derivation.repeat(250),
            })),
          })),
        }),
      ).resolves.toEqual({
        data: { accepted: true, workerType: 'document-reviewer' },
      })
    }
  })

  test('rejects an invalid exact anchor before accepted and allows correction in the same tool turn', async () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts: [
          {
            path: 'systemDeliveryContract',
            content: '{"roots":{"content":"assets/content"}}\n',
          },
          {
            path: 'docs/TECHNICAL_DESIGN.md',
            content: '### Resources\n',
          },
        ],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const call = definition!.call as (value: unknown) => Promise<unknown>
    const artifacts = [
      {
        path: 'systemDeliveryContract',
        content: '{"roots":{"content":"assets/content"}}\n',
      },
      { path: 'docs/TECHNICAL_DESIGN.md', content: '### Resources\n' },
    ]
    const references = buildDocumentReviewReferenceIndex(artifacts).references
    const systemRef = references.find(
      item => item.anchor === '/roots/content',
    )!.referenceId
    const documentRef = references.find(
      item => item.path === 'docs/TECHNICAL_DESIGN.md',
    )!.referenceId
    await expect(
      call({ checks: [submission(systemRef, 'ref-unknown')] }),
    ).rejects.toThrow('unknown document review referenceId')

    const corrected = submission(systemRef, documentRef)
    await expect(call({ checks: [corrected] })).resolves.toEqual({
      data: { accepted: true, workerType: 'document-reviewer' },
    })
  })

  test('keeps one fixed schema while rejecting Closure fields in Initial Review', async () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts: [],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const schema = definition!.inputSchema as { parse(value: unknown): unknown }
    const value = {
      checks: [
        {
          ...submission(),
          findings: [
            {
              ...submission().findings[0],
              regressionPaths: ['docs/TECHNICAL_DESIGN.md'],
            },
          ],
        },
      ],
    }
    expect(() => schema.parse(value)).not.toThrow()
    const call = definition!.call as (value: unknown) => Promise<unknown>
    await expect(call(value)).rejects.toThrow()
    const prompt = await (definition!.prompt as () => Promise<string>)()
    expect(prompt).toContain(
      'Initial Review findings cannot contain regressionPaths',
    )
    expect(prompt).toContain('A rejected call accepts nothing')
    expect(prompt).toContain('referenceId')
  })

  test('exposes regression paths only for Closure Review', () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'complete',
        mode: 'closure',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts: [],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const schema = definition!.inputSchema as { parse(value: unknown): unknown }
    expect(
      schema.parse({
        checks: [
          {
            ...submission(),
            findings: [
              {
                ...submission().findings[0],
                regressionPaths: ['docs/TECHNICAL_DESIGN.md'],
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      checks: [
        { findings: [{ regressionPaths: ['docs/TECHNICAL_DESIGN.md'] }] },
      ],
    })
  })

  test('accepts an unresolved prior ID only with its immutable Closure identity', async () => {
    const artifacts = [
      {
        path: 'systemDeliveryContract',
        content: '{"roots":{"content":"assets/content"}}\n',
      },
      { path: 'docs/TECHNICAL_DESIGN.md', content: '### Resources\n' },
    ]
    const references = buildDocumentReviewReferenceIndex(artifacts).references
    const systemReferenceId = references.find(
      item => item.anchor === '/roots/content',
    )!.referenceId
    const documentReferenceId = references.find(
      item => item.path === 'docs/TECHNICAL_DESIGN.md',
    )!.referenceId
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'closure',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts,
        activeTarget: 'foundation',
        priorFindings: [{ ...finding, open: true }],
        changedPaths: ['docs/TECHNICAL_DESIGN.md'],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const call = definition!.call as (value: unknown) => Promise<unknown>
    const unresolved = submission(systemReferenceId, documentReferenceId)
    await expect(call({ checks: [unresolved] })).resolves.toEqual({
      data: { accepted: true, workerType: 'document-reviewer' },
    })
    await expect(
      call({
        checks: [
          {
            ...unresolved,
            findings: [
              {
                ...unresolved.findings[0],
                requiredOutcome: 'A different outcome cannot reuse this ID.',
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow('does not preserve its accepted identity')

    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'closure',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts,
        activeTarget: 'foundation',
        priorFindings: [{ ...finding, open: false }],
        changedPaths: ['docs/TECHNICAL_DESIGN.md'],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const closedCall = definition!.call as (value: unknown) => Promise<unknown>
    await expect(closedCall({ checks: [unresolved] })).rejects.toThrow(
      'is already closed',
    )

    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckIds: ['technical_feasibility'],
        artifacts,
        priorFindings: [{ ...finding, open: true }],
      },
      buildTool(value) {
        definition = value
        return value
      },
    })
    const initialCall = definition!.call as (value: unknown) => Promise<unknown>
    await expect(initialCall({ checks: [unresolved] })).rejects.toThrow(
      'finding ID already exists in the cycle ledger',
    )
  })
})

describe('native document repair plan result tool', () => {
  test('requires the service-owned group count', () => {
    expect(() =>
      createNativeWorkflowResultTool({
        workerType: 'document-author',
        documentAuthorMode: 'repair-planning',
        buildTool(value) {
          return value
        },
      }),
    ).toThrow('document repair plan group count is missing')
  })

  test('rejects incomplete plans before accepting the same tool call', async () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-author',
      documentAuthorMode: 'repair-planning',
      documentRepairGroupCount: 2,
      buildTool(value) {
        definition = value
        return value
      },
    })
    const call = definition!.call as (value: unknown) => Promise<unknown>
    await expect(
      call({ decisions: [{ decision: 'Repair the first group.' }] }),
    ).rejects.toThrow('requires exactly 2 decisions')
    await expect(
      call({
        decisions: [
          { decision: 'Repair the first group.' },
          { decision: 'Repair the dependent group.' },
        ],
      }),
    ).resolves.toEqual({
      data: { accepted: true, workerType: 'document-author' },
    })
  })
})

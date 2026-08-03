import { describe, expect, test } from 'bun:test'
import { createNativeWorkflowResultTool } from './native-workflow-result-tools'
import { buildDocumentReviewReferenceIndex } from './delivery-workflow/document-review-input'

const finding = {
  findingId: 'CONTRACT-1',
  checkId: 'technical_feasibility',
  severity: 'blocking',
  owner: 'foundation',
  subjects: [{ path: 'docs/TECHNICAL_DESIGN.md', anchor: 'Resources' }],
  observation: 'The documented delivery root conflicts with system authority.',
  blockingReason: 'Implementation would have two content roots.',
  requiredAction: 'Use the canonical content root.',
  closureCondition: 'The document defines only the canonical root.',
}
function submission(systemReferenceId = 'ref-system', documentReferenceId = 'ref-document') {
  return {
    check: {
      id: 'technical_feasibility',
      status: 'block',
      conclusion: 'The project contract conflicts with system authority.',
      evidence: [
        { referenceId: systemReferenceId },
        { referenceId: documentReferenceId },
      ],
      findingIds: ['CONTRACT-1'],
      assessments: [],
    },
    findings: [{
      findingId: finding.findingId,
      checkId: finding.checkId,
      subjects: [{ referenceId: documentReferenceId }],
      observation: finding.observation,
      blockingReason: finding.blockingReason,
      requiredAction: finding.requiredAction,
      closureCondition: finding.closureCondition,
    }],
  }
}

describe('native document review result tool', () => {
  test('rejects an invalid exact anchor before accepted and allows correction in the same tool turn', async () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewMode: 'initial',
      documentReviewScope: 'foundation',
      documentReviewContract: {
        scope: 'foundation',
        mode: 'initial',
        requiredCheckIds: ['technical_feasibility'],
        currentCheckId: 'technical_feasibility',
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
      { path: 'systemDeliveryContract', content: '{"roots":{"content":"assets/content"}}\n' },
      { path: 'docs/TECHNICAL_DESIGN.md', content: '### Resources\n' },
    ]
    const references = buildDocumentReviewReferenceIndex(artifacts).references
    const systemRef = references.find(item => item.anchor === '/roots/content')!.referenceId
    const documentRef = references.find(item => item.path === 'docs/TECHNICAL_DESIGN.md')!.referenceId
    await expect(call(submission(systemRef, 'ref-unknown'))).rejects.toThrow(
      'unknown document review referenceId',
    )

    const corrected = submission(systemRef, documentRef)
    await expect(call(corrected)).resolves.toEqual({
      data: { accepted: true, workerType: 'document-reviewer' },
    })
  })

  test('exposes an Initial schema without Closure regression fields', async () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewMode: 'initial',
      documentReviewScope: 'foundation',
      buildTool(value) {
        definition = value
        return value
      },
    })
    const schema = definition!.inputSchema as { parse(value: unknown): unknown }
    expect(() =>
      schema.parse({
        ...submission(),
        findings: [
          {
            ...submission().findings[0],
            regressionPaths: ['docs/TECHNICAL_DESIGN.md'],
          },
        ],
      }),
    ).toThrow()
    const prompt = await (definition!.prompt as () => Promise<string>)()
    expect(prompt).toContain(
      'Initial Review findings cannot contain regressionPaths',
    )
    expect(prompt).toContain('A rejected call is not accepted')
    expect(prompt).toContain('referenceId')
  })

  test('exposes regression paths only for Closure Review', () => {
    let definition: Record<string, unknown> | undefined
    createNativeWorkflowResultTool({
      workerType: 'document-reviewer',
      documentReviewMode: 'closure',
      documentReviewScope: 'complete',
      buildTool(value) {
        definition = value
        return value
      },
    })
    const schema = definition!.inputSchema as { parse(value: unknown): unknown }
    expect(
      schema.parse({
        ...submission(),
        findings: [
          {
            ...submission().findings[0],
            regressionPaths: ['docs/TECHNICAL_DESIGN.md'],
          },
        ],
      }),
    ).toMatchObject({
      findings: [{ regressionPaths: ['docs/TECHNICAL_DESIGN.md'] }],
    })
  })
})

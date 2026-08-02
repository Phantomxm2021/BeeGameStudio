import { describe, expect, test } from 'bun:test'
import { createNativeWorkflowResultTool } from './native-workflow-result-tools'

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
const {
  severity: _submissionSeverity,
  owner: _submissionOwner,
  ...submissionFinding
} = finding

function submission() {
  return {
    verdict: 'NEEDS_REVISION',
    checks: [{
      id: 'technical_feasibility',
      status: 'block',
      conclusion: 'The project contract conflicts with system authority.',
      evidence: [
        { path: 'systemDeliveryContract', anchor: '/roots/content' },
        { path: 'docs/TECHNICAL_DESIGN.md', anchor: 'Resources' },
      ],
      findingIds: ['CONTRACT-1'],
      assessments: [],
    }],
    findings: [submissionFinding],
  }
}

describe('native document review result tool', () => {
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
        findings: [{ ...submissionFinding, regressionPaths: ['docs/TECHNICAL_DESIGN.md'] }],
      }),
    ).toThrow()
    const prompt = await (definition!.prompt as () => Promise<string>)()
    expect(prompt).toContain('Initial Review findings cannot contain regressionPaths')
    expect(prompt).toContain('rejected by input validation is not a result')
    expect(prompt).toContain('never JSON-encoded strings')
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
        findings: [{ ...submissionFinding, regressionPaths: ['docs/TECHNICAL_DESIGN.md'] }],
      }),
    ).toMatchObject({
      findings: [{ regressionPaths: ['docs/TECHNICAL_DESIGN.md'] }],
    })
  })
})

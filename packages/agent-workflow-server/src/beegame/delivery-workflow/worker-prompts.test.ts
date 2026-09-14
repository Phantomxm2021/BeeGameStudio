import { describe, expect, test } from 'bun:test'
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
})

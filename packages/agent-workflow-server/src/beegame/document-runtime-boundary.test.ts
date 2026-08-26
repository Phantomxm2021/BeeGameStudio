import { describe, expect, test } from 'bun:test'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = dirname(fileURLToPath(import.meta.url))

describe('single-lane document runtime source boundary', () => {
  test('contains no removed document transport, compatibility protocol, or alternate writer', async () => {
    const sources = await productionSources(sourceRoot)
    const forbidden = [
      'renderCompleteGameDocument',
      'completeGameDocumentSubmissionSchema',
      'validateCompleteGameDocumentSubmission',
      'validateCompleteGameDocumentEvidence',
      'documentEvidenceEntrySchema',
      'CommitCanonicalDocument',
      'DocumentPart',
      'document_parts',
      'foundation-authority-sidecar',
      'workspaceText',
      'workflowMarkdownStreamContract',
      'normalizeCompleteGameDocumentProtocol',
      'foundation-markdown-stream',
    ]
    const violations = sources.flatMap(source =>
      forbidden
        .filter(symbol => source.content.includes(symbol))
        .map(symbol => `${source.path}:${symbol}`),
    )
    expect(violations).toEqual([])
  })
})

async function productionSources(root: string): Promise<Array<{ path: string; content: string }>> {
  const entries = await readdir(root, { withFileTypes: true })
  const sources: Array<{ path: string; content: string }> = []
  for (const entry of entries) {
    if (entry.name === 'fixtures' || entry.name.endsWith('.test.ts')) continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) sources.push(...await productionSources(path))
    else if (entry.isFile() && entry.name.endsWith('.ts'))
      sources.push({ path, content: await readFile(path, 'utf8') })
  }
  return sources
}

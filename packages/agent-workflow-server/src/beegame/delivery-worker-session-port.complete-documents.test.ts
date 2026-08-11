import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCanonicalDocumentCommitContract } from './delivery-worker-session-port'

describe('delivery worker complete document commit contract', () => {
  test('requires structured complete submissions for initial Foundation authors', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'complete-doc-contract-'))
    try {
      const contract = await buildCanonicalDocumentCommitContract(
        {
          workerType: 'document-author',
          workspacePath,
          allowedPaths: ['docs/GDD.md'],
          contract: {
            authoringMode: 'initial',
            documentSet: 'foundation',
            foundationDocumentPath: 'docs/GDD.md',
          },
        } as never,
        'dispatch-complete-document',
      )
      expect(contract).toMatchObject({
        targetPath: 'docs/GDD.md',
        submissionKind: 'complete_game_document',
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})

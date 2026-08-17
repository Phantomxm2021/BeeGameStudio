import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  FOUNDATION_DOCUMENT_LANES,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import {
  readFoundationReviewProjectionAuthority,
  readFoundationReviewProjection,
  writeFoundationReviewProjection,
} from './foundation-review-projection'
import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

const workspaces: string[] = []

function sourceDocument(path: FoundationDocumentPath): string {
  const contract = getGameDocumentContract(path)
  return [
    `# ${contract.discipline}`,
    '',
    ...contract.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Exact ${path} content for ${section.sectionId}.`,
      '',
    ]),
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    'Not projected.',
  ].join('\n')
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'beegame-review-projection-'))
  workspaces.push(root)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const absolute = resolve(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, sourceDocument(path), 'utf8')
  }
  return root
}

function expectedSelectors(laneId: FoundationDocumentLaneId): string[] {
  const lane = FOUNDATION_DOCUMENT_LANES.find(item => item.id === laneId)!
  const owned = new Set(lane.ownedPaths)
  return [
    ...new Set(
      lane.ownedPaths.flatMap(path =>
        getGameDocumentContract(path).upstreamSections.flatMap(source =>
          owned.has(source.path)
            ? []
            : source.sectionIds.map(sectionId => `${source.path}#${sectionId}`),
        ),
      ),
    ),
  ].sort()
}

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(path => rm(path, { recursive: true })),
  )
})

describe('foundation review projections', () => {
  test('writes only contract-declared cross-lane source sections', async () => {
    const root = await workspace()
    const revision = 'a'.repeat(64)

    for (const lane of FOUNDATION_DOCUMENT_LANES) {
      const accepted = await writeFoundationReviewProjection({
        workspacePath: root,
        revision,
        laneId: lane.id,
      })
      const projection = await readFoundationReviewProjection({
        workspacePath: root,
        revision,
        laneId: lane.id,
        expectedDigest: accepted.digest,
      })
      const selectors = projection.projection.sources.map(
        source => `${source.path}#${source.sectionId}`,
      )

      expect(selectors).toEqual(expectedSelectors(lane.id))
      expect(projection.projection.revision).toBe(revision)
      expect(projection.projection.lane).toBe(lane.id)
      expect(projection.path).toBe(accepted.path)
      expect(projection.digest).toBe(accepted.digest)
      for (const source of projection.projection.sources) {
        const markdown = sourceDocument(source.path)
        const exact = markdown
          .split('\n')
          .slice(source.startLine - 1, source.startLine - 1 + source.lineCount)
          .join('\n')
        expect(source.content).toBe(exact)
        expect(source.content).toContain(
          `<!-- beegame-section:${source.sectionId} -->`,
        )
        expect(source.digest).toBe(
          createHash('sha256').update(exact).digest('hex'),
        )
        expect(lane.ownedPaths).not.toContain(source.path)
      }
    }
  })

  test('binds projection bytes to revision and rejects tampering', async () => {
    const root = await workspace()
    const revision = 'b'.repeat(64)
    const accepted = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'technical-assets',
    })
    const absolute = resolve(root, accepted.path)
    const bytes = await readFile(absolute, 'utf8')
    await writeFile(absolute, bytes.replace('Exact ', 'Tampered '), 'utf8')

    await expect(
      readFoundationReviewProjection({
        workspacePath: root,
        revision,
        laneId: 'technical-assets',
        expectedDigest: accepted.digest,
      }),
    ).rejects.toThrow('foundation review projection digest changed')
    await expect(
      readFoundationReviewProjection({
        workspacePath: root,
        revision: 'c'.repeat(64),
        laneId: 'technical-assets',
        expectedDigest: accepted.digest,
      }),
    ).rejects.toThrow('foundation review projection is unavailable')
  })

  test('reads only the canonical projection descriptor and returns unique source paths', async () => {
    const root = await workspace()
    const revision = 'd'.repeat(64)
    const descriptor = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'core-design',
    })

    const authority = await readFoundationReviewProjectionAuthority({
      workspacePath: root,
      revision,
      laneId: 'core-design',
      descriptor,
    })

    expect(authority.path).toBe(descriptor.path)
    expect(authority.digest).toBe(descriptor.digest)
    expect(authority.byteLength).toBe(descriptor.byteLength)
    expect(authority.allowedEvidencePaths).toEqual([
      ...new Set(authority.projection.sources.map(source => source.path)),
    ])
  })

  test.each([
    {
      name: 'missing projection path',
      change: (descriptor: {
        path: string
        digest: string
        byteLength: number
      }) => ({
        ...descriptor,
        path: descriptor.path.replace('core-design.json', 'missing.json'),
      }),
    },
    {
      name: 'wrong canonical path',
      change: (descriptor: {
        path: string
        digest: string
        byteLength: number
      }) => ({
        ...descriptor,
        path: `docs/GDD.md`,
      }),
    },
    {
      name: 'wrong byte length',
      change: (descriptor: {
        path: string
        digest: string
        byteLength: number
      }) => ({
        ...descriptor,
        byteLength: descriptor.byteLength + 1,
      }),
    },
    {
      name: 'wrong digest',
      change: (descriptor: {
        path: string
        digest: string
        byteLength: number
      }) => ({
        ...descriptor,
        digest: 'e'.repeat(64),
      }),
    },
  ])('rejects a $name descriptor', async ({ change }) => {
    const root = await workspace()
    const revision = 'd'.repeat(64)
    const descriptor = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'core-design',
    })

    await expect(
      readFoundationReviewProjectionAuthority({
        workspacePath: root,
        revision,
        laneId: 'core-design',
        descriptor: change(descriptor),
      }),
    ).rejects.toThrow()
  })

  test.each([
    ['revision', 'revision', 'f'.repeat(64)],
    ['lane', 'lane', 'presentation'],
  ] as const)('rejects a projection with the wrong %s identity', async (_name, field, value) => {
    const root = await workspace()
    const revision = 'd'.repeat(64)
    const descriptor = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'core-design',
    })
    const absolute = resolve(root, descriptor.path)
    const projection = JSON.parse(await readFile(absolute, 'utf8'))
    projection[field] = value
    const bytes = `${JSON.stringify(projection, null, 2)}\n`
    await writeFile(absolute, bytes, 'utf8')

    await expect(
      readFoundationReviewProjectionAuthority({
        workspacePath: root,
        revision,
        laneId: 'core-design',
        descriptor: {
          path: descriptor.path,
          digest: createHash('sha256').update(bytes).digest('hex'),
          byteLength: Buffer.byteLength(bytes),
        },
      }),
    ).rejects.toThrow('foundation review projection identity changed')
  })
})

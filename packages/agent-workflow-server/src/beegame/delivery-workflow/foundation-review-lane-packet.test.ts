import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  acceptFoundationReviewLanePacket,
  foundationReviewLanePacketPath,
  foundationReviewLanePacketSchema,
  foundationReviewLanePacketStagingPath,
} from './foundation-review-lane-packet'
import { writeFoundationReviewProjection } from './foundation-review-projection'
import { getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

const revision = 'a'.repeat(64)
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
  const root = await mkdtemp(resolve(tmpdir(), 'beegame-review-lane-packet-'))
  workspaces.push(root)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const absolute = resolve(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, sourceDocument(path), 'utf8')
  }
  return root
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Runtime authority cannot satisfy the game rule',
    problem: 'The owned technical contract cannot implement the projected rule.',
    evidence: [
      {
        path: 'docs/TECHNICAL_DESIGN.md',
        location: 'Architecture',
        observed: 'Exact docs/TECHNICAL_DESIGN.md content for architecture.',
      },
      {
        path: 'docs/GDD.md',
        location: 'Player actions',
        observed: 'Exact docs/GDD.md content for player_actions.',
      },
    ],
    blockingReason: 'Runtime behavior would contradict the canonical game rule.',
    ...overrides,
  }
}

function packet(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    scope: 'foundation',
    revision,
    lane: 'technical-assets',
    candidates: [candidate()],
    ...overrides,
  }
}

async function stagePacket(root: string, value: unknown): Promise<string> {
  const path = foundationReviewLanePacketStagingPath(
    root,
    revision,
    'technical-assets',
  )
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value), 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true })))
})

describe('foundation review lane packets', () => {
  test('accepts only bounded blocking candidates with the fixed lane identity', () => {
    expect(() =>
      foundationReviewLanePacketSchema.parse(packet({ verdict: 'READY' })),
    ).toThrow()
    expect(() =>
      foundationReviewLanePacketSchema.parse(packet({ lane: 'final' })),
    ).toThrow()
    expect(() =>
      foundationReviewLanePacketSchema.parse(
        packet({ candidates: Array.from({ length: 25 }, candidate) }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewLanePacketSchema.parse(
        packet({ candidates: [candidate({ replacementText: 'Rewrite it.' })] }),
      ),
    ).toThrow()
  })

  test('atomically accepts exact observations from owned and projected source bytes', async () => {
    const root = await workspace()
    const projection = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'technical-assets',
    })
    await stagePacket(root, packet())

    const accepted = await acceptFoundationReviewLanePacket({
      workspacePath: root,
      revision,
      currentRevision: revision,
      laneId: 'technical-assets',
      projectionDigest: projection.digest,
    })
    const committed = await readFile(
      foundationReviewLanePacketPath(root, revision, 'technical-assets'),
    )

    expect(accepted.path).toBe(
      `.beegame/reviews/foundation/${revision}/parts/technical-assets.json`,
    )
    expect(accepted.digest).toBe(
      createHash('sha256').update(committed).digest('hex'),
    )
    expect(accepted.packet.lane).toBe('technical-assets')
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: root,
        revision,
        currentRevision: revision,
        laneId: 'technical-assets',
        projectionDigest: projection.digest,
      }),
    ).rejects.toThrow('foundation review lane packet is already committed')
  })

  test('rejects stale identity, malformed bytes, and evidence outside accepted authority', async () => {
    const staleRoot = await workspace()
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: staleRoot,
        revision,
        currentRevision: 'b'.repeat(64),
        laneId: 'technical-assets',
        projectionDigest: 'c'.repeat(64),
      }),
    ).rejects.toThrow('canonical artifacts changed during foundation review')

    const roleRoot = await workspace()
    const roleProjection = await writeFoundationReviewProjection({
      workspacePath: roleRoot,
      revision,
      laneId: 'technical-assets',
    })
    await stagePacket(roleRoot, packet({ lane: 'presentation' }))
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: roleRoot,
        revision,
        currentRevision: revision,
        laneId: 'technical-assets',
        projectionDigest: roleProjection.digest,
      }),
    ).rejects.toThrow('foundation review lane packet lane does not match')

    const outsideRoot = await workspace()
    const outsideProjection = await writeFoundationReviewProjection({
      workspacePath: outsideRoot,
      revision,
      laneId: 'core-design',
    })
    const outsidePath = foundationReviewLanePacketStagingPath(
      outsideRoot,
      revision,
      'core-design',
    )
    await mkdir(dirname(outsidePath), { recursive: true })
    await writeFile(
      outsidePath,
      JSON.stringify(
        packet({
          lane: 'core-design',
          candidates: [
            candidate({
              evidence: [
                {
                  path: 'docs/TECHNICAL_DESIGN.md',
                  location: 'Architecture',
                  observed:
                    'Exact docs/TECHNICAL_DESIGN.md content for architecture.',
                },
              ],
            }),
          ],
        }),
      ),
      'utf8',
    )
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: outsideRoot,
        revision,
        currentRevision: revision,
        laneId: 'core-design',
        projectionDigest: outsideProjection.digest,
      }),
    ).rejects.toThrow('foundation review evidence path is outside lane authority')

    const jsonRoot = await workspace()
    const jsonProjection = await writeFoundationReviewProjection({
      workspacePath: jsonRoot,
      revision,
      laneId: 'technical-assets',
    })
    const jsonPath = foundationReviewLanePacketStagingPath(
      jsonRoot,
      revision,
      'technical-assets',
    )
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, '{', 'utf8')
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: jsonRoot,
        revision,
        currentRevision: revision,
        laneId: 'technical-assets',
        projectionDigest: jsonProjection.digest,
      }),
    ).rejects.toThrow('foundation review lane packet is not valid JSON')

    const utfRoot = await workspace()
    const utfProjection = await writeFoundationReviewProjection({
      workspacePath: utfRoot,
      revision,
      laneId: 'technical-assets',
    })
    const utfPath = foundationReviewLanePacketStagingPath(
      utfRoot,
      revision,
      'technical-assets',
    )
    await mkdir(dirname(utfPath), { recursive: true })
    await writeFile(utfPath, Buffer.from([0xc3, 0x28]))
    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: utfRoot,
        revision,
        currentRevision: revision,
        laneId: 'technical-assets',
        projectionDigest: utfProjection.digest,
      }),
    ).rejects.toThrow('foundation review lane packet is not valid UTF-8')
  })

  test('rejects an absent observation even when the document path is authorized', async () => {
    const root = await workspace()
    const projection = await writeFoundationReviewProjection({
      workspacePath: root,
      revision,
      laneId: 'technical-assets',
    })
    await stagePacket(
      root,
      packet({
        candidates: [
          candidate({
            evidence: [
              {
                path: 'docs/TECHNICAL_DESIGN.md',
                location: 'Architecture',
                observed: 'A fabricated observation.',
              },
            ],
          }),
        ],
      }),
    )

    await expect(
      acceptFoundationReviewLanePacket({
        workspacePath: root,
        revision,
        currentRevision: revision,
        laneId: 'technical-assets',
        projectionDigest: projection.digest,
      }),
    ).rejects.toThrow('foundation review evidence is absent from accepted source bytes')
  })
})

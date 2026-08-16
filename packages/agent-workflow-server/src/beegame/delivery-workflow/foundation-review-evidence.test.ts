import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  acceptFoundationReviewEvidence,
  foundationReviewEvidencePath,
  foundationReviewEvidenceSchema,
  foundationReviewEvidenceStagingPath,
} from './foundation-review-evidence'

const revision = 'a'.repeat(64)

function candidate() {
  return {
    title: 'Terminal state authority differs',
    problem: 'Two canonical documents define incompatible terminal states.',
    evidence: [
      {
        path: 'docs/GDD.md',
        location: 'State register',
        observed: 'UNFINISHED is absent.',
      },
    ],
    blockingReason: 'Implementation cannot select one authoritative state.',
  }
}

function packet(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    scope: 'foundation',
    revision,
    role: 'contract-specialist',
    candidates: [candidate()],
    ...overrides,
  }
}

describe('foundation review specialist evidence', () => {
  test('rejects verdicts, final roles, unbounded candidates, and unknown fields', () => {
    expect(() =>
      foundationReviewEvidenceSchema.parse(packet({ verdict: 'READY' })),
    ).toThrow()
    expect(() =>
      foundationReviewEvidenceSchema.parse(packet({ role: 'final' })),
    ).toThrow()
    expect(() =>
      foundationReviewEvidenceSchema.parse(
        packet({ candidates: Array.from({ length: 33 }, candidate) }),
      ),
    ).toThrow()
    expect(() =>
      foundationReviewEvidenceSchema.parse(
        packet({ candidates: [{ ...candidate(), requiredOutcome: 'Change it' }] }),
      ),
    ).toThrow()
  })

  test('derives project-confined immutable paths from revision and role', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    expect(
      foundationReviewEvidencePath(
        workspacePath,
        revision,
        'contract-specialist',
      ),
    ).toBe(
      join(
        workspacePath,
        '.beegame',
        'reviews',
        'foundation',
        revision,
        'parts',
        'contract.json',
      ),
    )
    expect(() =>
      foundationReviewEvidenceStagingPath(
        workspacePath,
        revision,
        '../escape' as never,
      ),
    ).toThrow()
  })

  test('atomically accepts one byte-bound packet and rejects duplicate commit', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    const stagedPath = foundationReviewEvidenceStagingPath(
      workspacePath,
      revision,
      'contract-specialist',
    )
    await mkdir(dirname(stagedPath), { recursive: true })
    await writeFile(stagedPath, JSON.stringify(packet()), 'utf8')

    const accepted = await acceptFoundationReviewEvidence({
      workspacePath,
      revision,
      currentRevision: revision,
      role: 'contract-specialist',
    })
    const committedBytes = await readFile(
      foundationReviewEvidencePath(
        workspacePath,
        revision,
        'contract-specialist',
      ),
    )
    expect(accepted.path).toBe(
      `.beegame/reviews/foundation/${revision}/parts/contract.json`,
    )
    expect(accepted.digest).toBe(
      createHash('sha256').update(committedBytes).digest('hex'),
    )
    expect(accepted.packet.role).toBe('contract-specialist')

    await expect(
      acceptFoundationReviewEvidence({
        workspacePath,
        revision,
        currentRevision: revision,
        role: 'contract-specialist',
      }),
    ).rejects.toThrow('foundation review evidence is already committed')
  })

  test('rejects changed source bytes, mismatched role, malformed JSON, and invalid UTF-8', async () => {
    const changedWorkspace = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    await expect(
      acceptFoundationReviewEvidence({
        workspacePath: changedWorkspace,
        revision,
        currentRevision: 'b'.repeat(64),
        role: 'contract-specialist',
      }),
    ).rejects.toThrow('canonical artifacts changed during foundation review')

    const roleWorkspace = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    const rolePath = foundationReviewEvidenceStagingPath(
      roleWorkspace,
      revision,
      'integration-specialist',
    )
    await mkdir(dirname(rolePath), { recursive: true })
    await writeFile(rolePath, JSON.stringify(packet()), 'utf8')
    await expect(
      acceptFoundationReviewEvidence({
        workspacePath: roleWorkspace,
        revision,
        currentRevision: revision,
        role: 'integration-specialist',
      }),
    ).rejects.toThrow('foundation review evidence role does not match')

    const jsonWorkspace = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    const jsonPath = foundationReviewEvidenceStagingPath(
      jsonWorkspace,
      revision,
      'contract-specialist',
    )
    await mkdir(dirname(jsonPath), { recursive: true })
    await writeFile(jsonPath, '{', 'utf8')
    await expect(
      acceptFoundationReviewEvidence({
        workspacePath: jsonWorkspace,
        revision,
        currentRevision: revision,
        role: 'contract-specialist',
      }),
    ).rejects.toThrow('foundation review evidence is not valid JSON')

    const utfWorkspace = await mkdtemp(join(tmpdir(), 'foundation-evidence-'))
    const utfPath = foundationReviewEvidenceStagingPath(
      utfWorkspace,
      revision,
      'contract-specialist',
    )
    await mkdir(dirname(utfPath), { recursive: true })
    await writeFile(utfPath, Buffer.from([0xc3, 0x28]))
    await expect(
      acceptFoundationReviewEvidence({
        workspacePath: utfWorkspace,
        revision,
        currentRevision: revision,
        role: 'contract-specialist',
      }),
    ).rejects.toThrow('foundation review evidence is not valid UTF-8')
  })
})

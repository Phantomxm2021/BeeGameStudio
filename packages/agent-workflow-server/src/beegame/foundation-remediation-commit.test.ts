import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import { commitFoundationRemediationTransaction } from './foundation-remediation-commit'
import {
  buildFoundationRemediationTransactionRequest,
  type FoundationRemediationResult,
} from './delivery-workflow/foundation-remediation-transaction'
import type { FoundationReview } from './delivery-workflow/foundation-review'

const PATH = 'docs/GDD.md' as const
const PREVIOUS_UPDATED_AT = '2026-08-17T10:00:00.000Z'
const COMMITTED_AT = '2026-08-17T11:00:00.000Z'

function canonicalDocument(): string {
  return [
    '---',
    'document_id: GDD',
    'version: 1.0.0',
    `updated_at: ${PREVIOUS_UPDATED_AT}`,
    '---',
    renderTestCompleteGameDocument(PATH, completeTestSubmission(PATH)).trimEnd(),
    '',
  ].join('\n')
}

function transaction() {
  const conflicts: FoundationReview['conflicts'] = [
    {
      id: 'B1',
      title: 'Core loop authority is incomplete',
      problem: 'The implementation boundary cannot be verified.',
      evidence: [
        {
          path: PATH,
          location: 'Core loop section',
          observed: 'The acceptance boundary is missing.',
        },
      ],
      requiredOutcome: 'Define one observable implementation boundary.',
      changes: [
        {
          path: PATH,
          action: 'Add the observable boundary to the core loop authority.',
        },
      ],
      acceptance: ['The core loop authority has an observable boundary.'],
    },
  ]
  const request = buildFoundationRemediationTransactionRequest({
    sourcePath: PATH,
    sourceMarkdown: canonicalDocument(),
    reviewDigest: 'a'.repeat(64),
    sourceRevision: 'b'.repeat(64),
    conflicts,
  })
  const unit = request.units.find(candidate =>
    candidate.unitId.startsWith('section:'),
  )!
  const result: FoundationRemediationResult = {
    version: 1,
    sourcePath: PATH,
    sourceDigest: request.sourceDigest,
    resolvedConflictIds: ['B1'],
    patches: [
      {
        unitId: unit.unitId,
        expectedBodyDigest: unit.bodyDigest,
        replacementBody:
          'Revised authority with an observable implementation boundary and a concrete verification result.',
      },
    ],
  }
  return { request, result }
}

describe('foundation remediation commit', () => {
  let workspacePath = ''

  afterEach(async () => {
    if (workspacePath)
      await rm(workspacePath, { recursive: true, force: true })
    workspacePath = ''
  })

  test('atomically commits and idempotently replays one transaction', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'remediation-commit-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    await writeFile(join(workspacePath, PATH), canonicalDocument())
    const { request, result } = transaction()

    const first = await commitFoundationRemediationTransaction({
      workspacePath,
      dispatchId: 'dispatch-gdd',
      request,
      result,
      previousMetadata: {
        version: '1.0.0',
        updatedAt: PREVIOUS_UPDATED_AT,
      },
      committedAt: COMMITTED_AT,
    })
    const firstBytes = await readFile(join(workspacePath, PATH), 'utf8')
    const replay = await commitFoundationRemediationTransaction({
      workspacePath,
      dispatchId: 'dispatch-gdd',
      request,
      result,
      previousMetadata: {
        version: '1.0.0',
        updatedAt: PREVIOUS_UPDATED_AT,
      },
      committedAt: COMMITTED_AT,
    })

    expect(first).toEqual(replay)
    expect(await readFile(join(workspacePath, PATH), 'utf8')).toBe(firstBytes)
    expect(firstBytes).toContain('version: 1.0.1')
    expect(firstBytes).toContain('Revised authority')
  })

  test('leaves externally changed source bytes untouched', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'remediation-stale-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    const externallyChanged = `${canonicalDocument()}\nExternal change.\n`
    await writeFile(join(workspacePath, PATH), externallyChanged)
    const { request, result } = transaction()

    await expect(
      commitFoundationRemediationTransaction({
        workspacePath,
        dispatchId: 'dispatch-stale',
        request,
        result,
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      }),
    ).rejects.toThrow('foundation remediation target changed before commit')
    expect(await readFile(join(workspacePath, PATH), 'utf8')).toBe(
      externallyChanged,
    )
  })

  test('leaves source bytes untouched when structured output is invalid', async () => {
    workspacePath = await mkdtemp(join(tmpdir(), 'remediation-invalid-'))
    await mkdir(join(workspacePath, 'docs'), { recursive: true })
    const original = canonicalDocument()
    await writeFile(join(workspacePath, PATH), original)
    const { request } = transaction()

    await expect(
      commitFoundationRemediationTransaction({
        workspacePath,
        dispatchId: 'dispatch-invalid',
        request,
        result: { version: 1 },
        previousMetadata: {
          version: '1.0.0',
          updatedAt: PREVIOUS_UPDATED_AT,
        },
        committedAt: COMMITTED_AT,
      }),
    ).rejects.toThrow()
    expect(await readFile(join(workspacePath, PATH), 'utf8')).toBe(original)
  })
})

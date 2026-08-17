import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { FOUNDATION_DOCUMENT_LANES } from './foundation-document-lanes'
import { createFoundationReviewState } from './foundation-review-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  acceptFoundationReviewWorkerTerminal,
  atomicCommitReceipt,
  buildFoundationReviewDispatches,
} from './foundation-review-stage'
import { getGameDocumentContract } from './game-document-contracts'

const revision = 'a'.repeat(64)
const workspaces: string[] = []

function sourceDocument(path: (typeof CANONICAL_FOUNDATION_DOCUMENTS)[number]): string {
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
  const root = await mkdtemp(resolve(tmpdir(), 'foundation-review-stage-'))
  workspaces.push(root)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    const absolute = resolve(root, path)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, sourceDocument(path), 'utf8')
  }
  return root
}

function laneMarkdown(input: {
  lane: (typeof FOUNDATION_DOCUMENT_LANES)[number]
  projectionDigest: string
  includeCandidate?: boolean
}): string {
  const identity = [
    '# Foundation Review Packet',
    '',
    `Revision: \`${revision}\``,
    '',
    `Lane: \`${input.lane.id}\``,
    '',
    `Projection: \`${input.projectionDigest}\``,
  ]
  if (!input.includeCandidate) return `${identity.join('\n')}\n`
  const path = input.lane.ownedPaths[0]
  return [
    ...identity,
    '',
    `## \`${input.lane.id}:C1\` — ${input.lane.id} blocker`,
    '',
    '### Problem',
    'The authority permits incompatible implementations.',
    '',
    '### Evidence',
    `- Path: ${path}`,
    '  Location: Contract section',
    '  Observed: The required outcome is ambiguous.',
    '',
    '### Required outcome',
    'Define one implementable outcome.',
    '',
    '### Changes',
    `- Path: ${path}`,
    '  Action: Define the unique outcome.',
    '',
    '### Acceptance',
    '- The outcome has one observable result.',
    '',
  ].join('\n')
}

function selectionMarkdown(input: {
  keep?: string[]
  duplicate?: Array<{ source: string; target: string }>
  reject?: string[]
} = {}): string {
  const list = (values: string[]) =>
    values.length ? values.map(value => `- ${value}`) : ['-']
  return [
    '# Foundation Review Selection',
    '',
    `Revision: \`${revision}\``,
    '',
    '## Keep',
    ...list((input.keep ?? []).map(reference => `\`${reference}\``)),
    '',
    '## Duplicate',
    ...list(
      (input.duplicate ?? []).map(
        item => `\`${item.source}\` -> \`${item.target}\``,
      ),
    ),
    '',
    '## Reject',
    ...list((input.reject ?? []).map(reference => `\`${reference}\``)),
    '',
  ].join('\n')
}

async function acceptLanes(
  root: string,
  options: { includeCandidates?: boolean } = {},
) {
  let state = createFoundationReviewState({ revision, attempt: 1 })
  const dispatches = await buildFoundationReviewDispatches({
    state,
    workspacePath: root,
    confirmedBriefDigest: 'd'.repeat(64),
  })
  for (const dispatch of dispatches) {
    if (dispatch.role === 'synthesis' || !dispatch.contract.projection)
      throw new Error('expected lane dispatch')
    const lane = FOUNDATION_DOCUMENT_LANES.find(
      candidate => candidate.id === dispatch.role,
    )!
    const stagingPath = dispatch.assignment.stagingOutputPaths[0]
    await mkdir(dirname(stagingPath), { recursive: true })
    await writeFile(
      stagingPath,
      laneMarkdown({
        lane,
        projectionDigest: dispatch.contract.projection.digest,
        includeCandidate: options.includeCandidates,
      }),
      'utf8',
    )
    state = await acceptFoundationReviewWorkerTerminal({
      state,
      workspacePath: root,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: lane.id,
        reportPath: `.beegame/reviews/foundation/${revision}/parts/${lane.id}.md`,
      },
    })
  }
  return { state, dispatches }
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true })))
})

describe('foundation review lane dispatch barrier', () => {
  test('commits the validated receipt bytes when the worker staging path changes', async () => {
    const root = await workspace()
    const stagingPath = resolve(root, '.beegame/reviews/.staging/selection.md')
    const committedPath = resolve(root, '.beegame/reviews/selection.md')
    const validatedBytes = Buffer.from('validated receipt bytes\n', 'utf8')
    await mkdir(dirname(stagingPath), { recursive: true })
    await writeFile(stagingPath, 'swapped staging bytes\n', 'utf8')

    await atomicCommitReceipt({
      stagingPath,
      committedPath,
      bytes: validatedBytes,
    })

    expect(await readFile(committedPath)).toEqual(validatedBytes)
  })

  test('dispatches three disjoint document lanes before packet-only synthesis', async () => {
    const root = await workspace()
    const initial = createFoundationReviewState({ revision, attempt: 1 })
    const laneDispatches = await buildFoundationReviewDispatches({
      state: initial,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })

    expect(laneDispatches.map(dispatch => dispatch.role)).toEqual([
      'core-design',
      'technical-assets',
      'presentation',
    ])
    expect(
      laneDispatches.flatMap(dispatch =>
        dispatch.assignment.sourcePaths.filter(path => path.endsWith('.md')),
      ),
    ).toEqual(
      FOUNDATION_DOCUMENT_LANES.flatMap(lane =>
        lane.ownedPaths.map(path => resolve(root, path)),
      ),
    )
    expect(
      new Set(
        laneDispatches.flatMap(item =>
          item.assignment.sourcePaths.filter(path => path.endsWith('.md')),
        ),
      ).size,
    ).toBe(8)
    expect(
      laneDispatches.every(
        item =>
          item.assignment.sourcePaths.filter(path => path.endsWith('.md')).length < 8 &&
          item.assignment.sourcePaths.filter(path => path.endsWith('.json')).length === 1 &&
          !Object.hasOwn(item.assignment, 'verificationSourcePaths') &&
          item.contract.reviewMode === 'initial' &&
          item.contract.projection?.digest.match(/^[a-f0-9]{64}$/u),
      ),
    ).toBe(true)
    expect(laneDispatches[0].contract).not.toHaveProperty('priorReview')
    expect(laneDispatches[0].contract).not.toHaveProperty('priorConflictIds')
    expect(laneDispatches[0].contract).not.toHaveProperty('remediationReceipts')

    const completed = await acceptLanes(root, { includeCandidates: true })
    const synthesis = await buildFoundationReviewDispatches({
      state: completed.state,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(synthesis.map(dispatch => dispatch.role)).toEqual(['synthesis'])
    expect(synthesis[0].assignment.sourcePaths).toEqual(
      FOUNDATION_DOCUMENT_LANES.map(lane =>
        resolve(
          root,
          `.beegame/reviews/foundation/${revision}/parts/${lane.id}.md`,
        ),
      ),
    )
    expect(synthesis[0].assignment).not.toHaveProperty('verificationSourcePaths')
    expect(synthesis[0].contract.packetDigests).toEqual(
      Object.fromEntries(
        completed.state.reports
          .slice(0, 3)
          .map(report => [report.role, report.digest]),
      ),
    )
    expect(synthesis[0].contract.candidateReferences).toEqual([
      'core-design:C1',
      'technical-assets:C1',
      'presentation:C1',
    ])
  })

  test('resumes only a pending lane while preserving completed siblings', async () => {
    const root = await workspace()
    const initial = createFoundationReviewState({ revision, attempt: 1 })
    const resumed = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'core-design'
          ? {
              ...report,
              status: 'completed' as const,
              digest: 'b'.repeat(64),
            }
          : report.role === 'technical-assets'
            ? { ...report, status: 'running' as const }
            : report,
      ),
    }

    const dispatches = await buildFoundationReviewDispatches({
      state: resumed,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })
    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['presentation'])
  })

  test('removes an uncommitted lane draft before redispatch', async () => {
    const root = await workspace()
    const stagingPath = resolve(
      root,
      `.beegame/reviews/foundation/${revision}/.staging/parts/presentation.md`,
    )
    await mkdir(dirname(stagingPath), { recursive: true })
    await writeFile(stagingPath, '{"stale":true}', 'utf8')

    const initial = createFoundationReviewState({ revision, attempt: 1 })
    const resumed = {
      ...initial,
      status: 'running' as const,
      reports: initial.reports.map(report =>
        report.role === 'core-design' || report.role === 'technical-assets'
          ? {
              ...report,
              status: 'completed' as const,
              digest:
                report.role === 'core-design'
                  ? 'b'.repeat(64)
                  : 'c'.repeat(64),
            }
          : report,
      ),
    }

    const dispatches = await buildFoundationReviewDispatches({
      state: resumed,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })

    expect(dispatches.map(dispatch => dispatch.role)).toEqual(['presentation'])
    await expect(readFile(stagingPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('commits Markdown receipts and assembles canonical JSON with distinct authority digests', async () => {
    const root = await workspace()
    const acceptedLanes = await acceptLanes(root, { includeCandidates: true })
    const state = acceptedLanes.state
    const [synthesis] = await buildFoundationReviewDispatches({
      state,
      workspacePath: root,
      confirmedBriefDigest: 'd'.repeat(64),
    })
    const selection = selectionMarkdown({
      keep: ['core-design:C1'],
      reject: ['technical-assets:C1', 'presentation:C1'],
    })
    const finalStagingPath = synthesis.assignment.stagingOutputPaths[0]
    await mkdir(dirname(finalStagingPath), { recursive: true })
    await writeFile(
      finalStagingPath,
      selection,
      'utf8',
    )
    const completed = await acceptFoundationReviewWorkerTerminal({
      state,
      workspacePath: root,
      currentRevision: revision,
      terminal: {
        workerType: 'document-reviewer',
        status: 'completed',
        revision,
        mode: 'initial',
        role: 'synthesis',
        reportPath: `.beegame/reviews/foundation/${revision}/selection.md`,
      },
    })
    const committedSelection = await readFile(
      resolve(root, completed.reports[3].path),
    )
    const committedReview = await readFile(
      resolve(root, completed.finalReportPath!),
    )
    expect(completed).toMatchObject({
      status: 'completed',
      verdict: 'NEEDS_REVISION',
      finalReportPath: `.beegame/reviews/foundation/${revision}/review.json`,
    })
    expect(completed.reports[3]).toMatchObject({
      path: `.beegame/reviews/foundation/${revision}/selection.md`,
      digest: createHash('sha256').update(committedSelection).digest('hex'),
    })
    expect(completed.finalReportDigest).toBe(
      createHash('sha256').update(committedReview).digest('hex'),
    )
    expect(completed.finalReportDigest).not.toBe(completed.reports[3].digest)
    expect(JSON.parse(committedReview.toString('utf8'))).toMatchObject({
      version: 3,
      revision,
      verdict: 'NEEDS_REVISION',
      conflicts: [{ id: 'B1', title: 'core-design blocker' }],
    })

    await expect(
      acceptFoundationReviewWorkerTerminal({
        state: createFoundationReviewState({ revision, attempt: 1 }),
        workspacePath: root,
        currentRevision: 'f'.repeat(64),
        terminal: {
          workerType: 'document-reviewer',
          status: 'completed',
          revision,
          mode: 'initial',
          role: 'core-design',
          reportPath: `.beegame/reviews/foundation/${revision}/parts/core-design.md`,
        },
      }),
    ).rejects.toThrow('canonical artifacts changed during foundation review')
  })

  test('rejects tampered synthesis inputs before replacing an existing canonical review', async () => {
    const cases = [
      {
        name: 'lane receipt',
        tamper: async (input: {
          root: string
          state: Awaited<ReturnType<typeof acceptLanes>>['state']
          dispatches: Awaited<ReturnType<typeof acceptLanes>>['dispatches']
          synthesisStagingPath: string
        }) => {
          await writeFile(
            resolve(input.root, input.state.reports[0].path),
            'tampered lane receipt\n',
            'utf8',
          )
          return revision
        },
      },
      {
        name: 'selection receipt',
        tamper: async (input: {
          synthesisStagingPath: string
        }) => {
          await writeFile(
            input.synthesisStagingPath,
            '# Foundation Review Selection\n\nRevision: `stale`\n',
            'utf8',
          )
          return revision
        },
      },
      {
        name: 'source revision',
        tamper: async () => 'f'.repeat(64),
      },
      {
        name: 'projection digest',
        tamper: async (input: {
          root: string
          dispatches: Awaited<ReturnType<typeof acceptLanes>>['dispatches']
        }) => {
          const projectionPath = input.dispatches[0].contract.projection!.path
          await writeFile(resolve(input.root, projectionPath), '{}\n', 'utf8')
          return revision
        },
      },
    ]

    for (const scenario of cases) {
      const root = await workspace()
      const accepted = await acceptLanes(root)
      const [synthesis] = await buildFoundationReviewDispatches({
        state: accepted.state,
        workspacePath: root,
        confirmedBriefDigest: 'd'.repeat(64),
      })
      await mkdir(dirname(synthesis.assignment.stagingOutputPaths[0]), {
        recursive: true,
      })
      await writeFile(
        synthesis.assignment.stagingOutputPaths[0],
        selectionMarkdown(),
        'utf8',
      )
      const finalPath = resolve(
        root,
        `.beegame/reviews/foundation/${revision}/review.json`,
      )
      const existing = `${JSON.stringify(
        {
          version: 3,
          scope: 'foundation',
          revision,
          verdict: 'READY',
          conflicts: [],
        },
        null,
        2,
      )}\n`
      await writeFile(finalPath, existing, 'utf8')
      const currentRevision = await scenario.tamper({
        root,
        state: accepted.state,
        dispatches: accepted.dispatches,
        synthesisStagingPath: synthesis.assignment.stagingOutputPaths[0],
      })

      await expect(
        acceptFoundationReviewWorkerTerminal({
          state: accepted.state,
          workspacePath: root,
          currentRevision,
          terminal: {
            workerType: 'document-reviewer',
            status: 'completed',
            revision,
            mode: 'initial',
            role: 'synthesis',
            reportPath: `.beegame/reviews/foundation/${revision}/selection.md`,
          },
        }),
        scenario.name,
      ).rejects.toThrow()
      expect(await readFile(finalPath, 'utf8'), scenario.name).toBe(existing)
    }
  })
})

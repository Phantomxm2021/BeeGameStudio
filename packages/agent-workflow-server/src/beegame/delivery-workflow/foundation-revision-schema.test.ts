import { describe, expect, test } from 'bun:test'
import { foundationRevisionStateSchema } from './schema'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { foundationRevisionPacketPath } from './foundation-revision-stage'

const digest = 'a'.repeat(64)
const binding = {
  issueAuthority: { kind: 'review' as const, reviewDigest: digest, issueRegistryDigest: digest },
  derivedDigests: { sectionIndex: digest, factStore: digest, manifest: digest },
  documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest })),
}

describe('foundation revision persisted authority', () => {
  test('stores only artifact references and accepts the final phase/task union', () => {
    const parsed = foundationRevisionStateSchema.parse({
      authority: binding,
      roundBefore: { documentRevision: 'rev-1', issueRegistryDigest: digest },
      revision: 'rev-1',
      round: 1,
      phase: 'revising',
      status: 'running',
      phaseStartedAt: new Date().toISOString(),
      knownIssueIds: ['AUD-1'],
      tasks: [{
        taskId: 'rev-1.revision.1.0',
        kind: 'document-revision',
        revision: 'rev-1',
        round: 1,
        packetPath: foundationRevisionPacketPath('rev-1', 1, 'rev-1.revision.1.0'),
        packetDigest: digest,
        status: 'pending',
        attempt: 0,
        documentPath: 'docs/GDD.md',
        issueIds: ['AUD-1'],
        sectionIds: ['vision'],
        stagedPath: '.beegame/audit/foundation/rev-1/revision/docs/GDD.md',
        baseDocumentDigest: digest,
      }, {
        taskId: 'rev-1.recheck.1.0',
        kind: 'semantic-recheck',
        revision: 'rev-1',
        round: 1,
        packetPath: foundationRevisionPacketPath('rev-1', 1, 'rev-1.recheck.1.0'),
        packetDigest: digest,
        status: 'pending',
        attempt: 0,
        modelTier: 'fast',
        issueId: 'AUD-1',
      }],
    })

    expect(parsed).not.toHaveProperty('tasks.0.packet')
    expect(parsed.tasks[0]).not.toHaveProperty('packet.issues')
    expect(parsed.tasks[0]!.kind).toBe('document-revision')
  })

  test('rejects every completed receipt identity mismatch', () => {
    const task = {
      taskId: 'rev-1.revision.1.0', kind: 'document-revision' as const, revision: 'rev-1', round: 1 as const,
      packetPath: foundationRevisionPacketPath('rev-1', 1, 'rev-1.revision.1.0'), packetDigest: digest,
      status: 'completed' as const, attempt: 1, documentPath: 'docs/GDD.md' as const, issueIds: ['AUD-1'], sectionIds: ['vision'],
      stagedPath: '.beegame/audit/foundation/rev-1/revision/docs/GDD.md', baseDocumentDigest: digest,
      terminalDigest: digest,
      receipt: { taskId: 'rev-1.revision.1.0', round: 1 as const, documentPath: 'docs/GDD.md' as const, issueIds: ['AUD-1'], baseDocumentDigest: digest, stagedDocumentDigest: digest, changedSectionIds: ['vision'], stagedPath: '.beegame/audit/foundation/rev-1/revision/docs/GDD.md', terminalDigest: digest },
    }
    for (const [field, value] of Object.entries({ taskId: 'other', round: 2, documentPath: 'docs/LEVEL_SCENE_DESIGN.md', issueIds: ['AUD-2'], baseDocumentDigest: 'b'.repeat(64), stagedPath: 'stale', terminalDigest: 'b'.repeat(64) })) {
      const parsed = foundationRevisionStateSchema.safeParse({ authority: binding, roundBefore: { documentRevision: 'rev-1', issueRegistryDigest: digest }, revision: 'rev-1', round: 1, phase: 'revising', status: 'running', phaseStartedAt: new Date().toISOString(), knownIssueIds: ['AUD-1'], tasks: [{ ...task, receipt: { ...task.receipt, [field]: value } }] })
      expect(parsed.success).toBe(false)
    }
  })

  test('does not treat a completed semantic recheck as complete without its result binding', () => {
    const task = {
      taskId: 'rev-1.recheck.1.0', kind: 'semantic-recheck' as const, revision: 'rev-1', round: 1 as const,
      packetPath: foundationRevisionPacketPath('rev-1', 1, 'rev-1.recheck.1.0'), packetDigest: digest,
      status: 'completed' as const, attempt: 1, modelTier: 'strong' as const, issueId: 'AUD-1',
    }
    const base = { authority: binding, roundBefore: { documentRevision: 'rev-1', issueRegistryDigest: digest }, revision: 'rev-1', round: 1 as const, phase: 'semantic_recheck' as const, status: 'running' as const, phaseStartedAt: new Date().toISOString(), knownIssueIds: ['AUD-1'], tasks: [task] }
    expect(foundationRevisionStateSchema.safeParse(base).success).toBe(false)
    const complete = { ...task, resultPath: task.packetPath.replace(/packet\.json$/, 'result.json'), resultDigest: digest, terminalDigest: digest }
    expect(foundationRevisionStateSchema.safeParse({ ...base, tasks: [complete] }).success).toBe(true)
    for (const incomplete of [
      (() => { const { terminalDigest: _omit, ...value } = complete; return value })(),
      (() => { const { resultPath: _omit, ...value } = complete; return value })(),
      (() => { const { resultDigest: _omit, ...value } = complete; return value })(),
    ]) expect(foundationRevisionStateSchema.safeParse({ ...base, tasks: [incomplete] }).success).toBe(false)
    for (const resultPath of [
      complete.resultPath.replace('result.json', 'sibling-result.json'),
      `${complete.resultPath}/../result.json`,
      '.beegame/audit/other/result.json',
    ]) expect(foundationRevisionStateSchema.safeParse({ ...base, tasks: [{ ...complete, resultPath }] }).success).toBe(false)
  })

  test('rejects the removed shared round deadline field', () => {
    const result = foundationRevisionStateSchema.safeParse({
      authority: binding,
      roundBefore: { documentRevision: 'rev-1', issueRegistryDigest: digest },
      revision: 'rev-1', round: 1, phase: 'planning', status: 'running', phaseStartedAt: new Date().toISOString(),
      knownIssueIds: [], tasks: [], roundDeadlineAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })
})

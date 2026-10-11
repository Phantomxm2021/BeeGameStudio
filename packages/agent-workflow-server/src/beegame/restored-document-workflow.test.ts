import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { computeWorkspaceRevision } from './workspace-revision'
import { beginProjectDelivery, readProjectDelivery, projectDeliveryStatePath, recordProjectQualityReview,
  evaluateProjectDeliveryGate } from './project-delivery'

test('withdrawn v2 production state is rejected without rewriting or treating it as reviewed documents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-restored-documents-'))
  const workspace = join(root, 'project'), dataRoot = join(root, 'metadata')
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, dataRoot, 'Game')
    const path = projectDeliveryStatePath(workspace, dataRoot)
    const original = JSON.stringify({ version: 2, objective: 'Game', status: 'active', phase: 'playable' })
    await writeFile(path, original)
    await expect(readProjectDelivery(workspace, dataRoot)).rejects.toThrow('workflow was withdrawn')
    await expect(beginProjectDelivery(workspace, dataRoot, 'Game')).rejects.toThrow('workflow was withdrawn')
    expect(await readFile(path, 'utf8')).toBe(original)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('retained frontend feedback records owner objections but cannot advance phases or self-award acceptance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-restored-feedback-'))
  const workspace = join(root, 'project'), dataRoot = join(root, 'metadata')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, dataRoot, 'Game')
    const path = projectDeliveryStatePath(workspace, dataRoot)
    await writeFile(path, JSON.stringify({ ...state, phase: 'acceptance' }))
    await writeFile(join(workspace, 'game.txt'), 'unchanged fixture')
    const revision = await computeWorkspaceRevision(workspace)
    const review = { reviewerId: 'owner', decision: 'changes-required' as const, note: 'Visual treatment needs revision', revision }
    await recordProjectQualityReview(workspace, dataRoot, review)
    expect(await readProjectDelivery(workspace, dataRoot)).toMatchObject({ version: 1, phase: 'acceptance', qualityReview: review })
    expect(await evaluateProjectDeliveryGate(workspace, dataRoot)).toMatchObject({ allowed: false, layer: 'delivery', issues: [review.note] })
    const saved = await readFile(path, 'utf8')
    await expect(recordProjectQualityReview(workspace, dataRoot, { ...review, decision: 'accepted' })).rejects.toThrow('Repair or verify')
    await expect(recordProjectQualityReview(workspace, dataRoot, { ...review, revision: 'stale' })).rejects.toThrow('current revision')
    expect(await readFile(path, 'utf8')).toBe(saved)
    expect(await readFile(join(workspace, 'game.txt'), 'utf8')).toBe('unchanged fixture')
  } finally { await rm(root, { recursive: true, force: true }) }
})

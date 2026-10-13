import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beginProjectDelivery, readProjectDelivery, projectDeliveryStatePath,
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

test('retired production-review feedback cannot silently block an existing delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-restored-feedback-'))
  const workspace = join(root, 'project'), dataRoot = join(root, 'metadata')
  try {
    await mkdir(workspace)
    const state = await beginProjectDelivery(workspace, dataRoot, 'Game')
    const path = projectDeliveryStatePath(workspace, dataRoot)
    await writeFile(path, JSON.stringify({ ...state, phase: 'acceptance', qualityReview: { reviewerId: 'owner', decision: 'changes-required', note: 'Retired feedback', revision: 'old' } }))
    const gate = await evaluateProjectDeliveryGate(workspace, dataRoot)
    expect(gate?.issues).not.toContain('Retired feedback')
    expect(await readProjectDelivery(workspace, dataRoot)).toMatchObject({ version: 1, phase: 'acceptance' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

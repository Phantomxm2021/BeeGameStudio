import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditProjectDeliveryContract } from './project-delivery-contract-audit'

describe('project delivery contract audit', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('requires a structured contract instead of inferring requirements from prose', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-doc-missing-'))
    expect(auditProjectDeliveryContract(workspace)).toMatchObject({ present: false, valid: false })
  })

  test('requires all five explicit player-path phases', async () => {
    workspace = await createWorkspace({
      version: 1,
      requirements: [{ id: 'core-loop', title: 'Core loop', scope: 'mvp', evidenceRequired: ['runtime'] }],
      playerPaths: [{ id: 'main', requirementIds: ['core-loop'], phases: { entry: [{}] } }],
    })

    const audit = auditProjectDeliveryContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain('Player path main must declare structured recovery actions/assertions.')
  })

  test('accepts platform-neutral structured actions and assertions', async () => {
    const phases = {
      entry: [{ action: { id: 'enter' }, assertions: [{ state: 'ready' }] }],
      core_action: [{ action: { id: 'primary' }, assertions: [{ state: 'acted' }] }],
      state_change: [{ action: { id: 'observe' }, assertions: [{ state: 'changed' }] }],
      completion: [{ action: { id: 'complete' }, assertions: [{ state: 'completed' }] }],
      recovery: [{ action: { id: 'restart' }, assertions: [{ state: 'ready' }] }],
    }
    workspace = await createWorkspace({
      version: 1,
      requiredCapabilities: ['skill:acceptance-capability'],
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp',
        evidenceRequired: ['implementation', 'runtime'],
      }],
      playerPaths: [{ id: 'main', requirementIds: ['core-loop'], phases }],
    })

    expect(auditProjectDeliveryContract(workspace)).toMatchObject({
      valid: true,
      requiredCapabilities: ['skill:acceptance-capability'],
      playerPathIds: ['main'],
    })
  })

  async function createWorkspace(contract: Record<string, unknown>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'beegame-delivery-doc-'))
    await mkdir(join(root, 'docs'), { recursive: true })
    await writeFile(join(root, 'docs', 'delivery-contract.json'), JSON.stringify(contract))
    return root
  }
})

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
        sourceRefs: [{ path: 'docs/GDD.md', locator: '# Core loop' }],
        evidenceRequired: ['implementation', 'runtime'],
      }],
      playerPaths: [{ id: 'main', requirementIds: ['core-loop'], phases }],
      acceptanceCriteria: [{
        id: 'AC-CORE',
        sourceRef: { path: 'docs/specs/ACCEPTANCE_CRITERIA.md', locator: 'AC-CORE' },
        requirementIds: ['core-loop'],
        playerPathIds: ['main'],
      }],
    })

    expect(auditProjectDeliveryContract(workspace)).toMatchObject({
      valid: true,
      requiredCapabilities: ['skill:acceptance-capability'],
      playerPathIds: ['main'],
    })
  })

  test('rejects placeholder player-path phase objects without executable actions and assertions', async () => {
    workspace = await createWorkspace({
      version: 1,
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp',
        sourceRefs: [{ path: 'docs/GDD.md', locator: 'core-loop' }],
        evidenceRequired: ['runtime'],
      }],
      playerPaths: [{ id: 'main', requirementIds: ['core-loop'], phases: {
        entry: [{}], core_action: [{}], state_change: [{}], completion: [{}], recovery: [{}],
      } }],
    })

    const audit = auditProjectDeliveryContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain('Player path main must declare structured entry actions/assertions.')
  })

  test('rejects source locators that do not exist in the approved document', async () => {
    workspace = await createWorkspace({
      version: 1,
      requiredCapabilities: [],
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp',
        sourceRefs: [{ path: 'docs/GDD.md', locator: 'missing-section' }],
        evidenceRequired: ['document'],
      }],
      playerPaths: [],
    })

    expect(auditProjectDeliveryContract(workspace).issues).toContain(
      'Requirement core-loop sourceRef locator does not exist in docs/GDD.md: missing-section',
    )
  })

  test('requires every MVP requirement and player path in the explicit acceptance index', async () => {
    const phases = {
      entry: [{ action: { id: 'enter' }, assertions: [{ state: 'ready' }] }],
      core_action: [{ action: { id: 'primary' }, assertions: [{ state: 'acted' }] }],
      state_change: [{ action: { id: 'observe' }, assertions: [{ state: 'changed' }] }],
      completion: [{ action: { id: 'complete' }, assertions: [{ state: 'completed' }] }],
      recovery: [{ action: { id: 'restart' }, assertions: [{ state: 'ready' }] }],
    }
    workspace = await createWorkspace({
      version: 1,
      requiredCapabilities: [],
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp',
        sourceRefs: [{ path: 'docs/GDD.md', locator: '# Core loop' }],
        evidenceRequired: ['runtime'],
      }],
      playerPaths: [{ id: 'main', requirementIds: ['core-loop'], phases }],
      acceptanceCriteria: [],
    })

    const audit = auditProjectDeliveryContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain('acceptanceCriteria must be a non-empty array.')
  })

  test('rejects free-form capabilities and uncovered runtime requirements', async () => {
    workspace = await createWorkspace({
      version: 1,
      requiredCapabilities: ['threejs_rendering'],
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp',
        sourceRefs: [{ path: 'docs/GDD.md', locator: '# Core loop' }],
        evidenceRequired: ['runtime'],
      }],
      playerPaths: [],
    })

    const audit = auditProjectDeliveryContract(workspace)
    expect(audit.issues).toContain(
      'requiredCapabilities may reference only registered skill:* ids: threejs_rendering',
    )
    expect(audit.issues).toContain('Every runtime MVP requirement must be covered by a player path: core-loop')
  })

  test('rejects project-authored validation outcomes', async () => {
    workspace = await createWorkspace({
      version: 1,
      status: 'passed',
      acceptedAt: '2026-01-01T00:00:00.000Z',
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp', evidenceRequired: ['runtime'],
        status: 'accepted', evidence: [{ kind: 'runtime', detail: 'Claimed by builder.' }],
      }],
      playerPaths: [{
        id: 'main', requirementIds: ['core-loop'], phases: {
          entry: [{ action: { id: 'entry' }, assertions: [{ state: 'entered' }] }], core_action: [{ action: { id: 'act' }, assertions: [{ state: 'acted' }] }], state_change: [{ action: { id: 'observe' }, assertions: [{ state: 'changed' }] }], completion: [{ action: { id: 'complete' }, assertions: [{ state: 'completed' }] }], recovery: [{ action: { id: 'recover' }, assertions: [{ state: 'ready' }] }],
        },
      }],
    })

    const audit = auditProjectDeliveryContract(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain('Delivery contract must not declare validator-owned outcome fields: status, acceptedAt.')
    expect(audit.issues).toContain('Requirement 0 must not declare validator-owned outcome fields: status, evidence.')
  })

  async function createWorkspace(contract: Record<string, unknown>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'beegame-delivery-doc-'))
    await mkdir(join(root, 'docs'), { recursive: true })
    await mkdir(join(root, 'docs', 'specs'), { recursive: true })
    await writeFile(join(root, 'docs', 'GDD.md'), '# Core loop\n')
    await writeFile(join(root, 'docs', 'specs', 'ACCEPTANCE_CRITERIA.md'), '# Acceptance\nAC-CORE\n')
    await writeFile(join(root, 'docs', 'delivery-contract.json'), JSON.stringify(contract))
    return root
  }
})

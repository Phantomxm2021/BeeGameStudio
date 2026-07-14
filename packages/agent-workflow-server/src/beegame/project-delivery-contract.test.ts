import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureProjectDeliveryContractSkeleton,
  formatProjectDeliveryContract,
  PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES,
} from './project-delivery-contract'

describe('project delivery contract skeleton', () => {
  let workspace = ''

  afterEach(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true })
  })

  test('creates the canonical declarative skeleton without validation outcomes', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-skeleton-'))
    const path = await ensureProjectDeliveryContractSkeleton(workspace)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      requirements: [],
      playerPaths: [],
      acceptanceCriteria: [],
      requiredCapabilities: [],
    })
  })

  test('does not overwrite an existing project declaration', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'beegame-delivery-existing-'))
    const path = await ensureProjectDeliveryContractSkeleton(workspace)
    await writeFile(path, '{"version":1,"requirements":[{"id":"existing"}]}\n')
    await ensureProjectDeliveryContractSkeleton(workspace)
    expect(await readFile(path, 'utf8')).toContain('existing')
  })

  test('publishes one canonical player-path shape for prompts and diagnostics', () => {
    const format = JSON.parse(formatProjectDeliveryContract()) as {
      properties: {
        playerPaths: { items: { properties: { phases: {
          required: string[]
          properties: Record<string, unknown>
        } } } }
      }
    }
    const phases = format.properties.playerPaths.items.properties.phases
    expect(phases.required).toEqual(
      [...PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES],
    )
    expect(Object.keys(phases.properties)).toEqual([...PROJECT_DELIVERY_CONTRACT_PLAYER_PATH_PHASES])
    expect(formatProjectDeliveryContract()).not.toContain('placeholder')
  })
})

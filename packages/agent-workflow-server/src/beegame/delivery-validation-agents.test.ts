import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DELIVERY_VALIDATOR_AGENT_TYPE,
  DELIVERY_VALIDATOR_AGENT_TYPES,
  DOCUMENT_REVIEWER_AGENT_TYPE,
  materializeBeeGameNativeAgents,
} from './delivery-validation-agents'

describe('native delivery agents', () => {
  test('materializes standard Claude Code agent files without an SDK override', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-native-agents-'))
    try {
      materializeBeeGameNativeAgents(dataDir)
      const agentsDir = join(dataDir, '.runtime', 'app', 'agents')
      const validator = await readFile(
        join(agentsDir, `${DELIVERY_VALIDATOR_AGENT_TYPE}.md`),
        'utf8',
      )
      const reviewer = await readFile(
        join(agentsDir, `${DOCUMENT_REVIEWER_AGENT_TYPE}.md`),
        'utf8',
      )

      expect(DELIVERY_VALIDATOR_AGENT_TYPES).toEqual([
        'beegame-acceptance-validator',
      ])
      expect(validator).toContain(`name: ${DELIVERY_VALIDATOR_AGENT_TYPE}`)
      expect(validator).toContain('disallowedTools: [Write, Edit')
      expect(validator).toContain('Return exactly one terminal JSON object')
      expect(validator).toContain('do not assume Web, Unity, Godot, Unreal')
      expect(validator).toContain('completion claim supplied by the caller as untrusted')
      expect(validator).toContain('document, build, test, runtime, asset, and skill')
      expect(validator).toContain('Keep the terminal JSON concise')
      expect(reviewer).toContain(`name: ${DOCUMENT_REVIEWER_AGENT_TYPE}`)
      expect(reviewer).toContain('docs/ART_DIRECTION.md')
      expect(reviewer).toContain('selected document language')
      expect(reviewer).toContain('Do not edit files')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('refreshes only BeeGame-owned native agent files', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-native-agents-refresh-'))
    try {
      materializeBeeGameNativeAgents(dataDir)
      materializeBeeGameNativeAgents(dataDir)
      await expect(readFile(
        join(dataDir, '.runtime', 'app', 'agents', `${DELIVERY_VALIDATOR_AGENT_TYPE}.md`),
        'utf8',
      )).resolves.toContain('status":"passed|failed|blocked')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

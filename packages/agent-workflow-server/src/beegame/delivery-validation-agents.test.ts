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
      expect(validator).toContain('Run as a foreground native subagent')
      expect(validator).toContain('permissionMode: bubble')
      expect(validator).toContain('assets/asset-manifest.json')
      expect(validator).toContain('runtime asset load failure')
      expect(reviewer).toContain(`name: ${DOCUMENT_REVIEWER_AGENT_TYPE}`)
      expect(reviewer).toContain('tools: [Read, Glob, Grep, Skill]')
      expect(reviewer).not.toContain('tools: [Read, Glob, Grep, Skill, Bash]')
      expect(reviewer).toContain('docs/ART_DIRECTION.md')
      expect(reviewer).toContain('selected document language')
      expect(reviewer).toContain('selected game user-visible language')
      expect(reviewer).toContain('never infer one from the other')
      expect(reviewer).toContain('Do not edit files')
      expect(reviewer).toContain('Return exactly one terminal JSON object')
      expect(reviewer).toContain('READY|NEEDS_REVISION|BLOCKED')
      expect(reviewer).toContain('An empty response')
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

  test('keeps validator build and test commands on the native visible permission path', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'beegame-validator-permissions-'))
    try {
      materializeBeeGameNativeAgents(dataDir)
      const validator = await readFile(
        join(
          dataDir,
          '.runtime',
          'app',
          'agents',
          `${DELIVERY_VALIDATOR_AGENT_TYPE}.md`,
        ),
        'utf8',
      )

      expect(validator).toContain('tools: [Read, Glob, Grep, Skill, Bash')
      expect(validator).toContain('permissionMode: bubble')
      expect(validator).not.toContain('permissionMode: dontAsk')
      expect(validator).not.toContain('permissionMode: bypassPermissions')
      expect(validator).toContain('Run the project-native build and tests')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

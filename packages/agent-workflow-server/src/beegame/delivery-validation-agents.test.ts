import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DELIVERY_VALIDATOR_AGENT_TYPE,
  DELIVERY_VALIDATOR_AGENT_TYPES,
  DOCUMENT_REVIEWER_AGENT_TYPE,
  IMPLEMENTATION_AUDITOR_AGENT_TYPE,
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
      const auditor = await readFile(
        join(agentsDir, `${IMPLEMENTATION_AUDITOR_AGENT_TYPE}.md`),
        'utf8',
      )

      expect(DELIVERY_VALIDATOR_AGENT_TYPES).toEqual([
        'beegame-acceptance-validator',
      ])
      expect(validator).toContain(`name: ${DELIVERY_VALIDATOR_AGENT_TYPE}`)
      expect(validator).toContain('disallowedTools: [Write, Edit')
      expect(validator).toContain('Return exactly one terminal JSON object')
      expect(validator).toContain('Do not assume or favor any game engine or platform')
      expect(validator).toContain('Completion claims, prior reports and transcripts are context rather than evidence')
      expect(validator).toContain('Keep the terminal JSON concise')
      expect(validator).toContain('explicitly mark optional or future scope')
      expect(validator).toContain("terminal status as authoritative")
      expect(validator).not.toContain('Run as a foreground native subagent')
      expect(validator).not.toContain('run_in_background')
      expect(validator).not.toContain('permissionMode: bubble')
      expect(validator).not.toContain('skills: [beegame-game-acceptance]')
      expect(validator).toContain('A keyboard shortcut is not evidence for a documented mouse or touch interaction')
      expect(validator).toContain('direct state mutation')
      expect(validator).toContain('verify the rendered result and interaction')
      expect(validator).not.toContain('At the beginning of this validation pass')
      expect(validator).not.toContain('Request those project-native capabilities')
      expect(validator).not.toContain('cross-Pack')
      expect(validator).not.toContain('candidate ranking')

      const validatorFrontmatter = readMaterializedFrontmatter(validator)
      expect(validatorFrontmatter.has('background')).toBe(false)
      expect(validatorFrontmatter.has('permissionMode')).toBe(false)
      expect(reviewer).toContain(`name: ${DOCUMENT_REVIEWER_AGENT_TYPE}`)
      expect(reviewer).toContain('tools: [Read, Glob, Grep, Skill, ProjectDeliveryContract]')
      expect(reviewer).not.toContain('tools: [Read, Glob, Grep, Skill, Bash]')
      expect(reviewer).toContain('confirmed project intent')
      expect(reviewer).toContain('language requirements')
      expect(reviewer).not.toContain('docs/ART_DIRECTION.md')
      expect(reviewer).toContain('Do not edit files')
      expect(reviewer).toContain('Return exactly one terminal JSON object')
      expect(reviewer).toContain('READY|NEEDS_REVISION|BLOCKED')
      expect(reviewer).toContain('An empty response')
      expect(reviewer).toContain('Do not impose an implementation strategy')
      expect(reviewer).toContain('deterministic platform contract diagnostics')
      expect(reviewer).not.toContain('RESOURCE_ASSET_MANIFEST_VOCABULARY')
      expect(reviewer).not.toContain('Cross-Pack composition')
      expect(reviewer).not.toContain('asset_format_capabilities')
      expect(auditor).toContain(`name: ${IMPLEMENTATION_AUDITOR_AGENT_TYPE}`)
      expect(auditor).toContain('tools: [Read, Glob, Grep, Skill, ProjectDeliveryContract]')
      expect(auditor).toContain('disallowedTools: [Write, Edit, MultiEdit, NotebookEdit, Bash]')
      expect(auditor).toContain('copied-but-unreferenced assets')
      expect(auditor).toContain('Do not operate the game')
      expect(auditor).toContain('response language requirement')
      expect(auditor).toContain('Return exactly one terminal JSON object')
      expect(auditor).toContain('"status":"passed|failed|blocked"')
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
      expect(validator).not.toContain('permissionMode: bubble')
      expect(validator).not.toContain('permissionMode: dontAsk')
      expect(validator).not.toContain('permissionMode: bypassPermissions')
      expect(validator).toContain('report the precise blocker without bypassing the permission decision')
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

function readMaterializedFrontmatter(markdown: string): Map<string, string> {
  const frontmatter = markdown.split('---', 3)[1] ?? ''
  const entries: Array<[string, string]> = []
  for (const line of frontmatter.split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    entries.push([
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    ])
  }
  return new Map(entries)
}

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
      expect(validator).toContain('explicitly non-blocking observations')
      expect(validator).toContain("terminal status as authoritative")
      expect(validator).toContain('Run as a foreground native subagent')
      expect(validator).toContain('custom background agents cannot display interactive permission requests')
      expect(validator).not.toContain('permissionMode: bubble')
      expect(validator).toContain('do not retry equivalent command variants')
      expect(validator).toContain('named test and assertions actually exercise')
      expect(validator).toContain('generated siblings in authored source directories')
      expect(validator).toContain('assets/asset-manifest.json')
      expect(validator).toContain('Runtime asset evidence must be observed during this Validator run')
      expect(validator).toContain('normal player-facing view')
      expect(validator).toContain('independently normalized overlapping parts')
      expect(validator).toContain('dependency closures')
      expect(validator).toContain('do not reconstruct or second-guess candidate ranking')
      expect(validator).toContain('fixed Pack version')
      expect(validator).toContain('Do not infer compatibility from platform or filenames')

      const validatorFrontmatter = readMaterializedFrontmatter(validator)
      expect(validatorFrontmatter.has('background')).toBe(false)
      expect(validatorFrontmatter.has('permissionMode')).toBe(false)
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
      expect(reviewer).toContain('project_target')
      expect(reviewer).toContain('requirements and imports to be arrays')
      expect(reviewer).toContain('compositions to be an array')
      expect(reviewer).toContain('legacy or invented root shapes')
      expect(reviewer).toContain('whose task text begins with its stable machine-readable identifier')
      expect(reviewer).toContain('asset_format_capabilities to be one flat array of format strings')
      expect(reviewer).toContain('project_target.resource_library_usage')
      expect(reviewer).toContain('Under required usage')
      expect(reviewer).toContain('Resource Library results are alternatives chosen by Claude Code')
      expect(reviewer).toContain('mutable integration state is validated later')
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
      expect(validator).toContain('Request those project-native capabilities before performing the detailed source review')
      expect(validator).toContain('Record one precise BLOCKED finding')
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

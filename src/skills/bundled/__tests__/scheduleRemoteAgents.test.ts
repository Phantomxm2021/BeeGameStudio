import { expect, test } from 'bun:test'

test('schedule prompt generation never creates a cloud environment', async () => {
  // Keep module mocks in a child so they cannot affect other skill suites.
  const cwd = new URL('../../../../', import.meta.url).pathname
  const script = `
    import { mock } from 'bun:test'
    import { resolve } from 'node:path'

    const modulePath = path => resolve(process.cwd(), path)
    let command
    let environments = []
    let creates = 0
    let reads = 0

    mock.module(modulePath('src/skills/bundledSkills.ts'), () => ({
      registerBundledSkill: definition => { command = definition },
    }))
    mock.module(modulePath('src/services/analytics/growthbook.ts'), () => ({
      getFeatureValue_CACHED_MAY_BE_STALE: () => true,
    }))
    mock.module(modulePath('src/services/policyLimits/index.ts'), () => ({
      isPolicyAllowed: () => true,
    }))
    mock.module('@bee-game-studio/builtin-tools/tools/AskUserQuestionTool/prompt.js', () => ({
      ASK_USER_QUESTION_TOOL_NAME: 'AskUserQuestion',
    }))
    mock.module('@bee-game-studio/builtin-tools/tools/RemoteTriggerTool/prompt.js', () => ({
      REMOTE_TRIGGER_TOOL_NAME: 'RemoteTrigger',
    }))
    mock.module(modulePath('src/utils/auth.ts'), () => ({
      getClaudeAIOAuthTokens: () => ({ accessToken: 'offline-fixture' }),
    }))
    mock.module(modulePath('src/utils/background/remote/preconditions.ts'), () => ({
      checkRepoForRemoteAccess: async () => ({ hasAccess: true }),
    }))
    mock.module(modulePath('src/utils/debug.ts'), () => ({ logForDebugging: () => {} }))
    mock.module(modulePath('src/utils/detectRepository.ts'), () => ({
      detectCurrentRepositoryWithHost: async () => null,
      parseGitRemote: () => null,
    }))
    mock.module(modulePath('src/utils/git.ts'), () => ({ getRemoteUrl: async () => null }))
    mock.module(modulePath('src/utils/slowOperations.ts'), () => ({ jsonStringify: JSON.stringify }))
    mock.module(modulePath('src/utils/teleport/environments.ts'), () => ({
      fetchEnvironments: async () => { reads++; return environments },
      createDefaultCloudEnvironment: async () => {
        creates++
        return { name: 'unexpected', environment_id: 'unexpected', kind: 'cloud' }
      },
    }))

    const { registerScheduleRemoteAgentsSkill } = await import(modulePath('src/skills/bundled/scheduleRemoteAgents.ts'))
    registerScheduleRemoteAgentsSkill()
    const results = []
    const existing = { name: 'fixture', environment_id: 'existing-env', kind: 'cloud' }
    for (const available of [[], [existing]]) {
      environments = available
      for (const request of ['', 'list triggers', 'update an existing trigger', 'create a weekly trigger']) {
        const blocks = await command.getPromptForCommand(request, { options: { mcpClients: [] } })
        results.push({
          available: available.length,
          textBlocks: blocks.filter(block => block.type === 'text' && block.text.length > 0).length,
          existingIncluded: blocks.some(block => block.type === 'text' && block.text.includes(existing.environment_id)),
        })
      }
    }
    process.stdout.write(JSON.stringify({ name: command.name, enabled: command.isEnabled(), reads, creates, results }))
  `
  const child = Bun.spawn([process.execPath, '-e', script], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  const result = JSON.parse(stdout)
  expect(result.name).toBe('schedule')
  expect(result.enabled).toBe(true)
  expect(result.reads).toBe(8)
  expect(result.creates).toBe(0)
  expect(result.results).toHaveLength(8)
  for (const item of result.results) {
    expect(item.textBlocks).toBe(1)
    expect(item.existingIncluded).toBe(item.available > 0)
  }
})

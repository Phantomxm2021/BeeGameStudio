import { mock, describe, expect, test } from 'bun:test'
import { logMock } from '../../../../tests/mocks/log'
import { createFileStateCacheWithSizeLimit } from '../../../utils/fileStateCache.js'
import { createSubagentContext } from '../../../utils/forkedAgent.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import type { ToolUseContext } from '../../../Tool.js'
import { z } from 'zod/v4'

mock.module('src/utils/log.ts', logMock)

const {
  getDenyRuleForTool,
  getAskRuleForTool,
  getDenyRuleForAgent,
  filterDeniedAgents,
  hasPermissionsToUseTool,
} = await import('../permissions')

function makeContext(opts: { denyRules?: string[]; askRules?: string[] }) {
  const ctx = getEmptyToolPermissionContext()
  const deny: Record<string, string[]> = {}
  const ask: Record<string, string[]> = {}
  if (opts.denyRules?.length) deny.localSettings = opts.denyRules
  if (opts.askRules?.length) ask.localSettings = opts.askRules
  return { ...ctx, alwaysDenyRules: deny, alwaysAskRules: ask } as any
}

function makeTool(
  name: string,
  mcpInfo?: { serverName: string; toolName: string },
) {
  return { name, mcpInfo }
}

describe('getDenyRuleForTool', () => {
  test('returns null when no deny rules', () => {
    const ctx = makeContext({})
    expect(getDenyRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
  test('returns matching deny rule for tool', () => {
    const ctx = makeContext({ denyRules: ['Bash'] })
    const result = getDenyRuleForTool(ctx, makeTool('Bash'))
    expect(result).not.toBeNull()
    expect(result!.ruleValue.toolName).toBe('Bash')
  })
  test('returns null for non-matching tool', () => {
    const ctx = makeContext({ denyRules: ['Bash'] })
    expect(getDenyRuleForTool(ctx, makeTool('Read'))).toBeNull()
  })
  test('rule with content does not match whole-tool deny', () => {
    const ctx = makeContext({ denyRules: ['Bash(rm -rf)'] })
    const result = getDenyRuleForTool(ctx, makeTool('Bash'))
    expect(result).toBeNull()
  })
})

describe('getAskRuleForTool', () => {
  test('returns null when no ask rules', () => {
    const ctx = makeContext({})
    expect(getAskRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
  test('returns matching ask rule', () => {
    const ctx = makeContext({ askRules: ['Write'] })
    const result = getAskRuleForTool(ctx, makeTool('Write'))
    expect(result).not.toBeNull()
  })
  test('returns null for non-matching tool', () => {
    const ctx = makeContext({ askRules: ['Write'] })
    expect(getAskRuleForTool(ctx, makeTool('Bash'))).toBeNull()
  })
})

describe('getDenyRuleForAgent', () => {
  test('returns null when no deny rules', () => {
    const ctx = makeContext({})
    expect(getDenyRuleForAgent(ctx, 'Agent', 'Explore')).toBeNull()
  })
  test('returns matching deny rule for agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    const result = getDenyRuleForAgent(ctx, 'Agent', 'Explore')
    expect(result).not.toBeNull()
  })
  test('returns null for non-matching agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    expect(getDenyRuleForAgent(ctx, 'Agent', 'Research')).toBeNull()
  })
})

describe('Langfuse trace propagation', () => {
  test('subagent context preserves parent trace for nested side queries', () => {
    const parentTrace = { id: 'parent-trace' } as never
    const parentContext = {
      ...getEmptyToolPermissionContext(),
      messages: [],
      abortController: new AbortController(),
      readFileState: createFileStateCacheWithSizeLimit(1),
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      langfuseTrace: parentTrace,
    } as never
    const subagentContext = createSubagentContext(parentContext)
    expect(subagentContext.langfuseRootTrace).toBe(parentTrace)
  })
})

describe('filterDeniedAgents', () => {
  test('returns all agents when no deny rules', () => {
    const ctx = makeContext({})
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    expect(filterDeniedAgents(agents, ctx, 'Agent')).toEqual(agents)
  })
  test('filters out denied agent type', () => {
    const ctx = makeContext({ denyRules: ['Agent(Explore)'] })
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    const result = filterDeniedAgents(agents, ctx, 'Agent')
    expect(result).toHaveLength(1)
    expect(result[0]!.agentType).toBe('Research')
  })
  test('returns empty array when all agents denied', () => {
    const ctx = makeContext({
      denyRules: ['Agent(Explore)', 'Agent(Research)'],
    })
    const agents = [{ agentType: 'Explore' }, { agentType: 'Research' }]
    expect(filterDeniedAgents(agents, ctx, 'Agent')).toEqual([])
  })
})

describe('native project automatic permissions and deferred tools', () => {
  test('bypass allows routine work while preserving explicit ask, deny and safety checks', async () => {
    const { buildTool } = await import('../../../Tool.js')
    const tool = buildTool({
      name: 'PermissionFixture',
      inputSchema: z.object({}),
      checkPermissions: async () => ({
        behavior: 'passthrough',
        message: 'Routine tool',
      }),
    } as never)
    const permissionContext = {
      ...getEmptyToolPermissionContext(),
      mode: 'bypassPermissions' as const,
    }
    const ctx = {
      abortController: new AbortController(),
      getAppState: () => ({ toolPermissionContext: permissionContext }),
    } as unknown as ToolUseContext
    const parent = {} as never
    expect(
      (await hasPermissionsToUseTool(tool, {}, ctx, parent, 'call')).behavior,
    ).toBe('allow')
    permissionContext.alwaysAskRules.flagSettings = [tool.name]
    expect(
      (await hasPermissionsToUseTool(tool, {}, ctx, parent, 'call')).behavior,
    ).toBe('ask')
    permissionContext.alwaysDenyRules.flagSettings = [tool.name]
    expect(
      (await hasPermissionsToUseTool(tool, {}, ctx, parent, 'call')).behavior,
    ).toBe('deny')
    permissionContext.alwaysAskRules = {}
    permissionContext.alwaysDenyRules = {}
    tool.checkPermissions = async () => ({
      behavior: 'ask',
      message: 'Safety review',
      decisionReason: {
        type: 'safetyCheck',
        reason: 'Protected file',
        classifierApprovable: false,
      },
    })
    expect(
      (await hasPermissionsToUseTool(tool, {}, ctx, parent, 'call')).behavior,
    ).toBe('ask')
  })

  test.each(['allow', 'ask', 'deny'] as const)(
    'wrapped DiscoverSkills uses native %s decision without a wrapper prompt',
    async behavior => {
      const { ExecuteTool } = await import(
        '@bee-game-studio/builtin-tools/tools/ExecuteTool/ExecuteTool.js'
      )
      const { DiscoverSkillsTool } = await import(
        '@bee-game-studio/builtin-tools/tools/DiscoverSkillsTool/DiscoverSkillsTool.js'
      )
      // Keep the real tool schema and default permissions; replace only the
      // local search effect so the test has no dependency on installed skills.
      const call = mock(async () => ({ data: { results: [], count: 0 } }))
      const target = { ...DiscoverSkillsTool, call }
      const permissionContext = getEmptyToolPermissionContext()
      if (behavior === 'ask')
        permissionContext.alwaysAskRules.flagSettings = [target.name]
      if (behavior === 'deny')
        permissionContext.alwaysDenyRules.flagSettings = [target.name]
      const ctx = {
        options: { tools: [ExecuteTool, target] },
        messages: [],
        toolUseId: 'wrapped-discovery',
        abortController: new AbortController(),
        getAppState: () => ({ toolPermissionContext: permissionContext }),
      } as unknown as ToolUseContext
      const parent = {} as never
      const input = {
        tool_name: target.name,
        params: { description: 'game design' },
      }
      expect(
        (
          await hasPermissionsToUseTool(
            ExecuteTool,
            input,
            ctx,
            parent,
            ctx.toolUseId!,
          )
        ).behavior,
      ).toBe('allow')
      const broker = mock(hasPermissionsToUseTool)
      const result = await ExecuteTool.call(input, ctx, broker, parent)
      expect(broker).toHaveBeenCalledWith(
        target,
        input.params,
        ctx,
        parent,
        ctx.toolUseId,
      )
      expect(call).toHaveBeenCalledTimes(behavior === 'allow' ? 1 : 0)
      expect(result.data.result).toEqual(
        behavior === 'allow' ? { results: [], count: 0 } : null,
      )
    },
  )
})

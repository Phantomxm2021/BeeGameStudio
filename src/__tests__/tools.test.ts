import { describe, expect, test } from 'bun:test'
import {
  filterToolsByDenyRules,
  getTools,
  parseToolPreset,
} from '../tools'
import { getEmptyToolPermissionContext } from '../Tool'

describe('parseToolPreset', () => {
  test('returns "default" for "default" input', () => {
    expect(parseToolPreset('default')).toBe('default')
  })

  test('returns "default" for "Default" input (case-insensitive)', () => {
    expect(parseToolPreset('Default')).toBe('default')
  })

  test('returns null for unknown preset', () => {
    expect(parseToolPreset('unknown')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(parseToolPreset('')).toBeNull()
  })

  test('returns null for random string', () => {
    expect(parseToolPreset('custom-preset')).toBeNull()
  })
})

describe('foundation revision native tool registration', () => {
  test('builds a complete tool for the CLI bootstrap inventory', () => {
    const previousWorkerType = process.env.BEEGAME_WORKFLOW_WORKER_TYPE
    const previousContract = process.env.BEEGAME_REVISION_CONTRACT
    const previousWorkspace = process.env.BEEGAME_WORKSPACE_PATH
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_WORKSPACE_PATH = '/workspace'
    process.env.BEEGAME_REVISION_CONTRACT = JSON.stringify({
      taskId: 'task-1',
      revision: 'revision-1',
      round: 1,
      documentPath: 'docs/GDD.md',
      issueIds: ['issue-1'],
      sectionIds: ['section-1'],
      stagedPath: '.beegame/audit/foundation/revision/docs/GDD.md',
      baseDocumentDigest: 'a'.repeat(64),
    })

    try {
      const tool = getTools(getEmptyToolPermissionContext()).find(
        candidate => candidate.name === 'SubmitFoundationRevisionResult',
      )
      expect(tool).toBeDefined()
      expect(tool?.isEnabled()).toBe(true)
      expect(tool?.isConcurrencySafe({} as never)).toBe(false)
    } finally {
      if (previousWorkerType === undefined)
        delete process.env.BEEGAME_WORKFLOW_WORKER_TYPE
      else process.env.BEEGAME_WORKFLOW_WORKER_TYPE = previousWorkerType
      if (previousContract === undefined)
        delete process.env.BEEGAME_REVISION_CONTRACT
      else process.env.BEEGAME_REVISION_CONTRACT = previousContract
      if (previousWorkspace === undefined)
        delete process.env.BEEGAME_WORKSPACE_PATH
      else process.env.BEEGAME_WORKSPACE_PATH = previousWorkspace
    }
  })

  test('registers a dynamic round and rejects invalid rounds', () => {
    const previousWorkerType = process.env.BEEGAME_WORKFLOW_WORKER_TYPE
    const previousContract = process.env.BEEGAME_REVISION_CONTRACT
    const previousWorkspace = process.env.BEEGAME_WORKSPACE_PATH
    process.env.BEEGAME_WORKFLOW_WORKER_TYPE = 'foundation-document-reviser'
    process.env.BEEGAME_WORKSPACE_PATH = '/workspace'
    const base = {
      taskId: 'task-4',
      revision: 'revision-4',
      documentPath: 'docs/GDD.md',
      issueIds: ['issue-1'],
      sectionIds: ['section-1'],
      stagedPath: '.beegame/audit/foundation/revision/docs/GDD.md',
      baseDocumentDigest: 'a'.repeat(64),
    }
    try {
      process.env.BEEGAME_REVISION_CONTRACT = JSON.stringify({ ...base, round: 4 })
      expect(
        getTools(getEmptyToolPermissionContext()).find(
          candidate => candidate.name === 'SubmitFoundationRevisionResult',
        ),
      ).toBeDefined()

      process.env.BEEGAME_REVISION_CONTRACT = JSON.stringify({ ...base, round: 0 })
      expect(
        getTools(getEmptyToolPermissionContext()).find(
          candidate => candidate.name === 'SubmitFoundationRevisionResult',
        ),
      ).toBeUndefined()

      for (const round of [Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        process.env.BEEGAME_REVISION_CONTRACT = JSON.stringify({ ...base, round })
        expect(
          getTools(getEmptyToolPermissionContext()).find(
            candidate => candidate.name === 'SubmitFoundationRevisionResult',
          ),
        ).toBeUndefined()
      }

      process.env.BEEGAME_REVISION_CONTRACT = JSON.stringify({ ...base, round: 4 })
      delete process.env.BEEGAME_WORKSPACE_PATH
      expect(
        getTools(getEmptyToolPermissionContext()).find(
          candidate => candidate.name === 'SubmitFoundationRevisionResult',
        ),
      ).toBeUndefined()
      process.env.BEEGAME_WORKSPACE_PATH = 'relative/workspace'
      expect(
        getTools(getEmptyToolPermissionContext()).find(
          candidate => candidate.name === 'SubmitFoundationRevisionResult',
        ),
      ).toBeUndefined()
    } finally {
      if (previousWorkerType === undefined)
        delete process.env.BEEGAME_WORKFLOW_WORKER_TYPE
      else process.env.BEEGAME_WORKFLOW_WORKER_TYPE = previousWorkerType
      if (previousContract === undefined)
        delete process.env.BEEGAME_REVISION_CONTRACT
      else process.env.BEEGAME_REVISION_CONTRACT = previousContract
      if (previousWorkspace === undefined)
        delete process.env.BEEGAME_WORKSPACE_PATH
      else process.env.BEEGAME_WORKSPACE_PATH = previousWorkspace
    }
  })
})

// ─── filterToolsByDenyRules ─────────────────────────────────────────────

describe('filterToolsByDenyRules', () => {
  const mockTools = [
    { name: 'Bash', mcpInfo: undefined },
    { name: 'Read', mcpInfo: undefined },
    { name: 'Write', mcpInfo: undefined },
    {
      name: 'mcp__server__tool',
      mcpInfo: { serverName: 'server', toolName: 'tool' },
    },
  ]

  test('returns all tools when no deny rules', () => {
    const ctx = getEmptyToolPermissionContext()
    const result = filterToolsByDenyRules(mockTools, ctx)
    expect(result).toHaveLength(4)
  })

  test('filters out denied tool by name', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result.find(t => t.name === 'Bash')).toBeUndefined()
    expect(result).toHaveLength(3)
  })

  test('filters out multiple denied tools', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: ['Bash', 'Write'],
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(2)
    expect(result.map(t => t.name)).toEqual(['Read', 'mcp__server__tool'])
  })

  test('returns empty array when all tools denied', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: {
        localSettings: mockTools.map(t => t.name),
      },
    }
    const result = filterToolsByDenyRules(mockTools, ctx as any)
    expect(result).toHaveLength(0)
  })

  test('handles empty tools array', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(filterToolsByDenyRules([], ctx)).toEqual([])
  })
})

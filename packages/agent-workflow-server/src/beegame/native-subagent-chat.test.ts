import { describe, expect, test } from 'bun:test'
import { createNativeSubagentChatEnricher } from './native-subagent-chat'

describe('native subagent chat observation', () => {
  test('routes approvals by native agent ID or known tool owner, never the most recent agent', () => {
    const enrich = createNativeSubagentChatEnricher()
    for (const id of ['a', 'b']) enrich({ type: 'system.status', payload: { type: 'runtime_event', childThreadId: 'native-' + id, parentToolUseID: 'owner-' + id } })
    const requested = enrich({ type: 'permission.requested', payload: { toolUseID: 'bash-a', agentId: 'native-a' } })
    expect(requested.payload).toHaveProperty('parentToolUseID', 'owner-a')
    expect(enrich({ type: 'permission.resolved', payload: { toolUseID: 'bash-a', agentId: 'native-a' } }).payload)
      .toHaveProperty('parentToolUseID', 'owner-a')
    enrich({ type: 'tool.started', payload: { toolUseID: 'read-b', parentToolUseID: 'owner-b' } })
    expect(enrich({ type: 'permission.requested', payload: { toolUseID: 'read-b' } }).payload)
      .toHaveProperty('parentToolUseID', 'owner-b')
    expect(enrich({ type: 'permission.requested', payload: { toolUseID: 'unknown', agentId: 'not-known' } }).payload)
      .not.toHaveProperty('parentToolUseID')
  })

})

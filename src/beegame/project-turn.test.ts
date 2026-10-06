import { expect, test } from 'bun:test'
import { parseNativeProjectTurn } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { createAssistantMessage, createUserMessage } from '../utils/messages.js'
import { projectMilestoneBoundary } from './project-turn.js'

test('completed-milestone boundary preserves user instructions and images, not tool logs or signed assistant history', () => {
  const user = createUserMessage({ content: [
    { type: 'text', text: 'BGS project state (platform context, not additional user instructions): Original confirmed constraints' },
    { type: 'text', text: 'Human constraint: offline, no external assets.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'OFFLINE_FIXTURE' } },
  ] })
  const assistant = createAssistantMessage({ content: [
    { type: 'thinking', thinking: 'UNRETAINED_THOUGHT', signature: 'UNCHANGED_SIGNATURE' },
    { type: 'tool_use', id: 'fixture-tool', name: 'Bash', input: { command: 'fixture' } },
  ] })
  const tool = createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'fixture-tool', content: 'OLD_EXECUTION_LOG' }] })
  const later = createUserMessage({ content: [
    { type: 'text', text: 'BGS project state (platform context, not additional user instructions): EXPIRED_CAPABILITY' },
    { type: 'text', text: 'Human correction: retain the original art direction.' },
  ] })
  const old = [user, assistant, tool, later]
  const raw = JSON.stringify(old)
  const next = projectMilestoneBoundary(old)
  expect(next[0]).toMatchObject({ type: 'system', subtype: 'compact_boundary', logicalParentUuid: later.uuid })
  const retained = JSON.stringify(next[1])
  for (const required of ['Original confirmed constraints', 'offline, no external assets', 'OFFLINE_FIXTURE', 'retain the original art direction'])
    expect(retained).toContain(required)
  for (const discarded of ['OLD_EXECUTION_LOG', 'UNCHANGED_SIGNATURE', 'UNRETAINED_THOUGHT', 'EXPIRED_CAPABILITY'])
    expect(retained).not.toContain(discarded)
  expect(JSON.stringify(old)).toBe(raw)
  const following = projectMilestoneBoundary([...next, createUserMessage({ content: 'New human requirement' })])
  expect(JSON.stringify(following)).toContain('offline, no external assets')
  expect(JSON.stringify(following)).toContain('New human requirement')
  expect(JSON.stringify(following).split('Earlier user inputs below').length - 1).toBe(1)
})

test('an earlier native model summary is retained but not relabeled as verbatim human authority', () => {
  const next = projectMilestoneBoundary([createUserMessage({ isMeta: true, isCompactSummary: true, content: 'Old model summary' })])
  expect(JSON.stringify(next)).toContain('pre-existing native compact summary, not a verbatim user instruction')
  expect(JSON.stringify(next)).toContain('Old model summary')
})

test('project-turn metadata rejects invalid shape, duplicate or escaping document paths', () => {
  expect(parseNativeProjectTurn(undefined)).toBeUndefined()
  expect(parseNativeProjectTurn({ restartContext: false, reviewDocuments: ['GDD.md'] })).toEqual({ restartContext: false, reviewDocuments: ['GDD.md'] })
  for (const invalid of [null, {}, { restartContext: 'true' }, { restartContext: true, reviewDocuments: [] },
    { restartContext: true, reviewDocuments: ['../GDD.md'] }, { restartContext: true, reviewDocuments: ['GDD.md', 'GDD.md'] }])
    expect(() => parseNativeProjectTurn(invalid)).toThrow()
})

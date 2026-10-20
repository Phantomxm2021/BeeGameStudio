import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { clearInvokedSkills, getInvokedSkillsForAgent } from '../../bootstrap/state.js'
import { createSkillAttachmentIfNeeded } from '../../services/compact/compact.js'
import { preserveCompactContext } from '../../services/compact/preservedContext.js'
import type { Message } from '../../types/message.js'
import { loadMessagesFromJsonlPath, restoreSkillStateFromMessages } from '../conversationRecovery.js'
import { normalizeAttachmentForAPI } from '../messages.js'
import { isLoggableMessage, loadFullLog } from '../sessionStorage.js'
import type { LogOption } from '../../types/logs.js'

const skillName = 'test:execution'
const body = 'Base directory for this skill: /offline/skills/execution\n\n# Execution\nRead the authored nodes before consuming actions.'
let directory: string
let previousUserType: string | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'skill-state-recovery-'))
  previousUserType = process.env.USER_TYPE
  process.env.USER_TYPE = 'external'
  clearInvokedSkills()
})
afterEach(() => {
  clearInvokedSkills()
  if (previousUserType === undefined) delete process.env.USER_TYPE
  else process.env.USER_TYPE = previousUserType
  rmSync(directory, { recursive: true, force: true })
})

function message(type: Message['type'], content: unknown, extra = {}): Message {
  return { type, uuid: randomUUID(), message: { role: type, ...(type === 'assistant' ? { id: randomUUID() } : {}), content }, ...extra } as Message
}
function invocation(content = body, name = skillName): Message[] {
  const id = randomUUID()
  return [
    message('assistant', [{ type: 'tool_use', id, name: 'Skill', input: { skill: name } }]),
    message('user', [{ type: 'text', text: content }], { isMeta: true, sourceToolUseID: id }),
  ]
}
async function persisted(messages: Message[], name: string): Promise<Message[]> {
  const entries = messages.filter(isLoggableMessage)
  const file = join(directory, name + '.jsonl')
  writeFileSync(file, entries.map((entry, i) => JSON.stringify({
    ...entry, parentUuid: entries[i - 1]?.uuid ?? null,
    sessionId: 'offline-session', timestamp: new Date(1700000000000 + i).toISOString(),
  })).join('\n') + '\n')
  const loaded = await loadMessagesFromJsonlPath(file)
  const full = await loadFullLog({ messages: [], sessionId: 'offline-session', fullPath: file } as LogOption)
  expect(full.messages.map(m => m.uuid)).toEqual(loaded.messages.map(m => m.uuid))
  return full.messages as Message[]
}

test('stop, resume, compact and resume again preserve the invoked body in model context', async () => {
  const beforeStop = invocation()
  // Put the invocation outside the raw recent-round window.
  for (let n = 0; n < 4; n++) beforeStop.push(message('user', 'continue'), message('assistant', 'saved work'))
  const resumed = await persisted(beforeStop, 'stopped')
  restoreSkillStateFromMessages(resumed)
  expect([...getInvokedSkillsForAgent(null).values()]).toMatchObject([
    { skillName, skillPath: '/offline/skills/execution', content: body },
  ])
  const kept = preserveCompactContext(resumed).messagesToKeep
  expect(JSON.stringify(kept)).not.toContain('# Execution')
  const attachment = createSkillAttachmentIfNeeded()!
  expect(attachment).not.toBeNull()
  expect(isLoggableMessage(attachment)).toBe(true)
  const compacted = await persisted([
    message('system', undefined, { subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 1000 } }),
    message('user', 'Continue the pending task', { isCompactSummary: true }),
    ...kept, attachment,
  ], 'compacted')
  clearInvokedSkills() // A fresh runtime has no process-local skill state.
  restoreSkillStateFromMessages(compacted)
  const restored = createSkillAttachmentIfNeeded()!
  expect(normalizeAttachmentForAPI(restored.attachment as any).map(m => m.message.content).join('\n')).toContain(body)
  expect(getInvokedSkillsForAgent(null).size).toBe(1)
})

test('only a correlated main-session Skill body restores state', () => {
  const [call, inline] = invocation()
  const readCall = message('assistant', [{ type: 'tool_use', id: 'read', name: 'Read', input: {} }])
  restoreSkillStateFromMessages([
    call!, readCall,
    { ...inline!, isMeta: false },
    { ...inline!, sourceToolUseID: 'missing' },
    { ...inline!, sourceToolUseID: 'read' },
    { ...inline!, isSidechain: true },
    { ...inline!, message: { role: 'user', content: [{ type: 'text', text: 'Launching skill: test:execution' }] } },
  ])
  expect(getInvokedSkillsForAgent(null).size).toBe(0)
  restoreSkillStateFromMessages([call!, inline!])
  expect(getInvokedSkillsForAgent(null).size).toBe(1)
  // No blanket exception for other internal attachments.
  expect(isLoggableMessage({ type: 'attachment', uuid: randomUUID(), attachment: { type: 'file' } } as Message)).toBe(false)
})

test('a later invocation replaces the same skill without duplicating or reloading it', () => {
  const updated = body.replace('# Execution', '# Updated execution')
  restoreSkillStateFromMessages([...invocation(), ...invocation(updated)])
  const skills = [...getInvokedSkillsForAgent(null).values()]
  expect(skills).toHaveLength(1)
  expect(skills[0]!.content).toBe(updated)
})

// Native command loads carry provenance on the same body, not a second copy.
test('command-loaded Skill survives persisted stop, resume and compaction without a fabricated tool call', async () => {
  const inline = message('user', [{type:'text',text:body}], {
    isMeta: true, invokedSkill: {name:skillName,path:'plugin:'+skillName},
  })
  const resumed = await persisted([inline], 'command')
  restoreSkillStateFromMessages(resumed)
  expect([...getInvokedSkillsForAgent(null).values()]).toMatchObject([
    {skillName,skillPath:'plugin:'+skillName,content:body},
  ])
  const attachment = createSkillAttachmentIfNeeded()!
  clearInvokedSkills()
  restoreSkillStateFromMessages(await persisted([attachment], 'command-compacted'))
  expect([...getInvokedSkillsForAgent(null).values()][0]?.content).toBe(body)
  clearInvokedSkills()
  restoreSkillStateFromMessages([{...inline,isMeta:false},{...inline,isSidechain:true}])
  expect(getInvokedSkillsForAgent(null).size).toBe(0)
})

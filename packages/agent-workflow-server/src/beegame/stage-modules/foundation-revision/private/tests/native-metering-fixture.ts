// Fixed local protocol fixture: no model, network, or filesystem writes.
import { createInterface } from 'node:readline'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const input = createInterface({ input: process.stdin })
input.once('line', async line => {
  const user = JSON.parse(line)
  if (user.message.content[0].text.includes('# incomplete')) throw new Error('whole document leaked in prompt')
  const contract = JSON.parse(process.env.BEEGAME_REVISION_CONTRACT!)
  if (contract.scope !== 'document' || contract.stagedPath !== 'assigned.md') throw new Error('wrong assignment')
  const markdown = await readFile(join(process.env.BEEGAME_WORKSPACE_PATH!, contract.stagedPath), 'utf8')
  if (markdown !== '# incomplete\r\n') throw new Error('wrong read bytes')
  const messages = [
    { type: 'system', session_id: '85144bc2-d8d4-4c5a-9c10-924619827101' },
    { type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 12 } } } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-1', name: 'ReadAssignedFoundationRevision', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: JSON.stringify({ markdown }) }] } },
    { type: 'result', subtype: 'success', result: '# Repaired fixture', modelUsage: { fixture: { inputTokens: 12, outputTokens: 4 } } },
    { type: 'stream_event', event: { usage: { output_tokens: 2 } } },
    // The old native runtime ignores late business events, but drains metering.
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', is_error: true, content: 'late ignored fixture' }] } },
  ]
  process.stdout.write(messages.map(message => JSON.stringify(message)).join('\n') + '\n', () => process.exit(0))
})

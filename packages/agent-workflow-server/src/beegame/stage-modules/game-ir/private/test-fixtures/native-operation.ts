import { writeFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

createInterface({ input: process.stdin }).once('line', () => {
  if (process.env.BEEGAME_EXTERNAL_REVIEW === '1') process.exit(3)
  if (process.env.MAX_STRUCTURED_OUTPUT_RETRIES || process.argv.includes('--json-schema')) process.exit(4)
  if (!readFileSync('docs/GDD.md', 'utf8').includes('修理') || !readFileSync('authority.md', 'utf8').includes('fixture'))
    process.exit(2)
  console.log(JSON.stringify({ type: 'stream_event', event: { type: 'message_start',
    message: { id: 'offline-operation', usage: { input_tokens: 10 } } } }))
  if (process.argv.includes('--cancel-fixture')) { setInterval(() => {}, 1000); return }
  writeFileSync('output.json', '{"schemaVersion":"game-ir-direct-draft.v1","modules":[]}\n')
  console.log(JSON.stringify({ type: 'result', subtype: 'success', structured_output: { summary: 'offline fixture' },
    modelUsage: { fixture: { inputTokens: 10, outputTokens: 5 } } }))
  process.stdin.pause()
})

/** Offline native protocol fixture for targeted-controller tests. */
export {}
let pending = ''
const mode = process.argv.find(arg => arg.startsWith('--fixture-mode='))?.split('=')[1] ?? 'success'
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
for await (const chunk of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(chunk)
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
    const message = JSON.parse(line)
    if (message.type !== 'user') continue
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    const contract = JSON.parse(prompt.split('Model packet contract: ')[1])
    const packet = contract.packet
    if (contract.workerType === 'foundation-fact-extractor') {
      const provider = process.env.BEEGAME_MODEL_TYPE!.toUpperCase()
      if (process.env[`${provider}_DEFAULT_SONNET_MODEL`] !== 'fixture-fast') throw new Error('targeted fact did not select fast model')
      output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 7, outputTokens: 3 } },
        structured_output: { status: 'completed', results: packet.keys.map((key: string) => ({ key, status: 'absent' })) } })
    } else {
      const provider = process.env.BEEGAME_MODEL_TYPE!.toUpperCase()
      if (process.env[`${provider}_DEFAULT_SONNET_MODEL`] !== 'fixture-strong') throw new Error('targeted semantic did not select strong model')
      if (mode === 'invalid') output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 7, outputTokens: 3 } }, structured_output: { status: 'bad' } })
      else output({ type: 'result', subtype: 'success', modelUsage: { fixture: { inputTokens: 7, outputTokens: 3 } }, structured_output: { status: 'PASS' } })
    }
  }
}

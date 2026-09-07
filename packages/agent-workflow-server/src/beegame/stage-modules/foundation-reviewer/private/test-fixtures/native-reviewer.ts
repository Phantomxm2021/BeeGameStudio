/** Offline protocol executable. No model, network, project reads or file writes. */
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from '../domain/foundation-semantic-audit'
let mode = process.argv.find(arg => arg.startsWith('--fixture-mode='))?.split('=')[1] ?? 'success'
const output = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
let pending = ''
let completed: Record<string, unknown> | undefined
function finish() {
  if (mode === 'invalid-json') { process.stdout.write('not JSON\n'); return }
  if (mode === 'exit') { process.exit(23) }
  if (mode === 'error') { output({ type: 'result', subtype: 'error', is_error: true, modelUsage: { fixture: { inputTokens: 7, outputTokens: 3 } } }); return }
  if (mode === 'stop') {
    process.on('SIGTERM', () => {})
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'tool' || mode === 'wrong-tool' || mode === 'failed-tool') {
    output({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'structured-1', name: 'StructuredOutput', input: completed }] } })
    output({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: mode === 'wrong-tool' ? 'unmatched' : 'structured-1', is_error: mode === 'failed-tool', content: 'Structured output provided successfully' }] } })
    if (mode !== 'tool') output({ type: 'result', subtype: 'success' })
    return
  }
  output({ type: 'result', subtype: 'success', is_error: false,
    ...(mode === 'empty-model-usage' ? { modelUsage: {}, usage: { input_tokens: 9, output_tokens: 4 } } : { modelUsage: { fixture: { inputTokens: 7, outputTokens: 3 } } }),
    ...(mode === 'empty' ? {} : { structured_output: mode === 'invalid-output' ? { status: 'completed', results: [], runId: 'forged' } : completed }),
  })
}
const decoder = new TextDecoder()
for await (const chunk of Bun.stdin.stream()) {
  pending += decoder.decode(chunk, { stream: true })
  for (;;) {
    const newline = pending.indexOf('\n')
    if (newline < 0) break
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
    const message = JSON.parse(line)
    if (message.type === 'control_response') {
      if (message.response.response.behavior !== 'deny') throw new Error('read must be denied')
      finish()
      continue
    }
    if (message.type !== 'user') continue
    if (message.session_id !== '' || process.argv.some(arg => arg.startsWith('--resume')) ||
      process.argv[process.argv.indexOf('--tools') + 1] !== '' || !process.argv.includes('--json-schema'))
      throw new Error('packet execution must be fresh and tool-free')
    const prompt = message.message.content.map((block: { text: string }) => block.text).join('')
    const contract = JSON.parse(prompt.split('Model packet contract: ')[1])
    completed = contract.workerType === 'foundation-fact-extractor'
      ? { status: 'completed', results: contract.packet.keys.map((key: string) => ({ key, status: 'absent' })) }
      : { status: 'completed', outcome: 'PASS' }
    if (mode === 'targeted-pass') completed = { status: 'PASS' }
    if (mode === 'targeted-fail') {
      const sections = Array.isArray(contract.packet.sections) ? contract.packet.sections : []
      completed = {
        status: 'FAIL',
        diagnostic: {
          observedActual: 'fixture actual persists',
          failureReasonCode: 'actual_persists',
          evidence: sections.map((section: { documentPath: string; sectionId: string; digest: string }) => ({
            documentPath: section.documentPath,
            sectionId: section.sectionId,
            digest: section.digest,
          })),
        },
      }
    }
    if (mode.startsWith('semantic-')) {
      const strong = contract.kind === 'confirmation'
      const tier = strong ? 'strong' : FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === contract.checkId)!.modelTier
      const provider = process.env.BEEGAME_MODEL_TYPE!.toUpperCase()
      if (process.env[`${provider}_DEFAULT_SONNET_MODEL`] !== `fixture-${tier}`) throw new Error('semantic model tier was not selected')
      if ((!strong && contract.checkId === FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[0]!.checkId) || mode === 'semantic-undecidable')
        completed = { status: 'completed', outcome: 'UNDECIDABLE', reason: 'fixture requests independent confirmation' }
      if (strong && mode === 'semantic-strong-stop') mode = 'stop'
      if (strong && mode === 'semantic-strong-error') mode = 'error'
    }
    if (mode === 'usage-noise') {
      for (let index = 0; index < 256; index++) output({ type: 'keep_alive' })
    }
    output({ type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 7 } } } })
    if (mode === 'usage-noise') {
      for (let index = 0; index < 256; index++) {
        output({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } })
        output({ type: 'stream_event', event: { type: 'message_start', message: { usage: { input_tokens: 7 } } } })
      }
    }
    output({ type: 'stream_event', event: { type: 'message_delta', usage: { output_tokens: 3 } } })
    if (mode === 'permission') output({ type: 'control_request', request_id: 'read-attempt', request: { subtype: 'can_use_tool', tool_name: 'Read', tool_use_id: 'read-1', input: { path: 'docs/GDD.md' } } })
    else finish()
  }
}

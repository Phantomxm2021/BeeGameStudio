import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { assertDesignReviewReady, type DesignReviewReceipt } from '../beegame/workflow-v3/design-review'
import { getLatestRuntimeUsage, type BeeGameEvent } from '../beegame/session-manager'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
for (const protocol of ['responses', 'chat-completions'] as const) nativeTest(
  protocol + ' native GDD review isolates context, preserves permissions and revisits the author once', async () => {
    const root = await mkdtemp('/private/tmp/bgs-independent-review-'), game = join(root, 'game')
    await mkdir(join(game, 'docs'), { recursive: true })
    const candidate = '# Synthetic GDD\nA sample rule awaiting review.\n'
    const revised = '# Synthetic GDD\nThe sample rule has one consistent result.\n'
    await writeFile(join(game, 'docs/GDD.md'), candidate)
    const requests: any[] = [], events: any[] = [], receipts: DesignReviewReceipt[] = [], accepted: unknown[] = [], usage: BeeGameEvent[] = []
    const confirmedBriefContext = JSON.stringify({ settings: { platform: 'VR/AR', engine: 'Unity' }, idea: 'Synthetic original requirement' })
    const authorSecret = 'AUTHOR_REASONING_MUST_NOT_REACH_REVIEWER'
    const finding = { location: 'GDD sample rule', issue: 'Synthetic contradictory result',
      evidence: 'The same condition has two declared outcomes.', impact: 'Implementation would have to invent a decision.' }
    const disposition = { finding: 1, status: 'corrected' as const, evidence: 'Saved GDD now specifies one result for the sample condition.' }
    const report = (initial: boolean) => JSON.stringify({ summary: initial ? 'Resolve the sample rule' : 'Rule checked; runtime quality remains unverified',
      findings: initial ? [finding] : [], ...(initial ? {} : { resolutions: [disposition] }) })
    const probe = `const fs=require('node:fs'); console.log(fs.readFileSync('docs/GDD.md','utf8')); for(const file of ['docs/GDD.md','forbidden.txt']) { let denied=false; try {fs.writeFileSync(file,'Forbidden')} catch {denied=true} if(!denied) throw Error('Reviewer could write '+file) } console.log('review read-only verified')`
    const command = process.execPath + ' -e ' + "'" + probe.replaceAll("'", "'\\''") + "'"
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
      if (new URL(request.url).pathname !== '/v1/' + (protocol === 'responses' ? 'responses' : 'chat/completions')) return new Response('Unexpected route', { status: 404 })
      const body = await request.json() as any
      const step = requests.push(body) - 1
      if (step > 5) return new Response('Unexpected extra model request', { status: 400 })
      const tool = step === 1 || step === 3
      const call = step === 1
        ? { id: 'fc_read', call_id: 'review-read', name: 'exec_command', arguments: JSON.stringify({ cmd: command, max_output_tokens: 200 }), status: 'completed' }
        : { id: 'fc_write', call_id: 'author-revise', name: 'WriteProjectFile', arguments: JSON.stringify({ file_path: 'docs/GDD.md', content: revised }), status: 'completed' }
      const text = step === 2 ? report(true) : step === 5 ? report(false)
        : JSON.stringify({ status: 'ready', summary: step === 0 ? authorSecret : 'Resolved the sample-rule contradiction in GDD.',
          ...(step === 0 ? {} : { reviewResponses: [disposition] }) })
      if (protocol === 'chat-completions') return new Response([
        { choices: [{ index: 0, delta: tool ? { tool_calls: [{ index: 0, id: call.call_id, type: 'function', function: { name: call.name, arguments: call.arguments } }] } : { content: text }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } })
      const item = tool ? { type: 'function_call', ...call } : { id: 'final-' + step, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
      const response = { id: 'fixture-' + step, object: 'response', created_at: 1, model: body.model, status: 'completed', output: [item], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
      return new Response([
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response },
      ].map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    const runner = createBgsRunner({ resolveOutboundTarget: async value => {
      const url = new URL(value)
      if (url.origin !== server.url.origin) throw Error('External fixture request forbidden')
      return { url, addresses: ['127.0.0.1'], lookup: (_host, _options, callback) => callback(null, '127.0.0.1', 4) }
    } })
    let runtime: Awaited<ReturnType<typeof runner.start>> | undefined, authorThread = ''
    const source = async () => ({ path: 'docs/GDD.md', sha256: createHash('sha256').update(await readFile(join(game, 'docs/GDD.md'))).digest('hex') })
    const finalOutput = { readOnly: true, writeDocument: { path: 'docs/GDD.md', authorize: async () => {} },
      schema: { type: 'object' }, designReview: {
        candidate: async (value: unknown) => {
          const result = value as { summary: string; reviewResponses?: typeof disposition[] }
          return { source: await source(), summary: result.summary, reviewResponses: result.reviewResponses }
        },
        record: async (receipt: DesignReviewReceipt) => { receipts.push(receipt) },
      },
      accept: async (value: unknown) => { assertDesignReviewReady(await source(), receipts); accepted.push(value); return 'Reviewed candidate handed off' },
    }
    const requestPermission = async (request: any) => ({ behavior: request.toolName === 'Write' ? 'allow' as const : 'deny' as const })
    try {
      runtime = await runner.start({ sessionId: 'independent-review-fixture', cwd: game, systemContext: authorSecret, confirmedBriefContext, finalOutput,
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), OPENAI_API_KEY: 'fixture-only', BEEGAME_API_PROTOCOL: protocol,
          OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-review-model' },
        requestPermission, onNativeSessionId: id => { authorThread = id },
        onNativeUsage: (value, epoch, details) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
          payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value,
            ...(details?.baselineOnly ? { usageBaselineOnly: true } : {}), ...(details?.replayed ? { usageReplayed: true } : {}) } }),
      })
      await runtime.submit({ prompt: authorSecret + ': save the candidate', confirmedBriefContext, finalOutput,
        signal: AbortSignal.timeout(25_000), onMessage: message => { events.push(message) }, requestPermission })
      expect(requests).toHaveLength(6)
      expect(receipts).toHaveLength(2)
      expect(accepted).toHaveLength(1)
      expect(receipts[0]!.nativeThreadId).not.toBe(authorThread)
      expect(receipts[1]!.nativeThreadId).toBe(receipts[0]!.nativeThreadId)
      expect(receipts[1]!.nativeTurnId).not.toBe(receipts[0]!.nativeTurnId)
      expect(receipts[1]!.source.sha256).not.toBe(receipts[0]!.source.sha256)
      expect(receipts[1]!.authorResponses).toEqual([disposition])
      expect(receipts[1]!.report.resolutions).toEqual([disposition])
      expect(await readFile(join(game, 'docs/GDD.md'), 'utf8')).toBe(revised)
      expect(JSON.stringify(requests[2])).toContain('review read-only verified')
      for (const index of [1, 2, 5]) {
        const serialized = JSON.stringify(requests[index])
        expect(serialized).not.toContain(authorSecret)
        expect(serialized).toContain('Synthetic original requirement')
        expect(serialized).toContain('Unity')
        expect(requests[index].model).toBe(requests[0].model)
        expect(requests[index].reasoning).toEqual(requests[0].reasoning)
        const toolNames = JSON.stringify(requests[index].tools)
        expect(toolNames).not.toContain('WriteProjectFile')
        expect(toolNames).not.toContain('spawn_agent')
        expect(toolNames).not.toContain('BgsFinishDelivery')
      }
      expect(JSON.stringify(requests[3])).toContain('Synthetic contradictory result')
      expect(JSON.stringify(requests[5])).toContain('Targeted follow-up only')
      expect(getLatestRuntimeUsage(usage).total_tokens).toBe(720)
      expect(events.filter(e => e.eventType === 'assistant.message').map(e => e.text).join('')).toContain('Reviewed candidate handed off')
    } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
  }, 35_000)

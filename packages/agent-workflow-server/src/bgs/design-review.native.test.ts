import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createBgsRunner } from './runner'
import { assertDesignReviewReady, type DesignReviewReceipt } from '../beegame/workflow-v3/design-review'
import { getLatestRuntimeUsage, type BeeGameEvent } from '../beegame/session-manager'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
for (const outcome of ['repaired', 'exhausted', 'missing-resolution', 'resumed', 'resume-during-review', 'resume-after-pass'] as const)
for (const protocol of ['responses', 'chat-completions'] as const) nativeTest(
  protocol + ' native GDD review snapshot, isolation and repair: ' + outcome, async () => {
    const root = await mkdtemp('/private/tmp/bgs-independent-review-'), game = join(root, 'game'), skills = join(root, 'skills')
    await mkdir(join(game, 'docs'), { recursive: true })
    await writeFile(join(game, 'AGENTS.md'), 'PROJECT_WORK_GUIDE_MUST_NOT_REACH_REVIEWER\n')
    await mkdir(join(skills, 'fixture'), { recursive: true })
    await writeFile(join(skills, 'fixture/SKILL.md'), '---\nname: fixture\ndescription: UNUSED_REVIEW_SKILL_CATALOG_MARKER\n---\nSynthetic guidance.')
    const candidate = '# Synthetic GDD\nSOURCE_BEGIN\n' + 'Saved rule with 中文 units and boundaries.\n'.repeat(3500) + 'SOURCE_END\n'
    const revised = '# Synthetic GDD\nThe sample rule has one consistent result.\n'
    await writeFile(join(game, 'docs/GDD.md'), candidate)
    const finalDraft = revised + 'The dependent rule is consistent too.\n'
    const requests: any[] = [], events: any[] = [], receipts: DesignReviewReceipt[] = [], accepted: unknown[] = [], usage: BeeGameEvent[] = []
    const confirmedBriefContext = JSON.stringify({ settings: { platform: 'VR/AR', engine: 'Unity' }, idea: 'Synthetic original requirement' })
    const authorSecret = 'AUTHOR_REASONING_MUST_NOT_REACH_REVIEWER'
    const targetContext = 'BGS target interpretation: the selected Unity runtime. Current GDD handoff: MVP implementation.'
    const finding = { location: 'GDD sample rule', issue: 'Synthetic contradictory result',
      evidence: 'The same condition has two declared outcomes.', impact: 'Implementation would have to invent a decision.' }
    const disposition = { finding: 1, status: 'corrected' as const, evidence: 'Saved GDD now specifies one result for the sample condition.' }
    const report = (initial: boolean, newDefect = false) => JSON.stringify({ summary: initial ? 'Resolve the sample rule' : 'Rule checked; runtime quality remains unverified',
      findings: initial ? [finding] : newDefect ? [{ ...finding, issue: 'New dependent defect' }] : [], ...(initial || outcome === 'missing-resolution' ? {} : { resolutions: [disposition] }) })
    const probe = `const fs=require('node:fs'); const fd=fs.openSync('docs/GDD.md','r'); const part=Buffer.alloc(64); const count=fs.readSync(fd,part,0,64,0); fs.closeSync(fd); console.log(part.subarray(0,count).toString('utf8')); for(const file of ['docs/GDD.md','forbidden.txt']) { let denied=false; try {fs.writeFileSync(file,'Forbidden')} catch {denied=true} if(!denied) throw Error('Reviewer could write '+file) } console.log('review read-only verified'); for(const key of ['PLAYWRIGHT_BROWSERS_PATH', 'BEEGAME_PLAYWRIGHT_MODULE', 'BEEGAME_PREVIEW_TEST_MODULE', 'BEEGAME_PREVIEW_CAPABILITY_FILE', 'BEEGAME_MEASUREMENT_CAPABILITY_FILE', 'BEEGAME_ASSET_CAPABILITY_FILE', 'BEEGAME_CONTENT_CHECKER_MODULE', 'BEEGAME_SHARP_MODULE', 'BEEGAME_FONT_MODULE', 'BEEGAME_NATIVE_BUILTIN_SKILLS_DIR']) { if(Object.hasOwn(process.env,key)) throw Error('Reviewer inherited '+key) } console.log('review environment and calculation verified: '+String(6n*7n))`
    const command = process.execPath + ' -e ' + "'" + probe.replaceAll("'", "'\\''") + "'"
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET') return Response.json({ data: [{ id: 'fixture-review-model', limit: { output: 42424 } }] })
      if (new URL(request.url).pathname !== '/v1/' + (protocol === 'responses' ? 'responses' : 'chat/completions')) return new Response('Unexpected route', { status: 404 })
      const body = await request.json() as any
      const step = requests.push(body) - 1
      if(outcome==='resume-during-review' && step===5) {stop.abort();return new Response(null,{status:499})}
      if (step > (outcome==='resume-after-pass'?9:8)) return new Response('Unexpected extra model request', { status: 400 })
      const exhausted = outcome === 'exhausted' && step === 2
      const tool = step === 1 || step === 3 || step === 6
      const call = step === 1
        ? { id: 'fc_read', call_id: 'review-read', name: 'exec_command', arguments: JSON.stringify({ cmd: command, max_output_tokens: 200 }), status: 'completed' }
        : { id: 'fc_write-' + step, call_id: 'author-revise-' + step, name: 'WriteProjectFile', arguments: JSON.stringify({ file_path: 'docs/GDD.md', content: step === 6 ? finalDraft : revised }), status: 'completed' }
      const text = step === 2 ? report(true) : step === 5 ? report(false, true) : step === 8 ? report(false)
        : JSON.stringify({ status: 'ready', summary: step === 0 ? authorSecret : 'Resolved the sample-rule contradiction in GDD.',
          ...(step === 0 || step === 9 ? {} : { reviewResponses: [disposition] }) })
      if (protocol === 'chat-completions') return new Response([
        { choices: [{ index: 0, delta: exhausted ? {} : tool ? { tool_calls: [{ index: 0, id: call.call_id, type: 'function', function: { name: call.name, arguments: call.arguments } }] } : { content: text }, finish_reason: null }] },
        { choices: [{ index: 0, delta: {}, finish_reason: exhausted ? 'length' : tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: exhausted ? 32000 : 20 } },
      ].map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), { headers: { 'Content-Type': 'text/event-stream' } })
      const item = tool ? { type: 'function_call', ...call } : { id: 'final-' + step, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }
      const response = { id: 'fixture-' + step, object: 'response', created_at: 1, model: body.model, status: exhausted ? 'incomplete' : 'completed', output: exhausted ? [] : [item],
        ...(exhausted ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
        usage: { input_tokens: 100, output_tokens: exhausted ? 32000 : 20, total_tokens: exhausted ? 32100 : 120 } }
      return new Response([
        { type: 'response.created', response: { ...response, status: 'in_progress', output: [] } },
        ...(exhausted ? [] : [
          { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
          { type: 'response.output_item.done', output_index: 0, item },
        ]),
        { type: exhausted ? 'response.incomplete' : 'response.completed', response },
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
        context: targetContext,
        candidate: async (value: unknown) => {
          const result = value as { summary: string; reviewResponses?: typeof disposition[] }
          return { source: await source(), summary: result.summary, reviewResponses: result.reviewResponses }
        },
        record: async (receipt: DesignReviewReceipt) => { receipts.push(receipt); if(outcome==='resumed' && receipts.length===1 || outcome==='resume-after-pass' && receipts.length===3) stop.abort() },
      },
      accept: async (value: unknown) => { assertDesignReviewReady(await source(), receipts); accepted.push(value); return 'Reviewed candidate handed off' },
    }
    const stop = new AbortController()
    const requestPermission = async (request: any) => ({ behavior: request.toolName === 'Write' ? 'allow' as const : 'deny' as const })
    try {
      const startInput: Parameters<typeof runner.start>[0] = { sessionId: 'independent-review-fixture', cwd: game, language: 'zh', systemContext: targetContext + '\n' + authorSecret, confirmedBriefContext, finalOutput,
        env: { BEEGAME_CONFIG_DIR: join(root, 'private'), BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: skills, OPENAI_API_KEY: 'fixture-only', BEEGAME_API_PROTOCOL: protocol,
          OPENAI_BASE_URL: server.url.origin + '/v1', BEEGAME_MODEL: 'fixture-review-model' },
        requestPermission, onNativeSessionId: id => { authorThread = id },
        onNativeUsage: (value, epoch, details) => usage.push({ id: usage.length, type: 'usage', sessionId: 'fixture', text: '', createdAt: new Date(),
          payload: { type: 'usage', subtype: 'native_accounting', nativeAccountingEpoch: epoch, usage: value,
            ...(details?.baselineOnly ? { usageBaselineOnly: true } : {}), ...(details?.replayed ? { usageReplayed: true } : {}) } }),
      }
      runtime = await runner.start(startInput)
      let failure: unknown
      try {
        await runtime.submit({ prompt: authorSecret + ': save the candidate', confirmedBriefContext, finalOutput,
          signal: outcome==='resumed'||outcome==='resume-during-review'||outcome==='resume-after-pass'?stop.signal:AbortSignal.timeout(25_000), onMessage: message => { events.push(message) }, requestPermission })
      } catch (error) { failure = error }
      if(outcome==='resumed'||outcome==='resume-during-review'||outcome==='resume-after-pass') {
        expect(failure).toBeInstanceOf(Error)
        expect(receipts).toHaveLength(outcome==='resume-after-pass'?3:1)
        expect(requests).toHaveLength(outcome==='resumed'?3:outcome==='resume-after-pass'?9:6)
        const originalAuthor=authorThread
        await runtime.dispose?.()
        const resumedOutput={...finalOutput,designReview:{...finalOutput.designReview,previousReviews:[...receipts]}}
        runtime=await runner.start({...startInput,resumeSessionId:originalAuthor,nativeRecovery:true,finalOutput:resumedOutput})
        expect(authorThread).toBe(originalAuthor)
        failure=undefined
        try {await runtime.submit({prompt:'',confirmedBriefContext,finalOutput:resumedOutput,nativeRecovery:true,
          signal:AbortSignal.timeout(25000),onMessage:message=>{events.push(message)},requestPermission})}
        catch(error){failure=error}
        if(outcome!=='resume-after-pass')expect(JSON.stringify(requests[outcome==='resumed'?3:6])).toContain('Current GDD revision findings')
        expect(JSON.stringify(requests[outcome==='resumed'?3:6])).toContain('Synthetic contradictory result')
        expect(JSON.stringify(requests[outcome==='resumed'?3:6])).toContain('reviewResponses')
        expect(events.filter(event=>event.eventType==='tool.started'&&event.text==='Independent GDD review').map(event=>event.reviewRound)).toEqual(outcome==='resume-during-review'?[1,2,2]:[1,2,3])
      }
      expect(JSON.stringify(requests[0])).not.toContain('preview-test-client.mjs')
      const outputFormat = (index: number) => protocol === 'responses' ? requests[index].text.format : requests[index].response_format.json_schema
      expect(outputFormat(1)).toMatchObject({ strict: true, schema: { required: ['summary', 'findings'], additionalProperties: false } })
      expect(outputFormat(1).schema.properties).not.toHaveProperty('resolutions')
      expect(outputFormat(2)).toEqual(outputFormat(1))
      const reviewerInput = JSON.stringify(requests[1])
      const toolNames=requests[1].tools.flatMap((tool:any)=>tool.type==='namespace' ? tool.tools.map((child:any)=>child.name) : [tool.name??tool.function?.name])
      expect(toolNames).not.toContain('view_image')
      expect(toolNames).not.toContain('image_gen')
      expect(toolNames).toContain('exec_command')
      for (const path of ['preview-test-client.mjs', 'beegame-preview-access-', 'beegame-checker-', 'playwright-core', 'beegame-media-', 'beegame-font-', skills])
        expect(reviewerInput).not.toContain(path)
      const probeOutput = protocol === 'responses'
        ? requests[2].input.find((item: any) => item.type === 'function_call_output' && item.call_id === 'review-read')?.output
        : requests[2].messages.find((item: any) => item.role === 'tool' && item.tool_call_id === 'review-read')?.content
      expect(probeOutput).toBeDefined()
      expect(JSON.stringify(probeOutput)).toContain('review read-only verified')
      expect(JSON.stringify(probeOutput)).toContain('review environment and calculation verified: 42')
      if (outcome === 'exhausted') {
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toContain('max_output_tokens')
        expect((failure as Error).message).toContain('未形成完整报告')
        expect(requests).toHaveLength(3)
        expect(requests.every(request => protocol === 'responses' ? request.max_output_tokens === 42424 : request.max_tokens === 42424)).toBe(true)
        expect(JSON.stringify(requests[2])).toContain(targetContext)
        expect(JSON.stringify(requests[2])).not.toContain(authorSecret)
        expect(receipts).toHaveLength(0)
        expect(accepted).toHaveLength(0)
        expect(events.some(event => event.eventType === 'tool.failed' && event.text === 'Independent GDD review' && event.output.includes('max_output_tokens'))).toBe(true)
        expect(getLatestRuntimeUsage(usage).total_tokens).toBe(32340)
        return
      }
      expect(outputFormat(5)).toMatchObject({ strict: true, schema: { required: ['summary', 'findings', 'resolutions'],
        properties: { resolutions: { minItems: 1, maxItems: 1, items: { properties: { finding: { minimum: 1, maximum: 1 } } } } } } })
      if (outcome === 'missing-resolution') {
        // Providers may ignore strict output: local validation still rejects, never guesses or retries.
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toContain('exactly one evidence-backed disposition')
        expect(requests).toHaveLength(6)
        expect(receipts).toHaveLength(1)
        expect(accepted).toHaveLength(0)
        expect(events.some(event => event.eventType === 'tool.failed' && event.text === 'Independent GDD review')).toBe(true)
        return
      }
      expect(outputFormat(8)).toEqual(outputFormat(5))
      expect(failure).toBeUndefined()
      expect(requests).toHaveLength(outcome==='resume-after-pass'?10:9)
      expect(requests.every(request => protocol === 'responses' ? request.max_output_tokens === 42424 : request.max_tokens === 42424)).toBe(true)
      expect(JSON.stringify(requests[0])).toContain('UNUSED_REVIEW_SKILL_CATALOG_MARKER')
      for (const [index,expected] of [[1,candidate],[2,candidate],[5,revised],[8,finalDraft]] as const) {
        const input = protocol === 'responses' ? requests[index].input : requests[index].messages
        const userText = input.filter((item: any) => item.role === 'user').map((item: any) => typeof item.content === 'string'
          ? item.content : item.content.map((part: any) => part.text || '').join('')).join('')
        expect(userText).toContain(JSON.stringify(expected))
        if(index>=5)expect(userText).not.toContain('SOURCE_BEGIN')
      }
      expect(JSON.stringify(requests[1])).toContain('SOURCE_BEGIN')
      expect(JSON.stringify(requests[1])).toContain('SOURCE_END')
      const initialInput = protocol === 'responses' ? requests[1].input : requests[1].messages
      const snapshot = initialInput.filter((item: any) => item.role === 'user').map((item: any) => typeof item.content === 'string'
        ? item.content : item.content.map((part: any) => part.text || '').join('')).join('')
      expect(snapshot.includes(JSON.stringify(candidate))).toBe(true)
      expect(JSON.stringify(requests[0])).toContain('PROJECT_WORK_GUIDE_MUST_NOT_REACH_REVIEWER')
      expect(JSON.stringify(requests[0])).toContain(targetContext)
      expect(JSON.stringify(requests[2])).toContain('SOURCE_BEGIN')
      expect(JSON.stringify(requests[2])).toContain('SOURCE_END')
      const reviewEvents = events.filter(event => event.eventType === 'tool.started' && event.text === 'Independent GDD review')
      expect(reviewEvents).toHaveLength(3)
      expect(reviewEvents.every(event => !JSON.stringify(event.input).includes('SOURCE_BEGIN'))).toBe(true)
      expect(receipts).toHaveLength(outcome==='resume-during-review'?2:3)
      expect(accepted).toHaveLength(1)
      expect(receipts[0]!.nativeThreadId).not.toBe(authorThread)
      expect(receipts[1]!.nativeThreadId).not.toBe(receipts[0]!.nativeThreadId)
      expect(receipts[1]!.nativeTurnId).not.toBe(receipts[0]!.nativeTurnId)
      expect(receipts[1]!.source.sha256).not.toBe(receipts[0]!.source.sha256)
      expect(receipts[1]!.authorResponses).toEqual([disposition])
      expect(receipts[1]!.report.resolutions).toEqual([disposition])
      expect(await readFile(join(game, 'docs/GDD.md'), 'utf8')).toBe(finalDraft)
      expect(JSON.stringify(requests[2])).toContain('review read-only verified')
      for (const index of [1, 2, 5, 8]) {
        const serialized = JSON.stringify(requests[index])
        expect(serialized).not.toContain(authorSecret)
        expect(serialized).not.toContain('UNUSED_REVIEW_SKILL_CATALOG_MARKER')
        expect(serialized).not.toContain('<skills_instructions>')
        expect(serialized).toContain('Synthetic original requirement')
        expect(serialized).toContain(targetContext)
        expect(serialized).toContain('requirement preservation, compatible product rules')
        expect(serialized).toContain('mutually incompatible outcomes under the same applicable conditions')
        expect(serialized).toContain('source identity is checked by BGS')
        expect(serialized).toContain('hypothetical bad implementations are outside this document review')
        expect(serialized).toContain('evidence absent from the snapshot')
        expect(serialized).toContain('Each finding requires corrective work before handoff')
        expect(serialized).toContain('preserve user-stated appearance and source constraints')
        expect(serialized).not.toContain('decisions needed to implement the agreed behavior or produce the next required output')
        expect(serialized).not.toContain('PROJECT_WORK_GUIDE_MUST_NOT_REACH_REVIEWER')
        expect(serialized).not.toContain('You are a coding agent. Please keep going until the query is completely resolved')
        expect(serialized).toContain('independent game-design document reviewer')
        expect(serialized).not.toContain('Recompute consequential examples from the saved definitions')
        expect(serialized).toContain('Unity')
        expect(requests[index].model).toBe(requests[0].model)
        expect(requests[index].reasoning).toEqual(requests[0].reasoning)
        const toolNames = JSON.stringify(requests[index].tools)
        expect(toolNames).toContain('exec_command')
        expect(toolNames).not.toContain('update_plan')
        expect(toolNames).not.toContain('WriteProjectFile')
        expect(toolNames).not.toContain('spawn_agent')
        expect(toolNames).not.toContain('BgsFinishDelivery')
      }
      expect(JSON.stringify(requests[outcome==='resumed'?3:6])).toContain('Synthetic contradictory result')
      expect(JSON.stringify(requests[3]).includes('Return only the required status and summary')).toBe(false)
      expect(JSON.stringify(requests[3])).toContain('Return the fields in the current final-result contract')
      expect(JSON.stringify(requests[5])).toContain('Targeted follow-up only')
      if(outcome==='resume-during-review')expect(JSON.stringify(requests[6]).includes('New dependent defect')).toBe(false)
      else expect(JSON.stringify(requests[6])).toContain('New dependent defect')
      expect(new Set(receipts.map(receipt=>receipt.nativeThreadId)).size).toBe(outcome==='resume-during-review'?2:3)
      expect(receipts.at(-1)!.source.sha256).not.toBe(receipts[outcome==='resume-during-review'?0:1]!.source.sha256)
      expect(getLatestRuntimeUsage(usage).total_tokens).toBe(outcome==='resume-during-review'?960:outcome==='resume-after-pass'?1200:1080)
      expect(events.filter(e => e.eventType === 'assistant.message').map(e => e.text).join('')).toContain('Reviewed candidate handed off')
    } finally { await runtime?.dispose?.(); server.stop(true); await rm(root, { recursive: true, force: true }) }
  }, 35_000)

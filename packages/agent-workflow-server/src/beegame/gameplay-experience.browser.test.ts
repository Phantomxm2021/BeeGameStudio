import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createPreviewTestBrowser } from './preview-test-browser'
import { startPreviewRecording } from './preview-test-recording'
import { editProtectedFileText } from '../bgs/runner'
import { experienceFixture, experienceGames, type ExperienceGame } from './fixtures/gameplay-experience'

// Uses the existing opt-in browser mode, owned Chromium and CDP input pattern.
test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('four genres retain evidence and a source-bound repair/retest', async () => {
  const started = performance.now(), root = await mkdtemp('/private/tmp/bgs-experience-')
  const output = resolve('docs/research/evidence/game-design-skills', new Date().toISOString().replaceAll(':', '-'))
  await mkdir(output, { recursive: true })
  for (const game of experienceGames) await writeFile(join(root, game + '.html'), experienceFixture(game))
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const name = new URL(request.url).pathname.slice(1).replace('.html', '')
    if (!experienceGames.includes(name as ExperienceGame)) return new Response('Not found', { status: 404 })
    return new Response(await readFile(join(root, name + '.html')), { headers: { 'content-type': 'text/html' } })
  } })
  const owned = createPreviewTestBrowser(), observations: Record<string, unknown>[] = []
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  let socket: WebSocket | undefined
  try {
    const { endpoint } = await owned.start()
    socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(Error('Fixture CDP unavailable')) })
    let id = 0
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
    const errors: unknown[] = []
    socket.onmessage = event => {
      const value = JSON.parse(String(event.data))
      if (value.id) {
        const request = pending.get(value.id)
        if (request) { clearTimeout(request.timer); pending.delete(value.id); value.error ? request.reject(Error(JSON.stringify(value.error))) : request.resolve(value.result) }
      }
      if (value.method === 'Runtime.exceptionThrown') errors.push(value.params)
    }
    const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const requestId = ++id
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('Fixture CDP timeout: ' + method)) }, 5000)
      pending.set(requestId, { resolve, reject, timer }); socket!.send(JSON.stringify({ id: requestId, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId)
    await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId)
    const read = async (expression: string) => {
      const value = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails))
      return value.result.value
    }
    const status = async (): Promise<string> => await read("document.querySelector('#status')?.textContent ?? ''")
    const waitStatus = async (part: string) => {
      const until = Date.now() + 10000
      while (!(await status()).includes(part)) { if (Date.now() > until) throw Error('State not reached: ' + part + '; observed ' + await status()); await Bun.sleep(20) }
    }
    async function run(game: ExperienceGame, label: string, intent: string, hypothesis: string,
      act: (key: (type: 'down' | 'up', value: string) => Promise<void>, click: (name: string) => Promise<void>) => Promise<string[]>) {
      const trace: unknown[] = []; errors.length = 0
      const recording = await startPreviewRecording(endpoint, { targetId, label,
        conditions: 'Synthetic local fixture; 800x600; ordinary keyboard/buttons; no state injection; not novice research', preview: { mode: 'development', fixture: game } }, output)
      const key = async (type: 'down' | 'up', code: string) => {
        trace.push({ at: Date.now(), type, code })
        await send('Input.dispatchKeyEvent', { type: type === 'down' ? 'keyDown' : 'keyUp', code, key: code === 'Space' ? ' ' : code,
          windowsVirtualKeyCode: code === 'Space' ? 32 : code === 'ArrowRight' ? 39 : 37 }, sessionId)
      }
      const click = async (name: string) => {
        const point = await read(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(name)});if(!b)throw Error('Missing control');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        trace.push({ at: Date.now(), type: 'click', name })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sessionId)
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sessionId)
      }
      try {
        await send('Page.navigate', { url: server.url.href + game + '.html' }, sessionId); await waitStatus('Ready')
        const initial = join(output, label + '-initial.png')
        await writeFile(initial, Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'))
        const facts = await act(key, click); expect(errors).toEqual([])
        const bounds = await read("(()=>{const r=document.querySelector('#status').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,viewport:innerHeight}})()")
        expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.height).toBeGreaterThan(0); expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewport)
        const media = await recording.finish('scenario-finished')
        const result = { scenario: label, genre: game, design_intent: intent, hypothesis,
          sourceSha256: sha(await readFile(join(root, game + '.html'), 'utf8')), mode: 'real-input-on-synthetic-fixture', observed_facts: facts,
          inferences: ['Only the tested route is established; scripted knowledge does not prove discoverability.'],
          unverified_questions: ['Representative novice comprehension, enjoyment, motion quality and aesthetics need appropriate player observation.'],
          input_trace: trace, initialScreenshot: initial, recording: media }
        observations.push(result); return result
      } finally { await recording.finish('scenario-cleanup'); await writeFile(join(output, label + '-inputs.json'), JSON.stringify(trace, null, 2)) }
    }
    const collect = async (key: (type: 'down' | 'up', value: string) => Promise<void>, click: (name: string) => Promise<void>) => {
      await click('Start'); await Bun.sleep(200); await click('Restart')
      await key('down', 'ArrowRight'); await Bun.sleep(1000); await key('up', 'ArrowRight'); await Bun.sleep(1200)
      return [await status()]
    }
    const before = await run('collection', 'collection-before', 'Restart starts a clean round', 'One catch after restart produces one catch without an earlier-round entity.', collect)
    expect(before.observed_facts[0]).toContain('Score 2 / 3')
    const file = join(root, 'collection.html'), original = await readFile(file, 'utf8')
    const corrected = editProtectedFileText(original, { edits: [{ old_string: '/* restart cleanup */', new_string: 'drops=[];' }] })
    await writeFile(file + '.pending', corrected); await rename(file + '.pending', file)
    await writeFile(join(output, 'repair.json'), JSON.stringify({ sourceBefore: sha(original), sourceAfter: sha(corrected),
      defect: 'Restart retained the prior token; two catches followed one restart path.',
      patch: { old_string: '/* restart cleanup */', new_string: 'drops=[];' }, owner: 'gameplay lifecycle',
      limitation: 'Deliberately seeded fixture defect; not autonomous model discovery or a production project fix.' }, null, 2))
    const after = await run('collection', 'collection-after', 'Restart starts a clean round', before.hypothesis, collect)
    expect(after.observed_facts[0]).toContain('Score 1 / 3')
    await run('platformer', 'platformer', 'Jump consequences and recovery lead to the flag', 'Walking into the gap loses; restart and a timed jump reach the flag.', async (key, click) => {
      await click('Start'); await key('down', 'ArrowRight'); await waitStatus('Lost'); await key('up', 'ArrowRight')
      const loss = await status(); await click('Restart'); await key('down', 'ArrowRight'); await Bun.sleep(800)
      await key('down', 'Space'); await Bun.sleep(80); await key('up', 'Space'); await waitStatus('Won'); await key('up', 'ArrowRight')
      return [loss, await status()]
    })
    await run('puzzle', 'puzzle', 'Visible consequences can be reversed', 'Middle changes the pattern; undo restores it; left/right solves the authored puzzle.', async (_key, click) => {
      await click('Start'); await click('Toggle middle'); await Bun.sleep(50); expect(await status()).toContain('010')
      await click('Undo'); await Bun.sleep(50); expect(await status()).toContain('101')
      await click('Toggle left'); await click('Toggle right'); await waitStatus('Won'); expect(await status()).toContain('000')
      return ['Middle produces 010; Undo restores 101.', await status()]
    })
    await run('defense', 'defense', 'A placement changes the announced lane outcome', 'Bottom cannot defend top; a restarted top placement can.', async (_key, click) => {
      await click('Start'); await click('Build bottom'); await waitStatus('Lost'); const loss = await status()
      await click('Restart'); await click('Build top'); await waitStatus('Won'); return [loss, await status()]
    })
    await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'passed', scope: 'four synthetic genres; observed controls and one controlled repair/retest',
      modelCalls: 0, modelTokens: 0, newDependencies: [], durationMs: Math.round(performance.now() - started), observations }, null, 2))
    console.log('EXPERIENCE_EVIDENCE', output)
    await send('Target.closeTarget', { targetId })
  } catch (error) {
    await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'failed', error: String(error), observations, durationMs: Math.round(performance.now() - started) }, null, 2)); throw error
  } finally { socket?.close(); await owned.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 45000)

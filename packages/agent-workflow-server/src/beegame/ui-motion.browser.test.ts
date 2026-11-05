import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { createPreviewTestBrowser } from './preview-test-browser'
import { startPreviewRecording } from './preview-test-recording'
import { editProtectedFileText } from '../bgs/runner'
import { uiMotionFixture, uiMotionGames, type UiMotionGame } from './fixtures/ui-motion'

// Same opt-in, isolated browser and real-input CDP path as the existing gameplay fixtures.
test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('three UI moods retain state, motion and interruption evidence', async () => {
  const started = performance.now(), root = await mkdtemp('/private/tmp/bgs-ui-motion-')
  const output = resolve('docs/research/evidence/ui-motion', new Date().toISOString().replaceAll(':', '-'))
  await mkdir(output, { recursive: true })
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')
  const defect = "if(state==='Paused')setTimeout(()=>{state='Paused';log('stale-completion');},220);"
  const before = uiMotionFixture('platformer').replace('/* finish is presentation only */', defect)
  const after = editProtectedFileText(before, { edits: [{ old_string: defect, new_string: '/* finish is presentation only */' }] })
  expect(after).toBe(uiMotionFixture('platformer'))
  const sources: Record<string, string> = { 'platformer-before': before, ...Object.fromEntries(uiMotionGames.map(g => [g, g === 'platformer' ? after : uiMotionFixture(g)])) }
  for (const [name, html] of Object.entries(sources)) {
    await writeFile(join(root, name + '.html'), html)
    await writeFile(join(output, name + '-source.html'), html)
  }
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const name = new URL(request.url).pathname.slice(1).replace('.html', '')
    if (!(name in sources)) return new Response('Not found', { status: 404 })
    return new Response(await readFile(join(root, name + '.html')), { headers: { 'content-type': 'text/html' } })
  } })
  const owned = createPreviewTestBrowser(), observations: object[] = []
  let socket: WebSocket | undefined
  try {
    const { endpoint } = await owned.start()
    socket = new WebSocket(endpoint)
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(Error('Fixture CDP unavailable')) })
    let id = 0
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
    const errors: unknown[] = []
    let motionFrames: Array<{ data: string; timestamp: number }> = []
    socket.onmessage = event => {
      const value = JSON.parse(String(event.data))
      if (value.id) {
        const request = pending.get(value.id)
        if (request) { clearTimeout(request.timer); pending.delete(value.id); value.error ? request.reject(Error(JSON.stringify(value.error))) : request.resolve(value.result) }
      }
      if (value.method === 'Runtime.exceptionThrown') errors.push(value.params)
      if (value.method === 'Page.screencastFrame') {
        const { data, metadata, sessionId: frameSession } = value.params
        if (!Number.isFinite(metadata.timestamp)) errors.push('Missing screencast timestamp')
        motionFrames.push({ data, timestamp: metadata.timestamp })
        socket!.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: frameSession }, sessionId: value.sessionId }))
      }
    }
    const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error('Fixture CDP timeout: ' + method)) }, 5000)
      pending.set(requestId, { resolve, reject, timer }); socket!.send(JSON.stringify({ id: requestId, method, params, sessionId }))
    })
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId); await send('Runtime.enable', {}, sessionId)
    const read = async (expression: string) => {
      const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails))
      return value.result.value
    }
    const waitState = async (wanted: string) => {
      const until = Date.now() + 10000
      while (await read("typeof shown==='undefined'?'Loading':(shown===state?state:'Pending UI')") !== wanted) {
        if (Date.now() > until) throw Error('State not reached: ' + wanted)
        await Bun.sleep(20)
      }
    }
    async function run(game: UiMotionGame, reduced: boolean, seeded = false) {
      const label = (seeded ? 'platformer-before' : game) + (reduced ? '-reduced-800x600' : '-1280x800')
      const sourceName = seeded ? 'platformer-before' : game, trace: object[] = [], frames: object[] = []
      errors.length = 0
      const viewport = reduced ? { width: 800, height: 600 } : { width: 1280, height: 800 }
      await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false }, sessionId)
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] }, sessionId)
      const recording = await startPreviewRecording(endpoint, { targetId, label,
        conditions: 'Playable local prototype; ordinary mouse/keyboard; no state injection; headless desktop, not a player study',
        preview: { mode: 'development', fixture: game, viewport, reducedMotion: reduced } }, output)
      const capture = async (name: string) => {
        const observed = await read(`(()=>({at:performance.now(),state,text,focus:document.activeElement.textContent,animations:document.getAnimations().map(a=>({time:a.currentTime,state:a.playState,duration:a.effect.getTiming().duration})),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches}))()`)
        const file = label + '-' + name + '.png'
        await writeFile(join(output, file), Buffer.from((await send('Page.captureScreenshot', { format: 'png' }, sessionId)).data, 'base64'))
        const frame = { name, file, beforeCapture: observed, afterCaptureAt: await read('performance.now()') }
        frames.push(frame); return observed
      }
      const key = async (type: 'down' | 'up', code: string) => {
        trace.push({ at: Date.now(), type, code })
        await send('Input.dispatchKeyEvent', { type: type === 'down' ? 'keyDown' : 'keyUp', code, key: code === 'Space' ? ' ' : code,
          windowsVirtualKeyCode: code === 'Space' ? 32 : code === 'Escape' ? 27 : code === 'ArrowRight' ? 39 : 37 }, sessionId)
      }
      const escape = async () => { await key('down', 'Escape'); await key('up', 'Escape') }
      const click = async (name: string) => {
        const point = await read(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(name)});if(!b)throw Error('Missing control');const r=b.getBoundingClientRect();if(!r.width||!r.height||document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)!==b)throw Error('Control not reachable: '+b.textContent);return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        trace.push({ at: Date.now(), type: 'click', name })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, sessionId)
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, sessionId)
      }
      try {
        await send('Page.navigate', { url: server.url.href + sourceName + '.html' }, sessionId)
        await waitState('Ready'); await Bun.sleep(250); await capture('title')
        await click('Begin'); await waitState('Playing'); await Bun.sleep(50)
        await capture('play')
        const geometry = await read(`(()=>{const c=document.querySelector('canvas').getBoundingClientRect(),h=document.querySelector('#head').getBoundingClientRect(),f=document.querySelector('#foot').getBoundingClientRect();return {canvas:{top:c.top,bottom:c.bottom},headerBottom:h.bottom,footerTop:f.top,buttons:[...document.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width).map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom}}),viewport:{width:innerWidth,height:innerHeight}}})()`)
        expect(geometry.headerBottom).toBeLessThanOrEqual(geometry.canvas.top)
        expect(geometry.footerTop).toBeGreaterThanOrEqual(geometry.canvas.bottom)
        for (const b of geometry.buttons) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0); expect(b.right).toBeLessThanOrEqual(viewport.width); expect(b.bottom).toBeLessThanOrEqual(viewport.height) }
        motionFrames = []
        await send('Page.startScreencast', { format: 'png', maxWidth: 960, maxHeight: 600, everyNthFrame: 1 }, sessionId)
        await click('Pause'); await waitState('Paused')
        const paused0 = await capture('pause-0')
        const simulation = () => read(game === 'puzzle' ? 'JSON.stringify(lights)' : game === 'arena' ? 'JSON.stringify({x,elapsed,hp,rivalHp})' : 'JSON.stringify({x,y,vy})')
        const frozen = await simulation()
        await Bun.sleep(45); await capture('pause-1'); await Bun.sleep(220)
        const pausedEnd = await capture('pause-2')
        expect(await simulation()).toBe(frozen)
        expect(pausedEnd.focus).toBe('Resume')
        if (reduced) expect(paused0.animations).toEqual([])
        await click('Resume'); await waitState('Playing')
        // A fast normal back/return pair, with no screenshot delaying the input.
        await escape(); await escape(); await Bun.sleep(370)
        const recovered = await capture('rapid-return')
        await send('Page.stopScreencast', {}, sessionId)
        const sequence: Array<{ file: string; atMs: number }> = []
        for (const [index, frame] of motionFrames.entries()) {
          const file = label + '-motion-' + String(index).padStart(3, '0') + '.png'
          await writeFile(join(output, file), Buffer.from(frame.data, 'base64'))
          sequence.push({ file, atMs: (frame.timestamp - motionFrames[0]!.timestamp) * 1000 })
        }
        expect(sequence.length).toBeGreaterThan(1)
        await writeFile(join(output, label + '-motion.html'), `<!doctype html><meta charset="utf-8"><title>${label} captured frames</title><style>body{font:16px system-ui;background:#171b24;color:white}img{display:block;max-width:95vw}button{padding:12px}</style><h1>${label}</h1><p>Captured PNGs at observed timestamps, normal-speed playback. This is not display FPS or sample-accurate input timing.</p><button>Play capture</button><span id="time"></span><img><script>const frames=${JSON.stringify(sequence)};const image=document.querySelector('img');image.src=frames[0].file;document.querySelector('button').onclick=()=>{const start=performance.now();function show(now){const elapsed=now-start;const frame=frames.filter(f=>f.atMs<=elapsed).at(-1)||frames[0];image.src=frame.file;document.querySelector('#time').textContent=Math.round(elapsed)+' ms';if(elapsed<frames.at(-1).atMs)requestAnimationFrame(show)}requestAnimationFrame(show)};</script>`)

        if (seeded) expect(recovered.state).toBe('Paused')
        else {
          expect(recovered.state).toBe('Playing'); expect(recovered.focus).toBe('Pause')
          if (game === 'platformer') {
            await key('down', 'ArrowRight'); await Bun.sleep(800); await key('down', 'Space'); await Bun.sleep(80); await key('up', 'Space'); await waitState('Won'); await key('up', 'ArrowRight')
          } else if (game === 'puzzle') {
            await click('Toggle middle'); await Bun.sleep(40); expect(await read('lights.join(\'\')')).toBe('010')
            await click('Undo'); await Bun.sleep(40); expect(await read('lights.join(\'\')')).toBe('101')
            await click('Toggle left'); await click('Toggle right'); await waitState('Won')
          } else { await key('down', 'Space'); await waitState('Won'); await key('up', 'Space') }
          await Bun.sleep(250); await capture('result')
          if (game === 'puzzle') {
            // Actual rendered board: authored tiles end at canvas y=200 of 360.
            const board = await read(`(()=>{const c=document.querySelector('canvas').getBoundingClientRect(),r=document.querySelector('#result-screen').getBoundingClientRect();return {tileBottom:c.top+c.height*200/360,resultTop:r.top}})()`)
            expect(board.resultTop).toBeGreaterThanOrEqual(board.tileBottom)
            frames.push({ name: 'completed-board-visibility', geometry: board })
          }
          expect(await read('document.activeElement.textContent')).toBe('Try again')
          await click('Try again'); await waitState('Playing')
          expect(await read('document.querySelector(\'#result-screen\').hidden')).toBe(true)
        }
        expect(errors).toEqual([])
        const samples: number[] = await read(`new Promise(resolve=>{const s=[];let last;function tick(now){if(last!==undefined)s.push(now-last);last=now;if(s.length===30)resolve(s);else requestAnimationFrame(tick)}requestAnimationFrame(tick)})`)
        const sorted = [...samples].sort((a, b) => a - b)
        observations.push({ label, game, sourceSha256: sha(sources[sourceName]!), viewport, reducedMotion: reduced,
          mode: 'ordinary-input-on-local-playable-prototype', seededDefect: seeded, frames, sequence, geometry, inputTrace: trace,
          headlessRaf: { samples, medianMs: sorted[15], maxMs: sorted.at(-1), limitation: 'Observed callback cadence, not display FPS or input-to-photon latency' },
          recording: await recording.finish('scenario-finished'),
          unverified: ['Representative player comprehension and emotional quality', 'Physical device input latency, GPU performance, touch/gamepad/XR', 'Audiovisual synchronization; these prototypes have no audio', 'Autonomous BGS Skill selection or production game quality'] })
      } finally {
        await recording.finish('scenario-cleanup')
        await writeFile(join(output, label + '-trace.json'), JSON.stringify({ trace, frames }, null, 2))
      }
    }
    await run('platformer', false, true)
    for (const game of uiMotionGames) { await run(game, false); await run(game, true) }
    await writeFile(join(output, 'repair.json'), JSON.stringify({ defect: 'Controlled prototype defect: a stale pause completion restored Paused after Resume',
      sourceBefore: sha(before), sourceAfter: sha(after), patch: { old_string: defect, new_string: '/* finish is presentation only */' },
      owner: 'UI transition/state lifecycle', limitation: 'Seeded local regression, not a discovered BGS production bug or autonomous agent repair' }, null, 2))
    await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'passed', observations, durationMs: Math.round(performance.now() - started),
      modelCalls: 0, modelTokens: 0, newDependencies: [], scope: 'Three local playable UI moods, two desktop viewports, reduced motion and one controlled interruption repair; not production-agent validation' }, null, 2))
    console.log('UI_MOTION_EVIDENCE', output)
    await send('Target.closeTarget', { targetId })
  } catch (error) {
    await writeFile(join(output, 'results.json'), JSON.stringify({ status: 'failed', error: String(error), observations, durationMs: Math.round(performance.now() - started) }, null, 2)); throw error
  } finally { socket?.close(); await owned.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60000)

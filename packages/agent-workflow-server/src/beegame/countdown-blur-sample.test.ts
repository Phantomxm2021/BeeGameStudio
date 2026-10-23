import { expect, test } from 'bun:test'
import { mkdtemp, realpath, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentTools } from './workflow-v3/agent-tools'
import { openPreviewTestAccess } from './preview-test-access'
import { sharedContentChecker } from './content-checker-runtime'
import { sharedPlaywright } from './shared-playwright'
import { projectPreviewCapabilityPath } from './project-preview-capability'

// Local synthetic pages only; never use a generated game or invoke a model.
test.skipIf(process.env.BGS_COUNTDOWN_BLUR_BROWSER !== '1')('countdown blur sample retains real pre-restore evidence for broken and paused countdowns', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-countdown-blur-')))
  let scenario = 'broken', starts = 0, navigations = 0
  const events: any[] = []
  const game = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/event') { events.push(JSON.parse(await request.text())); return new Response(null, { status: 204 }) }
    if (path === '/favicon.ico') return new Response(null, { status: 204 })
    navigations++
    return new Response(`<!doctype html><style>body{background:#183044;color:white}</style>
      <button id="start">Start</button><div id="countdown" hidden></div><div id="playing" hidden>Playing</div><script>
      const scenario=${JSON.stringify(scenario)};
      const countdown=document.querySelector('#countdown'),playing=document.querySelector('#playing');
      let phase='menu',remaining=1500,timer;
      Date.now=()=>999999999;window.elapsed=999999;
      const send=(type,event)=>navigator.sendBeacon('/event',JSON.stringify({scenario,type,trusted:event?.isTrusted,phase,remaining,focused:document.hasFocus()}));
      function tick(){remaining-=100;countdown.textContent=String(remaining);if(remaining<=0){clearInterval(timer);phase='playing';countdown.hidden=true;playing.hidden=false;send('playing')}}
      document.querySelector('#start').onclick=e=>{send('start',e);phase='countdown';countdown.hidden=scenario==='missing';countdown.textContent=String(remaining);timer=setInterval(tick,100)};
      window.addEventListener('blur',e=>{send('blur',e);if(scenario==='paused'&&phase==='countdown')clearInterval(timer)});
      window.addEventListener('focus',e=>{send('focus',e);if(scenario==='paused'&&phase==='countdown')timer=setInterval(tick,100)});
      </script>`, { headers: { 'Content-Type': 'text/html' } })
  } })
  const preview = openPreviewTestAccess({ start: async mode => {
    starts++; expect(mode).toBe('production'); return { status: 'running', mode, url: game.url.origin }
  }, status: () => ({ status: 'running', mode: 'production', url: game.url.origin }), stop() {} })
  const tools = await openAgentTools({ workspacePath: root, sessionId: 'countdown-test', getAuthToken: () => undefined, openPreview: () => preview })
  try {
    await writeFile(join(root, 'source-sentinel.txt'), 'unchanged fixture source')
    const runtime = await sharedContentChecker()
    const run = async (observeMs = 200) => {
      const options = { startSelector: '#start', countdownSelector: '#countdown', playingSelector: '#playing',
        countdownMs: 1500, observeMs, viewport: { width: 640, height: 360 } }
      const child = Bun.spawn(['node', join(root, tools.directory, 'preview.mjs'), '--countdown-blur-sample', JSON.stringify(options)], {
        cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl,
          BEEGAME_PREVIEW_TEST_MODULE: new URL('./preview-test-client.mjs', runtime.moduleUrl).href,
          BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl,
          BEEGAME_PREVIEW_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'countdown-test') }, stdout: 'pipe', stderr: 'pipe',
      })
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(out, err).not.toBe('')
      const report = JSON.parse(out)
      expect(JSON.parse(await readFile(join(root, report.reportPath), 'utf8'))).toEqual(report)
      expect(report.driver).toBe('host-fixed-countdown-blur')
      expect(report.quality).toBe('unverified')
      expect(report.scope).toContain('not pause/resume acceptance')
      expect(report).not.toHaveProperty('passed')
      expect((await readFile(join(root, report.video))).length).toBeGreaterThan(1000)
      return { report, code }
    }
    const broken = await run()
    expect(broken.code, JSON.stringify(broken.report)).toBe(0)
    expect(broken.report.status).toBe('observed') // Observed bug, never an acceptance verdict.
    const failedPause = broken.report.observations
    expect(failedPause.before).toMatchObject({ focused: true, visible: true, countdown: { visible: true }, playing: { visible: false } })
    expect(failedPause.beforeRestore).toMatchObject({ focused: false, visible: true, countdown: { visible: false }, playing: { visible: true } })
    expect(failedPause.blurElapsedMs).toBeGreaterThanOrEqual(1750)
    expect(failedPause.restoreElapsedMs).toBeGreaterThanOrEqual(200)
    expect(failedPause.events.map((e: any) => [e.type, e.trusted])).toEqual([['blur', true], ['focus', true]])
    expect(failedPause.events[0].countdown.visible).toBe(true)
    expect(failedPause.actions.map((a: any) => [a.type, a.status])).toEqual([
      ['start-click', 'sent'], ['host-focus-click', 'sent'], ['restore-iframe-focus', 'sent'],
    ])
    expect(broken.report.frames).toHaveLength(4)
    expect(failedPause.beforeRestoreCapturedAtMs).toBeLessThanOrEqual(failedPause.actions[2].startedAtMs)
    for (const frame of broken.report.frames)
      expect((await readFile(join(root, frame.path))).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(events.find(e => e.scenario === 'broken' && e.type === 'playing')).toMatchObject({ focused: false })

    scenario = 'paused'
    const paused = await run(1800)
    expect(paused.code, JSON.stringify(paused.report)).toBe(0)
    expect(paused.report.status).toBe('observed')
    const correctPause = paused.report.observations
    expect(correctPause.beforeRestore).toMatchObject({ focused: false, visible: true, countdown: { visible: true }, playing: { visible: false } })
    expect(correctPause.beforeRestore.countdown.text).toBe(correctPause.events[0].countdown.text)
    // It resumes through its own normal timers, proving this fixture did not merely hang.
    expect(correctPause.afterRestore).toMatchObject({ focused: true, countdown: { visible: false }, playing: { visible: true } })
    expect(events.find(e => e.scenario === 'paused' && e.type === 'playing')).toMatchObject({ focused: true })
    expect(events.filter(e => e.type === 'blur').every(e => e.trusted)).toBe(true)

    scenario = 'missing'
    const missing = await run()
    expect(missing.code).toBe(1)
    expect(missing.report.status).toBe('incomplete')
    expect(missing.report.observations.actions.map((a: any) => a.type)).toEqual(['start-click'])
    expect(missing.report.observations.events.filter((e: any) => e.type === 'blur')).toHaveLength(0)
    expect(starts).toBe(3)
    expect(navigations).toBe(3)
    expect(new Set([broken.report.directory, paused.report.directory, missing.report.directory]).size).toBe(3)
    expect(await readFile(join(root, 'source-sentinel.txt'), 'utf8')).toBe('unchanged fixture source')
    expect((await readdir(root)).sort()).toEqual(['.beegame', 'source-sentinel.txt'])
  } finally { await tools.close(); game.stop(true); await rm(root, { recursive: true, force: true }) }
}, 60000)

import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openPreviewTestAccess } from './preview-test-access'
import { sharedPlaywright } from './shared-playwright'
import { sharedContentChecker } from './content-checker-runtime'

const source = fileURLToPath(new URL('../../../../.beegame/skills/builtinskills/game-playtest-performance/scripts/capture-play.mjs', import.meta.url))

test('copied capture helper has a read-only CLI and rejects missing active access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-play-skill-cli-'))
  try {
    const script = join(root, 'capture.mjs'); await cp(source, script)
    const child = Bun.spawn(['node', script, '--help'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toContain('No chosen node means explicitly unverified audio')
    expect((await readdir(root)).sort()).toEqual(['capture.mjs'])
    const check = Bun.spawn(['node', '--input-type=module', '-e',
      `const {withPlayCapture}=await import(${JSON.stringify(pathToFileURL(script).href)}); await withPlayCapture({},async()=>{});`],
      { cwd: root, env: { PATH: process.env.PATH, BEEGAME_PREVIEW_TEST_MODULE: '' }, stdout: 'pipe', stderr: 'pipe' })
    expect(await check.exited).not.toBe(0)
    expect(await new Response(check.stderr).text()).toContain('No current supplied Preview helper')
    expect((await readdir(root)).sort()).toEqual(['capture.mjs'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

/** Free local fixture: no model, generated game workspace or personal browser. */
test.skipIf(process.env.BGS_PLAY_CAPTURE_BROWSER !== '1')('actual Preview path retains video, selected-node audio, limits and failed-driver evidence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-play-skill-browser-')))
  const fixture = `<!doctype html><body><button id="start">Start</button><button id="hit">Hit</button><button id="quiet">Quiet</button><button id="mute">Mute</button><div id="dot" style="width:32px;height:32px;background:green;transition:transform .2s"></div><script>
  window.gameAudio = new AudioContext(); window.master = gameAudio.createGain(); master.gain.value=.2; master.connect(gameAudio.destination);
  window.originalConnect=AudioNode.prototype.connect;
  document.querySelector('#start').onclick=async()=>{await gameAudio.resume();const source=gameAudio.createOscillator();source.connect(master);source.start();source.stop(gameAudio.currentTime+1);document.querySelector('#dot').style.transform='translateX(120px)'};
  document.querySelector('#hit').onclick=()=>{const source=gameAudio.createOscillator();source.frequency.value=700;source.connect(master);source.start();source.stop(gameAudio.currentTime+.07)};
  document.querySelector('#quiet').onclick=()=>master.gain.value=.04;
  document.querySelector('#mute').onclick=()=>master.gain.value=0;
  </script>`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: () => new Response(fixture, { headers: { 'Content-Type': 'text/html' } }) })
  const snapshot = { status: 'running', mode: 'production', url: server.url.href }
  const access = openPreviewTestAccess({ start: async () => snapshot, status: () => snapshot, stop() {} })
  try {
    await mkdir(join(root, 'evidence'))
    await cp(source, join(root, 'capture.mjs'))
    await writeFile(join(root, 'capability.json'), JSON.stringify({ version: 1, workspace: root,
      sessionId: 'offline-test', executionId: 'offline-test', apiUrl: access.baseUrl }))
    await writeFile(join(root, 'driver.mjs'), `
      const mode=process.argv[2];
      const {withPlayCapture}=await import(mode==='legacy' ? './capture.mjs' : process.env.BEEGAME_PREVIEW_TEST_MODULE);
      let metrics;
      const report=await withPlayCapture({mode:'production',viewport:{width:480,height:320},outputParent:'evidence',audio:true,audioLimitMs:mode==='limit'?350:30000}, async ({page,gameFrame,mark,captureFrame})=>{
        await gameFrame.waitForSelector('#start');
        if(mode!=='no-tap')await gameFrame.evaluate(()=>__bgsPlayAudioTap.start(master,'fixture master after game gain'));
        await captureFrame('before start');
        await gameFrame.locator('#start').click(); mark('start input');
        await page.waitForTimeout(150);
        if(mode==='fail'){
          // Fail only after the audio clock has advanced; wall-clock delay
          // alone can end a cold recorder before it has produced any bytes.
          await gameFrame.waitForFunction(()=>gameAudio.currentTime>=.4);
          await gameFrame.evaluate(()=>console.error('retained fixture diagnostic token=synthetic-secret'));
          await page.waitForTimeout(50);
          throw Error('deliberate fixture assertion failed');
        }
        await gameFrame.locator('#hit').click(); await page.waitForTimeout(100);
        await gameFrame.locator('#quiet').click(); await page.waitForTimeout(200);
        await gameFrame.locator('#mute').click(); await page.waitForTimeout(250);
        await captureFrame('muted resulting state');
        if(mode!=='no-tap')metrics=await gameFrame.evaluate(async()=>{
          const result=await __bgsPlayAudioTap.stop();
          const recording=result.recordings[0];
          const bytes=Uint8Array.from(atob(recording.base64),c=>c.charCodeAt(0));
          const decoder=new OfflineAudioContext(2,1,48000);
          const decoded=await decoder.decodeAudioData(bytes.buffer), data=decoded.getChannelData(0);
          const rms=(start,end)=>{let sum=0;for(let i=start;i<end;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(end-start))};
          return {duration:decoded.duration,overallRms:rms(0,data.length),tailRms:rms(Math.floor(data.length*.85),data.length),
            nativeConnectUnchanged:AudioNode.prototype.connect===originalConnect,contextState:gameAudio.state,
            observedX:document.querySelector('#dot').getBoundingClientRect().x};
        });
      });
      console.log(JSON.stringify({report,metrics}));
    `)
    const runtime = await sharedContentChecker()
    const run = async (mode: string) => {
      const child = Bun.spawn(['node', join(root, 'driver.mjs'), mode], { cwd: root, stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, BEEGAME_PREVIEW_CAPABILITY_FILE: join(root, 'capability.json'),
          BEEGAME_PREVIEW_TEST_MODULE: new URL('./preview-test-client.mjs', runtime.moduleUrl).href,
          BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl } })
      const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, out, error }
    }
    const normal = await run('normal')
    if (normal.code !== 0) throw Error(normal.error)
    const { report, metrics } = JSON.parse(normal.out)
    expect(report.audio.recordings[0]).toMatchObject({ status: 'recorded', initialContextState: 'suspended',
      label: 'fixture master after game gain', quality: 'unverified' })
    expect(metrics.nativeConnectUnchanged).toBe(true)
    expect(metrics.contextState).toBe('running')
    expect(metrics.observedX).toBeGreaterThan(100)
    expect(metrics.overallRms).toBeGreaterThan(.01)
    expect(metrics.tailRms).toBeLessThan(metrics.overallRms / 10)
    expect((await readFile(join(root, report.video))).length).toBeGreaterThan(1000)
    expect((await readFile(join(root, report.audio.recordings[0].path))).length).toBeGreaterThan(200)
    expect(report.runtimeErrors.pageErrors).toBe(0)
    expect(report.frames).toHaveLength(2)
    expect(await readFile(join(root, report.frames[0].path))).not.toEqual(await readFile(join(root, report.frames[1].path)))
    const legacy = await run('legacy')
    expect(legacy.code).toBe(0)
    expect(JSON.parse(legacy.out).report.quality).toBe('unverified')
    const limited = await run('limit')
    if (limited.code !== 0) throw Error(limited.error)
    const limitedRecording = JSON.parse(limited.out).report.audio.recordings[0]
    expect(limitedRecording.endReason).toBe('window-limit')
    expect(limitedRecording.coverage).toBe('limited-or-interrupted-window')
    expect(limitedRecording.durationMs).toBeLessThan(750)
    const noTap = await run('no-tap')
    expect(noTap.code).toBe(0)
    expect(JSON.parse(noTap.out).report.audio).toMatchObject({ status: 'unverified', recordings: [] })
    const failure = await run('fail')
    expect(failure.code).not.toBe(0)
    expect(failure.error).toContain('retained evidence/play-capture-')
    const reports = await Promise.all((await readdir(join(root, 'evidence')))
      .map(async name => JSON.parse(await readFile(join(root, 'evidence', name, 'observation.json'), 'utf8'))))
    expect(reports).toHaveLength(5)
    expect(reports.find(item => item.driverError)?.video).toBeTruthy()
    expect(reports.find(item => item.driverError)?.audio.recordings[0]?.status).toBe('recorded')
    const failedReport = reports.find(item => item.driverError)
    expect(failedReport.runtimeErrors.consoleErrors).toBe(1)
    expect(failedReport.runtimeErrorDetails.consoleErrors[0].message).toContain('retained fixture diagnostic')
    expect(JSON.stringify(failedReport.runtimeErrorDetails)).not.toContain('synthetic-secret')
  } finally { await access.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 45_000)

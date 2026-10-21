import { expect, test } from 'bun:test'
import { createPreviewTestBrowser, resolveTestBrowserExecutable } from './preview-test-browser'
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bgsCommand, toml } from '../bgs/client'

test('invalid browser config fails explicitly instead of selecting a personal browser', async () => {
  await expect(resolveTestBrowserExecutable('relative/chrome')).rejects.toThrow('absolute path')
  const browser = createPreviewTestBrowser({ executable: '/missing/beegame/chrome' })
  const first = browser.start()
  expect(browser.start()).toBe(first)
  await expect(first).rejects.toThrow('executable absolute path')
  expect(browser.status().status).toBe('not-running')
  await expect(browser.restart()).rejects.toThrow('executable absolute path')
  await browser.close()
  await expect(browser.start()).rejects.toThrow('closed')
  await expect(browser.restart()).rejects.toThrow('closed')
})

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('real isolated browser opens an empty page through CDP and closes', async () => {
  const browser = createPreviewTestBrowser()
  let ws: WebSocket | undefined
  try {
    const result = await browser.start()
    expect(result.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:/)
    expect((await browser.start()).endpoint).toBe(result.endpoint)
    ws = new WebSocket(result.endpoint)
    const answer = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP healthcheck timeout')), 5000)
      ws!.onopen = () => ws!.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank' } }))
      ws!.onmessage = event => { const value = JSON.parse(String(event.data)); if (value.id === 1) { clearTimeout(timer); resolve(value) } }
      ws!.onerror = () => { clearTimeout(timer); reject(new Error('CDP connection failed')) }
    })
    expect(answer.error).toBeUndefined()
    expect(answer.result.targetId).toBeTruthy()
    ws.close(); ws = undefined
    const restarted = await browser.restart()
    expect(restarted.endpoint).not.toBe(result.endpoint)
    expect((await browser.start()).endpoint).toBe(restarted.endpoint)
    await expect(fetch(`http://${new URL(result.endpoint).host}/json/version`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
  } finally { ws?.close(); await browser.close() }
  expect(browser.status().status).toBe('closed')
}, 25000)

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('close during explicit restart cannot resurrect the owned browser', async () => {
  const browser = createPreviewTestBrowser()
  await browser.start()
  const restart = browser.restart()
  await browser.close()
  await expect(restart).rejects.toThrow('closed')
  expect(browser.status().status).toBe('closed')
  await expect(browser.start()).rejects.toThrow('closed')
}, 25000)

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1' || process.platform !== 'darwin')('a filesystem-sandboxed native client can use the host browser with network permission', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beegame-cdp-client-')))
  const browser = createPreviewTestBrowser()
  try {
    const { endpoint } = await browser.start()
    const file = join(root, 'probe.js')
    await writeFile(file, `const ws = new WebSocket(process.argv[2]); const timeout = setTimeout(() => process.exit(2), 5000); ws.onopen = () => ws.send(JSON.stringify({id:1,method:'Target.getTargets'})); ws.onmessage = e => {const m = JSON.parse(e.data); if(m.id===1){clearTimeout(timeout); ws.close(); process.exit(m.result?.targetInfos?.some(t=>t.type==='page')?0:3)}};`)
    const profile = {filesystem:{':minimal':'read',[root]:'write',[process.execPath]:'read'},network:{enabled:true}}
    const child = Bun.spawn(bgsCommand().concat('sandbox','-C',root,'-P','bgs-browser-test','-c','permissions.bgs-browser-test='+toml(profile),'--',process.execPath,file,endpoint), { cwd: root,
      env: { PATH: '/usr/bin:/bin', TMPDIR: root, BGS_HOME:root }, stdout: 'pipe', stderr: 'pipe' })
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect({ code, error }).toEqual({ code: 0, error: '' })
  } finally { await browser.close(); await rm(root, { recursive: true, force: true }) }
}, 25000)

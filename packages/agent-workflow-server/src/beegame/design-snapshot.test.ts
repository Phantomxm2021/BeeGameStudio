import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, realpath, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { openAgentTools } from './workflow-v3/agent-tools'
import { prepareProductionHandoff } from './workflow-v3/production-workflow'
import { openPreviewTestAccess } from './preview-test-access'
import { createPreviewTestBrowser } from './preview-test-browser'
import { projectPreviewCapabilityPath } from './project-preview-capability'
import { sharedContentChecker } from './content-checker-runtime'
import { sharedPlaywright } from './shared-playwright'

async function fixture(realBrowser = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-render-fixture-')))
  await mkdir(join(root, 'docs'))
  await writeFile(join(root, 'docs/board.html'), '<!doctype html><h1>Design</h1>')
  let starts = 0, browserStarts = 0
  const browser = realBrowser ? createPreviewTestBrowser() : {
    start: async () => { browserStarts++; throw Error('Unexpected browser start') },
    status: () => ({ status: 'idle' }), close: async () => {},
  }
  const preview = openPreviewTestAccess({ start: async () => { starts++; throw Error('Design must not start a game server') },
    status: () => ({ status: 'idle' }), stop() {}, browser })
  const tools = await openAgentTools({ workspacePath: root, sessionId: 'design-fixture', getAuthToken: () => undefined,
    openPreview: () => preview })
  const env = { PATH: process.env.PATH, BEEGAME_CONTENT_CHECKER_MODULE: (await sharedContentChecker()).moduleUrl,
    BEEGAME_PREVIEW_CAPABILITY_FILE: projectPreviewCapabilityPath(root, 'design-fixture'),
    BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl }
  const run = async (input: unknown) => {
    const child = Bun.spawn([Bun.which('node')!, join(root, tools.directory, 'preview.mjs'), '--design-snapshot', JSON.stringify(input)],
      { cwd: root, env, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { code, stderr, result: JSON.parse(stdout) }
  }
  return { root, tools, run, env, browser, counters: () => ({ starts, browserStarts }),
    close: async () => { await tools.close(); await rm(root, { recursive: true, force: true }) } }
}

test('design render rejects invalid or aliased sources and revoked access before opening a browser', async () => {
  const f = await fixture()
  try {
    await symlink(join(f.root, 'docs/board.html'), join(f.root, 'docs/alias.html'))
    for (const input of [
      { path: '../outside.html', views: [{ width: 800, height: 600 }] },
      { path: 'docs/alias.html', views: [{ width: 800, height: 600 }] },
      { path: 'docs/board.html', views: [] },
      { path: 'docs/board.html', views: [{ width: 0, height: 600 }] },
      { path: 'docs/board.html', views: [{ width: 800, height: 600, query: 'https://example.com' }] },
      { path: 'docs/board.html', views: [{ width: 800, height: 600, typo: true }] },
    ]) {
      const r = await f.run(input)
      expect(r.code, r.stderr).toBe(1)
      expect(r.result).toMatchObject({ status: 'error', quality: 'unverified' })
      expect(r.result.error).not.toContain('Unexpected browser start')
    }
    await f.tools.close()
    const expired = await f.run({ path: 'docs/board.html', views: [{ width: 800, height: 600 }] })
    expect(expired.code).toBe(1)
    expect(expired.result.error).toContain('PREVIEW_CAPABILITY_EXPIRED')
    expect(f.counters()).toEqual({ starts: 0, browserStarts: 0 })
  } finally { await f.close() }
})

test.skipIf(process.env.BGS_LAYOUT_BROWSER !== '1')('managed design batch retains real images and failures with compact diagnostics and no game server', async () => {
  const f = await fixture(true)
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'bgs-design-outside-')))
  try {
    await writeFile(join(outside, 'private.txt'), 'OUTSIDE_MUST_NOT_BE_READ')
    await symlink(join(outside, 'private.txt'), join(f.root, 'docs/linked.txt'))
    await mkdir(join(f.root, '.private'))
    await writeFile(join(f.root, '.private/secret.txt'), 'PRIVATE_MUST_NOT_BE_READ')
    await writeFile(join(f.root, 'docs/style.css'), 'body{margin:0;background:rgb(18,52,86);color:white}#state{font:20px sans-serif}')
    await writeFile(join(f.root, 'docs/dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="orange"/></svg>')
    await writeFile(join(f.root, 'docs/board.html'), `<!doctype html><link rel="stylesheet" href="./style.css"><div id="state"></div><img src="./dot.svg"><script>
      state.textContent=new URLSearchParams(location.search).get('state');document.title=state.textContent;
      Promise.all(['./linked.txt','../.private/secret.txt'].map(async p=>{
        const r=await fetch(p); if(r.status!==404)throw Error('Private source exposed');
      })).then(()=>{state.dataset.ready='yes'});
      console.error('fixture diagnostic');
    </script>`)
    const result = await f.run({ path: 'docs/board.html', views: [
      { width: 640, height: 360, query: '?state=one', readySelector: '[data-ready=yes]' },
      { width: 800, height: 600, query: '?state=two', readySelector: '[data-ready=yes]' },
    ] })
    expect(result.code, result.stderr).toBe(0)
    expect(result.result).toMatchObject({ status: 'observed', requestedViews: 2, unattemptedViews: 0, quality: 'unverified' })
    expect(result.result.reportPath).toMatch(/^docs\/design\/render-[^/]+\/observation\.json$/)
    const saved = JSON.parse(await readFile(join(f.root, result.result.reportPath), 'utf8'))
    expect(saved.views).toHaveLength(2)
    for (const [index, view] of saved.views.entries()) {
      const png = await readFile(join(f.root, view.imagePath))
      expect(png.readUInt32BE(16)).toBe(index ? 800 : 640)
      expect(png.readUInt32BE(20)).toBe(index ? 600 : 360)
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
      expect([...data.subarray((info.width * (info.height - 1)) * info.channels, (info.width * (info.height - 1)) * info.channels + 3)]).toEqual([18, 52, 86])
      expect(view.runtimeErrors.httpErrors).toBe(2)
      expect(view.runtimeErrors.consoleErrors).toBeGreaterThan(0)
      expect(view.layout.brokenImages).toBe(0)
      expect(view.layout.title).toBe(index ? 'two' : 'one')
      expect(view.observedEnvironment.viewport).toEqual({ width: index ? 800 : 640, height: index ? 600 : 360 })
      expect(result.result.views[index].runtimeErrorDetails).toBeDefined()
      expect(result.result.views[index].layout).toBeUndefined()
    }
    await writeFile(join(f.root, 'docs/GDD.md'), '# GDD\n## Visual\nSynthetic design reference.\n')
    const handoff = prepareProductionHandoff({ workspacePath: f.root } as any,
      { production: { stage: 'visual', originRequestKey: 'fixture' } } as any,
      { action: 'advance', summary: 'Synthetic design rendered', sections: ['Visual'], files: saved.views.map((view: any) => view.imagePath) })
    expect(handoff.next.stage).toBe('resources')
    expect(handoff.sources).toHaveLength(3)
    const failed = await f.run({ path: 'docs/board.html', views: [
      { width: 640, height: 360 }, { width: 640, height: 360, readySelector: '[' }, { width: 640, height: 360 },
    ] })
    expect(failed.code).toBe(1)
    expect(failed.result).toMatchObject({ status: 'error', unattemptedViews: 1, quality: 'unverified' })
    expect(failed.result.views[0].imagePath).toBeTruthy()
    expect(failed.result.views[1].error).toBeTruthy()
    expect(f.counters().starts).toBe(0)
    // A failed callback must not leak a browser context or close the shared browser.
    const status = f.browser.status()
    const endpoint = 'endpoint' in status ? status.endpoint : undefined
    expect(endpoint).toBeTruthy()
    const inspect = Bun.spawn([Bun.which('node')!, '--input-type=module', '-e',
      `const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);const b=await chromium.connectOverCDP(${JSON.stringify(endpoint)});try{console.log(JSON.stringify(b.contexts().map(c=>c.pages().map(p=>p.url()))))}finally{await b.close()}`],
      { cwd: f.root, env: f.env, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(inspect.stdout).text(), new Response(inspect.stderr).text(), inspect.exited])
    expect(code, err).toBe(0)
    expect(JSON.parse(out).flat()).not.toContain('https://bgs-design.invalid/docs/board.html')
    expect(JSON.parse(out).flat().filter((url: string) => url.startsWith('https://bgs-design.invalid'))).toHaveLength(0)
  } finally { await f.close(); await rm(outside, { recursive: true, force: true }) }
}, 60000)

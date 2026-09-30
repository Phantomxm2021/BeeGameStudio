import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectExecutionAccess } from './project-execution-access'
import { openPreviewTestAccess } from './preview-test-access'
import { createPreviewTestBrowser } from './preview-test-browser'

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('shared Node Playwright connects, clicks, resizes and captures an owned browser', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-playwright-fixture-'))
  const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<html><body><button onclick="this.textContent=\'Clicked\'">Click</button></body></html>', { headers: { 'content-type': 'text/html' } }) })
  const browser = createPreviewTestBrowser()
  const capability = openPreviewTestAccess({ start: async () => ({ status: 'running', url: fixture.url.href }), status: () => ({ status: 'running', url: fixture.url.href }), stop() {}, browser })
  let endpoint: string | undefined
  try {
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'fixture', environment: {} })
    const response = await fetch(capability.baseUrl + '/browser', { method: 'POST' })
    const result = await response.json() as { endpoint?: string; error?: string }
    expect(response.status, result.error).toBe(200)
    endpoint = result.endpoint!
    const script = `
      const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);
      const browser=await chromium.connectOverCDP(process.env.FIXTURE_CDP);
      let context;
      try {
        context=await browser.newContext({viewport:{width:800,height:600}});
        const page=await context.newPage();
        await page.goto(process.env.FIXTURE_URL);
        await page.getByRole('button').click();
        if(await page.getByRole('button').textContent()!=='Clicked') throw Error('click failed');
        await page.setViewportSize({width:390,height:844});
        if(await page.evaluate(()=>innerWidth)!==390) throw Error('resize failed');
        const png=await page.screenshot();
        if(png.length<100) throw Error('capture failed');
        console.log('SHARED_PLAYWRIGHT_PASS');
      } finally { await context?.close(); await browser.close(); }
    `
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    const child = Bun.spawn([node!, '--input-type=module', '-e', script], { cwd: workspace,
      env: { ...process.env, ...access.environment, FIXTURE_CDP: endpoint, FIXTURE_URL: fixture.url.href }, stdout: 'pipe', stderr: 'pipe' })
    const timeout = setTimeout(() => child.kill(), 20000)
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(code, err).toBe(0)
      expect(out).toContain('SHARED_PLAYWRIGHT_PASS')
    } finally { clearTimeout(timeout) }
  } finally {
    await capability.close()
    fixture.stop(true)
    await rm(workspace, { recursive: true, force: true })
  }
  expect(browser.status().status).toBe('closed')
  const ws = new URL(endpoint!)
  await expect(fetch(`http://${ws.host}/json/version`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
}, 40000)

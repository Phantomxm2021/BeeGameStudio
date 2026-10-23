import { expect, test } from 'bun:test'
import { openPreviewTestAccess } from './preview-test-access'
import { resolveTestBrowserExecutable } from './preview-test-browser'
import { sharedPlaywright } from './shared-playwright'

// Capability probe only: the existing isolated headless browser, no game project,
// synthetic visibility events, forced lifecycle states, browser install or fallback.
test.skipIf(process.env.BGS_BACKGROUND_CAPABILITY_BROWSER !== '1')('current Preview browser can hide the host and game iframe by switching tabs', async () => {
  const executable = await resolveTestBrowserExecutable()
  const game = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(
    '<!doctype html><title>Local visibility fixture</title><button>Fixture</button>',
    { headers: { 'Content-Type': 'text/html' } },
  ) })
  const preview = openPreviewTestAccess({
    start: async mode => ({ status: 'running', mode, url: game.url.origin }),
    status: () => ({ status: 'running', mode: 'production', url: game.url.origin }), stop() {},
  })
  try {
    const child = Bun.spawn(['node', '--input-type=module', '--eval', `
      import { setTimeout as waitHost } from 'node:timers/promises';
      const { withPreviewPage } = await import(${JSON.stringify(new URL('./preview-test-client.mjs', import.meta.url).href)});
      const report = await withPreviewPage({apiUrl:${JSON.stringify(preview.baseUrl)},mode:'production',runtimeErrorPolicy:'fail'},
        async ({page,gameFrame,context,browser}) => {
          const other = await context.newPage();
          const gameSession = await context.newCDPSession(page);
          const otherSession = await context.newCDPSession(other);
          // Remove the client's active-page override; do not force hidden/frozen.
          await gameSession.send('Emulation.setFocusEmulationEnabled',{enabled:false});
          await otherSession.send('Emulation.setFocusEmulationEnabled',{enabled:false});
          const observe = () => {
            const events = [];
            const record = e => events.push({type:e.type,trusted:e.isTrusted,visibility:document.visibilityState});
            document.addEventListener('visibilitychange',record);
            return { read:()=>({visibility:document.visibilityState,focused:document.hasFocus(),events:[...events]}),
              stop:()=>document.removeEventListener('visibilitychange',record) };
          };
          const hostObserver = await page.evaluateHandle(observe);
          const frameObserver = await gameFrame.evaluateHandle(observe);
          const read = async () => ({host:await hostObserver.evaluate(o=>o.read()),frame:await frameObserver.evaluate(o=>o.read())});
          try {
            await page.bringToFront();
            await waitHost(100);
            const before = await read();
            await other.bringToFront();
            const started = performance.now();
            await waitHost(1000);
            const background = await read(), backgroundElapsedMs = performance.now()-started;
            await page.bringToFront();
            await waitHost(100);
            const restored = await read();
            const supported = ['host','frame'].every(key => before[key].visibility==='visible' &&
              background[key].visibility==='hidden' && restored[key].visibility==='visible' &&
              background[key].events.some(e=>e.trusted && e.visibility==='hidden') &&
              restored[key].events.some((e,i,events)=>e.trusted && e.visibility==='visible' &&
                events.slice(0,i).some(prior=>prior.trusted && prior.visibility==='hidden')));
            return {browserVersion:browser.version(),supported,before,background,restored,backgroundElapsedMs};
          } finally {
            await hostObserver.evaluate(o=>o.stop()); await frameObserver.evaluate(o=>o.stop());
            await hostObserver.dispose(); await frameObserver.dispose();
            await gameSession.detach(); await otherSession.detach(); await other.close();
          }
        });
      console.log(JSON.stringify(report));
    `], { env: { ...process.env, BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect(code, stderr).toBe(0)
    const report = { executable, ...JSON.parse(stdout) }
    console.info('Background capability observation:', JSON.stringify(report))
    expect(report.supported, 'No genuine hidden transition: do not enable background sampling or substitute synthetic events').toBe(true)
  } finally { await preview.close(); game.stop(true) }
}, 30000)

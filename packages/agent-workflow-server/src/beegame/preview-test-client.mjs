import { readFile, realpath } from 'node:fs/promises';

export async function resolvePreviewApi(apiUrl) {
  if (apiUrl === undefined) {
    const path = process.env.BEEGAME_PREVIEW_CAPABILITY_FILE;
    if (!path) throw new Error('PREVIEW_CAPABILITY_MISSING: No current project browser capability. Continue through BGS to acquire one.');
    let capability;
    try { capability = JSON.parse(await readFile(path, 'utf8')); }
    catch { throw new Error('PREVIEW_CAPABILITY_EXPIRED: This execution has ended. Continue through BGS; do not reuse old URLs.'); }
    if (capability.version !== 1 || !capability.executionId || !capability.sessionId ||
        capability.workspace !== await realpath(process.cwd()))
      throw new Error('PREVIEW_CAPABILITY_MISMATCH: Browser capability does not belong to this workspace.');
    apiUrl = capability.apiUrl;
  }
  const api = new URL(apiUrl);
  if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
    throw new Error('Expected the current local Preview API');
  return api.href.replace(/\/$/, '');
}

/** Optional Node client: owns only this call's context and CDP connection.
 * The caller chooses interactions/assertions; no retries or gameplay verdicts. */
export async function withPreviewPage({ apiUrl, mode, contextOptions = {}, beforeNavigate, runtimeErrorPolicy = 'observe' }, inspect) {
  if (process.versions.bun) throw new Error('PREVIEW_NODE_REQUIRED: Run the test script with node, not bun. The shared Playwright/CDP client uses Node.');
  apiUrl = await resolvePreviewApi(apiUrl);
  const moduleUrl = process.env.BEEGAME_PLAYWRIGHT_MODULE;
  if (!moduleUrl) throw new Error('BEEGAME_PLAYWRIGHT_MODULE is unavailable');
  if (typeof inspect !== 'function') throw new Error('An inspection callback is required');
  if (beforeNavigate !== undefined && typeof beforeNavigate !== 'function')
    throw new Error('beforeNavigate must be a function');
  if (!['observe', 'fail'].includes(runtimeErrorPolicy)) throw new Error('runtimeErrorPolicy must be observe or fail');
  const request = async (path, body) => {
    const response = await fetch(apiUrl + path, body === undefined ? undefined : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Preview API returned ${response.status}`);
    return result;
  };
  const preview = mode === undefined ? await request('/status') : await request('/preview', { mode });
  if (preview.preview?.status !== 'running') throw new Error('Start a running preview before inspecting it');
  const { endpoint } = await request('/browser', {});
  const { chromium } = await import(moduleUrl);
  const browser = await chromium.connectOverCDP(endpoint);
  let context;
  try {
    context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    // Capture from the first navigation even if inspect installs its own
    // listeners late. Counts only: no console payloads, URLs or credentials are
    // copied into host logs. They are observations, never an automatic verdict.
    const runtimeErrors = { pageErrors: 0, consoleErrors: 0, failedRequests: 0, httpErrors: 0 };
    page.on('pageerror', () => runtimeErrors.pageErrors++);
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.consoleErrors++; });
    page.on('requestfailed', () => runtimeErrors.failedRequests++);
    page.on('response', response => { if (response.status() >= 400) runtimeErrors.httpErrors++; });
    // Install startup error listeners and context routes before the game's
    // first request. Registering them in inspect is too late for boot failures.
    await beforeNavigate?.({ page, context });
    await page.goto(preview.hostUrl);
    const iframe = page.locator(preview.frameSelector);
    await iframe.waitFor({ state: 'attached' });
    const element = await iframe.elementHandle();
    const gameFrame = await element?.contentFrame();
    await element?.dispose();
    if (!gameFrame) throw new Error('Unverified: preview iframe has no attached game frame');
    await gameFrame.waitForLoadState('domcontentloaded');
    // Keyboard events belong to the active frame. Focusing the iframe neither
    // clicks a game control nor changes game state; render readiness is still
    // the caller's precondition. Preserve the original FrameLocator API.
    await iframe.evaluate(element => element.focus());
    const result = await inspect({ page, frame: page.frameLocator(preview.frameSelector), gameFrame,
      environment: preview.environment, runtimeErrors, context, browser });
    // Opt-in for tests claiming a clean runtime. A late user listener cannot
    // hide the helper's initial-load observations. Diagnostic callers keep the
    // original observe-only contract; this is not a gameplay/quality verdict.
    if (runtimeErrorPolicy === 'fail' && Object.values(runtimeErrors).some(count => count > 0))
      throw new Error('PREVIEW_RUNTIME_ERRORS: ' + JSON.stringify(runtimeErrors));
    return result;
  } finally {
    try { await context?.close(); }
    finally { await browser.close(); }
  }
}

/** Deterministic bounded-sample check, not a semantic auditor or a guarantee
 * outside the observed interval. Keep all retained runs, not only the latest. */
export function checkNumericSamples(samples, { minimum, maximum } = {}) {
  if ((minimum === undefined && maximum === undefined) ||
      (minimum !== undefined && !Number.isFinite(minimum)) ||
      (maximum !== undefined && !Number.isFinite(maximum)) ||
      (minimum !== undefined && maximum !== undefined && minimum > maximum))
    throw new Error('Supply at least one finite bound; minimum cannot exceed maximum');
  if (!Array.isArray(samples))
    throw new Error('Samples must be finite observed numbers, not missing values or PASS labels');
  for (const value of samples) if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Samples must be finite observed numbers, not missing values or PASS labels');
  const violations = samples.flatMap((value, index) =>
    (minimum !== undefined && value < minimum || maximum !== undefined && value > maximum) ? [{ index, value }] : []);
  return { status: !samples.length ? 'unverified' : violations.length ? 'failed' : 'passed',
    count: samples.length, ...(samples.length ? { observedMinimum: samples.reduce((a,b)=>Math.min(a,b)),
      observedMaximum: samples.reduce((a,b)=>Math.max(a,b)) } : {}), violations,
    note: 'Only the supplied observations and explicit bounds; does not prove coverage, concurrency, listening quality or unseen behavior.' };
}

/** Explicit groups whose rendered text is expected to be separate. Text-node
 * ranges include nested inline/block descendants that parent boxes can miss.
 * This observes current DOM geometry, not Canvas pixels or aesthetic quality. */
export async function checkTextSeparation(gameFrame, selectors) {
  if (!Array.isArray(selectors) || selectors.length < 2 ||
      selectors.some(s => typeof s !== 'string' || !s.trim()) || new Set(selectors).size !== selectors.length)
    throw new Error('Supply at least two distinct CSS selectors for text groups intended not to overlap');
  const groups = await gameFrame.evaluate(selected => selected.map(selector => {
    const elements = [...document.querySelectorAll(selector)], rects = [];
    for (const element of elements) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walker.nextNode())) {
        if (!text.textContent.trim()) continue;
        let visible = true;
        for (let parent = text.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) { visible = false; break; }
        }
        if (!visible) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0)
          rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
    return { selector, elements: elements.length, rects };
  }), selectors);
  const overlaps = [];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++)
    for (const a of groups[i].rects) for (const b of groups[j].rects) {
      const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (width > 0 && height > 0) overlaps.push({ first: groups[i].selector, second: groups[j].selector, width, height });
    }
  return { status: overlaps.length ? 'failed' : groups.some(g => !g.rects.length) ? 'unverified' : 'passed',
    groups, overlaps,
    note: 'Only selected visible DOM text-range rectangles in this state; missing text is unverified. Select disjoint semantic groups. Not clipping/occlusion, Canvas, all-screen coverage, sound, taste or gameplay acceptance.' };
}

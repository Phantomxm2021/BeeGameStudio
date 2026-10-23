import { open, mkdir, mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { relative, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePreviewApi, withPreviewPage } from './preview-test-client.mjs';

// Read at most 2 KiB per stream. Only the head/tail are sampled; the omitted
// middle may contain the key error or a credential's opening label. Redaction
// covers recognizable sampled forms, not unknown context. Full output stays on disk.
async function failureOutputExcerpt(path) {
  let file;
  try {
    if (await realpath(path) !== path) throw Error('Aliased output');
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile()) throw Error('Not a regular output file');
    const limit = 2048, truncated = stat.size > limit;
    const read = async (length, position) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    };
    const decode = buffer => {
      let start = 0;
      while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++;
      return new StringDecoder('utf8').write(buffer.subarray(start));
    };
    // Recognize both forms on the original sample. Overlapping spans must not
    // rewrite each other's quote/escape context or the original line boundary.
    const redact = (value, start = 0) => {
      const ranges = [
        /\bBearer\s+[^\s,;"']+/gi,
        /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|token|secret|password|cookie)["']?\s*[:=]\s*(?:"(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$)|'(?:\\(?:[\s\S]|$)|[^'\\])*(?:'|$)|[^\s,;]+)/gi,
      ].flatMap(pattern => [...value.matchAll(pattern)].map(match => [Math.max(start, match.index), match.index + match[0].length]))
        .sort((a, b) => a[0] - b[0]);
      let output = '', cursor = start;
      for (const [begin, end] of ranges) {
        if (end <= cursor) continue;
        if (begin >= cursor) output += value.slice(cursor, begin) + '[credential redacted]';
        cursor = end;
      }
      return output + value.slice(cursor);
    };
    const gap = '\n[...truncated...]\n', part = Math.floor((limit - gap.length) / 2);
    let text;
    if (truncated) {
      const head = redact(decode(await read(part, 0)));
      // Include one preceding byte within the 2 KiB budget to distinguish a
      // complete first tail line from a fragment. Never join across the gap before redaction.
      const tailBytes = await read(part + 1, stat.size - part - 1);
      const tail = decode(tailBytes.subarray(1));
      const tailStart = tailBytes[0] === 10 || tailBytes[0] === 13 ? 0
        : /^[^\r\n]*(?:\r\n?|\n|$)/.exec(tail)[0].length;
      text = head + gap + redact(tail, tailStart);
    } else text = redact(decode(await read(stat.size, 0)));
    return { text: text.slice(0, limit), truncated: truncated || text.length > limit };
  } catch {
    return { unavailable: true };
  } finally {
    // Optional diagnostics must not replace the process result or prevent its receipt.
    try { await file?.close(); } catch {}
  }
}

/** One first-load observation without a project-authored test driver. It is a
 * diagnostic image, never a gameplay, design or source-version verdict. */
export async function capturePreviewSnapshot(mode, width, height, visit = withPreviewPage) {
  if (!['development', 'production'].includes(mode) ||
      ![width, height].every(value => Number.isInteger(value) && value > 0 && value <= 4096))
    throw Error('Expected --snapshot development|production <viewport-width> <viewport-height> (1..4096)');
  const root = await realpath(process.cwd());
  const api = await resolvePreviewApi();
  const status = await fetch(api + '/status', { redirect: 'error' });
  if (!status.ok) throw Error('PREVIEW_CAPABILITY_EXPIRED: Current preview access is unavailable');
  let parent = root;
  for (const name of ['.beegame', 'tmp']) {
    parent = join(parent, name);
    await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (await realpath(parent) !== parent) throw Error('Snapshot directory must not resolve through a link');
  }
  const directory = await mkdtemp(join(parent, 'preview-snapshot-'));
  const imagePath = relative(root, join(directory, 'screen.png'));
  const reportPath = relative(root, join(directory, 'observation.json'));
  let report = { status: 'error', mode, viewport: [width, height], startedAt: new Date().toISOString(),
    reportPath, quality: 'unverified', note: 'First-load visual/runtime observation only. No gameplay, aesthetics, content consumption or source freshness certified.' };
  try {
    const observation = await visit({ mode, contextOptions: { viewport: { width, height } } },
      async ({ page, gameFrame, observedEnvironment, runtimeErrors, runtimeErrorDetails }) => {
        await gameFrame.waitForLoadState('load');
        const image = await page.screenshot({ fullPage: false });
        return { image, observedEnvironment, runtimeErrors: { ...runtimeErrors }, runtimeErrorDetails };
      });
    await writeFile(join(root, imagePath), observation.image, { flag: 'wx', mode: 0o600 });
    report = { ...report, status: 'observed', finishedAt: new Date().toISOString(), imagePath,
      imageSha256: createHash('sha256').update(observation.image).digest('hex'),
      observedEnvironment: observation.observedEnvironment, runtimeErrors: observation.runtimeErrors,
      runtimeErrorDetails: observation.runtimeErrorDetails };
  } catch (error) {
    report = { ...report, finishedAt: new Date().toISOString(),
      error: String(error instanceof Error ? error.message : error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 500),
      runtimeErrors: error?.runtimeErrors, runtimeErrorDetails: error?.runtimeErrorDetails };
  }
  await writeFile(join(root, reportPath), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  return report;
}

async function toolingIdentity() {
  try {
    if (process.versions.bun) throw Error('Child Node identity unavailable from a Bun adapter');
    const hashes = {};
    for (const name of ['preview-test-command.mjs', 'preview-test-client.mjs', 'preview-play-capture.mjs'])
      hashes[name] = createHash('sha256').update(await readFile(new URL('./' + name, import.meta.url))).digest('hex');
    const client = process.env.BEEGAME_PLAYWRIGHT_MODULE;
    if (!client || new URL(client).protocol !== 'file:') throw Error('Shared client unavailable');
    // Read only the pinned client's identity; never import/launch a browser to
    // inspect a receipt. This is not a hash of the entire installed toolchain.
    for (const name of ['package.json', 'browsers.json', 'index.mjs'])
      hashes['playwright/' + name] = createHash('sha256').update(await readFile(new URL('./' + name, client))).digest('hex');
    return { status: 'observed', node: process.versions.node, platform: process.platform, arch: process.arch, hashes };
  } catch {
    return { status: 'unverified', reason: 'Supplied test helper/client identity unavailable' };
  }
}

async function executionInputs(root, file, signal, capabilityFile = process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE) {
  const scriptSha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  const tooling = await toolingIdentity();
  if (!capabilityFile)
    return { scriptSha256, tooling, status: 'unverified', reason: 'No active source identity capability' };
  try {
    const capability = JSON.parse(await readFile(capabilityFile, 'utf8'));
    if (capability.version !== 1 || capability.workspace !== root || !capability.executionId || !capability.sessionId)
      throw Error('Mismatched source identity capability');
    const api = new URL(capability.apiUrl);
    if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
      throw Error('Invalid source identity endpoint');
    const response = await fetch(api, { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), headers: {'Content-Type':'application/json'},
      body: JSON.stringify({executionInputs:true}) });
    if (!response.ok) throw Error('Source identity inspection failed: HTTP ' + response.status);
    return { scriptSha256, tooling, status: 'observed', inputs: await response.json() };
  } catch (error) { return { scriptSha256, tooling, status: 'unverified', reason: error.message }; }
}

/** Inspect exactly one retained receipt. No model, browser, build or test runs. */
export async function inspectPreviewTest(reportPath, { workspace = process.cwd(), capabilityFile = process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE } = {}) {
  const root = await realpath(workspace);
  const file = resolve(root, reportPath), path = relative(root, file);
  if (!/^\.beegame\/tmp\/preview-test-[^/]+\/execution\.json$/.test(path) || await realpath(file) !== file)
    throw Error('Select an existing .beegame/tmp/preview-test-*/execution.json receipt in this workspace');
  const report = JSON.parse(await readFile(file, 'utf8'));
  const script = resolve(root, report.script);
  if (!relative(root, script) || relative(root, script).startsWith('../'))
    throw Error('Saved test script is outside this workspace');
  const current = await (async () => {
    if (await realpath(script) !== script) throw Error('Saved script is now an alias')
    return executionInputs(root, script, undefined, capabilityFile)
  })().catch(error => ({status:'unverified',reason:error.message}));
  const observed = report.after?.status === 'observed' && current.status === 'observed';
  const {before, after, ...summary} = report;
  const beforeFiles = new Map((after?.inputs?.files ?? []).map(item => [item.path, item.sha256]));
  const currentFiles = new Map((current.inputs?.files ?? []).map(item => [item.path, item.sha256]));
  const changedPaths = observed ? [...new Set([...beforeFiles.keys(), ...currentFiles.keys()])]
    .filter(path => beforeFiles.get(path) !== currentFiles.get(path)) : [];
  const changes = observed ? { sources:changedPaths,
    script:after.scriptSha256 !== current.scriptSha256,
    requirements:after.inputs.requirementsRevision !== current.inputs.requirementsRevision,
    run:after.inputs.runId !== current.inputs.runId,
    dependencies:after.inputs.dependencySha256 !== current.inputs.dependencySha256 } : undefined;
  const inputsChanged = changes && (changes.sources.length || changes.script || changes.requirements || changes.run || changes.dependencies);
  const toolingObserved = after?.tooling?.status === 'observed' && current.tooling?.status === 'observed';
  return {...summary, quality:'unverified', freshness: {status: observed
    ? inputsChanged ? 'changed' : 'unchanged-at-boundaries' : 'unverified',
    changedPaths, changes, reason: current.reason,
    currentAttemptDiffers:observed ? after.inputs.attemptId !== current.inputs.attemptId : undefined,
    scope:'Source/dependency boundary identity only, not tooling, browser consumption, assertion coverage or game quality.'},
    toolingFreshness: { status: toolingObserved
      ? JSON.stringify(after.tooling) === JSON.stringify(current.tooling) ? 'unchanged-at-boundaries' : 'changed' : 'unverified',
      scope: 'Node version/platform and supplied helper/client identity only. Actual browser binary, launch flags, OS state and assertion coverage remain unverified.' }};
}

/** Optional execution adapter, not a test framework. Run a caller-selected
 * Node test once with the current capability; retain complete output rather
 * than asking the model to rerun a test to recover truncated stdout. */
export async function runPreviewTest(script, args = [], { timeoutMs = 300_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw Error('Test execution timeout must be 1..300000 ms');
  const root = await realpath(process.cwd());
  const file = await realpath(resolve(root, script));
  const path = relative(root, file);
  if (!path || path === '..' || path.startsWith('../')) throw Error('Test must belong to the current workspace');
  const api = await resolvePreviewApi();
  // Reading status validates a live capability without starting a browser or
  // preview. A retained script is never run with a revoked turn's access.
  const status = await fetch(api + '/status', { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!status.ok) throw Error('PREVIEW_CAPABILITY_EXPIRED: Current preview access is unavailable');
  let parent = root;
  for (const name of ['.beegame', 'tmp']) {
    parent = join(parent, name);
    await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (await realpath(parent) !== parent) throw Error('Test output directory must not resolve through a link');
  }
  const directory = await mkdtemp(join(parent, 'preview-test-'));
  const reportPath = relative(root, join(directory, 'execution.json'));
  const report = { script: path, runtime: 'node', timeoutMs, startedAt: new Date().toISOString(), status: 'started',
    stdoutPath: relative(root, join(directory, 'stdout.txt')), stderrPath: relative(root, join(directory, 'stderr.txt')),
    reportPath, quality: 'unverified', note: 'Process result only, not assertion or gameplay acceptance. Read these saved files without executing the test again.' };
  await writeFile(join(root, reportPath), JSON.stringify(report), { flag: 'wx', mode: 0o600 });
  const controller = new AbortController();
  let child, termination, interruption;
  const kill = signal => {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
  };
  const interrupt = (status, signal) => {
    if (controller.signal.aborted) return;
    interruption = { status, exitCode: null, ...(signal ? { cancelSignal: signal } : {}) };
    controller.abort();
    if (child?.pid) {
      kill('SIGTERM');
      // The group leader can exit before a descendant that ignores SIGTERM.
      // Complete group cleanup even if the child's close event arrives first.
      termination = new Promise(resolve => setTimeout(() => { kill('SIGKILL'); resolve(); }, 1000));
    }
  };
  const onTerm = () => interrupt('interrupted', 'SIGTERM');
  const onInt = () => interrupt('interrupted', 'SIGINT');
  process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
  const timer = setTimeout(() => interrupt('timed-out'), timeoutMs);
  try {
    report.before = await executionInputs(root, file, controller.signal);
    const stdout = await open(join(root, report.stdoutPath), 'wx', 0o600);
    try {
      const stderr = await open(join(root, report.stderrPath), 'wx', 0o600);
      try {
        if (!controller.signal.aborted) {
          const result = await new Promise(resolveResult => {
            // Own only this test's process group, not the shared host browser.
            // Under Node, use the exact runtime whose version was recorded,
            // not another executable selected by a subsequently changed PATH.
            child = spawn(process.versions.bun ? 'node' : process.execPath, [file, ...args], { cwd: root, env: process.env,
              detached: process.platform !== 'win32', stdio: ['ignore', stdout.fd, stderr.fd] });
            child.once('error', error => resolveResult({ status: 'launch-failed', error: error.message, exitCode: null }));
            child.once('close', (exitCode, signal) => resolveResult({ status: 'exited', exitCode, signal }));
          });
          Object.assign(report, result);
          // A detached test group can outlive its leader even after exit 0.
          // Reuse cancellation cleanup; a still-writing descendant is not a
          // settled execution and must not receive a successful receipt.
          if (result.status === 'exited' && !controller.signal.aborted && process.platform !== 'win32') {
            try {
              process.kill(-child.pid, 0);
              report.error = 'Test exited with background processes still running; owned group interrupted.';
              interrupt('interrupted');
            } catch (error) { if (error.code !== 'ESRCH') throw error; }
          }
        }
        report.after = controller.signal.aborted ? {status:'unverified', reason:'Test execution interrupted'}
          : await executionInputs(root, file, controller.signal);
        report.inputIdentity = report.before.status === 'observed' && report.after.status === 'observed'
          ? JSON.stringify(report.before) === JSON.stringify(report.after) ? 'unchanged-at-boundaries' : 'changed'
          : 'unverified';
      } finally { await stderr.close(); }
    } finally { await stdout.close(); }
  } catch (error) {
    Object.assign(report, {status:'error', exitCode:null,
      error:'Test adapter failed (' + (error.code ?? error.name ?? 'unknown') + '); inspect retained output'});
  } finally {
    try {
      await termination;
      Object.assign(report, interruption, {finishedAt:new Date().toISOString()});
      if (report.status !== 'exited' || report.exitCode !== 0) report.failureOutput = {
        stdout: await failureOutputExcerpt(join(directory, 'stdout.txt')),
        stderr: await failureOutputExcerpt(join(directory, 'stderr.txt')),
      };
      await writeFile(join(root, reportPath), JSON.stringify(report, null, 2));
    } finally {
      clearTimeout(timer);
      process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
    }
  }
  // Full identities and output remain on disk; do not flood model history.
  const { before, after, ...summary } = report;
  return { ...summary, evidence: 'Boundary snapshots only; transient edits, browser consumption and assertions are not certified.' };
}

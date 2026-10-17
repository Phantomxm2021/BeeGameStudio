import { open, mkdir, mkdtemp, realpath, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePreviewApi, withPreviewPage } from './preview-test-client.mjs';

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

async function executionInputs(root, file, signal, capabilityFile = process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE) {
  const scriptSha256 = createHash('sha256').update(await readFile(file)).digest('hex');
  if (!capabilityFile)
    return { scriptSha256, status: 'unverified', reason: 'No active source identity capability' };
  try {
    const capability = JSON.parse(await readFile(capabilityFile, 'utf8'));
    if (capability.version !== 1 || capability.workspace !== root || !capability.executionId || !capability.sessionId)
      throw Error('Mismatched source identity capability');
    const api = new URL(capability.apiUrl);
    if (api.protocol !== 'http:' || api.hostname !== '127.0.0.1' || api.username || api.password || api.search || api.hash)
      throw Error('Invalid source identity endpoint');
    const response = await fetch(api, { method: 'POST', redirect: 'error', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({executionInputs:true}) });
    if (!response.ok) throw Error('Source identity inspection failed: HTTP ' + response.status);
    return { scriptSha256, status: 'observed', inputs: await response.json() };
  } catch (error) { return { scriptSha256, status: 'unverified', reason: error.message }; }
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
  return {...summary, quality:'unverified', freshness: {status: observed
    ? inputsChanged ? 'changed' : 'unchanged-at-boundaries' : 'unverified',
    changedPaths, changes, reason: current.reason,
    currentAttemptDiffers:observed ? after.inputs.attemptId !== current.inputs.attemptId : undefined,
    scope:'Boundary identity only, not browser consumption, assertion coverage or game quality.'}};
}

/** Optional execution adapter, not a test framework. Run a caller-selected
 * Node test once with the current capability; retain complete output rather
 * than asking the model to rerun a test to recover truncated stdout. */
export async function runPreviewTest(script, args = []) {
  const root = await realpath(process.cwd());
  const file = await realpath(resolve(root, script));
  const path = relative(root, file);
  if (!path || path === '..' || path.startsWith('../')) throw Error('Test must belong to the current workspace');
  const api = await resolvePreviewApi();
  // Reading status validates a live capability without starting a browser or
  // preview. A retained script is never run with a revoked turn's access.
  const status = await fetch(api + '/status', { redirect: 'error' });
  if (!status.ok) throw Error('PREVIEW_CAPABILITY_EXPIRED: Current preview access is unavailable');
  let parent = root;
  for (const name of ['.beegame', 'tmp']) {
    parent = join(parent, name);
    await mkdir(parent, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (await realpath(parent) !== parent) throw Error('Test output directory must not resolve through a link');
  }
  const directory = await mkdtemp(join(parent, 'preview-test-'));
  const reportPath = relative(root, join(directory, 'execution.json'));
  const report = { script: path, runtime: 'node', startedAt: new Date().toISOString(), status: 'started',
    stdoutPath: relative(root, join(directory, 'stdout.txt')), stderrPath: relative(root, join(directory, 'stderr.txt')),
    reportPath, quality: 'unverified', note: 'Process result only, not assertion or gameplay acceptance. Read these saved files without executing the test again.' };
  report.before = await executionInputs(root, file);
  await writeFile(join(root, reportPath), JSON.stringify(report), { flag: 'wx', mode: 0o600 });
  const stdout = await open(join(root, report.stdoutPath), 'wx', 0o600);
  try {
    const stderr = await open(join(root, report.stderrPath), 'wx', 0o600);
    try {
      const result = await new Promise(resolveResult => {
        // No shell interpolation, retries, global installation or new permission.
        const child = spawn('node', [file, ...args], { cwd: root, env: process.env, stdio: ['ignore', stdout.fd, stderr.fd] });
        child.once('error', error => resolveResult({ status: 'launch-failed', error: error.message, exitCode: null }));
        child.once('close', (exitCode, signal) => resolveResult({ status: 'exited', exitCode, signal }));
      });
      Object.assign(report, result, { finishedAt: new Date().toISOString() });
      report.after = await executionInputs(root, file).catch(error => ({status:'unverified', reason:error.message}));
      report.inputIdentity = report.before.status === 'observed' && report.after.status === 'observed'
        ? JSON.stringify(report.before) === JSON.stringify(report.after) ? 'unchanged-at-boundaries' : 'changed'
        : 'unverified';
    } finally { await stderr.close(); }
  } finally { await stdout.close(); }
  await writeFile(join(root, reportPath), JSON.stringify(report, null, 2));
  // Full identities and output remain on disk; do not flood model history.
  const { before, after, ...summary } = report;
  return { ...summary, evidence: 'Boundary snapshots only; transient edits, browser consumption and assertions are not certified.' };
}

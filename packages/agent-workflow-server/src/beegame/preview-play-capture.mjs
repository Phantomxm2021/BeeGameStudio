import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as waitHost } from 'node:timers/promises';

/** Executed in the game frame before load. No input, resume, play or graph patching. */
export function installAudioTap({ limitMs = 30_000 } = {}) {
  if (!Number.isFinite(limitMs) || limitMs < 1 || limitMs > 60_000) throw Error('Audio window must be 1..60000 ms');
  if (globalThis.__bgsPlayAudioTap) throw Error('Audio observer is already installed');
  const taps = [], limitBytes = 16 * 1024 * 1024;
  globalThis.__bgsPlayAudioTap = {
    start(source, label) {
      if (typeof AudioNode === 'undefined' || !(source instanceof AudioNode) ||
          typeof source.context.createMediaStreamDestination !== 'function')
        throw Error('Select an actual live AudioNode in this frame');
      if (typeof label !== 'string' || !label.trim() || label.length > 120 || taps.length >= 4)
        throw Error('Use a short source label; at most four explicit taps');
      if (source.numberOfOutputs !== 1 || source.channelCount > 2) throw Error('Only single-output mono/stereo nodes are supported');
      if (typeof MediaRecorder === 'undefined') throw Error('MediaRecorder is unavailable');
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw Error('WebM audio recording is unsupported');
      const sink = source.context.createMediaStreamDestination();
      sink.channelCount = source.channelCount;
      let recorder;
      try { recorder = new MediaRecorder(sink.stream, { mimeType }); }
      catch (error) { sink.stream.getTracks().forEach(track => track.stop()); throw error; }
      const chunks = [], startedAt = performance.now();
      const record = { label, mimeType, nodeType: source.constructor.name, sampleRate: source.context.sampleRate,
        channelCount: sink.channelCount, initialContextState: source.context.state, startedAtMs: startedAt,
        startedAtEpochMs: performance.timeOrigin + startedAt,
        bytes: 0, endReason: undefined, errors: [] };
      let finishing, timer;
      const stop = (reason = 'caller-finished') => finishing ??= (async () => {
        record.endReason = reason; clearTimeout(timer);
        // Disconnect only the observer branch; leave original playback routes alone.
        try { source.disconnect(sink); } catch (error) { record.errors.push('tap disconnect: ' + error.name); }
        let timeout;
        try {
          if (recorder.state !== 'inactive') await new Promise(resolveStop => {
            recorder.addEventListener('stop', resolveStop, { once: true });
            timeout = setTimeout(() => { record.errors.push('recorder stop timed out'); resolveStop(); }, 3000);
            recorder.stop();
          });
        } finally { clearTimeout(timeout); sink.stream.getTracks().forEach(track => track.stop()); }
        const data = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
        let binary = '';
        for (let index = 0; index < data.length; index += 32768)
          binary += String.fromCharCode(...data.subarray(index, index + 32768));
        return { ...record, durationMs: performance.now() - startedAt,
          finalContextState: source.context.state, status: record.errors.length ? 'incomplete' : data.length ? 'recorded' : 'unverified',
          coverage: reason === 'caller-finished' ? 'selected-tap-window' : 'limited-or-interrupted-window',
          base64: btoa(binary), quality: 'unverified',
          scope: 'Selected node output only. Not device audibility, all contexts, or proof that this node remains connected to the game destination.' };
      })();
      recorder.addEventListener('dataavailable', event => {
        if (record.bytes + event.data.size > limitBytes) {
          record.errors.push('capture byte limit reached'); void stop('byte-limit');
        } else { chunks.push(event.data); record.bytes += event.data.size; }
      });
      recorder.addEventListener('error', () => { record.errors.push('MediaRecorder error'); void stop('recorder-error'); });
      try { source.connect(sink); recorder.start(100); }
      catch (error) {
        try { source.disconnect(sink); } catch {}
        sink.stream.getTracks().forEach(track => track.stop()); throw error;
      }
      taps.push({ stop });
      timer = setTimeout(() => void stop('window-limit'), limitMs);
      return { index: taps.length - 1, label, source: record.nodeType };
    },
    async stop() {
      if (!taps.length) return { status: 'unverified', recordings: [], reason: 'No actual audio node selected; no audio was captured.' };
      return { recordings: await Promise.all(taps.map(tap => tap.stop())) };
    },
  };
}

/** Reuse the active BGS preview helper; the caller supplies real input and assertions. */
export async function withPlayCapture({ mode = 'production', viewport, outputParent = '.beegame/tmp',
  audio = false, audioLimitMs = 30_000 } = {}, inspect) {
  if (process.versions.bun) throw Error('Use Node for the shared Preview client');
  if (typeof inspect !== 'function') throw Error('Supply a player-path callback');
  if (!process.env.BEEGAME_PREVIEW_TEST_MODULE) throw Error('No current supplied Preview helper');
  if (!['development', 'production'].includes(mode)) throw Error('Unsupported preview mode');
  if (typeof audio !== 'boolean' || !Number.isFinite(audioLimitMs) || audioLimitMs < 1 || audioLimitMs > 60_000)
    throw Error('Use explicit audio true/false and a 1..60000 ms audio window');
  if (viewport && (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height) || viewport.width < 1 || viewport.height < 1))
    throw Error('Use a positive integer viewport');
  const root = await realpath(process.cwd()), parent = resolve(root, outputParent), part = relative(root, parent);
  if (part === '..' || part.startsWith('..' + sep) || isAbsolute(part) || await realpath(parent) !== parent)
    throw Error('Choose an existing non-aliased evidence directory inside the project');
  const { withPreviewPage } = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
  if (typeof withPreviewPage !== 'function') throw Error('Current Preview helper lacks withPreviewPage');
  const directory = await mkdtemp(join(parent, 'play-capture-'));
  const videoDirectory = join(directory, 'video'); await mkdir(videoDirectory);
  const marks = [], frames = [], startedAt = performance.now();
  const report = { directory: relative(root, directory), mode, startedAtEpochMs: Date.now(), quality: 'unverified', marks, frames,
    audio: { status: audio ? 'unverified' : 'not-requested', recordings: [] },
    scope: 'Caller-selected player path. Video excludes audio; audio taps are separate selected-node observations. No game acceptance verdict.' };
  let video, failure;
  const mark = label => {
    if (typeof label !== 'string' || !label.trim() || label.length > 120 || marks.length >= 128)
      throw Error('Use a short observation label; at most 128 marks');
    marks.push({ label, atMs: performance.now() - startedAt });
  };
  try {
    await withPreviewPage({ mode, contextOptions: { ...(viewport ? { viewport } : {}), recordVideo: { dir: videoDirectory } },
      beforeNavigate: async ({ page }) => {
        if (audio) await page.addInitScript({ content: `(${installAudioTap.toString()})(${JSON.stringify({ limitMs: audioLimitMs })})` });
      } }, async observed => {
      video = observed.page.video();
      report.environment = observed.observedEnvironment;
      const captureFrame = async label => {
        mark(label);
        const path = join(directory, `frame-${String(frames.length + 1).padStart(3, '0')}.png`);
        await writeFile(path, await observed.page.screenshot(), { flag: 'wx', mode: 0o600 });
        frames.push({ label, atMs: performance.now() - startedAt, path: relative(root, path) });
      };
      // Retain caller observations; they are data, not an automatic PASS.
      try { report.observations = await inspect({ ...observed, mark, captureFrame }); }
      finally {
        report.runtimeErrors = { ...observed.runtimeErrors };
        report.runtimeErrorDetails = observed.runtimeErrorDetails;
        if (audio) {
          try {
            const result = await observed.gameFrame.evaluate(async () => globalThis.__bgsPlayAudioTap
              ? await globalThis.__bgsPlayAudioTap.stop() : { status: 'unverified', recordings: [], reason: 'Observer lost after navigation or frame replacement.' });
            report.audio = { ...result, recordings: [] };
            for (const [index, recording] of result.recordings.entries()) {
              const { base64, ...facts } = recording;
              const path = join(directory, `audio-${index + 1}.webm`);
              if (base64) await writeFile(path, Buffer.from(base64, 'base64'), { flag: 'wx', mode: 0o600 });
              report.audio.recordings.push({ ...facts, ...(base64 ? { path: relative(root, path) } : {}) });
            }
          } catch (error) { report.audio = { status: 'unverified', recordings: [], reason: error.message }; }
        }
      }
    });
  } catch (error) {
    failure = error; report.driverError = error.message;
    if (error.runtimeErrors) report.runtimeErrors = error.runtimeErrors;
    if (error.runtimeErrorDetails) report.runtimeErrorDetails = error.runtimeErrorDetails;
  }
  finally {
    try { if (video) report.video = relative(root, await video.path()); }
    catch (error) { report.videoError = error.message; }
    report.durationMs = performance.now() - startedAt;
    await writeFile(join(directory, 'observation.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  }
  if (failure) throw Object.assign(Error(`Player-path driver failed; retained ${report.directory}/observation.json: ${failure.message}`), { report });
  return report;
}

/** Fixed desktop sampling, not a script runner or an automatic player.
 * Only host timers and browser input; no game hooks, clock injection or retries. */
export async function captureKeyboardSample(options) {
  const fields = ['startSelector', 'readySelector', 'key', 'holdMs', 'observeMs', 'viewport'];
  if (arguments.length !== 1 || !options || Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(key => !fields.includes(key)))
    throw Error('Keyboard sample accepts only startSelector?, readySelector, key, holdMs, observeMs and viewport?; no scripts or callbacks');
  const { startSelector, readySelector, key, holdMs, observeMs, viewport = { width: 1280, height: 720 } } = options;
  const selector = value => typeof value === 'string' && value.trim() && value.length <= 300;
  if (!selector(readySelector) || (startSelector !== undefined && !selector(startSelector)))
    throw Error('Use nonempty selectors (at most 300 characters)');
  if (typeof key !== 'string' || !/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Space|[a-zA-Z0-9])$/.test(key))
    throw Error('Use one arrow, Space, letter or digit; key combinations are unsupported');
  if (!Number.isInteger(holdMs) || holdMs < 100 || holdMs > 5000 ||
      !Number.isInteger(observeMs) || observeMs < 100 || holdMs + observeMs > 120000)
    throw Error('holdMs must be 100..5000; observeMs >=100; total input/observation time <=120000 ms');
  if (!viewport || Object.getPrototypeOf(viewport) !== Object.prototype ||
      Object.keys(viewport).some(key => !['width', 'height'].includes(key)) ||
      ![viewport.width, viewport.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096))
    throw Error('Use viewport width/height integers in 1..4096');
  const started = performance.now();
  const sample = { status: 'incomplete', requested: { ...options, viewport }, actions: [],
    clock: 'host monotonic milliseconds; never the game elapsed value' };
  const at = () => performance.now() - started;
  let report;
  try {
    report = await withPlayCapture({ mode: 'production', viewport }, async ({ page, gameFrame, captureFrame, runtimeErrors }) => {
      const cleanRuntime = () => {
        if (Object.values(runtimeErrors).some(count => count > 0)) throw Error('Runtime errors observed; inspect retained diagnostics');
      };
      cleanRuntime();
      if (startSelector !== undefined) {
        const action = { type: 'click', selector: startSelector, startedAtMs: at(), status: 'attempted' };
        sample.actions.push(action);
        await gameFrame.locator(startSelector).click({ timeout: 5000 });
        Object.assign(action, { status: 'sent', completedAtMs: at() });
      }
      await gameFrame.locator(readySelector).waitFor({ state: 'visible', timeout: 10000 });
      // Read-only frame conditions, not an application state/clock hook.
      sample.before = await gameFrame.evaluate(() => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus() }));
      if (!sample.before.visible || !sample.before.focused) throw Error('Game frame is not visible and focused for keyboard sampling');
      cleanRuntime();
      await captureFrame('before keyboard input');
      const sendKey = async type => {
        const action = { type, key, startedAtMs: at(), status: 'attempted' };
        sample.actions.push(action);
        await page.keyboard[type === 'keydown' ? 'down' : 'up'](key);
        Object.assign(action, { status: 'sent', completedAtMs: at() });
      };
      try {
        await sendKey('keydown');
        sample.holdStartedAtMs = at();
        await waitHost(holdMs);
        sample.holdElapsedMs = at() - sample.holdStartedAtMs;
      } finally {
        // Always attempt release, including partial dispatch/driver failure.
        await sendKey('keyup');
      }
      await captureFrame('after key release');
      sample.observationStartedAtMs = at();
      await waitHost(observeMs);
      sample.observationElapsedMs = at() - sample.observationStartedAtMs;
      sample.after = await gameFrame.evaluate(() => ({ visible: document.visibilityState === 'visible', focused: document.hasFocus() }));
      await captureFrame('after real-time observation');
      cleanRuntime();
      if (!sample.after.visible || !sample.after.focused) throw Error('Game frame lost visible/focused state');
      sample.status = 'observed';
      return sample;
    });
  } catch (error) {
    // The existing capture helper retains video/diagnostics even on failure.
    if (!error.report) throw error;
    report = error.report;
    sample.error = error.message;
  }
  if (sample.status !== 'observed' || report.videoError || !report.video ||
      Object.values(report.runtimeErrors ?? {}).some(count => count > 0)) sample.status = 'incomplete';
  report = { ...report, driver: 'host-fixed-desktop-keyboard', status: sample.status,
    observations: sample, reportPath: join(report.directory, 'observation.json'),
    scope: 'Host-dispatched desktop keyboard input and real-time observation only. No project callback or game clock/state mutation by this driver. Not proof of input effect, normal internal frame logic, scoring, completion, touch support or game quality.' };
  // Enrich only this invocation's retained report; never an earlier capture.
  await writeFile(resolve(process.cwd(), report.reportPath), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

/** One countdown/iframe-blur observation. The host never pauses the game. */
export async function captureCountdownBlurSample(options) {
  const fields = ['startSelector', 'countdownSelector', 'playingSelector', 'countdownMs', 'observeMs', 'viewport'];
  if (arguments.length !== 1 || !options || Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).some(key => !fields.includes(key)))
    throw Error('Countdown blur sample accepts only startSelector, countdownSelector, playingSelector, countdownMs, observeMs? and viewport?; no scripts or callbacks');
  const { startSelector, countdownSelector, playingSelector, countdownMs, observeMs = 500,
    viewport = { width: 1280, height: 720 } } = options;
  if (![startSelector, countdownSelector, playingSelector].every(value => typeof value === 'string' && value.trim() && value.length <= 300))
    throw Error('Supply actual CSS selectors for start, countdown and playing (at most 300 characters each)');
  if (!Number.isInteger(countdownMs) || countdownMs < 100 || countdownMs > 30000 ||
      !Number.isInteger(observeMs) || observeMs < 100 || observeMs > 5000)
    throw Error('Use source-derived full countdownMs in 100..30000 and observeMs in 100..5000');
  if (!viewport || Object.getPrototypeOf(viewport) !== Object.prototype ||
      Object.keys(viewport).some(key => !['width', 'height'].includes(key)) ||
      ![viewport.width, viewport.height].every(n => Number.isInteger(n) && n >= 1 && n <= 4096))
    throw Error('Use viewport width/height integers in 1..4096');
  const started = performance.now(), at = () => performance.now() - started;
  const sample = { status: 'incomplete', requested: { ...options, observeMs, viewport }, actions: [],
    clock: 'host monotonic milliseconds; browser event timestamps are separate', events: [] };
  let report;
  try {
    report = await withPlayCapture({ mode: 'production', viewport }, async ({ page, gameFrame, captureFrame, runtimeErrors }) => {
      let observer, control;
      const cleanRuntime = () => {
        if (Object.values(runtimeErrors).some(count => count > 0)) throw Error('Runtime errors observed; inspect retained diagnostics');
      };
      try {
        cleanRuntime();
        // This button belongs only to the temporary preview host, never the game DOM/source.
        control = await page.evaluateHandle(() => {
          const button = document.createElement('button');
          button.textContent = 'BGS focus target';
          button.style.cssText = 'position:fixed;right:0;bottom:0;z-index:2147483647';
          document.body.append(button); return button;
        });
        observer = await gameFrame.evaluateHandle(({ countdownSelector, playingSelector }) => {
          const read = selector => {
            const nodes = document.querySelectorAll(selector);
            if (nodes.length > 1) throw Error('Sampling CSS selector must identify at most one element');
            const node = nodes[0];
            return { matches: nodes.length, visible: !!node && node.getClientRects().length > 0 &&
              node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), text: node?.textContent?.slice(0, 300) ?? null };
          };
          const snapshot = () => ({ focused: document.hasFocus(), visible: document.visibilityState === 'visible',
            countdown: read(countdownSelector), playing: read(playingSelector) });
          const events = [];
          let overflow = false;
          const record = event => {
            // Capture phase also sees element focus changes; only the frame window is relevant.
            if (event.type !== 'visibilitychange' && event.target !== window) return;
            if (events.length >= 32) { overflow = true; return; }
            events.push({ type: event.type, trusted: event.isTrusted, browserAtMs: performance.now(), ...snapshot() });
          };
          window.addEventListener('blur', record, true);
          window.addEventListener('focus', record, true);
          document.addEventListener('visibilitychange', record, true);
          return { events, snapshot, stop() {
            window.removeEventListener('blur', record, true); window.removeEventListener('focus', record, true);
            document.removeEventListener('visibilitychange', record, true);
            return { events, overflow };
          } };
        }, { countdownSelector, playingSelector });
        const action = async (type, run) => {
          const entry = { type, startedAtMs: at(), status: 'attempted' }; sample.actions.push(entry);
          await run(); Object.assign(entry, { status: 'sent', completedAtMs: at() });
        };
        await action('start-click', () => gameFrame.locator('css=' + startSelector).click({ timeout: 5000 }));
        await gameFrame.locator('css=' + countdownSelector).waitFor({ state: 'visible', timeout: 5000 });
        await captureFrame('countdown before blur');
        sample.before = await observer.evaluate(value => { value.events.length = 0; return value.snapshot(); });
        if (!sample.before.focused || !sample.before.visible || !sample.before.countdown.visible || sample.before.playing.visible)
          throw Error('Unverified: focused countdown was not observed before blur');
        await action('host-focus-click', () => control.asElement().click({ timeout: 5000 }));
        sample.afterBlur = await observer.evaluate(value => value.snapshot());
        const blur = await observer.evaluate(value => value.events.find(event => event.type === 'blur' && event.trusted));
        if (!blur || !blur.countdown.visible || blur.playing.visible || sample.afterBlur.focused || !sample.afterBlur.visible)
          throw Error('Unverified: real iframe blur during countdown was not observed');
        await captureFrame('immediately after blur');
        sample.blurStartedAtMs = at();
        await waitHost(countdownMs + 250);
        sample.blurElapsedMs = at() - sample.blurStartedAtMs;
        sample.beforeRestore = await observer.evaluate(value => value.snapshot());
        await captureFrame('still unfocused after full countdown duration');
        sample.beforeRestoreCapturedAtMs = at();
        // Unexpected refocus/hidden transitions invalidate this narrow blur-only sample.
        const interrupted = await observer.evaluate(value => value.events.some(event => event.type === 'focus' || !event.visible));
        if (sample.beforeRestore.focused || !sample.beforeRestore.visible || interrupted)
          throw Error('Unverified: game did not remain visible and unfocused throughout the sample');
        cleanRuntime();
        const frameElement = await gameFrame.frameElement();
        try { await action('restore-iframe-focus', () => frameElement.focus()); }
        finally { await frameElement.dispose(); }
        sample.restoreStartedAtMs = at();
        await waitHost(observeMs);
        sample.restoreElapsedMs = at() - sample.restoreStartedAtMs;
        sample.afterRestore = await observer.evaluate(value => value.snapshot());
        await captureFrame('after focus restoration');
        if (!sample.afterRestore.focused || !sample.afterRestore.visible) throw Error('Unverified: game focus was not restored');
        cleanRuntime();
        sample.status = 'observed';
        return sample;
      } finally {
        if (observer) {
          try { Object.assign(sample, await observer.evaluate(value => value.stop())); }
          finally { await observer.dispose(); }
        }
        if (control) {
          try { await control.evaluate(button => button.remove()); }
          finally { await control.dispose(); }
        }
      }
    });
  } catch (error) {
    if (!error.report) throw error;
    report = error.report; sample.error = error.message; sample.status = 'incomplete';
  }
  if (sample.overflow || report.videoError || !report.video ||
      Object.values(report.runtimeErrors ?? {}).some(count => count > 0)) sample.status = 'incomplete';
  report = { ...report, driver: 'host-fixed-countdown-blur', status: sample.status, observations: sample,
    reportPath: join(report.directory, 'observation.json'),
    scope: 'Visible desktop iframe blur only, not hidden-tab/background testing. Selectors and full countdown duration are caller-supplied, not independently verified. DOM snapshots/video are evidence, not pause/resume acceptance; absence of a playing marker or an unchanged screenshot is not a PASS. No game state, timers or frame-loop mutation, callbacks or retries.' };
  await writeFile(resolve(process.cwd(), report.reportPath), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

export const help = `const {withPlayCapture} = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
Run that test through the current supplied preview.mjs --run entry.
withPlayCapture({mode,viewport?,outputParent?,audio?,audioLimitMs?}, async ({page,gameFrame,mark,captureFrame,...}) => {...})
Use actual player controls and source-derived assertions. The helper creates a unique evidence folder, video, selected stills and observation.json.
With audio:true, an optional game-frame observer offers __bgsPlayAudioTap.start(actualAudioNode, "source label"). Select a real accessible output/master node from inspected game code. No chosen node means explicitly unverified audio.
Audio capture adds one temporary parallel branch; it never resumes a context, starts a source or replaces the game's output route.
It records that node, not native HTML media, speakers or a combined multi-context/device mix. If the game disconnects the node from its destination, stop the tap at that boundary.
The callback chooses the input path. Failures retain evidence and throw; no retries, build, installation, model call or quality verdict.`;

const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  if (process.argv.length === 3 && process.argv[2] === '--help') console.log(help);
  else { console.error(help); process.exitCode = 1; }
}

// Capture the game's media decoder, not a host-created player. captureStream
// intentionally ignores element volume/mute; observe those native properties
// separately and never claim this measures the final output device/mix.
export async function observeAudio(page, probe, requested, servingBase) {
  const target = page.locator(probe.selector)
  if (await target.count() !== 1) return { reason: 'Audio selector must identify exactly one actual HTML audio element' }
  const state = () => target.evaluate(element => element instanceof HTMLAudioElement ? {
    paused: element.paused, ended: element.ended, time: element.currentTime, volume: element.volume,
    loop: element.loop, muted: element.muted, rate: element.playbackRate,
    src: element.currentSrc, error: element.error?.code ?? null,
  } : null)
  const initial = await state()
  if (!initial) return { reason: 'Only an actual HTML audio element is supported; detached/Web Audio needs another observation' }
  if (!initial.paused) return { reason: 'Probe must start from idle audio and exercise a real game play action; autoplay is outside this driver' }
  let tap
  try {
    for (const step of probe.playSteps) await page.locator(step.click).click({ timeout: 5000 })
    // Allow the game's own async load/play to settle. Never call play() or
    // change media attributes to manufacture the expected state.
    await target.evaluate(async element => {
      const deadline = performance.now() + 2000
      while ((element.paused || element.readyState < 2) && !element.error && performance.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20))
    })
    const playing = await state()
    if (!playing) return { reason: 'Game replaced the selected audio element during activation' }
    if (playing.paused || playing.ended || playing.error) return { audio: { initial, playing }, failed: true, reason: 'Declared game action did not produce native media playback' }
    const src = new URL(playing.src)
    const expected = new URL(probe.resource.path, servingBase)
    if (src.origin !== expected.origin || decodeURIComponent(src.pathname) !== decodeURIComponent(expected.pathname) ||
        !requested.has(probe.document) || !requested.has(probe.resource.path))
      return { reason: 'Actual playing media/source does not isolate the selected registered Scene/audio member' }
    // The tap is a separate capture graph with no output connection. Resume
    // only this observer's context after the game click, never the game's graph.
    tap = await target.evaluateHandle(async element => {
      if (typeof element.captureStream !== 'function') throw Error('Media capture unavailable')
      const stream = element.captureStream()
      if (stream.getAudioTracks().length !== 1) throw Error('A single decoded audio track is required')
      const context = new AudioContext(), source = context.createMediaStreamSource(stream), analyser = context.createAnalyser()
      analyser.fftSize = 2048; source.connect(analyser)
      let timer
      try {
        await Promise.race([context.resume(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Capture context resume timed out')), 2000) })])
      } catch (error) {
        source.disconnect(); stream.getTracks().forEach(track => track.stop()); await context.close(); throw error
      } finally { clearTimeout(timer) }
      return { context, source, analyser, stream }
    })
    const signal = await tap.evaluate(async ({ context, analyser }) => {
      const values = new Float32Array(analyser.fftSize), until = performance.now() + 450
      let peak = 0, samples = 0
      while (performance.now() < until) {
        analyser.getFloatTimeDomainData(values)
        for (const value of values) peak = Math.max(peak, Math.abs(value))
        samples++
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      return { peak, samples, contextState: context.state }
    })
    const after = await state()
    for (const step of probe.stopSteps) await page.locator(step.click).click({ timeout: 5000 })
    const stopped = await state()
    await page.waitForTimeout(180)
    const settled = await state()
    if (!after || !stopped || !settled) return { reason: 'Selected media element lost during playback/stop' }
    const audio = { initial, playing, after, signal, stopped, settled }
    if (signal.contextState !== 'running' || signal.samples < 2) return { audio, reason: 'Decoded signal observer did not run' }
    if (after.ended) return { audio, reason: 'Clip ended during the short observation; use another check for short one-shots' }
    const bad = after.paused || Math.abs(after.time - playing.time) < .03 || playing.muted || after.muted ||
      playing.rate !== 1 || after.rate !== 1 || playing.error || after.error ||
      !stopped.paused || !settled.paused || Math.abs(settled.time - stopped.time) > .03
    return { audio, failed: Boolean(bad), ...(bad ? { reason: 'Native playback/clock/unmuted/stop state differs from the declared probe path' } : {}) }
  } catch (error) {
    return { reason: 'Media activation/capture unsupported: ' + String(error).slice(0, 200) }
  } finally {
    if (tap) {
      await tap.evaluate(async ({ context, source, stream }) => {
        source.disconnect(); stream.getTracks().forEach(track => track.stop()); await context.close()
      }).catch(() => undefined)
      await tap.dispose()
    }
  }
}

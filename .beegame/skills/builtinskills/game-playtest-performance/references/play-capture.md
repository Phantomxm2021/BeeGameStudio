# Optional player-path capture

Use for a concrete motion, cadence, overlap or recovery question in an authorized Web runtime check. A static layout fix needs no video. The current BGS Preview Node helper exposes `withPlayCapture` and creates a unique local evidence folder. It adds no gameplay solver, score system or build step. The old [capture-play.mjs](../scripts/capture-play.mjs) import forwards to the same implementation.

Import `withPlayCapture` from the supplied Preview helper into a project-owned Node test, then run that test through the current supplied `preview.mjs --run` entry. No Skill invocation or installed Skill path is needed for this API. The normal helper owns browser context cleanup; access expires with the turn. There is no guessed endpoint, personal browser profile or package installation.

```js
const { withPlayCapture } = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
const report = await withPlayCapture({ mode: 'production', viewport: { width: 960, height: 540 } },
  async ({ page, gameFrame, mark, captureFrame }) => {
    // Replace with the actual delivered controls and expected state.
    await gameFrame.getByRole('button', { name: 'Start' }).click();
    mark('start accepted');
    await captureFrame('initial playable state');
    await page.keyboard.press('ArrowRight');
    // Exercise and assert the relevant stop/turn/contact/retry from actual rules.
    await captureFrame('resulting state');
  });
console.log(JSON.stringify(report));
```

The default evidence parent is the existing `.beegame/tmp`; an explicit parent must already exist inside the project. Each invocation creates a new folder containing video, selected PNGs and `observation.json`, so prior evidence is retained. The callback chooses real controls, timing and source-derived assertions. A driver/assertion failure preserves available observations and throws; the helper does not convert a failed route into a game defect or retry it. Inspect runtime error counts and the actual clip. A changed frame demonstrates pixels changed, not that movement, contact or game feel is correct.

Video is silent. Marks, video and audio have different clocks/encoding delays; epoch timestamps can help locate the passage, but do not establish sample-accurate audiovisual synchronization or input latency. Clip evaluation still needs the actual motion and a suitable observation of input/event timing.

## Selected Web Audio output

For an actual exposed AudioNode whose role has been confirmed from the game code, `audio:true` installs an optional observer in the game frame. It does not locate or choose the node. In the callback, before the relevant action:

```js
await gameFrame.evaluate(() => {
  // Use the actual accessible node from this game's inspected audio code.
  __bgsPlayAudioTap.start(window.gameAudio.masterGain, 'master gain after music/effects mix');
});
```

The example global is not a required game API. If the graph is private/inaccessible, keep audio unverified or use an existing authorized recording/player path. Do not invent a fake master, generate a test tone in the game, or save product hooks merely to obtain a recording. Set `audioLimitMs` for the needed passage (default 30 seconds, maximum 60); the observer records no more than four explicit node taps and 16 MiB per tap. These are diagnostic resource limits, not song-length requirements.

The tap adds a temporary parallel `MediaStreamAudioDestinationNode`/`MediaRecorder` branch to that existing node, leaving original routes intact. It never calls play/resume, starts a sound source, patches AudioNode prototypes or mixes separate contexts. The normal game input must activate sound. On completion it disconnects its branch, stops its stream and retains a WebM audio clip with node/clock/context facts. Recorder failure or truncation is incomplete evidence. Browser support is checked explicitly. The approach uses [native fan-out](https://developer.mozilla.org/en-US/docs/Web/API/AudioNode/connect) and [media stream destinations](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination), with [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) for encoding.

This records the **selected node's signal**, not speakers or every game output. Confirm that the node is after the relevant master gain/effects and connected to the real destination; selecting a pre-gain music bus cannot establish the final mix. If the game disconnects that node from the destination while the node still produces a signal, end the tap at that boundary; its parallel branch does not automatically follow the destination connection. Native HTML media outside that graph, multiple contexts, multichannel/device/spatial output and a graph rebuilt after navigation need separate observations. No selected node or lost frame yields explicitly unverified audio. Capture itself can affect timing and adds processing; do not use it alone as a performance baseline.

Listen to the recorded passage for the actual short cues, overlap and transitions it covers. Keep source identity and the asserted input path in the project test/report. WebM is not PCM16 WAV; use the browser's real decoder/player for it rather than feeding it into the PCM helper. Captured non-silence establishes signal, not pleasant sound, correct triggering, complete coverage or physical audibility. The ordinary delivered player remains the path for those claims.

## Check whether a method was adopted

When examining a weak result or a claim about Skill usage, read the current supplied `handoff.mjs` once. Its `skills.currentTurnUses` reports actual native tool lifecycle evidence and status; `recordedMainLoads` is prior successful main-session loading, with context presence/application explicitly unverified. Child loads are not evidence of a parent's adoption. Missing records do not prove a method was never used. A loaded Skill still needs a concrete matching implementation choice and the resulting observation before claiming it helped.

For example, a heading/pivot defect can call for technical art; action response/feedback can call for game feel; collisions/rules can call for gameplay programming. Select and invoke the appropriate installed method when that work is part of the task, then use the relevant source and runtime passage. Do not prescribe loading every Skill or add another review stage to establish a call count.

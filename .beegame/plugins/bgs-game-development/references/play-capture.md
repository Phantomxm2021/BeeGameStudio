# Player-path observation

Use recordings when motion, cadence, overlap or recovery cannot be judged from the existing observations. Choose tools available for the actual engine and device; a static layout question may need only an image.

Exercise the delivered controls and retain the relevant state transition. Record the runtime/build, display conditions and the input or event that produced the observed result. A changed frame establishes changed pixels; judge contact, response and game feel at the intended camera and normal playback speed.

Video, marks and audio can have different clocks and encoding delays. When locating recorded audio events by time or interpreting decoded zeros, preserve media timestamps and their gaps; concatenated sample positions alone may omit those gaps. Distinguish captured zero samples from zeros inserted during decoding to fill timestamp gaps: inserted zeros do not independently establish that the original signal was silent. Timestamps help locate a passage but do not establish sample-accurate synchronization or input latency. Recording itself can affect timing, so it is not an independent performance baseline.

## Audio observations

For an accessible Web Audio graph, a temporary parallel MediaStreamAudioDestinationNode and MediaRecorder can capture an existing AudioNode without changing its original routing. Select the node from the actual game code and confirm its position relative to gain, effects and the destination. Browser support and recorder errors affect what was observed. The mechanics are documented by [AudioNode.connect](https://developer.mozilla.org/en-US/docs/Web/API/AudioNode/connect), [media stream destinations](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination) and [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder).

A selected node's signal is not necessarily the complete game mix or physical speaker output. Separate contexts, HTML media, device/spatial processing and destination disconnection may lie outside the recording. State that scope and inspect the actual passage. Captured non-silence does not establish correct triggering, pleasant sound or complete coverage.

## Visual comparison

When confirmed requirements include audiovisual behavior, observe a short relevant passage in the actual game, including consequential overlap or interruption. Use the delivered rendering, asset, event and input paths; an isolated preview can diagnose a problem, but a separately implemented demonstration does not verify the game. For a visual change, judge the complete composition at the intended gameplay camera, display scale and normal playback speed. When comparing before/after or an available effect OFF/ON, keep lighting, subjects, framing, action path and supported random seed comparable; record unavoidable differences. Slow motion and close-ups help locate defects but do not replace normal-scale observation.

Check the affected composition, action/state feedback and sound against the requirement or selected design. Scope this to the changed behavior; it does not require solving the game or an experience study. Judge observable agreement with the selected composition, proportions, typography, materials and spatial relationships separately from personal preference. Stills can show composition and detail; continuity and timed transitions need live observation or a relevant clip. Layout calculations, clicks and decoded audio establish only their respective properties. If viewing or listening is unavailable, retain that uncertainty without repeated runs merely to fill evidence. Pending preference feedback does not excuse observable defects or incomplete implementation.

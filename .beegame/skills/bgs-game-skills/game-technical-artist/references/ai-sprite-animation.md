# Sprite frames to playable animation

Use for supplied, sourced or AI-produced 2D character/monster actions, and effects that need changing drawn poses. Follow the [source policy](../SKILL.md); suitable existing animations need no image generation. Shared motion, frame preparation and playback checks apply to every source. Keep the selected art direction and the current playable slice; do not require a fixed set of actions, directions, frame counts or reference boards. A texture atlas can contain unrelated images; packing those images does not create an animation.

## Describe the required motion

Identify the actions and states needed by the actual gameplay, then inspect whether the selected family supplies their changing poses. Keep face, proportions, costume, equipment, palette, line treatment, camera and facing consistent across the accepted family. Apply the source policy to incidental differences from Agent-proposed designs; a reference is not user-approved art merely because the Agent selected it.

For the required action, identify its readable poses, order, loop or one-shot behavior and gameplay timing. For example, a run needs alternating contacts and passing poses, not repeated copies of one stance. Frame count follows the motion and intended display size. Acquire or produce only the action/direction coverage needed now. Mirroring is suitable only when equipment, markings, handedness and lighting remain correct.

## AI generation only when selected

Skip this section for usable supplied or sourced animation. Use an existing suitable character image as the identity reference. If none exists, a usable frame from the first inspected sheet can become the reference for subsequent actions; no separate paid concept stage is required.

Read the current supplied `assets.mjs --help` and obtain its actual `cost low <size>` quote before an authorized generation. Use `generate <request.json> <new-assets-path>` with the existing request fields; no new provider, keys, job manifest or generation wrapper is needed. Respect the total budget, including model work: zero image charges do not make hand-coded artwork free. If generation or budget is blocked, explain the actual blocker and seek direction rather than drawing a substitute or launching paid diagnostics/retries.

Example request shape for a six-pose run, only when that motion needs six poses and a suitable local reference already exists (names, poses, count and canvas are illustrative):

```json
{
  "requestId": "character-run-v1",
  "referenceImagePath": "assets/source/character.png",
  "background": "transparent",
  "quality": "low",
  "size": "1536x1024",
  "prompt": "Use the attached character as the identity and art-style reference. Draw one right-facing in-place run cycle in six ordered poses, left-to-right then top-to-bottom in a 3-column, 2-row layout: left contact, left compression, left passing, right contact, right compression, right passing. Preserve the same camera, character scale, costume and equipment. Keep complete silhouettes separated with transparent space and a consistent local ground reference. Preserve natural body motion within the frames. No labels, grid lines, scenery or duplicate still poses. The final pose should lead naturally back into the first."
}
```

Group compatible poses into a readable sheet, rather than issuing one image request per frame. Split only for an actual resolution, composition or identity problem. A prompt's grid and transparent-background request are intentions, not verified output geometry or alpha.

## Inspect and prepare frames from any source

Inspect the source sheet or individual frames before cutting or importing; preserve usable source animation metadata. Check actual dimensions, transparency, complete silhouettes, pose order, identity changes, repeated stills and frames crossing nominal cell boundaries. For generated sheets, the image response supplies pixels, not trustworthy frame coordinates. Rectangles can be measured; whether the pose is correct still needs visual judgment. If silhouettes overlap or required body parts are absent, a crop or packer cannot repair them. Preserve the source and report the unresolved defect; do not automatically buy another attempt.

Use the existing paths, based on what inspection found:

- A clean sheet with usable frame rectangles: `assets.mjs atlas <sheet.png> <frames.json> <runtime.png>`. The input format is `{"frames":{"run-0":{"x":0,"y":0,"w":256,"h":256}}}` with measured values, not guessed grid coordinates. This registers rectangles; it does not separate or repack pixels.
- Frames needing extraction or shared-canvas padding: use the supplied `media.mjs` `images` operation with explicit crops, resize and transparent padding. Read its current help for the schema. Apply a consistent scale and coordinate reference across the sequence. Do not independently stretch, tightly recenter or bottom-align every pose: that can erase jumps, squash and intentional movement. Keep the intended contact foot/pivot relation; visible bounds are evidence to inspect, not an automatic alignment rule.
- Pack prepared frames with `media.mjs` `atlas`: exact named frames, no rotation/trim, and edge-copy padding for linear filtering. Use nearest filtering only for the intended pixel-art treatment. Preserve originals and use new output paths. The packer preserves supplied pixels and offsets; it does not judge or fix animation.

Register output image and sidecar through the existing Manifest/resource tools. Keep frame order, duration and loop behavior in the chosen engine's existing animation configuration; packed rectangle JSON does not itself encode a playable clip. In particular, selecting a named atlas frame in the current BGS consumer displays that frame, not an entire animation. Do not invent a new Scene component to hide missing runtime integration.

## Observe the animation, not just the files

Inspect the sequence at its intended size and timing, including the last-to-first transition for a loop. Look for identity flicker, scale changes, foot sliding, clipping, unintended offsets and unreadable key poses. A contact sheet helps compare poses but cannot establish cadence. During resource preparation, inspect the prepared sequence in an animation viewer or an asset-only preview, without changing the game entry points or build configuration. The supplied `--sprite-sample` helper creates a standalone demo project; it is not a resource-preparation step inside a game project. If playback cannot be observed, retain that limitation rather than claim motion was verified from still images. Asset playback does not prove gameplay integration. During implementation, use the supplied Preview and its shared `withPlayCapture` helper for the actual player action, contact and recovery; see [player-path capture](../../game-playtest-performance/references/play-capture.md). No separate Skill invocation is needed to access that helper.

Let the real simulation move the actor and decide hits; pose playback must not introduce a second jump trajectory or make a visual contact count as a gameplay hit. Check applicable interruption and restart behavior with normal inputs. Keep any captured first result before authorized revisions. Distinguish mechanical checks, visual observations and unverified properties in the retained evidence. A model's aesthetic approval is not user acceptance. Missing viewing evidence stays unverified; do not add automatic generation/review loops to compensate.

## References and deliberately omitted machinery

- [Godot: 2D sprite animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html): individual frames and sheets both support animation; frame selection and playback are separate from image generation.
- [Aseprite CLI](https://www.aseprite.org/docs/cli/): frame ranges, timing-related source organization, padding and extrusion inform import choices. Use the existing BGS packer, not a new Aseprite dependency.
- [Agent Sprite Forge](https://github.com/0x0funky/agent-sprite-forge) (MIT): reference-grounded actions and playable previews are useful ideas. Its extra video providers, batch orchestration and retake loops are not part of this Skill.
- [Animated Spritesheets](https://github.com/MizukiMachine/claude-skill-public/blob/develop/animated-spritesheets/SKILL.md): useful warnings about naive cell cuts and frame registration. Repository licensing was not established during review; no source code or scripts are copied here. Do not apply a universal bottom-alignment rule to airborne poses.

These are conceptual references, not installed dependencies or evidence that BGS generation quality has been verified.

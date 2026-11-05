# Sprite frames to playable animation

Use for supplied, sourced or AI-produced 2D character/monster actions, and effects that need changing drawn poses. Use the shared [artwork source method](../../game-content-pipeline-engineer/references/artwork-production.md); suitable existing animations need no image generation. Shared motion, frame preparation and playback checks apply to every source. Keep the selected art direction and the current playable slice; do not require a fixed set of actions, directions or frame counts. A texture atlas can contain unrelated images; packing those images does not create an animation.

## Describe the required motion

Identify the actions and states needed by the actual gameplay, then inspect whether the selected family supplies their changing poses. Keep face, proportions, costume, equipment, palette and line treatment consistent across the accepted family. Apply the source policy to incidental differences from Agent-proposed designs; a reference is not user-approved art merely because the Agent selected it.

Distinguish state coverage from motion within a state. A sheet containing one idle, punch, hurt and defeat pose covers four states; those entries are not four frames of a punch. Define each required action from its gameplay meaning and ordered body/equipment poses: a melee strike progresses through its applicable preparation, extension/contact and recovery; a run alternates contacts and passing poses. A held pose can remain a still when the intended action is static. Position, rotation and scale can supplement the drawn motion, but cannot supply missing limb or equipment poses. Reuse the action's ordered poses, timing and loop or one-shot behavior in the image request and runtime playback, including the target camera, facing and compatible entry/recovery poses.

Choose frame count from that motion and timing, and frame resolution from intended on-screen size and readable detail. Then fit the sequence into a supported canvas with sufficient separation; cell dimensions and canvas size are results of those needs. Acquire or produce only the action/direction coverage needed now. Mirroring is suitable only when equipment, markings, handedness and lighting remain correct.

## AI generation only when selected

Skip this section for usable supplied or sourced animation. Establish the static character reference before generating animation: reuse a suitable supplied static reference, or generate a static character atlas with one clearly separated, readable neutral pose per character, showing its complete body and equipment. Choose the reference view to communicate character design; it does not prescribe the camera or facing of later action sequences. Include additional views only to clarify design details hidden in the base view, listing each character/view separately and drawing each entry once. This atlas may contain different characters; its role is to establish their identities, proportions and visual treatment.

Use the corresponding character's static image as the reference for every action sequence. For a shared static atlas, extract the complete character with the existing crop tool and pass that image as the reference. Generate animation separately for each character; actions of the same character may share a sheet by defining each action's ordered frame IDs and poses, then assigning each frame ID exactly one cell in the layout.

Use the system `imagegen` Skill for reference-guided image requests and editing. Use the current generation tool's help for its execution, quote and recovery contract. Respect any explicit user budget. If generation or that budget is blocked, explain the actual blocker and seek direction rather than drawing a substitute or launching paid diagnostics/retries.

Supply the character’s actual static image as the generation reference and the canvas chosen for the sequence. Shape the animation prompt from the same action definition, with layout last:

```text
Reference: <static image of this character, used for identity and visual design>
Preserve: <identity, body proportions, costume, equipment, palette and rendering style>
Target view: <game camera and character facing for this sequence>; keep the camera consistent across its frames, and change facing only as required by the action
Drawing scale: <chosen scale for the intended on-screen size>, shared across all frames; crouching, jumping and falling change the visible silhouette's height and width, not the drawing scale
Local origin: <fixed origin's meaning and position within each frame canvas; ground reference if relevant>; describe body and equipment offsets relative to it. Grounded contact uses the specified ground reference where applicable; airborne feet and body parts move with the action

Repeat the following block for every included action:
Action <action ID>: <gameplay meaning and body/equipment motion from the shared definition>
Frame count: <N for this action>
Playback: <frame timing, loop closure or one-shot ending>
Ordered frames: list every frame separately in playback order
  <action ID>-01: <body, limbs and equipment pose; displacement relative to the local origin>
  ...
  <action ID>-<N>: <final pose and its loop connection or one-shot ending>

Layout, chosen after all action blocks:
Canvas and cells: <supported image width/height, cell width/height, row/column count and spacing, sized for the total frame count and full motion extents at the chosen drawing scale>
Cell assignment: list every frame ID above exactly once, each assigned a different cell by row and column; rows start at 1 from the top and columns at 1 from the left
  <action ID>-01 -> row <r>, column <c>
  ...
Each cell contains only the pose described for its assigned frame ID. Keep each action's frames consecutive in playback order, reading left to right then top to bottom; unused cells remain transparent
Presentation: complete silhouettes and transparent separation; frame IDs and coordinates are instructions only, with no labels, grid lines or scenery drawn in the image.
```

A prompt's grid and transparent-background request are intentions, not verified output geometry or alpha.

## Inspect and prepare frames from any source

Inspect the source sheet or individual frames before cutting or importing; preserve usable source animation metadata. Check actual dimensions, transparency, complete silhouettes, pose order, identity changes, repeated stills and frames crossing nominal cell boundaries. For generated sheets, the image response supplies pixels, not trustworthy frame coordinates. Rectangles can be measured; whether the pose is correct still needs visual judgment. If silhouettes overlap or required body parts are absent, a crop or packer cannot repair them. Preserve the source and report the unresolved defect; do not automatically buy another attempt.

Use the existing paths, based on what inspection found:

- For a clean sheet, retain its pixels and record named frame rectangles measured from the actual image. Rectangle metadata does not separate or repack pixels.
- For frames needing extraction or shared-canvas padding, use explicit measured crops, resize and transparent padding. Apply a consistent scale and coordinate reference across the sequence. Do not independently stretch, tightly recenter or bottom-align every pose: that can erase jumps, squash and intentional movement. Keep the intended contact foot/pivot relation; visible bounds are evidence to inspect, not an automatic alignment rule.
- Pack prepared frames with explicit frame names, no rotation/trim, and edge-copy padding for linear filtering. Use nearest filtering only for the intended pixel-art treatment. Preserve originals and use new output paths. The packer preserves supplied pixels and offsets; it does not judge or fix animation.

Register output image and sidecar through the existing Manifest/resource tools. Keep frame order, duration and loop behavior in the chosen engine's existing animation configuration; packed rectangle JSON does not itself encode a playable clip. Selecting an atlas region displays one pose; frame advancement and transitions still need runtime animation behavior.

## Observe the animation, not just the files

Inspect the sequence at its intended size and timing, including the last-to-first transition for a loop. Look for identity flicker, scale changes, foot sliding, clipping, unintended offsets and unreadable key poses. A contact sheet helps compare poses but cannot establish cadence. During resource preparation, inspect the prepared sequence in an animation viewer or an asset-only preview, without changing the game entry points or build configuration. If playback cannot be observed, retain that limitation rather than claim motion was verified from still images. Asset playback does not prove gameplay integration. During implementation, observe the actual player action, contact and recovery in the chosen runtime; see [player-path observation](../../game-playtest-performance/references/play-capture.md) for recording scope and clock limits.

Let the real simulation move the actor and decide hits; pose playback must not introduce a second jump trajectory or make a visual contact count as a gameplay hit. Check applicable interruption and restart behavior with normal inputs. Keep any captured first result before authorized revisions. Distinguish mechanical checks, visual observations and unverified properties in the retained evidence. A model's aesthetic approval is not user acceptance. Missing viewing evidence stays unverified; do not add automatic generation/review loops to compensate.

## References and deliberately omitted machinery

- [Godot: 2D sprite animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html): individual frames and sheets both support animation; frame selection and playback are separate from image generation.
- [Aseprite CLI](https://www.aseprite.org/docs/cli/): frame ranges, timing-related source organization, padding and extrusion inform import choices. This reference does not require adding Aseprite as a dependency.
- [Agent Sprite Forge](https://github.com/0x0funky/agent-sprite-forge) (MIT): reference-grounded actions and playable previews are useful ideas. Its extra video providers, batch orchestration and retake loops are not part of this Skill.
- [OpenAI image prompting: consistent characters](https://developers.openai.com/api/docs/guides/image-prompting#keep-a-character-consistent): GPT Image 2.5 examples establish a character reference and reuse it across poses and scenes while preserving defining features. Apply that reference method to the ordered poses above; frame timing and transitions belong to engine playback.

These are conceptual references, not installed dependencies or evidence that BGS generation quality has been verified.

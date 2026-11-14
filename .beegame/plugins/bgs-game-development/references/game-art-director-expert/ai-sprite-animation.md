# Character consistency and pose production

Use this specialist reference when the current spritesheet or sequence work needs character identity, articulated poses or character-facing consistency. The shared [spritesheet/atlas method](../game-content-pipeline-engineer/spritesheet-production.md) covers entry meanings, layout, extraction and consumption for every material. This reference develops only the character work already required by the project; it supplies no action list or universal pose cycle.

## Preserve the intended subject and action

Keep defining proportions, face, costume, equipment, palette and line treatment consistent at the actual game camera and display size. Derive pose changes from the subject's construction and the planned action: body orientation, support/contact, limb relationships and equipment trajectories must communicate that action. Choose the relevant motion, facing, timing and rest/recovery from the project, not from a demonstration character. A held pose is valid when the intended state is static.

Choose a representation that supplies those visible changes. Whole-image transforms can reinforce them or satisfy a rigid motion; they do not supply missing articulation or equipment changes. Simulation still owns legal movement and contact. Apply mirroring only when markings, equipment, handedness and lighting remain correct.

Retain suitable supplied or sourced character animation and its metadata. For consequential facing/contact/transition problems, use the relevant [motion implementation comparisons](motion-implementation.md); those examples are diagnostic cases, not another required action set.

## AI production when selected

Establish the static character reference before expanding it into animation. Reuse a suitable supplied image, or generate a static identity atlas with clearly separated, complete subjects and their equipment. Its purpose is identity and visual treatment, not action coverage. Choose reference views to expose design details; they do not prescribe the later sequence's camera or facing. Additional views serve a specific hidden detail rather than a fixed view list.

For a shared identity atlas, crop the complete corresponding character with existing media tools and pass that actual image as the generation reference. Generate sequences separately for different characters. Actions of one character may share a sheet when their entries and playback order remain unambiguous under the shared method.

Use the system imagegen Skill for the image operation and current tool help for request/recovery. Preserve the character's defining appearance while describing the project's actual action and ordered pose changes. State the target camera/facing, a shared drawing scale, and the local origin/contact relationship through the motion. Changes in visible height or width caused by a pose do not imply a change in drawing scale. Frame count, canvas and layout follow the resulting motion and full extents; the shared method owns their assignment and import.

When preparing and playing the result, examine the character-specific issues in the affected passage: identity flicker, support-foot sliding, equipment detachment, apparent scale changes and readable poses. Use the shared method for common frame preparation and playback observation. An animation's visual contact or completion does not prove a gameplay hit or action success.

## Method references

- [OpenAI image prompting: consistent characters](https://developers.openai.com/api/docs/guides/image-prompting#keep-a-character-consistent): reference-guided identity preservation across changed poses and scenes.
- [Agent Sprite Forge](https://github.com/0x0funky/agent-sprite-forge) (MIT): reference-grounded character actions and playable previews are useful ideas; its additional providers, orchestration and retake loops are not dependencies or requirements here.

These sources inform methods, not verified BGS generation results.

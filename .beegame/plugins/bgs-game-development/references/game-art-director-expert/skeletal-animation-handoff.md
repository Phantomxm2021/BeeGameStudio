# Skeletal animation handoff

Use for actual 3D rigging, clip export/import or locomotion-transition work. Reuse the selected engine's animation facilities and existing assets; a sprite or UI animation task does not need a skeleton.

## Rig and export compatibility

Establish the model's units, forward/up axes, rest/bind transforms and bone mapping before changing a rig. For skin repairs, inspect joints in motion: automatic weights may affect the opposite side, rigid accessories or disconnected parts. Normalize/prune weights on a runtime copy according to the target's influence limit. When baking control-rig motion, preserve the editable source and export only the intended runtime bones, meshes and clips.

A model and separately exported clips need compatible bind transforms, not just matching bone names. If import succeeds but the body distorts, compare the evaluated first pose and contact poses on the actual model in the same coordinate space. Check rest-pose changes and exporter settings before compensating with arbitrary bone offsets. Diagnose missing textures from the delivered dependency set without relying on files in the author's source directory.

Retain clip range, frame rate or sample timestamps, duration, loop behavior, root displacement and relevant contact/release times in the existing animation metadata. Keep times in seconds as well as source frame markers; changing frame rate alone changes playback speed, while resampling preserves time. Verify the loop seam and ordinary clip switching, not just isolated key poses.

## Movement and transition continuity

Identify which existing system applies translation and heading. Apply authored root motion or controller displacement once; separate model-forward correction from clip yaw. Do not change movement speed or action cadence to hide an import or visual-transition defect.

Use existing blending or phase synchronization first. If a partial turn entering locomotion swaps the support foot, compare the last evaluated pose with the receiving gait's contact phase in body-local space. Enter a compatible phase instead of always restarting at frame zero; a longer crossfade alone may retain the wrong support. Match the actual anatomy and inspect intermediate poses at gameplay speed. This is a repair choice, not a requirement to build a custom pose matcher.

Keep confirmed gameplay events on their existing authority and check whether the chosen player dispatches imported markers. Interruption must not emit a contact/release that never occurred. Preserve the source timing and bindings in the existing handoff rather than introducing a parallel animation specification.

[Godot's animation blending and root-motion documentation](https://docs.godotengine.org/en/stable/tutorials/animation/animation_tree.html) illustrates these engine facilities; use the selected engine/version's actual interfaces. Production cases informing this reference: [Mr. Mak animation integration](https://github.com/witnesstodark/mr-mak-workspace/blob/4f4bd3de65f71017ac5abada068066cece204a8e/.agents/skills/game-animation-integration/SKILL.md) and [export handoff](https://github.com/witnesstodark/mr-mak-workspace/blob/4f4bd3de65f71017ac5abada068066cece204a8e/.agents/skills/blender-game-animation/references/engine-handoff.md).

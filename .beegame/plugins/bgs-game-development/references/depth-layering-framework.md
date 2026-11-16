# Depth Layering Framework

Use depth to communicate purpose and priority. A useful distinction is primary interaction, supporting information, and ambience, but it is not a required three-layer stack. Test legibility, occlusion, and whether the player can reorient or recenter. Remove competing panels rather than adding depth solely to fit more content.

Choose anchoring and scale from the actual task. For a stationary inspection, compare a stable object/world-relative panel with one that constantly follows the head; for a moving task, check how the required information can be recovered without obscuring navigation. A world anchor is not usable simply because it is stable, and a head-relative panel is not universally forbidden for every specialized task.

[Apple spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/) guides placement for visionOS; do not assign its system-window behavior to a custom 3D panel. When using Unity's XRI UI path, [its UI setup](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.2/manual/ui-setup.html) documents world-space Canvas/raycast handling and optional occlusion checks. A visually hidden button may still receive input if that path is misconfigured.

Inspect the intended distance, orientation, visual angle and overlapping scene geometry with actual text and target input. Spatial relationships should remain editable in the native source. A flat screenshot or rectangle check does not establish eye targeting, readable apparent size or physical reach.

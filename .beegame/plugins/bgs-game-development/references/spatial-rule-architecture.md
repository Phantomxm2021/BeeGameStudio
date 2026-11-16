# Spatial Rules and Official Sources

Use for a consequential spatial/input decision, not a full platform survey. Identify device/OS, seated/standing/room-scale use, input modes, anchoring/immersion and actual engine/SDK version from the project. Read only the source that answers the current question. These design methods do not select the user's technology or establish new task authority.

## Source selection

| Context | Official reference | What it informs |
|---|---|---|
| Apple visionOS composition | [Spatial layout](https://developer.apple.com/design/human-interface-guidelines/spatial-layout/) and [Principles of spatial design](https://developer.apple.com/videos/play/wwdc2023/10072/) | Field of view, spatial placement, scale and immersion |
| Apple visionOS selection/gestures | [Design for spatial input](https://developer.apple.com/videos/play/wwdc2023/10073/) and [Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures/) | System eye/hand interaction, comfortable targeting and custom-gesture considerations |
| Meta device comfort | [Comfort](https://developers.meta.com/vr/design/comfort/) and [Locomotion comfort and usability](https://developers.meta.com/vr/design/locomotion-comfort-usability/) | Visibility, physical effort and the risks of the selected movement mode |
| Meta artificial locomotion input | [Input maps](https://developers.meta.com/vr/design/locomotion-input-maps/) | Supported/recommended mappings for controllers, hands and multimodal input; check SDK/device support |
| Unity XRI locomotion | [XRI 3.2 locomotion](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.2/manual/locomotion.html) | XR Origin, locomotion providers and collision-constrained movement facilities |
| Unity XRI UI | [XRI 3.2 UI setup](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@3.2/manual/ui-setup.html) | Its world-space Canvas input/raycast path and occlusion configuration |

Unity links are versioned examples, not a mandate to install 3.2; use documentation matching the installed package. Apple's system selection can use eyes and relaxed hands; do not assume continuous raw gaze data is available to the app. Meta's recommended mappings and experimental interactions are not universal engine contracts. Unity's component support describes implementation capability, not proof of comfort. If a page is inaccessible, use an available official source addressing the same fact or disclose the gap; do not substitute remembered requirements.

## Concrete interaction comparisons

The following are original illustrative decisions, not vendor-mandated game designs:

- **Tabletop puzzle:** compare short direct manipulation with distant selection. Preserve the same game rule; check target recognition, accidental grabs, posture and recovery from tracking loss. A stationary task does not need an artificial locomotion system.
- **Exploration:** compare the selected physical/artificial movement with the space and accessibility requirements. Check destination visibility and orientation after teleport, or movement basis/collision under continuous motion. Do not add a gesture-only movement scheme simply because hand tracking exists.
- **Off-screen event:** relate the available field of view, warning, turning effort and response window to the intended fairness. A world-space warning, sound or another designed cue can help; none automatically establishes that a user can react safely.

Use actual input availability and constrained outcomes. Keep gameplay-state changes separate from selection/raycast events and tracked pose updates. A desktop simulator can expose wiring or coordinate errors; target-device observation is still needed for tracking, legibility, reach and comfort. Missing device evidence stays unverified rather than creating an automatic extra research stage.

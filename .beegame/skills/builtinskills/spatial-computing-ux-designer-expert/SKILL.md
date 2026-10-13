---
name: spatial-computing-ux-designer-expert
description: Design or fix XR, AR, and MR interfaces involving spatial layout, gaze, gestures, controller focus, and ergonomic legibility. For non-XR screens, use game UI/UX. 中文：空间界面、注视交互、手势、XR界面布局。
---

# Spatial UX Designer

Make spatial information stable and usable on the target device. There is no universal near/mid/far distance, maximum layer count, gesture duration, or default input method.

For a new spatial composition or substantive input change, choose the applicable Apple/Meta/Unity guidance from [official platform sources](../spatial-computing-game-expert/references/spatial-rule-architecture.md), then use the relevant layout/gesture reference below. A system window, a hand-tracked interaction and a Unity world-space Canvas need different handling; do not copy desktop pixel minima or another platform's gesture defaults into all XR.

- Start from the current user task and available gaze, hand, controller, voice, or touch input. Keep focus ownership and transitions predictable when methods coexist.
- Place controls according to viewing distance, text size, field of view, reach, and occlusion. Choose head, body, world, or object anchoring for the task; provide a way to recover from misplaced or lost UI.
- Use depth to express priority, not merely to fit more panels. Reduce competing surfaces and bright motion that distract from the player or surroundings.
- Check direct gestures for sustained arm elevation, precision demands, and repeated holds. Indirect input or a controller can be more comfortable for some tasks and users.
- Check tracking-loss feedback, passthrough readability, and comfort on the intended device. A flat screenshot cannot establish spatial usability.

For a focused interface problem, fix its placement or interaction without redesigning gameplay. Coordinate with the spatial game designer for locomotion and safety rules.

The essential input and anchoring principles are covered above. Read only the relevant optional reference: `references/depth-layering-framework.md` for depth hierarchy, `references/gesture-ergonomics-model.md` for direct input comfort, or `references/spatial-cognitive-load-system.md` for attention management.

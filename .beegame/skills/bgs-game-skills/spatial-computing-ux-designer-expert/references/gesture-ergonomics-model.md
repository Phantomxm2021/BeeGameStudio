# Gesture Ergonomics Model

Comfort checks for direct gestures:

- Short duration
- Natural hand rest
- No extreme wrist angle
- Avoid repeated high arm lifts

Sustained elevation and repetition can cause fatigue, but there is no universal safe duration. Observe the real interaction on the target device and offer a less demanding path when needed.

For a repeated selection task, prefer the platform's suitable standard input before inventing a sustained hold or two-hand gesture. If direct manipulation is essential, distinguish hover/target, activation, drag and release, including tracking loss and cancellation. Check whether the target size and posture work during the actual sequence, not only a successful single activation.

Use [Apple's spatial input session](https://developer.apple.com/videos/play/wwdc2023/10073/) and [gesture guidance](https://developer.apple.com/design/human-interface-guidelines/gestures/) for visionOS. System targeting is not permission to collect raw eye data, and custom hand gestures may have space/permission and system-overlay constraints. For Meta, [locomotion input maps](https://developers.meta.com/vr/design/locomotion-input-maps/) distinguish mappings and supported modalities; verify current SDK support instead of treating hands as a drop-in replacement for a continuous thumbstick. These facts inform a choice, not an automatic gesture requirement.

# Audio and persistence

Use for silent audio, doubled music after restart, or saved-state restoration.

## Audio ownership

Browsers can suspend Web Audio until a user gesture. Loading a file is separate
from unlocking playback; connect initial playback to the game's real start
interaction and inspect the sound manager/context when silent. Format choice
follows the supported browsers and supplied assets; generating MP3 and OGG for
every file is not universally necessary.

The sound manager is game-wide. Decide which scene or persistent controller
owns background music; repeatedly starting it in `create()` can stack tracks
across restarts. Pause/resume, mute and leaving the game are distinct behaviors.
A scene leaving does not imply destroying music intentionally shared by the
next scene. Release tracks/listeners that the departing scene actually owns.

Use one-shot playback for short effects when overlap is intended; use a managed
sound instance for loops, volume envelopes or explicit interruption. A delayed
callback acting on a destroyed sound is a lifecycle issue, not a reason to
silence every audio error. Select clip formats and streaming/loading according
to target support and measured loading behavior.

## Reconstruct saved state

Persist data such as unlocked progress, score and settings, not Scene instances,
physics bodies or active tweens. Reconstruct runtime objects from data through
the existing game initialization path. Keep settings distinct from per-run
state if they have different reset behavior.

Storage and JSON parsing are external-data boundaries: handle unavailable
storage, malformed data and incompatible saved versions there. Validate fields
that affect reconstruction; preserve the intended reset/recovery behavior
rather than silently treating corrupt progression as a valid completed game.
Version a save format when its meaning changes; a small game with one high
score does not require a generic migration framework or cloud-save system.

Source topics: phaser-audio, phaser-saveload.

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).

# BGS Game Development Skill Collection

Subdirectories containing `SKILL.md` are independent Skills in the native
`bgs-game-development` Plugin. Choose from native metadata or use this optional map;
there is no requirement to read this index or the whole collection first.
Skill names are qualified by the native Plugin namespace; installation paths come from native discovery. The rows below are alternatives by
question, not stages or a required sequence.

## Find the current question

| Current question | Start with | Detail only when needed |
|---|---|---|
| What experience, theme/mechanic relationship or scope tradeoff should this game promise? | [Creative direction](game-creative-director-expert/SKILL.md) | Cross-domain appeal and scope decisions |
| What actions are legal, how do states change, and what ends play? | [Systems design](game-systems-designer-expert/SKILL.md) | Rules, transitions, progression/economy meaning |
| Does a route, encounter or teaching sequence work? | [Level design](game-level-designer-expert/SKILL.md) | Traversal, placement and challenge progression |
| Which numerical relationship or diagnosed balance issue needs tuning? | [Balance](game-balance-designer-expert/SKILL.md) | Quantities derived from existing rules |
| Which composition, visual language or subject treatment fits the agreed game? | [Art direction](game-art-director-expert/SKILL.md) | [Finished-picture comparisons](game-art-director-expert/references/ui-visual-hierarchy.md#finished-game-references) |
| How should players find information and use a menu, HUD or control? | [UI/UX](game-ui-ux-designer/SKILL.md) | Interface behavior, hierarchy, layout and copy |
| How do I obtain, generate, extract, pack or deliver compatible asset files? | [Content pipeline](game-content-pipeline-engineer/SKILL.md) | [Artwork production](game-content-pipeline-engineer/references/artwork-production.md), file/anchor compatibility and [assembly examples](game-content-pipeline-engineer/references/runtime-assembly-examples.md) |
| Generate/acquire a 3D model or prepare a generated static prop? | [3D assets](bgs-3d-asset/SKILL.md) | Provider access, model preparation and actual target-runtime import |
| Create or edit an image through an authorized generation source? | System `imagegen` Skill | Original system guidance; execution follows the available tool's contract |
| How should an action respond, stop, build anticipation or communicate impact? | [Game feel](game-feel-designer/SKILL.md) | Response and coordinated feedback decisions |
| How do delivered resources realize the required animation, VFX or material behavior? | [Technical art](game-technical-artist/SKILL.md) | [Spritesheets and atlases](game-technical-artist/references/spritesheet-production.md), applicable character/VFX methods, rigs and effect lifetime |
| How should the game sound across play and transitions, or why does its music/ambience/event feedback fail? | [Audio](game-audio-designer/SKILL.md) | Soundscape, composition, mixing and state/event integration |
| How do devices and camera orientation map to the intended player action? | [Interaction](beegame-interaction-contracts/SKILL.md) | Screen inputs or XR locomotion |
| How does a selected Phaser 4 API implement this behavior? | [Phaser 4](phaser4-gamedev/SKILL.md) | A current Phaser 3 project is not an automatic migration |
| How does the selected Three.js renderer or R3F API implement this behavior? | [Three.js](threejs-gamedev/SKILL.md) | Topic sections distinguish WebGL, WebGPU/TSL and R3F |
| What body/room/tracking constraints shape XR gameplay? | [Spatial gameplay](spatial-computing-game-expert/SKILL.md) | The actual device and interaction model |
| Where should spatial UI sit, and how do gaze/gesture/focus work? | [Spatial UI](spatial-computing-ux-designer-expert/SKILL.md) | Depth, anchoring and ergonomic readability |
| Is there a source-provable gap or contradiction in the assigned design? | [Design check](game-design-check/SKILL.md) | Assigned decisions, not a second GDD template |
| Which concrete performance problem or requested playtest question needs investigation? | [Playtest/performance](game-playtest-performance/SKILL.md) | [Visual comparison](game-playtest-performance/references/play-capture.md#visual-comparison); real-player studies only in scope |

Design methods decide the intended result; production methods realize its parts;
engine references explain the selected runtime. A concrete task may need more
than one, without requiring every specialist in that group. Follow a specific
reference/section when it answers the current question, reusing retained method
content rather than reopening its parent Skill.

Source package: `.beegame/plugins/bgs-game-development/`. Install and discover this
package through the native Plugin marketplace; there is no separate Skills source root.

## Shared methods

- Phaser and Three.js share [runtime dependency selection](references/runtime-dependencies.md) for a new setup or concrete version mismatch.
- Art and UI share the [visual comparison studies](game-art-director-expert/references/ui-visual-hierarchy.md). They do not each maintain a style catalog.
- Source choice and fallback conditions live in [artwork production](game-content-pipeline-engineer/references/artwork-production.md); image prompting/editing uses the original system `imagegen` Skill and execution follows the current tool's contract.
- Motion/audio recordings and visual comparison use [player-path observation](game-playtest-performance/references/play-capture.md). They do not create another review task.
- XR methods share [platform/source guidance](spatial-computing-game-expert/references/spatial-rule-architecture.md); each reads only the applicable platform.

This map does not inject Skill bodies, assign stages or prove that a method was
used. Current task authorization and native discovery remain unchanged.

## Packaging and compatibility

Only active domain Skills belong here. Removed Skills and their reasons are
listed in `docs/retired-skills/README.md`; they are not discoverable or packaged.

Runtime builds must package this directory unchanged. When the runtime is not
launched from the source tree, set `BEEGAME_BUILTIN_SKILLS_DIR` to its absolute
packaged path. Desktop clients that host their own runtime should package the
same directory and set that host-side variable. BGS prepares the bundled native
marketplace and installs `bgs-game-development@bgs-professional` into each isolated
account home before Agent work. Native discovery supplies namespaced Skill names
and installed paths; this source is not also registered as an extra Skills root.
Explicit disable settings and existing installations are preserved on resume.
Uploaded Skills synchronize to the account’s native `BGS_HOME/skills`; system
Skills remain separate. Native thread recovery uses retained installed Plugin paths; obsolete source-path
Shell commands are not rewritten or granted additional sandbox access.

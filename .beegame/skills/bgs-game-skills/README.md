# BGS Game Development Skill Collection

The immediate subdirectories are independent Skills discovered through native
`skills/extraRoots/set`. Choose from native metadata or use this optional map;
there is no requirement to read this index or the whole collection first.
Names and installed paths are stable. The rows below are alternatives by
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
| Which resource source/representation fits, or why does an imported part look wrong? | [Content pipeline](game-content-pipeline-engineer/SKILL.md) | [Artwork production](game-content-pipeline-engineer/references/artwork-production.md), [assembly examples](game-content-pipeline-engineer/references/runtime-assembly-examples.md) |
| Generate/acquire a 3D model or prepare a generated static prop? | [3D assets](bgs-3d-asset/SKILL.md) | Provider access, model preparation and actual target-runtime import |
| Create or edit an image through an authorized generation source? | System `imagegen` Skill | Original system guidance; execution follows the available tool's contract |
| How should an action respond, stop, build anticipation or communicate impact? | [Game feel](game-feel-designer/SKILL.md) | Response and coordinated feedback decisions |
| How do the chosen action poses, VFX, shader or camera treatment actually run? | [Technical art](game-technical-artist/SKILL.md) | [Sprite sequences](game-technical-artist/references/ai-sprite-animation.md), rigs and effect lifetime |
| How should music/sound communicate the event, or why does its mix/trigger fail? | [Audio](game-audio-designer/SKILL.md) | Composition, production and audible event integration |
| How do devices and camera orientation map to the intended player action? | [Interaction](beegame-interaction-contracts/SKILL.md) | Screen inputs or XR locomotion |
| Why do movement, contact, scoring, clocks or gameplay state execute incorrectly? | [Gameplay programming](gameplay-programmer/SKILL.md) | [React/Phaser hosting](gameplay-programmer/references/react-host-integration.md) when applicable |
| How does a selected Phaser 4 API implement this behavior? | [Phaser 4](phaser4-gamedev/SKILL.md) | A current Phaser 3 project is not an automatic migration |
| How does the selected Three.js renderer or R3F API implement this behavior? | [Three.js](threejs-gamedev/SKILL.md) | Topic sections distinguish WebGL, WebGPU/TSL and R3F |
| What body/room/tracking constraints shape XR gameplay? | [Spatial gameplay](spatial-computing-game-expert/SKILL.md) | The actual device and interaction model |
| Where should spatial UI sit, and how do gaze/gesture/focus work? | [Spatial UI](spatial-computing-ux-designer-expert/SKILL.md) | Depth, anchoring and ergonomic readability |
| Is there a source-provable gap or contradiction in the assigned design? | [Design check](game-design-check/SKILL.md) | Assigned decisions, not a second GDD template |
| What does the actual game do, and where is its measured performance cost? | [Playtest/performance](game-playtest-performance/SKILL.md) | [Visual comparison](game-playtest-performance/references/play-capture.md#visual-comparison); real-player studies only in scope |
| Which Git operation is needed for the requested repository change? | [Git workflow](git-workflow/SKILL.md) | No automatic branch, commit or push requirement |

Design methods decide the intended result; production methods realize its parts;
engine references explain the selected runtime. A concrete task may need more
than one, without requiring every specialist in that group. Follow a specific
reference/section when it answers the current question, reusing retained method
content rather than reopening its parent Skill.

## Shared methods

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
same directory and set that host-side variable. BGS registers this shared root
with `skills/extraRoots/set` before starting or resuming each native thread;
account homes do not need built-in Skill copies or projection links. The sandbox
grants read-only access to this catalog. User-installed Skills remain in the
per-user runtime configuration and are registered separately for that account.

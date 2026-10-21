# BGS Game Development Skill Collection

One shared collection, registered through native `skills/extraRoots/set`.
The existing immediate subdirectories remain independently discoverable Skills;
groups below are navigation, not directories, stages or assignments. Use native
Skill metadata to select a method and invoke its installed name, such as
`$game-ui-ux-designer`, or read its `SKILL.md`. Do not read the entire collection for each task.

## Choose by the actual task

| Group | Question being answered | Independent entry points |
|---|---|---|
| Game design | What experience is promised, what does the player do, how is space/challenge arranged, and which numbers support it? | [Creative direction](game-creative-director-expert/SKILL.md), [systems](game-systems-designer-expert/SKILL.md), [levels](game-level-designer-expert/SKILL.md), [balance](game-balance-designer-expert/SKILL.md) |
| Audiovisual and player experience | How should the game look, sound, respond and present information? Which spatial interactions are appropriate when XR is in scope? | [Art](game-art-director-expert/SKILL.md), [UI/UX](game-ui-ux-designer/SKILL.md), [audio](game-audio-designer/SKILL.md), [game feel](game-feel-designer/SKILL.md), [XR gameplay](spatial-computing-game-expert/SKILL.md), [XR interface](spatial-computing-ux-designer-expert/SKILL.md) |
| Engineering and resources | How do agreed rules, input, assets and dynamic visuals work in the selected runtime? | [Gameplay programming](gameplay-programmer/SKILL.md), [technical art](game-technical-artist/SKILL.md), [resource/content pipeline](game-content-pipeline-engineer/SKILL.md), [interaction contracts](beegame-interaction-contracts/SKILL.md) |
| Planning and execution | How is this implementation decomposed or resumed without redoing completed work? | [Implementation planning](game-implementation-planning/SKILL.md), [plan execution](game-plan-execution/SKILL.md) |
| Inspection and diagnosis | Is the design usable, what supports a completion claim, what happens in play, or where does a defect first arise? | [Design check](game-design-check/SKILL.md), [completion evidence](evidence-before-completion/SKILL.md), [playtest/performance](game-playtest-performance/SKILL.md), [root-cause debugging](root-cause-debugging/SKILL.md) |

Select only methods needed for the actual question and its consequential
dependencies. For example, shaping a movement response differs from coding its
collision behavior; choosing a visual language differs from implementing its
shader; authoring UI differs from checking whether a supplied design is usable.
One task may need both, but invoking a checking Skill does not replace the
specialist's design method. Reuse methods already loaded in the working context.
No group requires every member or defines a fixed workflow.

## Shared material, separate purposes

- Art and UI use one [composition study](game-art-director-expert/references/ui-visual-hierarchy.md), not separately maintained examples.
- UI layout fields, projection and calculator usage live in [layout calculation](game-ui-ux-designer/references/layout-calculation.md). The [design check](game-design-check/references/saved-content-checks.md) adds inspection questions rather than another layout contract.
- XR platform/source selection lives in [official spatial guidance](spatial-computing-game-expert/references/spatial-rule-architecture.md); spatial UX and interaction references use that same source.
- Design inspection finds missing/conflicting decisions; completion evidence bounds a claim; playtesting observes the actual runtime. They are not a mandatory three-pass chain.

The current Agent assignment supplies ownership, scope and authorization;
Skills supply methods and evidence requirements; BGS owns the user-facing
completion format. Do not copy Skill bodies into project guides or load
them all as one prompt. This navigator itself is a reference, not guaranteed
automatic discovery or proof that a method was applied correctly.

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

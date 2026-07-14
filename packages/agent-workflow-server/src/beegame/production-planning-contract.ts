export const GAME_PRODUCTION_DOCUMENT_PATHS = [
  'docs/production-brief.json',
  'docs/specs/GDD.md',
  'docs/specs/TECHNICAL_DESIGN.md',
  'docs/specs/ART_DIRECTION.md',
  'docs/specs/UI_UX_SPEC.md',
  'docs/specs/AUDIO_DESIGN.md',
  'docs/specs/LEVEL_CONTENT_DESIGN.md',
  'docs/specs/ASSET_PLAN.md',
  'docs/specs/ACCEPTANCE_CRITERIA.md',
  'assets/asset-manifest.json',
  'docs/delivery-contract.json',
] as const

export const GAME_PRODUCTION_PLAN_DIRECTORY = 'docs/superpowers/plans/'
export const GAME_PRODUCTION_PLAN_INDEX_PATH = 'docs/superpowers/plan-index.json'

const DOCUMENT_RESPONSIBILITIES = [
  '- docs/production-brief.json: host-materialized user-approved input and explicit settings. It is immutable task input, not an Agent-authored specification; use it to resolve provenance and MVP scope.',
  '- docs/specs/GDD.md: vision, player fantasy, scope/non-goals, first-minute experience, complete core loop, rules, controls, state transitions, progression, win/loss, restart, systems and balancing assumptions.',
  '- docs/specs/TECHNICAL_DESIGN.md: project-native architecture, module ownership, data flow, state lifecycle, input/simulation/rendering/asset loading, error handling, performance budgets, build/run/test commands and risks.',
  '- docs/specs/ART_DIRECTION.md: visual pillars, composition, shape language, palette, lighting, camera, characters, environment, props, VFX, animation and gameplay readability.',
  '- docs/specs/UI_UX_SPEC.md: player journeys, HUD, menus, interaction and feedback states, supported input behavior, accessibility, loading, failure, pause, completion and restart.',
  '- docs/specs/AUDIO_DESIGN.md: music, ambience, SFX, feedback priority, mixing, fallback behavior and event-to-audio mapping.',
  '- docs/specs/LEVEL_CONTENT_DESIGN.md: world/level or equivalent session/content progression, encounter flow, pacing, spatial metrics, spawn/checkpoint behavior and content boundaries.',
  '- docs/specs/ASSET_PLAN.md: required asset families, purpose, style/format constraints, source/license expectations, dependencies, fallbacks and mapping to machine-readable asset slots.',
  '- docs/specs/ACCEPTANCE_CRITERIA.md: observable criteria and complete player paths covering entry, core action, state change, completion and recovery/restart; never pre-check unobserved results.',
  '- assets/asset-manifest.json: platform-neutral asset requirements, target capabilities, bindings, provenance and honest uploaded/integrated status.',
  '- docs/delivery-contract.json: normative MVP/roadmap requirements, exact sourceRefs, evidence requirements, applicable skill capabilities, structured player paths and an explicit acceptanceCriteria index.',
]

export function withGameProductionPlanningContract(prompt: string): string {
  return [
    prompt,
    '',
    'Game production planning contract:',
    '- Claude Code is the only task state machine. Complete this work with native tools, skills, sub-agents, resume and compaction behavior; do not create or depend on a BeeGame/Web parallel phase controller.',
    '- Read docs/production-brief.json before authoring documents. Normalize that confirmed brief without editing it. Explicit user settings override recommendation fields; an approved MVP/prototype scope is distinct from the longer-term product vision. Preserve both only when they are labelled separately. Compare structured claims and their provenance, never keywords. If two authoritative fields still conflict materially, stop and ask the user instead of choosing silently.',
    '- Keep document and asset scope proportional to the approved MVP. Specify only the systems, content, UI, audio and assets required by declared MVP player paths; move optional modes, polish and production-scale content to an explicitly non-normative roadmap instead of expanding the implementation workload.',
    '- First invoke the applicable game-production skills from the runtime catalog. At minimum consider creative direction, game systems, level/content, art, UI/UX, audio, balance and the selected project-native technology; invoke only those applicable to this brief. Skills must inform the documents, not be called after the documents merely to satisfy a checklist.',
    '- After the applicable skills have been read, create and read the complete production document bundle below. A topic may be marked not applicable only with a project-specific rationale and substitute behavior; empty placeholders are not acceptable.',
    ...DOCUMENT_RESPONSIBILITIES,
    '- Before planning, ensure the deterministic document, asset-contract and delivery-contract checks pass, then invoke the fresh-context read-only beegame-production-reviewer through Claude Code\'s native Agent tool. Let Claude Code choose and manage the native foreground/background execution mode. It must compare the resolved brief, gameplay rules, technical state transitions, UI/audio/art feedback, content flow, asset slots, acceptance criteria and delivery-contract sourceRefs in one complete pass. Missing or non-JSON terminal output is a failed review attempt.',
    '- Review may use multiple repair passes because a genuine contradiction can remain after one edit, but it must converge. Run exactly one reviewer for each distinct document revision, resolve the complete blocking issue set, and revise the documents before another pass. Never re-run an unchanged bundle, launch duplicate reviewers, manually poll a native background reviewer, or silently keep rewriting the same structured claim. Claude Code will deliver native task completion notifications. If an issue repeats unchanged after its claimed resolution, or authoritative inputs remain materially ambiguous, stop with that explicit blocker or ask the user; do not create an unbounded review loop.',
    '- A later review pass may report a newly exposed contradiction, but it must identify the exact structured sources and explain why the prior complete pass could not expose it. Advisory observations do not block implementation. Only unresolved blocking contradictions in the approved MVP contract prevent planning.',
    '- Resolve reviewer findings toward the already approved MVP boundary. Content introduced only by a secondary document is scope leakage unless it is traced to an approved MVP statement; move it to roadmap or remove it instead of automatically adding new MVP requirements, player paths and assets.',
    '- Map every normative MVP statement to docs/delivery-contract.json and every runtime MVP requirement to at least one complete player path. acceptanceCriteria must use stable ids, exact locators from docs/specs/ACCEPTANCE_CRITERIA.md, and explicit requirementIds/playerPathIds; every MVP requirement and player path must be covered.',
    '- Every delivery-contract sourceRef locator must be copied verbatim from the referenced document and identify the normative statement or section; do not normalize punctuation, numbering or headings.',
    `- Invoke the writing-plans skill through Claude Code's native Skill tool and persist exactly one implementation plan under ${GAME_PRODUCTION_PLAN_DIRECTORY}. Also persist its machine-readable requirement-to-evidence index at ${GAME_PRODUCTION_PLAN_INDEX_PATH}. If writing-plans is unavailable, report a material blocker instead of simulating the skill.`,
    '- The plan index schema is: {"version":1,"planPath":"project-relative markdown plan path","tasks":[{"id":"stable task id","requirementIds":["existing delivery requirement id"],"playerPathIds":["existing player path id"],"files":["project-relative path"],"assetSlotIds":[],"preconditions":[{"description":"..."}],"actions":[{"description":"..."}],"assertions":[{"description":"..."}],"check":{"command":"project-native focused command","evidenceKinds":["implementation|build|test|runtime|asset|skill|document"],"assertions":[{"description":"observable expected result"}]}}]}. evidenceKinds declares what the command actually observes; build must never be declared as runtime. Supporting tasks may have no playerPathIds, but the first task must produce the smallest playable vertical slice and reference at least one complete player path. Across all tasks, every MVP requirement and player path must be covered, every MVP requirement must have checks for all evidenceRequired kinds, and every player path must have a runtime-evidence check.',
    '- Keep the plan concise: do not embed complete source files or large implementation listings. The plan is an executable requirement-to-evidence index, not a speculative code dump.',
    '- Every plan task must deliver one observable behavior or one cohesive supporting capability. The machine-readable plan index must map its stable task id to existing requirement ids and player-path ids, exact project-relative files and asset dependencies, structured preconditions/actions/observable assertions, and a focused project-native check. Vague tasks such as “implement the game” or “verify in browser” without concrete actions and assertions are invalid.',
    '- Plan and verify the smallest playable vertical slice first, then integration, complete player paths, failure/recovery, packaging and quality work.',
    '- After writing the plan, invoke either executing-plans or subagent-driven-development through the native Skill tool. Read the saved plan back before code or asset mutation and execute it task by task. After each task, run its focused check and record the observed evidence before marking that task complete.',
    '- The persisted plan is the sole implementation progress source. TodoWrite may mirror stable plan task ids but must never replace, shorten or independently redefine the plan. File existence is not evidence that a task is complete.',
    '- After resume or compaction, recover by reading docs/delivery-contract.json, the one persisted implementation plan, and its unfinished tasks before any further implementation action. Do not reconstruct progress by scanning which source files happen to exist, and do not read BeeGame runtime transcripts to guess prior intent.',
    '- Do not assume or hardcode a platform, engine, framework, asset format or runtime adapter. Derive all project-native choices from the confirmed brief and production documents.',
    '- Before claiming completion, invoke verification-before-completion, run project-native build/tests and every observable player path, then invoke the native beegame-acceptance-validator with only the workspace and delivery-contract path. Let Claude Code manage its native foreground/background lifecycle and consume its terminal result from the Agent result or native completion notification; never poll TaskOutput. Do not provide implementation claims, feature summaries or claimed build outcomes to the validator.',
    '- A missing, empty, truncated or non-JSON validator result is a failed validation attempt, not completion. Continue the same validator when possible or invoke a fresh validator, repair every failed finding, and revalidate. Build success alone is not playability evidence.',
    '- Completion requires a valid delivery contract, a valid canonical asset manifest when present, completed plan evidence, passing project-native checks, runtime evidence for every declared MVP player path, and a passed validator JSON result. Persist that exact terminal JSON unchanged to docs/validation-report.json and render docs/validation-report.md from it. The JSON is the machine-readable source; never replace validator evidence with the implementation agent\'s own summary.',
  ].join('\n')
}

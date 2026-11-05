# GDD chapter checks

Select only chapters relevant to the current document or integration question. The headings below label professional topics within the single `docs/GDD.md`; apply them to equivalent chapters without requiring new files. These are review questions, not document templates, mandatory game features or ownership definitions. Use the current responsibility prompt to determine who resolves a finding.

## Vision, gameplay and scope chapter

- Can the player understand the goal, legal actions, constraints and consequences? Does the core loop connect starting play, progress, success/failure and the applicable retry or exit?
- Are required first-release content, optional additions and exclusions distinguishable? Are completion conditions observable rather than system names?
- Are the relevant gameplay states, transition conditions and outcome precedence coherent at boundaries or simultaneous events? Are mandatory player information and feedback needs identified without assuming a particular presentation?
- Can downstream authors distinguish established rules from tunable parameters? Would a proposed zero, extreme or delayed value introduce or remove a stage or change the agreed result?

## Technical design chapter

- Do runtime choices meet the confirmed platform and actual authored needs? Are hard constraints distinguished from selected solutions and unverified performance assumptions?
- Does the chosen technical approach support the agreed gameplay, inputs and state changes? Distinguish necessary product decisions from file organization, APIs and execution details to resolve during implementation.
- Where required by the assignment, do initialization, interruption, restart, cleanup, loading failure and recovery support the specified behavior? For persistence, are saved data, lifetime, reset and failure behavior traceable to product requirements rather than inferred from the chosen storage?
- Are confirmed constraints distinguished from unresolved resource dependencies? Record required logical relationships; exact production metrics and bindings depend on actual assets unless an agreed behavior already relies on them.
- If technical implementation planning is assigned, does that plan cover required outcomes, prerequisites and source-backed checks while referencing the owning gameplay and presentation decisions? A GDD-only assignment does not require a file/function plan or test specification.

## Art direction chapter

- Does the direction establish the planned experience's composition, shape/material language, palette, typography and motion character, rather than only style adjectives or isolated assets? Can planned screen and control families use its shared visual treatments for their applicable states without inventing necessary appearance decisions? Do not require absent screens or decorative resources, or a separate specification for every control.
- Are essential subjects and state changes distinguishable at their intended scale, including without color alone? Are focal hierarchy, visual density and world/interface coherence preserved?
- Where a visual reference is supplied, do its composition, emphasis and treatment agree with the prose, with its provisional fonts/assets and illustrated scope clear? A file's existence or source markup alone does not establish appearance. Concrete missing direction or reference/prose contradictions need closure; an equally valid aesthetic preference is not a blocker or grounds for unlimited polishing. No user taste approval is required.
- Are layering direction, numeric conventions, transparency and intended occlusion compatible with required visibility? Do diagrams, tables and prose describe the same composition?
- Do feedback and motion express the actual action and outcome, with coherent affected subjects, meaningful timing and interruption/reset behavior? Preserve essential information under relevant accessibility settings. Exact frames and effect construction belong to production unless the rule depends on them.

## Audio chapter

- Does the sound identity fit the experience, and does each required cue have an actual trigger and clear player meaning? Distinguish attempted actions from confirmed outcomes and keep essential information available without hearing.
- Are consequential overlap, priority and interruption/retry behaviors coherent with the gameplay states? Define the audible result the game needs; detailed bus routing, voice limits and measured mix levels depend on actual production. If the GDD already relies on a concurrency or timing claim, check that claim against the stated rules.
- Do spatial sound and mute/volume choices agree with the designed space, inputs and lifecycle? Keep unavailable acoustic or mix measurements distinct from initial choices.

## Level and scene chapter

- Can each planned level or reusable type be constructed from its regions, connections, routes, starts, goals, obstacles and interactions? Are suggested routes distinguishable from enforced progression?
- Do coordinates, units, scale, camera/framing, world extent and display extent agree? Do visibility, permitted overlays and the supported container conditions work together with the UI design?
- Is the objective reachable under the actual rules and geometry? For procedural designs, are connectivity, spawning and achievable goals constrained rather than merely called random?
- Are consequential placement, visibility or pacing claims consistent with the stated geometry and rules? If a concrete feasibility uncertainty matters now, is there enough source or minimal calculation evidence to resolve it? Planned geometry is not observed runtime evidence.

## Systems and balance chapter

- Do necessary initial parameters have clear meanings, units and values, with bounds where they affect the rules? Distinguish selected tuning from requirements and runtime observations; incidental numbers need no range table.
- Do formulas follow the actual rules and geometry, including counting meanings, ratio bases and relevant zero/extreme boundaries? Do tuning choices preserve the established rules?
- Are necessary numerical decisions clear, with important derived claims supported proportionally? If a calculation was used, compare the claimed quantity, time boundary and action policy with what it actually computes. Distinguish requested actions, constrained execution and observed outcomes; initial tuning choices do not require a simulator.
- Do representative situations support the stated conclusion without being enlarged into universal safety, completion-time or game-feel claims? Are playtesting hypotheses separate from demonstrated results?

## UI/UX chapter

- Does each planned screen/state or genuinely shared composition define its entry/exit, information sources, actions and outcomes? Are relevant default, disabled, repeated, cancelled, error and recovery interactions coherent? Can the UI's actual control states be traced to applicable shared visual treatments or explicit differences, including coexisting cues? A list of state names or an art-document citation does not establish that connection; identify the missing treatment and downstream impact in the existing finding format.
- Are confirmed input methods, navigation and focus behavior usable? Compare focused-control activation with gameplay shortcuts in the same situation, including switching input methods. Follow relevant transition branches through to the actual destination's focus and input availability; do not infer them from a shared trigger name. Are acknowledgment, action effect, visual completion and state-entry cleanup compatible where their timing matters?
- Does the proposed composition keep gameplay, information and actions usable across the supported orientations and display conditions, including relevant overlays and insufficient space? Keep interruption, input and simulation behavior coherent. Any claimed size or fit must follow from its stated inputs; actual font metrics and projected control measurements belong to implementation.
- Are text/value variants, typography hierarchy and relevant overflow choices defined without claiming that unproduced fonts already fit? Do the UI's shape, palette, state cues and motion agree with the art direction, preserving required reduced-motion and silent-play meanings?
- Do the owner-linked UI data and any supplied references agree with the art direction and UI clauses? Are material differences legitimate composition choices rather than a different visual language? Do other planned screens/control states inherit usable treatments? Inspect actual saved inputs; a reference image does not establish layout calculation or runtime usability.

## Resources and content chapter

- Does every required resource have an actual design use, and does every required visual/audio role have a resource or explicitly designed procedural treatment? Check state variants, shared uses and independently addressable parts, not only item counts.
- Are resource representations and independently controlled parts sufficient for their designed use, including consequential transparency, layering, animation or looping needs? Initial design needs logical relationships and production constraints; exact pixel sizes, frame lists and bindings depend on actual selected or produced parts unless an agreed behavior already requires them.
- Do sourcing and fallback choices preserve the designed appearance, structure and behavior? Are origin/licensing needs identified without claiming undelivered files have been inspected or rights verified?
- Are actual text/value variants and font requirements available for resource production? Glyph inventories, delivered font fit, asset measurements and runtime rendering remain production/implementation checks; a GDD does not need to manufacture those outputs.
- Are retained assets, later content bindings and runtime behavior distinguished? A resource list must not silently substitute a new layout, state rule or implementation design.

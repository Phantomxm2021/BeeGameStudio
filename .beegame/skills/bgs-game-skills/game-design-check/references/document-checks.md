# Document-specific checks

Select only sections relevant to the current document or integration question. Filenames below label professional topics; apply them to equivalent sections in merged records without requiring new files. These are review questions, not document templates, mandatory game features or ownership definitions. Use the current responsibility prompt to determine who resolves a finding.

## GDD.md

- Can the player understand the goal, legal actions, constraints and consequences? Does the core loop connect starting play, progress, success/failure and the applicable retry or exit?
- Are required first-release content, optional additions and exclusions distinguishable? Are completion conditions observable rather than system names?
- Are the relevant gameplay states, transition conditions and outcome precedence coherent at boundaries or simultaneous events? Are mandatory player information and feedback needs identified without assuming a particular presentation?
- Can downstream authors distinguish established rules from tunable parameters? Would a proposed zero, extreme or delayed value introduce or remove a stage or change the agreed result?

## TECHNICAL_DESIGN.md

- Do runtime choices meet the confirmed platform and actual authored needs? Are hard constraints distinguished from selected solutions and unverified performance assumptions?
- At the current stage, is there an executable path from authored data and actual event/state producers to their consumers? Are data loading, binding, coordinate conversion and relevant ordering explained without replacing the designs?
- Where required by the assignment, do initialization, interruption, restart, cleanup, loading failure and recovery support the specified behavior? For persistence, are saved data, lifetime, reset and failure behavior traceable to product requirements rather than inferred from the chosen storage?
- Is the technical document, including interfaces and implementation/verification guidance, complete in the eight-document stage? Are unproduced inputs identified as planned rather than used to postpone technical design? Do later production changes revise only affected parts of the same plan from actual outputs?
- Does implementation guidance cover required outcomes, inputs, prerequisites and source-backed checks? Compare it with the original brief and professional decisions. Check that technical interfaces consume specialist rules rather than republishing tuning, geometry or sound tables. Preserve a real integration check without turning every task into the entire game.

## ART_DIRECTION.md

- Does the direction establish the planned experience's composition, shape/material language, palette, typography and motion character, rather than only style adjectives or isolated assets? Can planned screen and control families use its shared visual treatments for their applicable states without inventing necessary appearance decisions? Do not require absent screens or decorative resources, or a separate specification for every control.
- Are essential subjects and state changes distinguishable at their intended scale, including without color alone? Are focal hierarchy, visual density and world/interface coherence preserved?
- Where a visual reference is supplied, do its composition, emphasis and treatment agree with the prose, with its provisional fonts/assets and illustrated scope clear? A file's existence or source markup alone does not establish appearance. Concrete missing direction or reference/prose contradictions need closure; an equally valid aesthetic preference is not a blocker or grounds for unlimited polishing. No user taste approval is required.
- Are layering direction, numeric conventions, transparency and intended occlusion compatible with required visibility? Do diagrams, tables and prose describe the same composition?
- Do feedback and motion distinguish input acknowledgment, attempted action and actual outcome, including a constrained or unavailable action? Are their affected subjects, starting/ending appearances and consequential sequencing compatible with the delivered state changes and relevant interruption/reset? Do they preserve essential information under relevant accessibility settings and avoid inventing unavailable spatial or gameplay facts?

## AUDIO_DESIGN.md

- Is each required category grounded in an actual event or state and an intended player meaning? Are trigger, repeat, duration, looping, priority, concurrency and relative levels sufficient to describe audible behavior?
- Is the mapping defined across relevant source states and concurrent sources, including when one source leaves while others remain and when the last source leaves? Are attempted actions distinguished from actual outcomes?
- Across relevant scene, pause, result, retry/exit and focus changes, do event-specific, mix and lifetime policies imply one audible result? Distinguish continuing, ducking, fading, suspending and stopping where those behaviors exist, including applicable repeat/interruption and restoration.
- Are event categories, bus membership and control scope unambiguous? Shared or nested routing needs an explicit relationship, not overlapping event ranges whose meaning the implementer must choose.
- Are spatial claims grounded in delivered geometry/framing? Are mute/volume requirements and persistence lifetime clear, with essential information available without hearing? Do conditional branches rely on permitted source rules rather than an assumed future change?

## LEVEL_SCENE_DESIGN.md

- Can each planned level or reusable type be constructed from its regions, connections, routes, starts, goals, obstacles and interactions? Are suggested routes distinguishable from enforced progression?
- Do coordinates, units, scale, camera/framing, world extent and display extent agree? Do visibility, permitted overlays and the supported container conditions work together with the UI design?
- When the assignment supplies linked Scene JSON, do its actual hierarchy, placement, logical visual bounds, collision and Camera match the prose? Check the same Scene in the resolved UI game-view for supported 2D required visibility, not a standalone camera or guessed full window. Resource-dependent geometry, procedural traversal and 3D/XR visibility need their actual evidence and scope; valid syntax is not proof of playability.
- Is the objective reachable under the actual rules and geometry? For procedural designs, are connectivity, spawning and achievable goals constrained rather than merely called random?
- Are consequential placement, visibility or pacing claims consistent with the stated geometry and rules? If a concrete feasibility uncertainty matters now, is there enough source or minimal calculation evidence to resolve it? Planned geometry is not observed runtime evidence.

## BALANCE_DESIGN.md

- Do parameters have clear meanings, units, source values and permitted ranges? Are release configuration, reachable runtime state and tuning alternatives distinguishable?
- Do formulas follow the actual rules and geometry, including counting meanings, ratio bases and relevant zero/extreme boundaries? Do tuning choices preserve the established rules?
- Are necessary numerical decisions clear, with important derived claims supported proportionally? If a calculation was used, compare the claimed quantity, time boundary and action policy with what it actually computes. Distinguish requested actions, constrained execution and observed outcomes; initial tuning choices do not require a simulator.
- Do representative situations support the stated conclusion without being enlarged into universal safety, completion-time or game-feel claims? Are playtesting hypotheses separate from demonstrated results?

## UI_UX_SPEC.md

- Does each planned screen/state or genuinely shared composition define its entry/exit, information sources, actions and outcomes? Are relevant default, disabled, repeated, cancelled, error and recovery interactions coherent? Can the UI's actual control states be traced to applicable shared visual treatments or explicit differences, including coexisting cues? A list of state names or an art-document citation does not establish that connection; identify the missing treatment and downstream impact in the existing finding format.
- Are confirmed input methods, navigation and focus behavior usable? Compare focused-control activation with gameplay shortcuts in the same situation, including switching input methods. Follow relevant transition branches through to the actual destination's focus and input availability; do not infer them from a shared trigger name. Are acknowledgment, action effect, visual completion and state-entry cleanup compatible where their timing matters?
- Do hierarchy, layout constraints, adaptation and insufficient-space behavior account for the combined game view, HUD, overlays and controls? Distinguish outer viewport, usable area and final projected control size. Compare any space-budget claim with the same variant's actual padding, gaps, sizing limits and scaling clauses. Are orientation, visibility and overlay agreements respected? Trace each interruption/overlay condition to its intended input, simulation and clock behavior and the owning execution design; hidden elements must not be assumed non-interactive. Check whether cited platform evidence covers that exact condition instead of inferring automatic behavior from a different lifecycle condition.
- Are text limits, readable typography and expansion risks addressed, with an executable handling choice when variable text exceeds available space? Compare the UI's focal hierarchy, shape/palette/typography choices, state cues and motion sequence with the applicable art clauses, including global priorities and screen-specific exceptions; a citation alone is not agreement. Are relevant reduced-motion/silent-play meanings preserved without claiming font fit or rendered quality has already been tested?
- Do the owner-linked UI data and any supplied references agree with the art direction and UI clauses? Are material differences legitimate composition choices rather than a different visual language? Do other planned screens/control states inherit usable treatments? Inspect actual saved inputs; a reference image does not establish layout calculation or runtime usability.

## ASSET_PLAN.md

- Does every required resource have an actual design use, and does every required visual/audio role have a resource or explicitly designed procedural treatment? Check state variants, shared uses and independently addressable parts, not only item counts.
- Are production and loading requirements sufficient for the intended use: relevant size/scale, transparency, layers, frames, pivots, tiling, looping and group lifetime?
- Do sourcing and fallback choices preserve the designed appearance, structure and behavior? Are origin/licensing needs identified without claiming undelivered files have been inspected or rights verified?
- Are computed inventories such as font glyph subsets derived from actual text and runtime variants, rather than relying on a manually copied list? Geometry passing before bindings does not establish real-font fit or rendered appearance; those checks remain due against the produced resources.
- Are retained assets, later content bindings and runtime behavior distinguished? A resource list must not silently substitute a new layout, state rule or implementation design.

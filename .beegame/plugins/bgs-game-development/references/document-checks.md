# Targeted design questions

Use the section that answers the current design uncertainty, with the confirmed requirements and relevant saved clauses. These are reasoning aids, not required GDD chapters or a cross-discipline completion checklist.

## Requirement preservation

- Compare the required actions, content and explicit constraints with their design decisions. Read applicable tables and examples as well as prose; distinguish an author proposal from a user requirement.
- If a decision is deferred, determine whether the current handoff actually needs it. File organization, asset measurements and provisional tuning need not be settled to describe the required game.

## Source-backed rule contradictions

- Identify the same player situation in each relevant clause, including local conditions, exceptions and outcome precedence. Different terms or values do not establish a conflict when they apply to different situations.
- Preserve the stated meaning of quantities: requested input, legal execution, simulation time and displayed feedback can differ. Report incompatible meanings or conclusions in the actual design, rather than inventing extreme configurations to produce a failure.
- Where the rules already depend on a spatial or numerical claim, compare it with the stated movement, geometry and counting assumptions. Leave ordinary tuning open; a design review does not establish optimal balance or player enjoyment.
- For an explicit visual, audio or control constraint, report a conflicting source decision that defeats required appearance, information or behavior. Production details need not be invented to complete the review.

## Player-flow closure

- Trace the required action from its available input and conditions to its state change and player-visible result. A list of screen names alone does not determine the transitions between them.
- Where the design includes success, failure, retry, pause or another interruption, follow its actual entry and return conditions. Inspect relevant simultaneous outcomes when they could produce contradictory next states.
- Compare UI actions and gameplay inputs only where they coexist or share a transition. Follow the destination's actual input availability; a common trigger name does not guarantee the same result.
- Identify a missing product decision when the required next action or outcome is undetermined. Do not treat an unbuilt runtime, unmeasured font or unproduced resource as a missing GDD decision.

# Game UI type and copy

Use when establishing or repairing an interface's reading hierarchy and voice. A binding fix does not require a new type system. Work within the chosen art direction, actual language, screen size and player task.

## Choose treatments by information role

| Role | Useful treatment and reason | Competing choice to examine |
| --- | --- | --- |
| Title or major outcome | A characteristic face, proportion or weight can carry identity when the player has time to look | Applying that treatment to every label makes all text equally emphatic |
| Decision-critical HUD value | Stable placement and readily distinguishable numerals support repeated glances; tabular figures can prevent changing counts from shifting when the selected font supports them | Decorative narrow figures, changing width or a long count tween can obscure the current value |
| Control/action label | A readable, consistent treatment belongs to its control family; distinguish primary action through grouping and emphasis, not only size | Several enormous buttons compete, or text styling hides focus/disabled distinctions |
| Supporting explanation | Tune measure, line spacing and grouping to the actual face, language and available reading time | Tiny low-contrast text technically fits but cannot explain a failure during play |

Use size, weight, space and contrast together. Related labels/values need a stronger grouping relationship than unrelated regions; equal gaps everywhere can erase that relationship. Inspect visible shapes as well as rectangles: an icon's transparent bounds or a title's asymmetric glyphs can make mathematically centered content look displaced. Correct the visual child or resource where appropriate without changing hit geometry or defeating the layout constraints. No fixed type ratio, Latin character count or web body size governs every game.

For mixed Chinese/Latin text, inspect actual glyphs, baselines, punctuation, numeral widths and weight differences under the delivered font stack. A declared family may supply only Latin characters. Compare the fallback at the intended size; do not assume nominally equal font size means equal apparent weight. Keep necessary language coverage and content instead of shrinking everything or substituting an unapproved language.

## Write the consequence, not the implementation

Follow the player's whole path. A control label and its resulting message should describe the same action. Preserve established game terms; synonyms for the same object can look like different mechanics.

Consider an original hypothetical puzzle with pausing, restarting the current board and continuing to the next board already in scope. "Continue" on both the pause menu and results is ambiguous unless context makes each destination clear; "Resume", "Retry this board" and "Next board" can distinguish them. If retry loses current progress, disclose that consequence where the decision needs it. These are examples of meaning, not required screens, English copy or a universal confirmation dialog.

For a failed action, explain the relevant fact and available recovery: "Requires a connected power source" can guide a repair better than "Invalid action" when that cause is actually known. Do not expose an internal validation code as the main message or invent a cause. For success, confirm the outcome without repeating it in a title, subtitle and toast. Voice can be playful while consequences remain clear; urgent failure and routine success need not use the same tone.

Carry roles, terminology and meaningful exceptions into the existing UI/art source, then inspect actual text in context, including applicable long values and fallback. Font measurements can reveal overflow, not judge personality or comprehension. New locales, a terminology database and another review stage are not implied.

Method sources: Impeccable's [typeset](https://github.com/pbakaus/impeccable/blob/main/skill/reference/typeset.md) and [clarify](https://github.com/pbakaus/impeccable/blob/main/skill/reference/clarify.md) separate text roles, visual hierarchy and action meaning. Adapt those relationships to games; do not adopt its fixed web measures, command workflow or all-state checklist as universal requirements.

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

## Localize the player-facing expression

Keep simulation states, scene/resource identities and saved gameplay data separate from displayed wording. Resolve complete messages through the current project's engine-native message IDs or source-text/context facilities. Distinct meanings may need different messages even when one language shares the same word. Translate the actual game name or instruction where appropriate, not a technical role such as `title`; preserve intentionally fixed names. Retain placeholders and use the supported message/plural rules rather than concatenating fragments or choosing grammar with one universal singular/plural test. Web `Intl` formats numbers and selects plural categories; it does not translate complete sentences.

Keep an available saved player choice; otherwise match supported device language/script/region, then use the project's base language. Preserve explicitly required languages beyond a default pair. Do not derive a supported-language list from the authoring interface or silently collapse Simplified and Traditional Chinese. Missing messages use the established base copy while exposing the missing entry to development; a fallback is not a completed translation, and a raw internal key is not final copy. Use the existing settings/storage boundary: if persistent storage is unavailable, keep the session choice without claiming it will survive a reload.

For a language change, retain game progress, input/state identities and current values while updating the visible messages and language-dependent font/resource bindings. Use the current interface lifecycle; let required assets become usable before replacing the current presentation, and retain it on loading failure. Reflow from actual translated strings and font metrics at the same supported viewports, preserving essential play visibility and action targets. Where required, use the target's supported shaping and bidirectional layout; reversing a string or mirroring the whole game is not text layout. Web DOM text also carries the appropriate language/direction metadata; Canvas and native text use their actual renderer's facilities.

Observe the affected opening, dynamic messages and relevant pause/result passages in supported languages, including a real language change. Missing-key/placeholder checks establish structure, not translation quality, glyph rendering or the final layout. The implementation author performs the necessary checks within the assignment; use existing runtime evidence and disclose unobserved language quality rather than add another acceptance stage.

Method sources: [Godot localization](https://docs.godotengine.org/en/stable/tutorials/i18n/localization_using_gettext.html) demonstrates context and plural messages; [Intl.PluralRules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules) describes language-dependent categories; [HTML direction](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir) concerns text direction, not gameplay mirroring. Use the chosen engine's installed capabilities, not a mandatory Web library or JSON schema.

Carry roles, terminology and meaningful exceptions into the existing UI/art source, then inspect actual text in context, including applicable long values and fallback. Font measurements can reveal overflow, not judge personality or comprehension. Additional locales beyond the agreed language scope, a terminology database and another review stage are not implied.

Method sources: Impeccable's [typeset](https://github.com/pbakaus/impeccable/blob/main/skill/reference/typeset.md) and [clarify](https://github.com/pbakaus/impeccable/blob/main/skill/reference/clarify.md) separate text roles, visual hierarchy and action meaning. Adapt those relationships to games; do not adopt its fixed web measures, command workflow or all-state checklist as universal requirements.

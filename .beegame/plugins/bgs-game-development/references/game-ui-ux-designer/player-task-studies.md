# Organize game interfaces around player tasks

Use for an unresolved information, navigation or action relationship in a new interface or a focused repair. Read the relevant situation and source rather than applying every row or case. Existing rules, devices and adopted art remain the basis; the choices belong in the existing UI/design source.

## Organize information and actions

Ask what the player is deciding now, how much attention/time the action allows, and which facts need to be seen together. That determines the allocation before choosing a panel, HUD, map, list or world-space treatment. One surface can support several tasks.

| Player task | Information and action relationship to construct | Tradeoff to resolve |
| --- | --- | --- |
| Read while acting | Keep decision-critical state available for brief glances; show an immediate event near its meaningful subject when useful, then retain the resulting state | Persistent HUD, local marks and contextual cues compete differently with the action. Too little context can hide a threat; repeating everything creates competing signals |
| Inspect or operate one subject | Retain the selected subject's identity and relevant context while exposing its current state, available action and consequence | A world-attached control can clarify ownership but be occluded or too small; a stable detail view can aid reading but separate the action from its subject |
| Compare or organize alternatives | Keep candidate, baseline and decision-relevant attributes visible together; expose differences without losing item identity, selection or collection position | Side-by-side detail, aligned fields, filtering or a compact summary can serve different amounts of information. A summary can hide a decisive property; repeated opening and closing forces memory-based comparison |
| Plan then commit a spatial action | Keep the board/map and affected subjects connected to range, cost, targets or queued intent; distinguish a provisional choice from the confirmed consequence | A preview must follow the real rules. Dense overlays can obscure terrain, while separate lists can conceal spatial relationships. Cancel/edit/commit follow the actions the game actually offers |
| Navigate, return or recover | Retain useful category, selection and scroll/focus context; make the next legal action and return destination understandable | A quick repeated task needs a shorter path than a rare consequential commitment. Error feedback should preserve usable work instead of unnecessarily restarting the whole interaction |

Browsing, selecting and activating are distinct actions even when they share a control. On the chosen device, provide a usable path to the selected item and its actions; pointer hover alone cannot serve touch or focused navigation. For a drag operation, keep the source, destination and accepted/rejected result understandable, including cancellation. Device-to-action mapping uses the existing [interaction guidance](../../skills/game-feel-designer/SKILL.md); the UI owns how selection and the result are communicated.

When a task opens or closes a surface, carry the chosen subject/context into the existing [motion and input handoff](motion-language.md#input-and-state-lifecycle). A new arrangement does not require a new transition system. Compare relevant actual text/values and the affected action passage with that decision; source pictures and designer accounts support an application hypothesis, not proof of comprehension or runtime behavior.

## Concrete task studies

### Read during combat: Hades

Use the [shared published combat picture](../game-art-director-expert/ui-visual-hierarchy.md#hades-dense-painting-combat-emphasis-and-distributed-hud), sourced from the [developer/publisher gallery](https://store.steampowered.com/app/1145360/Hades/). Its early-version image shows a boss bar, ability icons and player health at different scales around the exposed fight, while a bright attack shape emphasizes a local event. This separates sustained state from immediate consequence. Apply that relationship to the current game's actual glance decisions; copying those positions or adding the same readouts would not establish a useful HUD. The still does not establish response timing or player comprehension.

### Choose equipment: Diablo III

Blizzard's [item-comparison development account](https://news.blizzard.com/en-gb/article/20120910/diablo-then-now-item-comparison-evolution) describes reducing equipment-review interruption, comparison tooltips and a quick-equip path. It also explains how overly generalized stat summaries became misleading and were revised. For a comparison task, keep the candidate and relevant baseline available together, with a summary that does not conceal the deciding property. The UI presents the game's actual calculations; this example does not authorize new stat formulas, a quick-equip feature or declaring one item universally better. This is a developer account, not a new observation of live interaction.

### Plan a turn: Into the Breach

Matthew Davis's [GDC design postmortem](https://media.gdcvault.com/gdc2019/presentations/Into%20the%20Breach%20Postmortem%20Final.pdf#page=14), especially slides 14 and 27–35, relates disclosed enemy attacks to the problem of showing each target and attack type on the board. The useful UI relationship is threat → affected place/subject → available counteraction, so the player can reason before committing. Preserve that spatial relationship when using a preview or contextual detail instead of replacing it with disconnected text. Their project-specific mechanical constraints are not requirements for another game; an assigned UI change preserves its existing rules. This source does not validate the current game's preview or difficulty.

### Act in the world, then organize items: Minecraft

The official [controls guide](https://www.minecraft.net/en-us/article/minecraft-controls) distinguishes targeting a world object and using the selected hotbar item from opening the inventory, moving items and returning to the main view. The useful separation is between acting on a visible subject and manipulating a collection; each retains different context. Apply it by keeping selected tool/subject identity meaningful during world action and preserving useful collection context when returning from item work. A separate menu is not necessary for every world action. The guide covers different devices; borrow the relationship, not a universal button binding, inventory grid or pixel-art treatment.

## General task and transition studies

[Nintendo's UI/UX role](https://www.nintendo.co.jp/jobs/introduction/design/work03.html) discusses mediating play through pictures/text; the [Zelda UI interview](https://www.nintendo.co.jp/jobs/keyword/150.html) examines necessary emphasis and delight; the [Switch OS CEDEC summary](https://nintendowire.com/news/2018/08/22/nintendo-talks-about-the-design-of-the-switchs-os-at-cedec-2018/) is secondary reporting about responsive transitions and fewer actions. Reuse these for the corresponding question, not as a Nintendo visual preset, universal timing rule or requirement to add another screen/review stage.

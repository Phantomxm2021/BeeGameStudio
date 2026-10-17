---
name: game-ui-ux-designer
description: Design or repair non-XR game HUDs, menus, interface feedback and motion, navigation, gamepad focus, and input accessibility. For XR interfaces, use spatial UX. 中文：游戏界面、血条、菜单、界面切换与动效、手柄焦点、触屏布局。
---

# Game UI/UX Designer

Make the player's next action and the game's current state clear without obscuring play. Work from the actual game loop, target devices, input methods, and existing UI vocabulary; do not invent screens or controls merely to fill a template.

For a narrow fix, investigate and verify the affected behavior without restyling unrelated screens. Preserve agreed language, scaling and accessibility scope; public guidelines or examples do not automatically add new locales, settings or platform targets. Do not mandate a UI framework or duplicate the art direction's palette rules.

- Map entry, play, pause, failure, recovery and completion as relevant. For a complete interface, cover every planned screen/state, its actions, navigation and information sources; a representative sample does not replace that scope.
- Choose persistent, contextual and urgent HUD information from the player's current decisions. Distinguish world-space from screen-space placement and establish which cue wins under competition. Combat glanceability and management comparison can justify different density.
- Translate art direction into focal subject, primary action, supporting information and quiet space. For an initial composition or substantial rework, read the shared [composition studies](../game-art-director-expert/references/ui-visual-hierarchy.md). Preserve the selected relationships, not just palette; menus, HUDs and results need not share a generic card layout.
- Define observable shared treatments for applicable control states, including coexisting cues, then describe local differences. State names or component reuse alone do not define appearance or screen placement. Identify missing treatment by the affected control rather than inventing another report.
- Specify the inputs in scope, focus/navigation, switching input methods and focused-control versus gameplay-shortcut precedence. Derive prompts from actual bindings/remapping. Hidden elements are not necessarily disabled; reconcile overlays with gameplay control, camera input and pointer-lock where relevant.
- Keep frequently used menus quick to revisit. Restore meaningful selection/scroll position or a valid replacement if its target disappeared; do not replay long introductions on each pause/retry. Apply inventory, map and dialogue methods only where those features exist.
- Preserve authored identities, hierarchy, text/images, states and bindings in the runtime. Read values and availability from authoritative game state; cosmetic tweens cannot announce readiness or success early. A painted shape is not an interactive button or referenced image.
- Check actual-size legibility, contrast, distinguishable status and applicable remapping/accessibility. Disabled, pending and error states need understandable responses without sacrificing the chosen visual language.

For a new reading hierarchy or unclear interface language, use [type and copy choices](references/type-and-copy.md): text roles, optical grouping, mixed-script treatment and action consequences. These choices complement font measurements; they do not require restyling a resolved interface.

## Layout and supported conditions

Establish how game view, information and controls share space before placing children: hierarchy, arrangement, size/spacing limits, safe areas, overlays and insufficient-space behavior. Encode editable relationships in the project's layout source, not screenshot-derived coordinates or per-viewport tables. A currently empty world area is not permanently safe for an overlay.

Choose orientations and usable sizes from requirements, not input-device assumptions. Use the same variant's padding, gaps, minima and scaling in its budget; verify control minima after projection. Shared layouts supply relationships once, while each screen supplies content and meaningful differences. Specify behavior outside supported conditions.

For a new interface, first describe screens, actions, navigation and space needs in the existing UI record. Work with art direction on actual complete-screen visual designs, inspect the pictures at useful size and link the selected designs. After corresponding resources are prepared, author the UI layout and resource/action/state bindings from those designs and actual asset metrics; do not start with UI JSON or a placeholder layout. For saved BGS UI data, use CheckUiLayouts to read effective variants and spatial observations; detailsFor also shows container constraints and which container controls positions. Apply the intended relationships with native Edit and recheck, letting the existing engine calculate flow positions. Read [layout calculation](references/layout-calculation.md) for its calls, schema and font measurement. Reuse the existing solver and the same authored UI/game-view for camera framing. Geometry does not choose composition or interaction. Existing sources are repaired in place; native engine/DOM layouts use their applicable facilities.

## State feedback and motion

Design motion around what the player needs to notice or understand: acknowledgment of input, a change of context, continuity of an object, or the importance of an outcome. Separate immediate control feedback from page entry/exit and ongoing status animation. A static treatment can convey feedback; not every control needs an animation.

For transition/state-feedback design, implementation or review, read the applicable [state, interruption and reduced-motion guidance](references/motion-language.md#state-meaning-interruption-and-accessibility). Its material/curve examples apply when choosing a treatment, not every binding repair. Distinguish acknowledgment, execution and confirmed outcome; preserve destination focus/input, cancellation and recovery. Motion must not redefine simulation facts or make essential information depend on animation completion, color or displacement alone.

## Resource measurements and verification

Keep geometry, legal text/value ranges and typography constraints traceable. Use actual font weights/glyph coverage and image proportions, pivots/cropping or frames; disclose provisional metrics and later checks. An existing asset or smallest critical sample can resolve uncertain metrics without a full asset batch. Choose overflow/formatting behavior for variable text; after binding, measure real fonts and inspect images. A necessary geometry/type change is a design correction, not merely binding or permission to shrink text/remove content.

When runnable, inspect actual Scene/UI at supported sizes and inputs: wrapping, overlap, clipping, hierarchy, useful world visibility, focus, actions and motion. Observe the agreed screens/states, not only one sample. Geometry, DOM presence, clicks or editor appearance do not establish visual quality; stills do not demonstrate motion or interaction. Design-time accommodation is not runtime verification, and unavailable observations remain unverified.

Correct the owning source within scope; do not rewrite valid UI to hide a consumer defect. Reuse current measurements/reports before rerunning unchanged checks. For measured expensive UI updates or effects, use the relevant [runtime cost tradeoffs](../game-technical-artist/references/runtime-cost-tradeoffs.md); do not profile every interface by default. A helper needs a concrete omission or repeated operation, not merely precedent in a public Skill.

# Spritesheet and atlas production

Use when the required output for any game or UI artwork is a spritesheet, atlas or image sequence, regardless of its subject. Start from the project's intended appearance and behavior and the shared [artwork source method](../../game-content-pipeline-engineer/references/artwork-production.md). This method organizes and prepares those outputs; their contents, states and visual changes come from the current assignment. Suitable supplied or sourced sheets need no generation.

## Relate the sheet to its consumers

Distinguish the meanings of its entries before acquisition or generation:

- Independent elements share an image for storage/loading; each consumer selects its own named region.
- Discrete state variants are selected by the actual state. Their placement next to one another is not a playback order.
- A temporal sequence represents a planned visual change. Preserve its ordered frame identities, timing and loop or ending behavior for the consumer.

A sheet can contain more than one of these kinds. Group compatible entries by required scale, transparency, sampling and loading use; separate independently composed parts where necessary. Neither sheet membership nor material category implies that something must animate. Frame dimensions, count and layout follow the actual output needs, intended display size and supported renderer; keep unrelated content and additional actions outside the assignment.

Retain the element/state/sequence identities in the project's existing resource and animation definitions. For a sequence, use that same definition to describe the source images and to select frames in the runtime. A numeric frame index may implement a named entry, but packing order alone cannot establish its meaning, playback order or state. No new common animation protocol or dedicated planning document is required.

## Acquire or generate the required images

Inspect suitable sources against those output needs. If AI generation is selected, use the system imagegen Skill and current tool help. Describe the actual family, rendering treatment, view, independent elements and required visual changes. Preserve identity, apparent scale and coordinate references where the entries are meant to match; use the transparency/compositing treatment required by the consumer.

For static elements and discrete variants, request the complete compatible family together with clear separation; extraction coordinates need not be invented before pixels exist. For a temporal sequence, describe the intended change and each frame in playback order, including timing and a loop connection or ending where applicable. Describe the full extents at a shared drawing scale and coordinate origin before choosing a canvas or packing layout. Image generation does not implement playback.

Assign image entries to their selected layout only after their contents are known. For a grid, map each named entry or sequence frame to exactly one specified cell, with no ambiguous assignments; do not infer an action from its row or silently fill spare cells with new content. A packed layout instead needs identifiable, complete elements with separation for measured bounds. Labels and layout guides are instructions, not artwork, unless the actual deliverable requires visible labels.

Use only the relevant specialist detail: [character consistency and pose production](ai-sprite-animation.md) for character-specific work, or [effect textures and sequences](vfx-craft.md#effect-textures-and-sequences) for VFX material, blending and lifetime. These specialties do not supply a default content list for other materials. Generation/recovery and authorization follow the existing tool contract; a failed attempt does not authorize paid retries or a substitute source.

## Inspect and prepare frames from any source

Inspect actual output dimensions, alpha, complete silhouettes, separability and correspondence with the intended entries. For sequences, also inspect ordering, repeated stills, scale/origin drift and continuity. Reuse reliable file facts already returned by the source/tools. A requested grid is not measured geometry, and an alpha channel does not establish edge quality. If required content is absent or parts overlap, cropping and packing cannot repair it.

Use the existing media paths as appropriate:

- Retain clean source pixels and record named rectangles measured from the actual image; rectangle metadata does not separate or repack pixels.
- Extract or pad only where needed, with a consistent drawing scale and coordinate reference across related entries. Per-frame tight recentering or bottom alignment can erase intentional travel and create jitter. Preserve authored pivots/contact points and supported trim offsets.
- Pack prepared images with explicit names and the consumer's supported rotation/trim policy. The existing BGS packer uses no rotation/trim and edge-copy padding; use suitable filtering, preserving the original images.

Keep actual files, provenance and processing receipts in the existing registration path. Store frame rectangles/anchors in native resource metadata and sequence timing/selection in the chosen runtime's existing animation definitions. The atlas sidecar is not a scene graph or a playable clip.

## Consume the result according to its meaning

Use the selected runtime's existing region/state/animation facilities. Static entries select their named bounds; discrete variants select the region mapped to the current state, without a playback clock. For temporal entries, select the intended sequence before selecting a frame. When implementing frame selection directly, advance per-instance elapsed time using the owning clock while that sequence plays; on a sequence change, apply its intended reset or resume behavior. Select frames from their cumulative durations, converting source time units once during import. A loop wraps within that sequence's duration; a one-shot reaches its defined ending or transition instead of wrapping accidentally. A scene-global frame modulo alone does not preserve sequence entry, reset or interruption. Gameplay state remains authoritative, and visual playback must not establish a hit or other rule outcome.

Judge the relevant result at its intended display scale and composition. For sequences, use playback to assess cadence, seams, clipping and unintended offsets; a contact sheet answers alignment/coverage questions but cannot prove continuity. Resource-only work can use an asset preview within its scope; implementation resolves concrete assembly questions, and separate verification retains its assigned runtime checks. Reuse valid observations and disclose what remains unobserved without adding generation/review loops.

## Method references

- [Phaser textures](https://docs.phaser.io/phaser/concepts/textures): texture regions, regular sheet frames and atlas metadata are resource representations, not gameplay state definitions.
- [Godot 2D sprite animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html): individual images and sheets both support sequence playback; examples do not prescribe contents or frame counts for another project.
- [Aseprite CLI](https://www.aseprite.org/docs/cli/): export ranges, timing, padding and extrusion inform preparation without requiring an additional dependency.

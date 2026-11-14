# Spritesheet and atlas production

Use when the required output for any game or UI artwork is a spritesheet, atlas or image sequence, regardless of its subject. Start from the project's intended appearance and behavior and the shared [artwork source method](artwork-production.md). This method organizes and prepares those outputs; their contents, states and visual changes come from the current assignment. Suitable supplied or sourced sheets need no generation.

## Relate the sheet to its consumers

Distinguish the meanings of its entries before acquisition or generation:

- Independent elements share an image for storage/loading; each consumer selects its own named region.
- Discrete state variants are selected by the actual state. Their placement next to one another is not a playback order.
- A temporal sequence represents a planned visual change. Preserve its ordered frame identities, timing and loop or ending behavior for the consumer.

A sheet can contain more than one of these kinds. Group compatible entries by required scale, transparency, sampling and loading use; separate independently composed parts where necessary. Neither sheet membership nor material category implies that something must animate. Frame dimensions, count and layout follow the actual output needs, intended display size and supported renderer; keep unrelated content and additional actions outside the assignment.

Retain the element/state/sequence identities in the project's existing resource and animation definitions. For a sequence, use that same definition to describe the source images and to select frames in the runtime. A numeric frame index may implement a named entry, but packing order alone cannot establish its meaning, playback order or state. No new common animation protocol or dedicated planning document is required.

## Acquire or generate the required images

Inspect suitable sources against those output needs. If AI generation is selected, use the system imagegen Skill and current tool help. Describe the actual family, rendering treatment, view, independent elements and required visual changes. Preserve identity, apparent scale and coordinate references where the entries are meant to match; use the transparency/compositing treatment required by the consumer.

For static elements and discrete variants, request compatible content together when the actual output can preserve required detail, complete silhouettes and clear separation. Split only as those output limits require, keeping compatible content together within each request; extraction coordinates need not be invented before pixels exist. For a temporal sequence, describe the intended change and each frame in playback order, including timing and a loop connection or ending where applicable. Describe the full extents at a shared drawing scale and coordinate origin before choosing a canvas or packing layout. Image generation does not implement playback.

Assign image entries to their selected layout only after their contents are known. For a grid, map each named entry or sequence frame to exactly one specified cell, with no ambiguous assignments; do not infer an action from its row or silently fill spare cells with new content. A packed layout instead needs identifiable, complete elements with separation for measured bounds. Labels and layout guides are instructions, not artwork, unless the actual deliverable requires visible labels.

Use only the relevant specialist detail: [character consistency and pose production](../game-art-director-expert/ai-sprite-animation.md) for character-specific work, or [effect textures and sequences](../game-art-director-expert/vfx-craft.md#effect-textures-and-sequences) for VFX material, blending and lifetime. These specialties do not supply a default content list for other materials. Generation/recovery and authorization follow the existing tool contract; a failed attempt does not authorize paid retries or a substitute source.

## Inspect and prepare frames from any source

Inspect actual output dimensions, alpha, complete silhouettes, separability and correspondence with the intended entries. For sequences, also inspect ordering, repeated stills, scale/origin drift and continuity. Reuse reliable file facts already returned by the source/tools. A requested grid is not measured geometry, and an alpha channel does not establish edge quality. If required content is absent or parts overlap, cropping and packing cannot repair it.

Use the existing media paths as appropriate:

- Retain clean source pixels and record named rectangles measured from the actual image; a region-capable consumer can load one shared atlas without separate image files. Rectangle metadata does not separate or repack pixels.
- Extract or pad only where needed, with a consistent drawing scale and coordinate reference across related entries. Per-frame tight recentering or bottom alignment can erase intentional travel and create jitter. Preserve authored pivots/contact points and supported trim offsets.
- Pack prepared images with explicit names and the consumer's supported rotation/trim policy. The existing BGS packer uses no rotation/trim and edge-copy padding; use suitable filtering, preserving the original images.

When running directly from the plugin without an available image-processing tool, [sprite_sheet.py](../../scripts/game-content-pipeline-engineer/sprite_sheet.py) supplies read-only alpha-region candidates and explicit batch crops. It uses an available Python/Pillow installation; `--help` needs only Python. It installs nothing and calls no BGS service. Prefer sufficient existing tool results over repeating the measurement.

```sh
python3 <installed-plugin>/scripts/game-content-pipeline-engineer/sprite_sheet.py regions sheet.png --alpha-threshold 0 --min-pixels 1
python3 <installed-plugin>/scripts/game-content-pipeline-engineer/sprite_sheet.py crop sheet.png --frame subject 8 4 64 80 --frame prop 100 8 32 40 --output new-parts
```

These example rectangles are not generation coordinates. `regions` reports 8-connected alpha components, not named objects: touching elements merge, detached parts separate, and an opaque background remains connected. Threshold and minimum pixel count are explicit; filtering totals are reported, and discarded low-alpha pixels may still belong to the artwork. Confirm complete source rectangles before cropping. `crop` accepts only those named rectangles, retains their pixels/scale/offsets, and reports source bounds for existing native bindings; it neither trims/recenters frames nor infers a pivot. Exports require a new directory and preserve PNG color interpretation metadata. Both modes accept single-frame 8-bit PNGs; neither recovers occluded art or certifies quality. Region-capable consumers can use the measured sheet directly without exporting individual files.

Keep the actual files and the acquisition/processing tools’ saved source facts; hand off only the runtime files adopted. Store frame rectangles/anchors in native resource metadata and sequence timing/selection in the chosen runtime's existing animation definitions. The atlas sidecar is not a scene graph or a playable clip.

During preparation, a contact sheet can establish coverage/alignment but not playback continuity. Hand temporal identity and timing to [runtime playback](../game-art-director-expert/motion-implementation.md#sheet-and-sequence-playback); resource-only previews remain within the assignment.

## Method references

- [Phaser textures](https://docs.phaser.io/phaser/concepts/textures): texture regions, regular sheet frames and atlas metadata are resource representations, not gameplay state definitions.
- [Godot 2D sprite animation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_sprite_animation.html): individual images and sheets both support sequence playback; examples do not prescribe contents or frame counts for another project.
- [Aseprite CLI](https://www.aseprite.org/docs/cli/): export ranges, timing, padding and extrusion inform preparation without requiring an additional dependency.

Implementation references: [Pillow image operations](https://pillow.readthedocs.io/en/stable/reference/Image.html) define decoded image bounds and crop coordinates; [OpenCV connected-component statistics](https://docs.opencv.org/4.x/d3/dc0/group__imgproc__shape.html) distinguish pixel connectivity, component area and bounding rectangles. The helper implements horizontal-run labeling itself; OpenCV is not a dependency.

# Renderer and version changes

Use for Phaser 3 migration, filters/masks, custom shaders or measured rendering
bottlenecks. Read the installed version and source before translating examples.

## Phaser 4 renderer changes

Phaser 4's Beam renderer uses filters and render nodes in places where older
examples use `preFX`, `postFX`, masks or custom pipelines. Search the installed
types for the intended operation instead of mechanically replacing a method
name. The following are lookup targets, not a request to enable every effect:

| Need | Phaser 4 symbols to inspect |
|---|---|
| Per-object effects | `enableFilters`, `filters.internal` / `filters.external` |
| Screen effects | Camera filter lists |
| Arbitrary mask | Filter `addMask`, its source/transform parameters |
| Rectangular camera clipping | Camera `setViewport` and camera object visibility |
| Generated texture commit | `DynamicTexture` / `RenderTexture` drawing and `render` lifecycle |
| Custom rendering | Render nodes, Shader object, filter `addCustom` |
| Dense sprite rendering | `SpriteGPULayer`, with its actual physics/input limitations |

On supported WebGL objects, enable filters before accessing their lists;
`filters` can otherwise be null. Internal and external filters operate in
different spaces: choose where the effect belongs, then verify the object's
bounds and transform. Filters render intermediate textures and add passes; a
camera-wide effect and hundreds of per-object effects have different costs.

A mask that renders nothing can be a renderer/API mismatch, an incorrect camera
visibility set, or incorrect mask coordinates. Do not conclude from successful
compilation that a v3 Canvas masking path works in Beam. Check the active
renderer and the installed implementation.

## Performance and migration

Measure the actual bottleneck before changing architecture. Reuse high-churn
objects/temporary vectors where allocation is visible; cap or recycle emitters
according to the intended effect lifetime. Shared atlases can reduce texture
switching; filters, blend modes and object ordering may still break batches.

GPU sprite layers and Mesh2D are specialized tools, not default replacements for
interactive physics sprites. Avoid adding full-screen blur/bloom chains to fix
art that is using the wrong texture, origin or scale.

A v3-to-v4 migration can also affect TypeScript exports, removed namespaces and
texture APIs. Resolve each used symbol from the installed package. Keep a
requested migration separate from an ordinary feature change; this document
does not require upgrading an existing project or selecting a renderer for it.

Source topics: phaser-fx, phaser-particles, phaser-migrate, phaser-analyze.
Filter lifecycle checked against [official Filters implementation](https://github.com/phaserjs/phaser/blob/master/src/gameobjects/components/Filters.js).

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).

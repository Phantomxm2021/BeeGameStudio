# Compositing and image diagnosis

Use when correct artwork looks wrong after sampling, blending, depth or final-image processing. These are public examples and derived diagnoses, not a record of BGS runtime failures. Trace the affected pixels through the existing rendering path; a new general render graph is unnecessary.

## Dark or bright transparent edges

**Basis:** W3C's [simple alpha compositing](https://www.w3.org/TR/compositing-1/#simplealphacompositing) distinguishes a color from a color already multiplied by its alpha. For source-over, using premultiplied colors `c` and alpha `a`:

```text
c_out = c_source + c_backdrop * (1 - a_source)
a_out = a_source + a_backdrop * (1 - a_source)
```

**Derived diagnosis:** straight white at alpha 0.5 becomes premultiplied RGB 0.5. Multiplying that RGB by alpha again gives 0.25, darkening the edge. Treating straight RGB 1 as already premultiplied instead gives excess brightness. Trace file import/upload conversion, shader output, blend factors, render-target alpha and final canvas composition together; the correct convention at one boundary need not match every other boundary. Do not toggle a global setting solely because its name contains “premultiplied.”

A baked matte or dark RGB sampled around an image edge is a different defect from a convention mismatch. Compare the same edge over light and dark backgrounds, and inspect the source alpha and padding. Removing dark pixels by a color threshold can destroy intentional smoke or outlines. [VFX textures](vfx-craft.md#effect-textures-and-sequences) and [sheet preparation](../game-content-pipeline-engineer/spritesheet-production.md) cover the corresponding source repairs.

## Disappearing surfaces: opacity is not depth order

**Public implementation:** Three.js's [transparency examples](https://threejs.org/manual/pages/transparency.html) show why enabling opacity and double-sided drawing does not resolve all missing faces. Object sorting does not generally sort every triangle inside a mesh; the article contrasts translucent objects with alpha-tested cutouts.

**Adaptation:** choose the actual surface relationship. A leaf card with solid visible pixels and holes may use cutout/discard; a glass sheet or soft smoke needs partial coverage. A texture with alpha does not by itself require the same draw/depth mode for both. For blended effects, disabling depth writes can prevent a transparent foreground pixel from blocking a later effect, but it does not solve intersecting surfaces or every sorting defect. Preserve depth testing when world geometry should occlude the effect. A forced render order is appropriate only to a known ordering relationship; it cannot represent two intersecting surfaces from every angle.

Follow the affected overlap from the gameplay camera. Separate an incorrect source mask, a wrong depth write, object sorting and an intended foreground layer before changing material flags.

## A washed-out palette may be an output problem

**Public basis:** Three.js's [color-management guide](https://threejs.org/manual/pages/color-management.html) distinguishes color textures, non-color data, linear working calculations and display output. Its postprocessing path uses an output pass for display conversion.

**Adaptation:** when an adopted palette changes after a custom shader or pass, locate the difference before recoloring the art. Color artwork needs its proper input interpretation; normal/roughness/mask data should not acquire an sRGB color conversion. Preserve linear working values where the selected renderer expects them, then perform the intended tone mapping and output encoding at the appropriate final boundary. A pass that encodes an intermediate image followed by another output conversion can alter the result twice. An intentionally unlit illustration and an HDR-lit world may need different tone-mapping treatment.

Compare the same supplied color/image through the affected path and a known supported material under the same display conditions. Use [engine shader output](../threejs-gamedev/threejs-shaders.md#output-color-and-tone-mapping) for exact Three.js integration; other renderers keep their own conventions.

## Effects and interface layers

**Public implementation:** Three.js's [selective bloom example](https://threejs.org/examples/webgl_postprocessing_unreal_bloom_selective.html) and [source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_postprocessing_unreal_bloom_selective.html) isolate bloom contribution, temporarily substitute dark materials for non-bloom meshes, restore those materials, then mix the images before the output pass. It demonstrates selection, not a required two-composer architecture.

**Adaptation:** identify which surfaces contribute to an effect and which image regions receive it. Keeping a non-glowing occluder in the depth relationship differs from simply hiding that object. For a HUD that should stay crisp, compose it after the affected world pass or use the renderer's existing UI layer; do not accidentally bloom or pixelate text because it shares the scene. An interface intentionally participating in the world's treatment may belong earlier. Track coordinates, masks and depth through that chosen boundary, including resized render targets. Restore only temporary state owned by the effect; reuse existing pass/layer facilities before adding another render path.

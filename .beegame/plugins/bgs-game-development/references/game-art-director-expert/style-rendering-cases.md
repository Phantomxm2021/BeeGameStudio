# From style to rendering

Use for a concrete gap between an adopted appearance and its construction. For naming or comparing styles, use [stylization language](stylization-language.md). These public implementations explain methods; they are not BGS runtime observations, required dependencies or permission to reuse commercial assets.

## Light bands and contours are separate choices

**Public implementation:** Three.js's [toon example](https://threejs.org/examples/webgl_materials_toon.html) and [source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_materials_toon.html) combine a small gradient texture with `MeshToonMaterial`, while `OutlineEffect` supplies contours separately. Flat Kit's author documents [independent cel, specular, rim, gradient and outline controls](https://flatkit.dustyroom.com/stylized-surface/); its optional PBR contribution means indirect illumination, not support for every physical material feature.

**Adaptation:** first decide where the broad light and shadow masses should sit on the subject. Normals and light direction determine that boundary; a ramp controls its value/color response. For discrete bands, avoid filtering the ramp into a continuous gradient unless a soft boundary is intended. Flat versus smooth normals can make the same ramp read as planes versus rounded volume. Choose contour construction separately: visible outer profile, material boundaries and creases are different edge sets. A silhouette shell does not automatically draw internal seams; a depth/normal screen pass may miss a coplanar color boundary.

At the gameplay camera, move the light or subject enough to expose the intended response. If shading changes but the profile is still wrong, repair geometry or the drawn silhouette. If contours change apparent weight with distance, resolve whether width belongs to object units or screen pixels. Adding more bands or a rim is not the default repair.

## Authored paint versus live material response

**Public implementation:** Valve's [TF2 rendering paper](https://cdn.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf) describes deliberately coordinated modeling, painted value relationships and modified lighting. It is a particular illustration treatment, not a generic stylized PBR recipe.

**Adaptation:** separate the surface's lasting identity from the illumination that should move. Broad painted color/value groups may remain stable; a live highlight can express view or light changes. If painted shadows are already strong, multiplying another strong diffuse shadow can bury the intended planes. Either author for the chosen live response, reduce that contribution, or preserve an intentionally baked/unlit treatment.

For stylized PBR, retain deliberate differences between materials through appropriate roughness, reflectance and normals; one shared tint and roughness cannot express every surface. A normal map changes local light response, not the outline. Put a needed opening, chunky edge or asymmetry in geometry or artwork. Use [material construction](material-and-shading.md#choose-the-rendering-method) and the selected engine's material reference for actual map/channel and lighting APIs.

## A painted image filter is an image-space method

**Public implementation:** Fronkon's [Artistic / Oil Paint documentation](https://fronkongames.github.io/store/artistic/) describes Kuwahara-family and other edge-preserving filters, with radius and pass controls. This processes a rendered image; it does not author brushwork into an object's texture.

**Adaptation:** choose this path only when the desired relationship belongs to the final image. A screen-sized kernel changes its footprint relative to an object as the camera approaches. Follow a moving contact edge and fine foreground detail: merging adjacent colors may erase useful separation or flicker even when one still looks painterly. If marks must remain attached to a surface, use UV/object-space authorship instead. Keep UI inclusion deliberate through [compositing](compositing-cases.md#effects-and-interface-layers), and measure an actual pass bottleneck before changing resolution or iteration count.

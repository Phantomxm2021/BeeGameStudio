# 2D rendering cases

Use for a sprite, tile or layered artwork that loses its intended appearance at runtime. [2D styles and assets](2d-style-and-assets.md) covers visual language and source representations; this reference concerns sampling, lighting and compositing behavior. The examples below are public implementations, not BGS playtest results.

## Pixel structure: sampling versus motion

**Public implementation:** Unity's [Pixel Perfect 5.1 documentation](https://docs.unity3d.com/Packages/com.unity.2d.pixel-perfect@5.1/manual/index.html) relates reference resolution, asset pixels per unit, point sampling and display scaling. Its render-time Pixel Snapping does not change object transforms.

**Adaptation:** preserve the selected artwork's texel scale through the camera and final display, including any intermediate render target. Point sampling alone cannot make uneven fractional enlargement produce equal-width screen pixels. An integer display scale preserves that relationship where the intended framing allows it; cropping, margins or a different reference resolution are framing tradeoffs, not mandatory black bars. Inspect camera movement as well as a still: subpixel placement can change which pixels are sampled even with a nearest filter.

Keep simulation precision independent. When render snapping is chosen, apply it in the presentation/camera path rather than rounding collision positions or changing input. For an atlas edge seam, first distinguish neighboring-region sampling from a camera grid mismatch; [sheet preparation](../game-content-pipeline-engineer/spritesheet-production.md) owns source bounds/padding. Pixel-art sampling is not appropriate to every illustrated sprite or UI font.

## Sprite volume: what does the normal map actually control?

**Public implementation:** Defold's [normal-mapped 2D sample](https://github.com/defold/sample-normal-maps-2d) has a [fragment shader](https://github.com/defold/sample-normal-maps-2d/blob/master/assets/sprite_normal.fp) that reads separate color and normal textures, decodes the normal, evaluates a light dot product and distance attenuation, then combines diffuse and ambient contributions. Its [controller](https://github.com/defold/sample-normal-maps-2d/blob/master/main/main.script) supplies the light position and viewport size. This is a concrete screen-relative light setup, not a ready-made world-space lighting system.

**Adaptation:** decide whether lighting should change inside the painted shape or only tint it. For internal volume, align the normal map with the same pose/frame and coordinate convention as the color image. Flipping a color image alone may leave its encoded directions wrong for the chosen lighting model. A moving camera or resized viewport needs the light and sampled surface expressed in compatible coordinates. Use the selected engine's native 2D lighting where available rather than transplanting this shader's viewport assumptions.

Move the light across one recognizable bulge and recess. If the shading follows the opposite side, inspect normal orientation/handedness and sprite transforms before changing the palette. Strong painted highlights plus strong live lighting can imply two conflicting volumes. No normal map creates a new silhouette or cast shadow by itself.

## Layered art: occlusion without pretending everything is 3D

**Public implementation:** Spine's [Spineboy portal](https://esotericsoftware.com/spine-examples-spineboy#Portal) combines separately transformed images, attachment visibility for flare frames, and a clipping polygon around the character.

**Adaptation:** for an actor entering an opening, separate rear art, the actor and the foreground lip; mask only the part that should disappear. Keep the mask in the opening's coordinate space and choose its affected draw range deliberately. A broad screen overlay can hide unrelated UI or other actors. Use geometric clipping for a hard boundary, or an alpha mask when an intentionally soft edge is required and supported. Layer order resolves intended overlap; it does not make a flat sprite into a volumetric object.

Mixed rigs, transformed layers and frame sequences can serve different parts of one effect. For timing and cancellation use [motion implementation](motion-implementation.md); for transparent fringes or incorrect blending use [compositing](compositing-cases.md).

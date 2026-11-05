# Translate artwork relationships into runtime assembly

Read when a required asset exists but looks detached, improperly occluded or
stretched in the game. These are small independently written integration
examples, not a new layout specification. Numbers describe hypothetical assets;
use actual source measurements and the installed engine's APIs. No image is
produced or visually validated by reading or running a snippet.

## A painted contact point is not the canvas edge

Suppose an untrimmed 192 by 192 character image has its intended planted-foot
anchor at source pixel (84, 176). At scale 0.5, a generic bottom-center origin
would put that point 6 display units left and 8 above the intended position.
Changing a collider or adding a shadow does not repair this painted offset.

```ts
import type Phaser from 'phaser';

export function placeCharacter(scene: Phaser.Scene, x: number, groundY: number) {
  // 'hero-idle' is an existing untrimmed 192x192 texture, already loaded.
  return scene.add.image(x, groundY, 'hero-idle')
    .setOrigin(84 / 192, 176 / 192)
    .setScale(0.5);
}
```

The normalized origin makes that source point map to (x, groundY). For trimmed
atlas frames, use their source-size/trim semantics rather than treating packed
rectangle dimensions as the original image. A different moving pose can have an
intentional lifted foot; do not independently bottom-align every animation
frame. Collision bodies retain their own intended geometry and offsets.

The same reasoning applies to hanging a prop by its painted hook or attaching a
held object to an authored hand point. Under parent transforms, map both points
through the actual hierarchy rather than comparing one local point with another
world point.

## Occlusion needs separable source parts

Assume the supplied basket-back and basket-front textures share a full-canvas
pivot at bottom center. The apple is a separate texture. This fragment changes
only visual assembly; it creates no physics bodies or new gameplay rules.

```ts
import type Phaser from 'phaser';

export function assembleBasket(scene: Phaser.Scene, x: number, y: number) {
  const root = scene.add.container(x, y);
  const back = scene.add.image(0, 0, 'basket-back').setOrigin(0.5, 1);
  const apple = scene.add.image(0, -74, 'apple').setOrigin(0.5, 1);
  const front = scene.add.image(0, 0, 'basket-front').setOrigin(0.5, 1);
  root.add([back, apple, front]);
  return root;
}
```

Here -74 is the example's authored apple placement relative to that shared
pivot, not a universal basket coordinate. Container children render in their
list order: the front can cover the apple's lower portion while the rear stays
behind it. Putting both basket images behind the apple loses the rim relation;
putting an opaque complete basket in front can hide the whole apple. Independently
cropped pieces need their actual offsets restored before sharing this pivot.
If artwork lacks a front layer or genuine transparency, code order cannot
recover missing pixels. Reuse/extract suitable separable source parts or obtain
the required derivative through the existing production method.

## Resize a panel without stretching its identity

Suppose an existing untrimmed 96 by 96 UI skin has measured fixed border/corner
regions of 16 source pixels on each side and a stretchable center. In a Phaser
WebGL renderer with this NineSlice API, keep the object's scale at one and
change its layout dimensions:

```ts
import type Phaser from 'phaser';

export function makePanel(scene: Phaser.Scene, x: number, y: number) {
  return scene.add.nineslice(x, y, 'ui', 'panel',
    360, 144, 16, 16, 16, 16);
}
```

Whole-image resizing from 96x96 to 360x144 scales a 16-pixel edge to 60 pixels
horizontally and 24 vertically; this nine-slice keeps its source corner regions.
The minimum dimensions are the sums of opposing fixed regions. A crest, text
or irregular ornament spanning stretch regions still needs separate artwork or
an appropriate non-stretched treatment. The same source-region logic applies
to a DOM border-image or the selected engine's equivalent, not this Phaser call.
In Canvas mode or another API version, use supported facilities rather than
assuming this WebGL-specific object exists.

## A DOM overlay can drift even when its logical position is correct

For a 1280x720 logical game fitted into a 1000x600 borderless wrapper, the canvas
is 1000x562.5 with a vertical offset of 18.75 if centered. Logical HUD point
(40,30) therefore maps to wrapper point (31.25,42.1875), not (40,30). Device pixel
ratio does not change these CSS-coordinate values. Use the actual displayed
rectangle and applicable camera projection, not a second hard-coded layout.
The [React host reference](../../gameplay-programmer/references/react-host-integration.md)
explains host alignment and input ownership.

API shapes checked in [Phaser 4.2.1 origin handling](https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/components/Origin.js),
[Container ordering](https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/container/Container.js)
and [NineSlice factory](https://github.com/phaserjs/phaser/blob/v4.2.1/src/gameobjects/nineslice/NineSliceFactory.js).
Recheck installed-version behavior when those details differ; these examples
neither select Phaser for another engine nor authorize a version migration.

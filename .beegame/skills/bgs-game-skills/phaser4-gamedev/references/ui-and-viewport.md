# UI and viewport

Use for stretched art, HUD drift, responsive overlays or incorrect hit areas.

## Distinguish sizes and spaces

Phaser's logical game size, displayed canvas size, parent bounds and backing
resolution are different quantities. `FIT` preserves the logical aspect ratio
inside the available parent; `RESIZE` changes the logical extent with the
parent. Choose according to the game's intended framing, not a blanket rule.

For a fixed logical canvas, stable logical coordinates can be correct even as
CSS scales the display. For a resizing canvas, derive anchored HUD placement
from the current logical viewport and recalculate on relevant resize events.
For split-screen or clipped panels, use the particular camera's viewport.
Avoid treating `window.innerWidth` as a world coordinate.

A DOM HUD must align to the canvas's actual display rectangle, including
letterboxing, rather than the entire window. On mobile, a `100dvh` host and safe
area padding can address browser chrome and notches; check target behavior
before imposing a sizing scheme. Remove external resize listeners at teardown.

## Layout and texture behavior

Place a non-scrolling HUD in its existing overlay layer or scene; a dedicated
HUD scene is useful only when it needs an independent lifetime/camera. If using
world objects as HUD, deliberately account for camera scroll and zoom.

Keep the selected art's silhouette, border thickness and content padding. A
stretchable panel may use nine-slice metadata if the installed API and source
support it; whole-frame stretching distorts corners. Rigid ornaments/icons
usually keep their aspect ratio. Text wrapping width and font availability can
change the visual bounds even when the parent panel is correctly placed.

Hit areas use the object's local geometry, transforms and input configuration,
not necessarily its visible painted pixels. Inspect the hit area when a scaled
or transparent-padded button reacts outside its apparent boundary. Resolve
input precedence on modal overlays as well as visual depth.

For concrete source-region and letterbox calculations, use the
[runtime assembly examples](../../game-content-pipeline-engineer/references/runtime-assembly-examples.md); for React host lifetime and subscriptions, use
[React host integration](../../gameplay-programmer/references/react-host-integration.md).

Source topics: phaser-ui, phaser-scene. Size distinctions checked against
[official Scale Manager guidance](https://docs.phaser.io/phaser/concepts/scale-manager).

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).

# Physics and tilemaps

Use for contact outcomes, reusable bodies, coordinate mismatch or Tiled loading.

## Select a body model for the actual mechanic

Arcade Physics suits axis-aligned rectangles/circles and ordinary movement,
projectiles and overlaps. Matter suits rigid-body rotation, polygon shapes,
joints and constraints. Preserve an already suitable physics setup; these are
alternatives, not consecutive implementation stages.

`collider` resolves contact and can invoke a callback; `overlap` observes contact
without separation. A process callback can reject a candidate contact before
resolution. Distinguish collision layers/categories from display depth.

For Arcade platform movement, distinguish `blocked` against static/world bounds
from `touching` another body; use the actual contact source to decide grounded
behavior. Input velocity and manual position changes are different mechanisms:
manual movement can bypass the collision result. Express `delta` conversion
explicitly when integrating pixels/second with millisecond frame times.

## Presentation versus collision geometry

Transparent frame padding, origin, display scale and body offsets all affect
where the player sees contact. Inspect the body in the same world/camera as the
sprite before changing gameplay dimensions to compensate for artwork padding.
A resized static object may need its static body refreshed; check the installed
body API. Moving a dynamic sprite is not the same as moving a static body.

## Reused objects

For frequent short-lived objects, a physics group can recycle inactive bodies.
On acquire, reset position, enabled/active/visible state, velocity, collision
flags, animation/tint and per-use listeners that the object actually changes.
On release, disable the body as well as visibility; an invisible enabled body
can still hit targets. A pool is useful for repeated allocation pressure, not a
reason to pool every UI object. Track ownership of groups/colliders created
outside the ordinary scene lifetime.

## Tiled integration

The exported map's tileset name and the preloaded texture key have distinct
roles in `addTilesetImage`; match each to its source. Use object-layer positions
for authored spawn points and account for the exported object's origin and
shape. Tile collision properties only have an effect when the corresponding
layer collision setup and body/layer collider exist.

Map dimensions, world bounds and camera bounds are separate decisions. A
scrolling world can exceed the viewport without scaling collision coordinates.
When a tile collision signature differs from an example, inspect the installed
`setCollisionByProperty` declaration rather than adding guessed arguments.

Source topics: phaser-physics, phaser-matter, phaser-tilemap.

Upstream technical source: [pinned skill collection](https://github.com/yakoub-ai/phaser4-gamedev/tree/1c1bf45dec3f0acbe8b2a963cc6dab93be31253a/skills).

# Deformation and procedural motion cases

Use when required motion changes shape or contact and a whole-object transform is insufficient. These public implementations explain representation choices; they are not verified fixes for the current game. [Motion implementation](motion-implementation.md) owns event timing and lifetime; [skeletal handoff](skeletal-animation-handoff.md) owns rig/clip compatibility.

## Choose which information must change

| Required change | Small suitable representation | What it cannot supply alone |
| --- | --- | --- |
| Rigid tilt, recoil or settling | Transform about the intended pivot | A new internal bend or drawn pose |
| An articulated limb keeps contact while the body moves | Weighted skeleton and an appropriate constraint | Correct weighting or a new painted viewing angle |
| An authored expression or bulge changes continuously | Morph targets with matching vertex correspondence | New topology or arbitrary articulation |
| Repeated flexible motion follows a spatial pattern | Vertex displacement on sufficient geometry | Automatic collision, contact solving or a correct shadow path |
| A new silhouette or perspective is drawn | Authored sequence/state frames | Continuous articulation between missing drawings |

These may be combined on different parts. Choose from the actual visible change and available asset, not a rule that all characters need rigs or every effect needs a shader.

## A spatial wave must bend, not merely translate

**Public implementation:** Godot's [fish vertex-animation example](https://docs.godotengine.org/en/4.4/tutorials/performance/vertex_animation/animating_thousands_of_fish.html) builds side movement, pivoting, a traveling wave and twist in model space. Position along the body shifts the wave's phase. It demonstrates repeated flexible motion; its model dimensions and axes are example-specific.

**Adaptation:** a uniform offset moves all vertices together. For a bend, vary displacement by position. For a rooted plant or hinged strip, preserve the attachment by giving its base zero displacement. One possible model-space relation is:

```text
s = normalized distance from attachment along the authored bend axis
displacement = direction * amplitude * weight(s) * sin(phase + frequency * s)
weight(0) = 0
```

This is an adaptation, not the fish shader or portable engine syntax. Define amplitude in the mesh's units and phase on the existing presentation clock. Keep a stationary attachment in the same space; object-space axes suit body-relative bending, while a world wind direction requires conversion. Sparse geometry cannot describe a smooth curve. Large bends also need suitable normals, deformed shadow/depth passes and conservative bounds where the engine requires them. A visual bend does not update gameplay collision automatically; alter collision only when the actual design requires it.

## Articulation and expression can remain independent

**Public implementation:** Three.js's [skinning and morph example](https://threejs.org/examples/webgl_animation_skinning_morph.html), with [source](https://github.com/mrdoob/three.js/blob/master/examples/webgl_animation_skinning_morph.html), uses imported body clips and separately controlled facial morph influences. A morph represents corresponding vertices moving toward authored target positions; a skeleton articulates weighted regions around joints.

**Adaptation:** use body clips for the available articulation and morphs for the authored local expression instead of scaling the entire head. Keep an independently owned expression from resetting body movement. When adding procedural displacement to an animated mesh, operate on the evaluated pose at the selected engine's supported stage; starting again from rest geometry can erase the skin/morph result. Use the existing [engine animation reference](../threejs-gamedev/threejs-animation.md) for Three.js/R3F integration, not the demo's hardcoded mesh names or transition durations.

## Contact depends on the hierarchy and evaluation order

**Public implementation:** In [Spineboy's leg/hoverboard setup](https://esotericsoftware.com/spine-examples-spineboy), the hip can move without moving sibling IK targets; foot constraints then follow the board through an explicit constraint order.

**Adaptation:** if feet drift as the torso settles, inspect target ownership and spaces before adding compensating offsets. Targets that inherit the same motion as the hip cannot provide independent support. Evaluate the support transform before its dependent contact constraint. Follow the contact through the bend and interruption at play speed; a correct endpoint does not establish planted motion. Preserve each effect's owned offsets and [interruption behavior](motion-implementation.md#facing-motion-and-contact).

# Color Language

Separate atmosphere from information. Define the palette needed by the current scene and reserve consistent cues for states the player must recognize. The meaning of red, green, or any other hue is project- and culture-dependent; do not assume a universal mapping.

Check the actual play view for value contrast, color-vision differences, lighting and effects that alter colors, and competition between world, UI, and VFX. Pair important color cues with shape, label, motion, or sound. Do not impose a fixed palette size by platform.

## Build relationships, not a swatch list

Start with the actual subject and action: which surfaces establish the place, which objects must separate from them, and which change deserves emphasis? Choose hue, value, saturation and occupied area together. A tiny bright indicator and a large bright floor do not compete equally just because they share a color.

- Give the surrounding material a coherent range rather than independently coloring every tile. Variation can describe wear or depth; repeated high-contrast seams can instead make the grid the dominant subject. Preserve a grid when judging cells is the player's task.
- Separate an important silhouette from its immediate surroundings before adding glow. Changing its local background or edge treatment can retain the intended mood better than brightening the entire object.
- Relate UI emphasis to world signals without making every heading, border and button another warning. A shared accent can establish identity; its placement and prominence still need different roles.
- Compare persistent state with the transient response. A successful action may briefly attract attention, then settle into a readable completed state while the next decision becomes prominent. Do not leave every completed object at peak emphasis.

In the [playable-scene study](../game-scene-designer/encounter-design-patterns.md#worked-scene-study-an-existing-platformer), warm grass-topped rock masses and the cool sky/background form different color families, while the blue player and red enemy remain recognizable against them. Compare these relationships in the actual picture rather than copying its swatches. The bright environment demonstrates that atmosphere need not come from muting the whole background; the current game's action, identity and viewing conditions determine its own treatment.

Carry the selected relationships into a representative asset/scene and the existing design source. Compare the real play view before and after a consequential state change. A grayscale view can help isolate value competition, but does not certify color accessibility or replace the color view. Hex values and pixel counts cannot decide whether the mood or emphasis fits.

[Riot's clarity discussion](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) supports matching audiovisual prominence to gameplay importance. This reference adapts that reasoning, not League's competitive constraints, colors or skin rules.

## Source studies: contrast placement and painted color

Valve's current [Dota 2 Character Art Guide](https://help.steampowered.com/en/faqs/view/0688-7692-4D5A-1935) documents original/revised character examples, including Witch Doctor, Lion and Beastmaster. The authors describe redistributing value contrast, saturation and detail to important features while keeping areas of rest. Use those examples for a concrete competition between face, equipment and surrounding detail, inspecting the guide's pictures when making a visual comparison. Its top-down value gradient, palette construction and pure-color restrictions belong to Dota's rendering and identification needs; they do not set another game's palette size or forbid bright environments. The retired PDF now redirects to this web guide.

[GRIS's official gallery](https://nomada.studio/gris-game/) offers a different color/material relationship:

![Official GRIS Screen 1: ink-dark rock and branching forms over a pale textured field](https://nomada.studio/wp-content/uploads/2018/08/GRIS-Screen-1.jpg)

![Official GRIS Screen 14: cool architectural planes and fine outlines against a warm translucent wash](https://nomada.studio/wp-content/uploads/2018/08/GRIS-Screen-14.jpg)

The first picture is largely near-monochrome; the second combines cool, sharply bounded architecture with warmer soft-edged washes. Paper-like grain, edge quality and the scale of the color masses contribute to the appearance alongside hue. For a selected painted treatment, decide which surfaces need those different marks and boundaries; a matching gradient behind generic blocks would retain only part of the relationship. These are different scenes, not a controlled recoloring comparison or proof that pale colors suit every game. Their stills do not establish motion or the production renderer.

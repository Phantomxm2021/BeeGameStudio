# Lighting and Atmosphere

Start with what the player must see and how the scene should feel. Check key light, shadow, material response, fog, post-processing, and effects in the actual camera view. Darkness, glare, or concealment may be intentional, but required navigation and interaction cues still need an understandable path.

Choose baked, dynamic, or hybrid lighting from scene behavior and measured target-platform cost; desktop, mobile, and XR do not mandate one quality tier. Compare the result in motion as well as in a still image.

## Decide what the light should do

Relate light to the subject's space and material: where it comes from, what it reveals, what remains quiet, and whether it represents a gameplay state. Mood words such as "warm" or "mysterious" do not decide these relationships. A flat graphic game can convey them through authored values and shapes without a physical lighting system.

- Distinguish the visible light source, illumination on surrounding surfaces, and a state indicator. A glowing lamp sprite may communicate activation but does not by itself make the facility look illuminated. Add surface response only when the selected direction needs it.
- Use light/shadow or authored value groups to separate useful planes and anchor objects. Choose contact/shadow softness and direction consistently with the intended treatment; do not apply realistic shadows to every flat UI element to manufacture depth.
- Reserve stronger local emphasis for the subject that needs attention. Increasing bloom everywhere can erase edges and material distinctions. Fog, reflections and moving highlights should reinforce the chosen atmosphere without concealing the information needed for the action.
- For a state change, decide whether only an indicator changes or the surrounding place also changes. A brief flash is an event response, not a substitute for a persistent restored/damaged appearance. Keep the resulting view compatible with the next action.

For the [canal-crossing exercise](../../game-level-designer-expert/references/encounter-design-patterns.md#worked-scene-reasoning-a-canal-crossing), a lighter exposed slab top against a darker recessed wall could separate the landing without adding a beacon. Strong water highlights might instead pull attention into the gap, so their prominence should follow the intended crossing experience. This is an untested art hypothesis; other moods or mechanics can justify different treatment.

Check the implementation path before extending the effect. Sprites may already contain painted highlights/shadows; runtime light can reinforce or contradict them. Programmatic gradients, baked art and dynamic lighting are alternatives with different behavior and cost, not quality ranks. Inspect the subject with its neighboring surfaces, world cues and HUD at the supported view; a lighting parameter or isolated glow preview does not establish the combined result.

[Godot's 2D lighting documentation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html) distinguishes ambient modulation, light textures, receiving surfaces and occluders. Use it to understand those mechanisms when relevant, not to require Godot, shadows or normal maps for every game. The craft choices above are design reasoning, not engine guarantees.

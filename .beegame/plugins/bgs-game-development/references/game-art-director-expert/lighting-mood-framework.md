# Lighting and Atmosphere

Start with what the player must see and how the scene should feel. Check key light, shadow, material response, fog, post-processing, and effects in the actual camera view. Darkness, glare, or concealment may be intentional, but required navigation and interaction cues still need an understandable path.

Choose baked, dynamic, or hybrid lighting from scene behavior and measured target-platform cost; desktop, mobile, and XR do not mandate one quality tier. Compare the result in motion as well as in a still image.

## Decide what the light should do

Relate light to the subject's space and material: where it comes from, what it reveals, what remains quiet, and whether it represents a gameplay state. Mood words such as "warm" or "mysterious" do not decide these relationships. A flat graphic game can convey them through authored values and shapes without a physical lighting system.

- Distinguish the visible light source, illumination on surrounding surfaces, and a state indicator. A glowing lamp sprite may communicate activation but does not by itself make the facility look illuminated. Add surface response only when the selected direction needs it.
- Use light/shadow or authored value groups to separate useful planes and anchor objects. Choose contact/shadow softness and direction consistently with the intended treatment; do not apply realistic shadows to every flat UI element to manufacture depth.
- Reserve stronger local emphasis for the subject that needs attention. Increasing bloom everywhere can erase edges and material distinctions. Fog, reflections and moving highlights should reinforce the chosen atmosphere without concealing the information needed for the action.
- For a state change, decide whether only an indicator changes or the surrounding place also changes. A brief flash is an event response, not a substitute for a persistent restored/damaged appearance. Keep the resulting view compatible with the next action.

In the [playable-scene study](../game-scene-designer/encounter-design-patterns.md#worked-scene-study-an-existing-platformer), lighter warm surface tops and darker rock sides give the platforms thickness, while the cooler sky/background keeps their depth relationship legible. The picture supports that visual reading, not a claim that dynamic lights or a particular shader produced it. Judge illumination together with surface, actor and next action; extra glow is not necessary to make this scene feel like a place. Other adopted moods can use different relationships.

Check the implementation path before extending the effect. Sprites may already contain painted highlights/shadows; runtime light can reinforce or contradict them. Programmatic gradients, baked art and dynamic lighting are alternatives with different behavior and cost, not quality ranks. Inspect the subject with its neighboring surfaces, world cues and HUD at the supported view; a lighting parameter or isolated glow preview does not establish the combined result.

[Godot's 2D lighting documentation](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html) distinguishes ambient modulation, light textures, receiving surfaces and occluders. Use it to understand those mechanisms when relevant, not to require Godot, shadows or normal maps for every game. The craft choices above are design reasoning, not engine guarantees.

## Source study: change the illumination relationship

Blizzard's [Environment States production article](https://overwatch.blizzard.com/en-gb/news/23674944/) pairs these Necropolis views:

![Official Necropolis night environment study: cool stone and sky with warm doorway lights](https://bnetcmsus-a.akamaihd.net/cms/page_media/sk/SKB13VFEOV4B1623099499162.png)

![Official Necropolis daytime environment study: broad warm illumination, pale stone and a cooler sky](https://bnetcmsus-a.akamaihd.net/cms/page_media/0q/0QBSIVFNQZ5T1623099529378.png)

The architecture remains recognizable while the distribution of illumination changes: localized warm entrances stand out at night; broad daylight exposes stone planes and different shadow masses. This is a useful comparison for a mood change that needs more than a global tint. Relate sky/ambient light, directional light, local sources and surface response to the intended place. The authors explain their own engine's implementation; adopting the visual relationship does not require an Environment States framework. These environment studies contain no active combat or HUD and cannot establish character/effect readability during play.

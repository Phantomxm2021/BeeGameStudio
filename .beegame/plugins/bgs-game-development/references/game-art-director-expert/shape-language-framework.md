# Shape Language

Use repeated proportion, edge treatment, silhouette, and material cues to make related assets feel authored together. Use deliberate contrast to distinguish a threat, ally, interactable, or background object; round and sharp shapes have no fixed meaning across all games.

Check recognizability at the object's actual size and camera distance. For modular pieces, preserve source pivots, scale, and assembly relationships instead of independently normalizing every part.

## Make the family concrete

Choose shape treatment from the subject's construction and the intended action, not just adjectives such as "industrial" or "friendly". For the family being made, identify the relationships that should survive replacement: broad proportions, characteristic silhouette, edge treatment, material joins and viewing/projection angle. Keep useful exceptions; a shared family does not require every object to have the same outline.

- Establish the main mass and the feature that communicates identity or use before small ornament. A cabinet's handle may explain interaction; screws usually communicate construction. Do not give both equal prominence by default.
- Place secondary detail where it clarifies material, orientation or assembly. Judge line thickness, bevels and texture marks at displayed size; detail that collapses into noisy pixels is not additional finish.
- Compare neighboring objects together. Individually attractive assets can disagree in perspective, scale, shadow treatment or texture density and look pasted onto the scene. Repair the incompatible relationship rather than adding the same outline to everything.
- Relate UI and world through suitable edge, type, icon or material treatment, not by turning each control into a literal world object. Preserve legibility and meaningful control states.

In the [playable-scene study](../game-scene-designer/encounter-design-patterns.md#worked-scene-study-an-existing-platformer), grass-covered platform tops, heavy rock sides, hanging vegetation and the actor's feet describe support and depth together. The silhouette and interior surface treatment have different jobs. Inspect the actual scene/collision source before treating every visible leaf or chipped edge as a gameplay boundary. Preserve that distinction with the current game's subject and camera; floating platforms and pixel-art contours are not a default shape family.

For a directional actor, choose a representation that can express its required facing and movement: suitable rotation, directional frames or another supported treatment. A fixed three-quarter image with a rotating light does not automatically show the body turning. Inspect the whole subject in context before producing variants; extra frames are not required when the chosen representation already communicates the action.

Use [Veloren's model guide](https://book.veloren.net/contributors/artists/voxel-models.html) as an example of referring to actual models and world scale. Its voxel dimensions are specific to that project, not proportions to copy. Asset compatibility and recognizable identity remain judgments in the actual camera view, not consequences of naming a family.

## Source study: form survives the renderer

Valve's [Illustrative Rendering in Team Fortress 2](https://cdn.steamstatic.com/apps/valve/2007/NPAR07_IllustrativeRenderingInTeamFortress2.pdf#page=2), Figure 2, compares the classes with their solid silhouettes. Body mass, stance and weapon profiles distinguish them without interior detail. Figure 1 pairs a painted Pyro concept with the in-game character: the bulky equipment and body proportions carry identity across different surface treatments.

Use this comparison when attractive isolated assets lose their identity in the play view. Distinguish an inadequate outer profile from weak internal plane shading: repainting highlights cannot restore missing body mass or a characteristic opening. The paper explains TF2's particular modeling, texture and shading choices; it does not make rim lighting, a shooter camera or its illustration style requirements for another game. Rendering an adopted relationship uses [material and shading](material-and-shading.md).

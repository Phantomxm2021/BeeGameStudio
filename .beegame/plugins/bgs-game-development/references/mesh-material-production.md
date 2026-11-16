# Mesh and material production

Use for producing or repairing 3D game meshes, material maps or baked detail. A material edit preserves supplied geometry; a usable game mesh does not need bake-down merely because this method exists.

## Geometry, UVs and baking

For a high-to-low conversion, preserve the textured source and choose the runtime budget from gameplay camera distance, silhouette, deformation needs and target constraints. Decimate or retopologize a separate copy; inspect thin parts and moving joints rather than optimizing to a universal face count.

Give the target mesh usable UVs, appropriate texel density and island padding. Overlap can serve intentional reuse, but must not unintentionally combine unrelated baked regions. Before baking, establish source/target transforms, selected-to-active direction and cage or ray distance. Check seams, missed surfaces and projection from nearby parts. Preserve silhouette with geometry where a normal map cannot supply it.

## Texture meaning in the receiving renderer

Preserve supplied texture maps. Constant roughness or metallic factors can be authored approximations; derived guesses are not recovered source maps. Identify each map's actual channel content and UV set. Base-color and emissive color textures typically use sRGB encoding; normal, roughness, metallic and occlusion maps carry non-color data. Configure their import/sampling accordingly instead of applying gamma conversion to every image. For glTF packed ORM textures, R is occlusion, G roughness and B metallic. Map the actual channels to the receiving shader; a filename such as ORM is not proof of correct wiring.

glTF tangent-space normal textures use the +Y/OpenGL convention; convert a -Y/DirectX source when needed. Match tangent-space normal orientation and tangent handling to the target. Diagnose inverted surface relief before flipping a channel; apply conversion only when the source convention differs. Check the material on the intended mesh, with its actual lighting and gameplay distance, for roughness response, seams, tiling and transparency behavior. A flat texture preview does not show these relationships.

Keep texture paths and material assignments with the delivered mesh. When investigating an export, load that dependency set without the source-machine directory, so hidden absolute paths cannot make a broken delivery appear complete. Record actual maps, channels, color-space settings and dependencies in existing resource metadata; do not add another material registry.

Technical references: [glTF 2.0 materials](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc#materials) and [Godot material/normal conventions](https://docs.godotengine.org/en/stable/tutorials/3d/standard_material_3d.html). Use the actual target's import settings rather than copying one engine's packed-channel convention. Production example reviewed: [Mr. Mak materials-to-game](https://github.com/witnesstodark/mr-mak-workspace/blob/4f4bd3de65f71017ac5abada068066cece204a8e/.agents/skills/materials-to-game/SKILL.md).

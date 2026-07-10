# Resource Pack taxonomy design

## Goal

Make a Pack discoverable by its intended use without conflating the Pack with
the individual files it contains. A Pack may contain meshes, textures,
materials, animations, and previews together, so a file-level category cannot
serve as its primary category.

## Three independent axes

| Axis | Stored on | Purpose | Examples |
| --- | --- | --- | --- |
| Pack primary category | Pack | The Pack's primary production use | `2d-art`, `3d-assets`, `ui-kit`, `vfx`, `audio`, `fonts`, `world-scene`, `animation-rig`, `mixed` |
| Representation dimension | Pack and optional element override | Rendering representation | `2D`, `3D`, `agnostic` |
| Element type | Element | Concrete resource type used for previews, validation, and AI retrieval | `sprite`, `sprite-sheet`, `tilemap`, `static-mesh`, `skeletal-mesh`, `texture`, `material`, `animation-clip`, `skeleton-rig`, `particle-effect`, `scene`, `audio`, `font` |

Content subjects such as character, environment, weapon, architecture, food,
or vehicle are tags. They are not categories because each can appear in several
different element types and Pack kinds.

## Create Pack dialog

The existing singular `主分类` control remains a native select. Its values are
Pack primary categories only:

| Value | Display label | Use when |
| --- | --- | --- |
| `2d-art` | 2D 美术包 | Sprites, sprite sheets, tiles, and 2D props are the Pack's main output. |
| `3d-assets` | 3D 资产包 | Meshes, materials, textures, and 3D props are the main output. |
| `animation-rig` | 动画与骨骼包 | The Pack is primarily animation clips, rigs, skeletons, or skins. |
| `ui-kit` | UI Kit | The Pack delivers UI layouts, components, icons, or HUD assets. |
| `vfx` | VFX 包 | The Pack is primarily particle systems, shaders, or effect resources. |
| `audio` | 音频包 | The Pack is music, ambience, or sound effects. |
| `fonts` | 字体包 | The Pack is a typeface and its game-ready font resources. |
| `world-scene` | 世界与场景包 | The Pack delivers a scene, map, environment assembly, or world-building kit. |
| `mixed` | 综合资源包 | No single primary use accurately describes the Pack. |

Consequences: Tilemap belongs to a `2d-art` Pack and has element type
`tilemap`. UI has primary category `ui-kit`, even when it is 2D. A scene/map
has primary category `world-scene`; its child meshes and textures retain their
own element types.

## Data contract and migration

Add required `primaryCategory` to Pack records and APIs. Preserve the existing
`categories` field temporarily as a legacy, derived list of contained element
categories so previously imported Packs keep working. The UI must stop treating
`categories[0]` as a Pack's primary category.

Existing Pack records receive `primaryCategory: mixed` during migration unless
their legacy data unambiguously maps to one Pack primary category. Existing
legacy values such as `characters`, `environment`, and `tiles` remain readable
but are never offered to new Pack authors.

## AI retrieval

AI selection narrows in this order: Pack primary category, dimension, style,
game type, content tags, then element type and compatibility metadata. This
allows a request for a fantasy HUD to select a `ui-kit` Pack, not every 2D
image Pack; a request for a world map selects `world-scene`; and a request for
a tileset selects a `2d-art` Pack then `tilemap` elements.

## Validation and tests

- Pack creation rejects a missing or unsupported `primaryCategory`.
- New Pack category values are distinct from element types and content tags.
- Legacy Pack records remain listable and navigable.
- Element lookup stays filtered by element type/category, never by Pack primary
  category.
- Create dialog renders the unchanged select control and the specified values.

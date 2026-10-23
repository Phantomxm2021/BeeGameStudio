# Asset Manifest authoring contract (v9)

This is the canonical resource registry interface for this project. Read this
file before creating or registering runtime assets. It is an interface
reference, not a request to use a particular tool, source, engine, or asset
creation method.

## Deliverables

- `assets/asset-manifest.json` is an **index**, not a flat asset list.
- Its `modules.requirements` path is one JSON file directly under
  `assets/manifest/requirements/` with exactly `{ "requirements": [...] }`.
- Each path in `modules.resources` is one JSON file directly under
  `assets/manifest/resources/` whose root is one resource object.
- Every required requirement must be named by at least one resource's
  `fulfills` array. Resource files belong under
  `project_target.runtime_asset_root` (normally `assets/runtime`).
- Use workspace-relative paths. Record source, licence facts where applicable,
  and hashes as `local_file_hashes: { "assets/runtime/file.ext": "64-character lowercase sha256" }`.
  `hashes` is not consumed for integrity checking; do not use it instead.
  `root_path` is a loadable entry **file**, not a directory, and must occur in
  `file_paths`. Audio groups may choose one real clip as their default entry.
  Do not put Scene/UI/VFX content definitions in
  this registry.

## Canonical example

## Sprite atlas contract

Named atlas entries must use `frames: { "idle": { "frame": { "x": 0, "y": 0, "w": 32, "h": 32 } } }`.
Use an image and same-basename JSON sidecar in file_paths. Flat rectangles, rotated and trimmed entries are not supported.
Every rectangle must fit inside the actual image dimensions. Render the full atlas before registering it; do not clamp rectangles to conceal cropped artwork.
Run the resource checker after generating assets. Editors and Agent-written game code consume this data; the Agent owns target-engine mapping, not a BGS game runtime.

## Optional rectangular TileSet data

{
  "scope": "Rectangular orthogonal 2D only. Consider Tilemap for repetitive grid environments; the Agent decides. Characters, props and free-form artwork can remain separate objects. No engine or tool choice is prescribed.",
  "ownership": "Register a beegame-tileset.v1 JSON file in the existing Manifest (data resource, exact root_path/file_paths). It defines reusable tiles, not Scene positions. Tilemap.assetRef selects this resource; data.member optionally selects an exact registered JSON file. No new registry or image wrapper is needed.",
  "coordinates": "Logical pixels, +X right, +Y down. Grid lives on the Tilemap node or an ancestor named by gridNodeId. Grid supplies cellSize/cellGap; cells are measured in Tilemap-local space, inheriting Transform once. Tile pivot position = cell*(cellSize+cellGap)+cellSize*tileAnchor+tile.offset; top-left = pivot position - tile.size*tile.pivot. Defaults: gap/offset [0,0], anchor/pivot [0.5,0.5]. Tile display size is independent of cell size and image pixels.",
  "cells": "Sparse integer x/y (negative allowed), unique coordinates per Tilemap, empty cells omitted. Separate nodes are separate layers. Within one layer paint ascending y then x; layers use TilemapRenderer.sortingOrder (integer, default 0, higher in front). Tilemap requires TilemapRenderer on the same node. Empty maps are valid.",
  "references": "sprite.assetRef refers to a verified Manifest resource. sprite.member is its exact project-relative image path in file_paths. Optional atlasMember is an exact JSON path in the SAME resource; frame must accompany it and identify a named packed frame. Rotated/trimmed frames are unsupported. Every frame must fit the image. Multiple resources/atlases can be used in one TileSet. No filename guessing.",
  "collision": "Optional per-tile polygon points are logical pixels relative to tile pivot; >=3 points. mode is solid, trigger or one-way. one-way requires a nonzero normal in the same local y-down space. Tilemap collisionEnabled defaults false. Agent implements target physics; BGS only validates data and previews outlines.",
  "versions": "Only the exact versioned fields below are accepted. No unversioned/legacy Tilemap guessing or automatic project migration. schema/cellSize, schema/gridNodeId/cells, schema, and schema/tiles are required for Grid, Tilemap, TilemapRenderer and TileSet respectively. Components may add enabled (default true); Tile definitions may add pivot, offset, collision.",
  "examples": {
    "grid": {
      "id": "grid-layout",
      "type": "grid",
      "data": {
        "schema": "grid.v1",
        "cellSize": [
          32,
          32
        ],
        "cellGap": [
          0,
          0
        ]
      }
    },
    "tilemap": {
      "id": "ground-map",
      "type": "tilemap",
      "assetRef": "RES-TILES",
      "data": {
        "schema": "tilemap.v1",
        "gridNodeId": "grid-node",
        "tileAnchor": [
          0.5,
          0.5
        ],
        "collisionEnabled": true,
        "cells": [
          {
            "x": -1,
            "y": 0,
            "tileId": "ground"
          },
          {
            "x": 0,
            "y": 0,
            "tileId": "ground"
          }
        ]
      }
    },
    "renderer": {
      "id": "ground-renderer",
      "type": "tilemap-renderer",
      "data": {
        "schema": "tilemap-renderer.v1",
        "sortingOrder": 0
      }
    },
    "tileSet": {
      "schema": "beegame-tileset.v1",
      "tiles": {
        "ground": {
          "sprite": {
            "assetRef": "RES-ATLAS",
            "member": "assets/runtime/terrain.png",
            "atlasMember": "assets/runtime/terrain.json",
            "frame": "ground"
          },
          "size": [
            32,
            32
          ],
          "pivot": [
            0.5,
            0.5
          ],
          "collision": {
            "points": [
              [
                -16,
                -16
              ],
              [
                16,
                -16
              ],
              [
                16,
                16
              ],
              [
                -16,
                16
              ]
            ],
            "mode": "solid"
          }
        }
      }
    }
  }
}

### `assets/asset-manifest.json`

```json
{
  "version": 9,
  "project_target": {
    "platform": "web",
    "runtime": "example-runtime",
    "asset_format_capabilities": [
      "json"
    ],
    "resource_library_usage": "optional",
    "runtime_asset_root": "assets/runtime",
    "generated_asset_root": "assets/generated"
  },
  "modules": {
    "requirements": "assets/manifest/requirements/example.json",
    "resources": [
      "assets/manifest/resources/example-runtime-data.json"
    ]
  }
}
```

### `assets/manifest/requirements/example.json`

```json
{
  "requirements": [
    {
      "id": "EXAMPLE-RUNTIME-DATA",
      "name": "Example runtime data",
      "purpose": "Demonstrates one registered project resource.",
      "required": true,
      "acquisition_profile": {
        "dimensions": [
          "agnostic"
        ],
        "asset_kinds": [
          "data"
        ],
        "usage_tags": [],
        "capabilities": [],
        "styles": [
          "example"
        ]
      }
    }
  ]
}
```

### `assets/manifest/resources/example-runtime-data.json`

```json
{
  "id": "EXAMPLE-RUNTIME-DATA-01",
  "fulfills": [
    "EXAMPLE-RUNTIME-DATA"
  ],
  "source": {
    "type": "agent-authored",
    "created_at": "2026-01-01T00:00:00.000Z",
    "reason": "Example only."
  },
  "root_path": "assets/runtime/example/resource.json",
  "file_paths": [
    "assets/runtime/example/resource.json"
  ],
  "provisional": false,
  "status": "verified",
  "selected_at": "2026-01-01T00:00:00.000Z",
  "selection_reason": [
    "Example only."
  ],
  "dimension": "agnostic",
  "asset_kind": "data",
  "styles": [
    "example"
  ]
}
```

## Canonical values

- dimensions: [
  "2D",
  "3D",
  "agnostic"
]
- source types: [
  "resource-library",
  "web",
  "agent-authored",
  "user-provided"
]
- source fields (examples; replace placeholder values with actual provenance):

```json
{
  "resource-library": {
    "type": "resource-library",
    "pack_id": "pack-example",
    "pack_version": "1",
    "element_id": "element-example",
    "element_path": "sprites/example.png"
  },
  "web": {
    "type": "web",
    "source_url": "https://example.com/assets/example.png",
    "page_url": "https://example.com/assets",
    "license": "Example licence",
    "retrieved_at": "2026-01-01T00:00:00.000Z"
  },
  "agent-authored": {
    "type": "agent-authored",
    "created_at": "2026-01-01T00:00:00.000Z",
    "reason": "Example only."
  },
  "user-provided": {
    "type": "user-provided",
    "created_at": "2026-01-01T00:00:00.000Z",
    "filename": "example.png"
  }
}
```

  Web sources require the original asset URL, page URL, licence and retrieval
  time. Library sources require the pack and selected element identity. Keep
  source details attached to each registered resource; these examples do not
  prescribe which source to use.
- resource-library usage: [
  "optional",
  "preferred",
  "required"
]
- requirement asset kinds: [
  "image",
  "texture",
  "sprite",
  "sprite-sheet",
  "sprite-atlas",
  "frame-animation",
  "tileset",
  "tilemap",
  "mesh",
  "model",
  "scene",
  "material",
  "rig",
  "animation-clip",
  "animation-library",
  "ui-document",
  "ui-screen",
  "font",
  "audio-clip",
  "audio-cue",
  "audio-bank",
  "music",
  "ambience",
  "voice",
  "vfx",
  "shader",
  "physical-material",
  "collider",
  "input-profile",
  "data"
]
- resource status: [
  "available",
  "verified",
  "failed"
]
- `usage_tags` and `capabilities` describe the asset in your own words (string
  arrays), not a closed catalogue vocabulary. Extra resource/source description
  fields such as `notes` and `toolchain` are preserved, not rejected.

## Check the actual delivery interface

From the project root, run `bun assets/manifest/check.mjs` when useful.
The generated `check.mjs` is executable code, not an authoring document; use
this CONTRACT.md for the format instead of reading the bundled checker. This
is the host's own read-only checker, bundled into the project. Exit 0 means
the resource interface passes; exit 1 returns specific issues. It checks registry
readability, required bindings, files, hashes and the confirmed sourcing policy.
It does not certify artistic or gameplay quality and does not require another
agent. If correcting an existing delivery, retain usable assets and address the
reported issues rather than recreating everything.

Use only relevant fields. Preserve the exact index/module separation above;
the host reads the completed registry after this turn finishes.

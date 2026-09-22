/** Author-facing data documentation, shared by resource and content tasks. */
export const TILEMAP_AUTHORING_CONTRACT = {
  scope: 'Rectangular orthogonal 2D only. Consider Tilemap for repetitive grid environments; the Agent decides. Characters, props and free-form artwork can remain separate objects. No engine or tool choice is prescribed.',
  ownership: 'Register a beegame-tileset.v1 JSON file in the existing Manifest (data resource, exact root_path/file_paths). It defines reusable tiles, not Scene positions. Tilemap.assetRef selects this resource; data.member optionally selects an exact registered JSON file. No new registry or image wrapper is needed.',
  coordinates: 'Logical pixels, +X right, +Y down. Grid lives on the Tilemap node or an ancestor named by gridNodeId. Grid supplies cellSize/cellGap; cells are measured in Tilemap-local space, inheriting Transform once. Tile pivot position = cell*(cellSize+cellGap)+cellSize*tileAnchor+tile.offset; top-left = pivot position - tile.size*tile.pivot. Defaults: gap/offset [0,0], anchor/pivot [0.5,0.5]. Tile display size is independent of cell size and image pixels.',
  cells: 'Sparse integer x/y (negative allowed), unique coordinates per Tilemap, empty cells omitted. Separate nodes are separate layers. Within one layer paint ascending y then x; layers use TilemapRenderer.sortingOrder (integer, default 0, higher in front). Tilemap requires TilemapRenderer on the same node. Empty maps are valid.',
  references: 'sprite.assetRef refers to a verified Manifest resource. sprite.member is its exact project-relative image path in file_paths. Optional atlasMember is an exact JSON path in the SAME resource; frame must accompany it and identify a named packed frame. Rotated/trimmed frames are unsupported. Every frame must fit the image. Multiple resources/atlases can be used in one TileSet. No filename guessing.',
  collision: 'Optional per-tile polygon points are logical pixels relative to tile pivot; >=3 points. mode is solid, trigger or one-way. one-way requires a nonzero normal in the same local y-down space. Tilemap collisionEnabled defaults false. Agent implements target physics; BGS only validates data and previews outlines.',
  versions: 'Only the exact versioned fields below are accepted. No unversioned/legacy Tilemap guessing or automatic project migration. schema/cellSize, schema/gridNodeId/cells, schema, and schema/tiles are required for Grid, Tilemap, TilemapRenderer and TileSet respectively. Components may add enabled (default true); Tile definitions may add pivot, offset, collision.',
  examples: {
    grid: { id: 'grid-layout', type: 'grid', data: { schema: 'grid.v1', cellSize: [32,32], cellGap: [0,0] } },
    tilemap: { id: 'ground-map', type: 'tilemap', assetRef: 'RES-TILES', data: { schema: 'tilemap.v1', gridNodeId: 'grid-node', tileAnchor: [.5,.5], collisionEnabled: true, cells: [{x: -1,y: 0,tileId:'ground'},{x:0,y:0,tileId:'ground'}] } },
    renderer: { id: 'ground-renderer', type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1', sortingOrder: 0 } },
    tileSet: { schema:'beegame-tileset.v1', tiles: { ground: {
      sprite: {assetRef:'RES-ATLAS',member:'assets/runtime/terrain.png',atlasMember:'assets/runtime/terrain.json',frame:'ground'},
      size:[32,32],pivot:[.5,.5],
      collision:{points:[[-16,-16],[16,-16],[16,16],[-16,16]],mode:'solid'},
    } } },
  },
} as const

import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tuple, number, strictObject, string, boolean, array, unknown as unknownSchema } from 'zod/v4'
import { parseBeeGameContentDocument } from './game-content-schema'
import { contentDraftStructureIssues } from './game-content-package'

const pair = tuple([number().int().safe(), number().int().safe()])
const layerSchema = strictObject({
  cellSize: tuple([number().positive(), number().positive()]),
  cellGap: pair.optional(), assetRef: string().min(1).optional(),
  collisionEnabled: boolean().optional(), sortingOrder: number().int().optional(),
  regions: array(strictObject({ from: pair, to: pair, tileId: string().min(1) })),
})

/** Only expands mechanical hierarchy and rectangular tile repetitions. The
 * output is the existing format; this never selects gameplay or fixes intent. */
export function composeDraft(input: unknown) {
  const draft = structuredClone(input) as any
  if (!draft || !Array.isArray(draft.data?.nodes)) throw Error('Expected the existing content document with data.nodes')
  const isUi = ['ui-screen', 'ui-hud', 'ui-flow'].includes(draft.kind)
  if (!isUi && !['scene-2d', 'scene-3d'].includes(draft.kind)) throw Error('Only Scene/UI drafts are supported')
  const nodes: any[] = [], ids = new Set<string>()
  const visit = (source: any, parent?: string) => {
    if (!source || typeof source !== 'object' || typeof source.id !== 'string' || !source.id || ids.has(source.id))
      throw Error('Each node needs a unique nonempty id')
    ids.add(source.id)
    const { children, tileLayer, ...node } = source
    if (parent !== undefined) {
      if (node.parentId !== undefined && node.parentId !== parent) throw Error(`Conflicting parentId: ${node.id}`)
      node.parentId = parent
    }
    if (isUi && node.layout?.container && node.layout?.size?.some((n: unknown) => n === 0))
      throw Error(`${node.id}: zero size is not auto sizing. Omit size for a content-sized container; use minSize/maxSize for constraints.`)
    if (tileLayer !== undefined) {
      if (draft.kind !== 'scene-2d') throw Error('tileLayer requires scene-2d')
      if ((node.components ?? []).some((c: any) => ['grid', 'tilemap', 'tilemap-renderer'].includes(c.type)))
        throw Error(`${node.id}: tileLayer cannot override explicit grid/tilemap components`)
      const layer = layerSchema.parse(tileLayer), cells: any[] = [], occupied = new Set<string>()
      for (const region of layer.regions) {
        const [x0, y0] = region.from, [x1, y1] = region.to
        const count = (x1 - x0 + 1) * (y1 - y0 + 1)
        if (x1 < x0 || y1 < y0 || !Number.isSafeInteger(count) || cells.length + count > 1_000_000)
          throw Error(`${node.id}: invalid or unsafe tile expansion (maximum one million cells per layer)`)
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const key = `${x},${y}`
          if (occupied.has(key)) throw Error(`${node.id}: overlapping tile regions at ${key}`)
          occupied.add(key); cells.push({ x, y, tileId: region.tileId })
        }
      }
      node.components = [...node.components ?? [],
        { id: `${node.id}-grid`, type: 'grid', data: { schema: 'grid.v1', cellSize: layer.cellSize, cellGap: layer.cellGap ?? [0, 0] } },
        { id: `${node.id}-map`, type: 'tilemap', ...(layer.assetRef ? { assetRef: layer.assetRef } : {}),
          data: { schema: 'tilemap.v1', gridNodeId: node.id, cells, collisionEnabled: layer.collisionEnabled ?? false } },
        { id: `${node.id}-renderer`, type: 'tilemap-renderer', data: { schema: 'tilemap-renderer.v1', sortingOrder: layer.sortingOrder ?? 0 } },
      ]
    }
    nodes.push(node)
    if (children !== undefined) {
      if (!Array.isArray(children)) throw Error(`${node.id}: children must be an array`)
      for (const child of children) visit(child, node.id)
    }
  }
  for (const node of draft.data.nodes) visit(node)
  draft.data.nodes = nodes
  const parsed = parseBeeGameContentDocument(draft)
  const issues = contentDraftStructureIssues(isUi ? 'content/ui/draft.json' : 'content/scenes/draft.json', parsed)
  if (issues.length) throw Error(issues.join('; '))
  return parsed
}

/** New drafts only. Revisions use exact edits; never replace existing sources. */
export function createComposedDrafts(workspace: string, input: unknown) {
  const requests = array(strictObject({ file: string(), document: unknownSchema() })).min(1).parse(input)
  const root = realpathSync(workspace), seen = new Set<string>()
  const target = (file: string) => {
    if (!/^content\/(ui|scenes)\/.+\.json$/.test(file) || file.includes('\\') || file.split('/').some(s => !s || s === '.' || s === '..'))
      throw Error('Use a relative content/ui or content/scenes JSON path')
    let path = root
    for (const part of file.split('/')) {
      path = join(path, part)
      try {
        if (lstatSync(path).isSymbolicLink()) throw Error('Draft path cannot contain symlinks')
        if (path === join(root, file)) throw Error('Draft already exists; use exact edits')
        if (!lstatSync(path).isDirectory()) throw Error('Draft parent is not a directory')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return path
  }
  const prepared = requests.map(({ file, document }) => {
    if (seen.has(file)) throw Error('Duplicate draft path: ' + file)
    seen.add(file)
    const path = target(file), draft = composeDraft(document)
    if (file.startsWith('content/ui/') !== draft.kind.startsWith('ui-')) throw Error('Draft kind does not match directory')
    return { file, path, content: JSON.stringify(draft, null, 2) + '\n' }
  })
  const written: string[] = [], issues: string[] = []
  for (const item of prepared) try {
    target(item.file)
    mkdirSync(dirname(item.path), { recursive: true })
    target(item.file)
    writeFileSync(item.path, item.content, { flag: 'wx' }); written.push(item.file)
  } catch (error) { issues.push(String(error)); break }
  return { valid: !issues.length, written, pending: requests.map(r => r.file).filter(f => !written.includes(f)), issues,
    note: 'Structure only; run the existing layout checks. No resources, aesthetics or gameplay certified. Per-file saves, not a transaction.' }
}

export const COMPOSE_DRAFT_HELP = `Usage: bun .beegame/delivery/compose-drafts.mjs --json '[{"file":"content/ui/menu.json","document":{...}}]'
Supply existing Scene/UI document fields. Optional children:[nodes] expands parentId and flattens nodes; conflicting parentId is rejected.
For a UI auto-sized container omit layout.size; zero is a real dimension, not auto. The normal layout.container/item fields control flow. Anchored overlays require item.absolute:true.
For repetitive Scene tiles, node.tileLayer:{cellSize:[16,16],assetRef:"RES-TILES",collisionEnabled:true,regions:[{from:[0,0],to:[9,2],tileId:"ground"}]} generates Grid, Tilemap and renderer on the SAME node. from/to are inclusive integer cells; overlaps fail. Optional cellGap and sortingOrder retain existing meanings.
Keep camera, behaviors, appearance, root viewport constraints and decisions explicit. Use existing native nodes for other structures. This is mechanical expansion, not design generation.
All sources are preflighted; saves are per file with written/pending on I/O failure. Existing files never overwritten. No new role permissions. Review remains under its original edit scope.`
export function runComposeDraftCli() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') { console.log(COMPOSE_DRAFT_HELP); return }
  if (args.length !== 2 || args[0] !== '--json') throw Error(COMPOSE_DRAFT_HELP)
  const result = createComposedDrafts(process.cwd(), JSON.parse(args[1]!))
  console.log(JSON.stringify(result)); if (!result.valid) process.exitCode = 1
}

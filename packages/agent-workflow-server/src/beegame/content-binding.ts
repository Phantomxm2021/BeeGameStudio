import type { z } from 'zod/v4'
import { strictObject, string, record as schemaRecord, unknown, array } from 'zod/v4'
import { readFile, realpath, open, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve } from 'node:path'
import { parseBeeGameContentDocument, validateContentDocument, type BeeGameContentAuthority } from './game-content-package'
import { designSupportingBytesDigest } from './design-handoff'
import { projectContentAuthority } from './project-content-authority'
import { validateResourceSelections } from './tilemap-contract'
import { BEEGAME_SCENE_ASSET_COMPONENT_TYPES, CONTENT_RESOURCE_LOCATOR_KEYS } from './game-content-schema'
import { readBeeGameAssetManifestSync, readBeeGameAssetManifestModulePathsSync } from './asset-contracts'

const patchSchema = strictObject({
  assetRef: string().optional(), data: schemaRecord(string(), unknown()).optional(),
  style: schemaRecord(string(), unknown()).optional(),
  actions: schemaRecord(string(), string()).optional(), bindings: schemaRecord(string(), string()).optional(),
})
const contentPathSchema = string().regex(/^content\/(?:ui|scenes)\/[A-Za-z0-9_./-]+\.json$/)
export const contentBindingRequestSchema = array(strictObject({
  file: contentPathSchema,
  sha256: string().regex(/^[a-f0-9]{64}$/),
  nodes: array(strictObject({ id: string().min(1), componentId: string().min(1).optional(), set: patchSchema })).min(1),
})).min(1)
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function merge(target: Record<string, unknown>, patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Unsafe binding key')
    if (key === 'actions' || key === 'bindings') target[key] = value
    else if (record(value)) {
      if (!record(target[key])) target[key] = {}
      merge(target[key] as Record<string, unknown>, value)
    } else target[key] = value
  }
}
function references(value: unknown, output: Set<string>) {
  if (Array.isArray(value)) value.forEach(item => references(item, output))
  else if (record(value)) {
    if (typeof value.assetRef === 'string') output.add(value.assetRef)
    Object.values(value).forEach(item => references(item, output))
  }
}
export function contentBindingAssetRefs(value: unknown): string[] {
  const refs = new Set<string>(); references(value, refs); return [...refs]
}
async function sourcePath(root: string, file: string) {
  if (file.split('/').includes('..')) throw Error('Expected a file inside the project workspace')
  const target = resolve(root, file), actual = await realpath(target), local = relative(root, actual)
  if (actual !== target || local === '..' || local.startsWith('../') || isAbsolute(local)) throw Error('Content path escapes project or follows a symlink')
  return actual
}

/** Binding operands from current bytes, not generated mappings or a design
 * summary. Works before content/index.json and resource production exist. */
export async function inspectContentBindings(workspace: string, paths: string[]) {
  if (!paths.length) throw Error('Supply saved content/ui or content/scenes files after --inspect')
  const root = await realpath(workspace)
  const files = [], issues: string[] = []
  // Do not replay Tilemap cells, geometry or layoutCamera links just to obtain
  // IDs and existing bindings. Exact full nodes remain available via inspect-draft.
  const locators = (value: Record<string, unknown> = {}) => Object.fromEntries(
    [...CONTENT_RESOURCE_LOCATOR_KEYS, 'font', 'image', 'texture'].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
  for (const file of [...new Set(paths)]) try {
    contentPathSchema.parse(file)
    const bytes = await readFile(await sourcePath(root, file))
    const document = parseBeeGameContentDocument(JSON.parse(bytes.toString()))
    if (!['ui-screen', 'ui-hud', 'ui-flow', 'scene-2d', 'scene-3d'].includes(document.kind))
      throw Error('Expected a Scene or UI document')
    const nodes = (document.data as { nodes: Array<Record<string, any>> }).nodes
    files.push({ file, sha256: hash(bytes), documentId: document.id, kind: document.kind, assetRefs: document.assetRefs,
      nodes: nodes.map(node => ({
        id: node.id, name: node.name, semantic: node.semantic, ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(document.kind.startsWith('scene') ? {
          components: (node.components ?? []).map((component: Record<string, unknown>) => ({
            componentId: component.id, type: component.type, assetRef: component.assetRef, data: locators(component.data as Record<string, unknown> | undefined),
          })).filter((component: { type: unknown }) =>
            (BEEGAME_SCENE_ASSET_COMPONENT_TYPES as readonly unknown[]).includes(component.type)),
        } : { role: node.role, text: node.text, assetRef: node.assetRef, actions: node.actions, bindings: node.bindings,
          data: locators(node.data), style: locators(node.style) }),
      })).filter(node => !('components' in node) || node.components.length),
    })
  } catch (error) { issues.push(file + ': ' + (error instanceof Error ? error.message : String(error))) }
  return { valid: !issues.length, scope: 'saved-binding-inputs', files, issues,
    note: 'Current source operands only; no binding selection or quality verdict. Keep valid bindings. SHA-256 must still match when applying edits.' }
}

/** Execute explicit assignments only. Protected decisions use the SAME digest
 * as release checks. All files are prepared before any write; commits are per
 * file, never advertised as a multi-file transaction or concurrent-edit lock. */
export async function bindContent(workspace: string, request: unknown, signal?: AbortSignal, context?: {
  readAuthority(root: string): BeeGameContentAuthority | Promise<BeeGameContentAuthority>;
  assertWritable(file: string): void;
}) {
  const written: Array<{ file: string; sha256: string; nodes: string[]; changed: boolean }> = []
  const issues: string[] = []
  const prepared: Array<{ file: string; path: string; before: Buffer; after: Buffer; nodes: string[] }> = []
  let files: z.infer<typeof contentBindingRequestSchema> = []
  try {
    files = contentBindingRequestSchema.parse(request)
    signal?.throwIfAborted()
    if (new Set(files.map(item => item.file)).size !== files.length) throw Error('One batch entry per file is required')
    for (const item of files) context?.assertWritable(item.file)
    const readAuthority = context?.readAuthority ?? projectContentAuthority
    const root = await realpath(workspace), authority = await readAuthority(root)
    for (const item of files) {
      try {
        signal?.throwIfAborted()
        const path = await sourcePath(root, item.file), before = await readFile(path)
        if (hash(before) !== item.sha256) throw Error('Source SHA-256 changed; reread this file before binding')
        const doc = parseBeeGameContentDocument(JSON.parse(before.toString()))
        if (!['ui-screen', 'ui-hud', 'ui-flow', 'scene-2d', 'scene-3d'].includes(doc.kind)) throw Error('Expected a Scene or UI document')
        const nodes = (doc.data as { nodes: Array<Record<string, any>> }).nodes
        const targets = new Set<string>()
        for (const edit of item.nodes) {
          const key = JSON.stringify([edit.id, edit.componentId])
          if (targets.has(key)) throw Error(`Duplicate assignment for node ${edit.id}/${edit.componentId ?? ''}`)
          targets.add(key)
          const matches = nodes.filter(node => node.id === edit.id)
          if (matches.length !== 1) throw Error(`Node ${edit.id} is missing or ambiguous`)
          let target = matches[0]!
          if (edit.componentId) {
            const components = target.components?.filter((c: { id: string }) => c.id === edit.componentId) ?? []
            if (components.length !== 1) throw Error(`Component ${edit.id}/${edit.componentId} is missing or ambiguous`)
            target = components[0]
          } else if (doc.kind.startsWith('scene')) throw Error(`Scene node ${edit.id} requires an exact componentId`)
          merge(target, edit.set)
        }
        // Do not delete old declarations: TileSets and runtime metadata can
        // reference assets that aren't visible in this node patch.
        const assets = new Set(doc.assetRefs)
        references(doc.data, assets)
        doc.assetRefs = [...assets]
        const candidate = parseBeeGameContentDocument(doc)
        const after = Buffer.from(JSON.stringify(candidate, null, 2) + '\n')
        if (designSupportingBytesDigest(item.file, before) !== designSupportingBytesDigest(item.file, after))
          throw Error('Binding would change protected design fields; use the existing affected-owner resolution')
        const errors: string[] = []
        validateContentDocument({ workspacePath: root, path: item.file, document: candidate, authority, issues: errors })
        validateResourceSelections(root, authority.manifest, candidate.data, errors, item.file)
        if (errors.length) throw Error(errors.join('; '))
        prepared.push({ file: item.file, path, before, after: JSON.stringify(JSON.parse(before.toString())) === JSON.stringify(candidate) ? before : after,
          nodes: item.nodes.map(node => node.id + (node.componentId ? '/' + node.componentId : '')) })
      } catch (error) { issues.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (issues.length) return { valid: false, written, pending: files.map(item => item.file), issues }
    for (const item of prepared) {
      const temporary = item.path + '.' + randomUUID() + '.tmp'
      try {
        signal?.throwIfAborted()
        const currentAuthority = await readAuthority(root)
        if (currentAuthority.documentRevision !== authority.documentRevision || currentAuthority.assetManifestRevision !== authority.assetManifestRevision)
          throw Error('Design or asset registry changed before commit; refresh the task inputs')
        if (await sourcePath(root, item.file) !== item.path || hash(await readFile(item.path)) !== hash(item.before)) throw Error('Source changed before commit')
        const changed = !item.after.equals(item.before)
        if (changed) {
          const handle = await open(temporary, 'wx', 0o600)
          try { await handle.writeFile(item.after); await handle.sync() } finally { await handle.close() }
          if (await sourcePath(root, item.file) !== item.path || hash(await readFile(item.path)) !== hash(item.before)) throw Error('Source changed during commit preparation')
          await rename(temporary, item.path)
        }
        written.push({ file: item.file, sha256: hash(item.after), nodes: item.nodes, changed })
      } catch (error) { issues.push(`${item.file}: ${error instanceof Error ? error.message : String(error)}`); break }
      finally { await unlink(temporary).catch(() => {}) }
    }
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  return { valid: !issues.length, written, pending: files.map(item => item.file).filter(file => !written.some(item => item.file === file)), issues,
    limitations: ['Binding/schema success is not visual or gameplay acceptance.', 'Do not edit these same files concurrently; hashes are conflict detection, not a shared writer lock.'] }
}

/** File-authorized native use: real saved content/registry/member versions,
 * not an invented eight-document release. This only binds the explicit batch;
 * design intent, missing original requirements and runtime use remain unverified. */
export async function bindCurrentContent(workspace:string, request:unknown, signal?:AbortSignal) {
  const files=contentBindingRequestSchema.parse(request),root=await realpath(workspace)
  const targets=new Set(files.map(item=>item.file))
  return bindContent(root,files,signal,{
    assertWritable(file){if(!targets.has(file))throw Error('Binding target not explicitly requested')},
    async readAuthority() {
      const refs=new Set(contentBindingAssetRefs(files)),sources=[]
      for(const file of targets) {
        const bytes=await readFile(await sourcePath(root,file))
        const document=parseBeeGameContentDocument(JSON.parse(bytes.toString()))
        document.assetRefs.forEach(id=>refs.add(id))
        sources.push([file,designSupportingBytesDigest(file,bytes)])
      }
      const manifest=readBeeGameAssetManifestSync(root),assets=[]
      for(const file of readBeeGameAssetManifestModulePathsSync(root))
        assets.push([file,hash(await readFile(await sourcePath(root,file)))])
      for(const resource of manifest.resources.filter(item=>refs.has(item.id)))
        for(const file of new Set([...resource.file_paths,...(resource.dependencies?.map(d=>d.local_path) ?? [])]))
          assets.push([file,hash(await readFile(await sourcePath(root,file)))])
      return {documentRevision:hash(Buffer.from(JSON.stringify(sources))),
        assetManifestRevision:hash(Buffer.from(JSON.stringify({manifest,assets}))),manifest}
    },
  })
}

export async function runContentBindingCli() {
  const args = process.argv.slice(2)
  if (args[0] === '--inspect') {
    const result = await inspectContentBindings(process.cwd(), args.slice(1))
    console.log(JSON.stringify(result))
    if (!result.valid) process.exitCode = 1
    return
  }
  if (args.length === 1 && args[0] === '--help') {
    console.log('Autonomous native use: --current mapping.json binds only those saved files using current protected content, actual Manifest and referenced member bytes. No eight documents, index, Task or stage is required or fabricated. This is not design intent, original requirement coverage or runtime acceptance.')
    console.log('Inspect current binding inputs (read-only, no index required): bun .beegame/delivery/bind-content.mjs --inspect content/scenes/level.json content/ui/menu.json\nReturns exact source SHA-256, node IDs, component IDs and saved bindings for all requested files. Uses the same supported paths as the binding writer. Inspect full nodes with check-content.mjs --inspect-draft only when needed.')
    console.log('Usage: bun .beegame/delivery/bind-content.mjs --current mapping.json\nMapping file may use a relative or absolute path inside this workspace. Mapping: [{file:"content/ui/screen.json",sha256:"<current file SHA-256>",nodes:[{id:"play",set:{actions:{click:"game.start"},bindings:{enabled:"showStart"},data:{image:{assetRef:"buttons",member:"assets/buttons.png",frame:"play"}}}}]}]. enabled controls activation/visibility, not visible-disabled control behavior. Scene id selects the node; componentId separately selects its component. set deep-merges resource data/style, but replaces each supplied actions/bindings map ({} clears it). Preserve protected colors, opacity, geometry and other design fields after resource binding. All inputs validate before writes; failures report written and pending. This tool does not change content/index.json.')
    return
  }
  if (args[0]!=='--current' || args.length!==2) throw Error('Supply --current mapping.json or --inspect FILE ...; use --help')
  const root = await realpath(process.cwd())
  const request = JSON.parse(await readFile(await sourcePath(root, args[1]!), 'utf8'))
  const controller = new AbortController(), cancel = () => controller.abort(Error('Binding interrupted; inspect written and pending files before continuing'))
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  try {
    const result = await bindCurrentContent(root, request, controller.signal)
    console.log(JSON.stringify(result))
    if (!result.valid) process.exitCode = 1
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel) }
}

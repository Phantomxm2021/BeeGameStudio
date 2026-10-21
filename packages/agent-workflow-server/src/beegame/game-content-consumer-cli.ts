/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { PRODUCTION_SURFACE_CAPABILITIES } from '../../../scene-editor/src/production-surface'
export const registeredRuntimeFilesSource = () => readFile(new URL('./registered-runtime-files.mjs',import.meta.url),'utf8')
export const CONTENT_CONSUMER_FILES = ['content-consumer.mjs', 'content-consumer.mjs.map', 'api.json', 'provenance.json', 'README.md', 'NOTICE.md'] as const
let cachedDistribution: Promise<Record<string, string>> | undefined
// Readable interface for the optional helper, not a second renderer or a
// project execution plan. Keep signatures checked against the exported module.
export const CONTENT_CONSUMER_API = {
  capabilities: PRODUCTION_SURFACE_CAPABILITIES,
  createGameStorage: {
    signature: 'await createGameStorage() -> {kind:"preview"|"deployment", getItem, setItem, removeItem}; all methods return Promises',
    usage: 'const saves=await createGameStorage(); const best=Number(await saves.getItem("best") ?? 0); await saves.setItem("best",String(nextBest)); await saves.removeItem("best"); keys are nonempty strings (256 UTF-8 bytes max), values are strings (64 KiB max). Await writes and report errors; no silent in-memory fallback.',
    isolation: 'Production Preview uses BGS host saves isolated by the authorized user and project, surviving new Preview URLs, browser sessions and BGS restarts on the same persistent dashboard data root (128 keys / 256 KiB per project). Deployment uses its own origin/path-scoped native localStorage; never Preview saves. Native localStorage/sessionStorage still throw in the opaque Preview iframe. No HTML or existing game sources are rewritten. Existing consumers must deliberately integrate this async API.',
    measurement: 'Isolated measurement uses disposable saves with the same request validation and quotas. It cannot read or overwrite actual Preview saves, and is not proof of cross-session persistence.',
  },
  createProductionUiSurface: {
    signature: 'const surface = await createProductionUiSurface(host: HTMLElement); returns Promise<{render, dispose}>',
    images: 'data.image.type: simple only (default); no sliced/nine-slice or clipChildren. These are optional helper limits, not Editor schema limits.',
    camera: '{nodeId,input,scene?,tileSet?}: input is required Camera projection data, not replaced by scene. camera-reference-2d requires orthographic projection, matching viewport and positive pixelsPerUnit.',
    render: 'surface.render(data, {width,height}, {state?, assets?, fonts?, onAction?, camera?}) -> resolved geometry array',
    state: 'state uses flat exact keys from authored bindings. enabled hides subtrees; widthRatio 0..1 needs fixed base/responsive sizes; styleColor sets text color/other backgroundColor. Missing/invalid state fails.',
    assets: 'loadProductionResources(...).assets supplies decoded records, not URLs. Declare IDs in document.assetRefs; dispose. A button can use assetRef/data.frame for its skin while text/actions stay live.',
    lifecycle: 'render replaces nodes; call it again with changed data/state/viewport. No update/setState/element lookup methods. Use host.querySelector with [data-node-id] for observations. dispose removes the surface.',
  },
  documents: {
    loadProductionResources: 'await loadProductionResources(absolute assets/asset-manifest.json URL, parsed documents, fetcher?) -> {assets, fonts, resourceUrl(id,member?), dispose}; static images/atlas/fonts only. resourceUrl resolves registered audio/model/dependency files for your own integration; it does not play audio or render 3D.',
    readUiData: 'readUiData(document object) -> validated document.data; not a path, DOM element or Promise',
    readSceneData: 'readSceneData(document object) -> validated document.data',
    fetchStartupContentDocuments: 'await fetchStartupContentDocuments(index object, absolute indexUrl, fetcher?) -> document[] (not a Map)',
    fetchContentDocument: 'await fetchContentDocument(index object, documentId, absolute indexUrl, fetcher?) -> one on-demand document',
    contentDocumentPath: 'contentDocumentPath(index object, documentId) -> registered content-relative path',
  },
  resources: {
    assets: 'loadProductionResources returns assets: ReadonlyMap<string, SurfaceImage>. Resolve authored assetRef/member/frame with resolveSurfaceImage; map values are decoded image records, not URLs.',
    SurfaceImage: '{source: CanvasImageSource, url: string, frame?: [sx,sy,sw,sh], sheet?: parsed SpriteSheet}. frame is a source-image pixel rectangle; drawImage(source,...frame,dx,dy,dw,dh) crops it. Without frame, use the full source.',
    resolveSurfaceImage: 'resolveSurfaceImage(assets, assetRef, {member?,frame?,initialFacing?} = {}) -> SurfaceImage; resolves registered member/frame keys and atlas metadata, throws when the decoded selection is missing.',
  },
  layout: {
    initializeUiLayout: 'await initializeUiLayout() -> void; initialize shared container allocation before resolving layouts.',
    resolveUiNodesForViewport: 'resolveUiNodesForViewport(nodes, rootId, {width,height}, {measureText?}?) -> responsive nodes with allocated local layout; preserves source, not host bounds.',
    inspectUiLayout: 'inspectUiLayout(nodes, rootId, {width,height}, {measureText?, camera?}?) -> geometry array: id, active, layout, corners, bounds, outsideViewport, outsideParent, outsideContentArea, belowMinimumControlSize, textFit, overlapCandidates, occludedBy. Join authored style/text/role by id.',
    createUiTextMeasurer: 'createUiTextMeasurer(canvas2dContext, fontFamilyForNode?) -> measureText(node): {width,height}; load actual fonts first. Intrinsic text/newlines only.',
    inspectUiLayoutInBrowser: 'await inspectUiLayoutInBrowser(nodes, rootId, {width,height}, {fontFamily, fontFaces?, textSamples?, camera?}) -> {viewport,nodes,textMeasurements,note}; initializes layout. fontFaces: Record keyed by assetRef, or JSON.stringify([assetRef,member]) for explicit members; faces loaded and registered. textSamples maps authored text node IDs to string[].',
    notes: 'Logical host pixels. camera: {nodeId,input,scene?,tileSet?} links the game-view to an authored 2D Camera. Candidate-font metrics are preliminary. No wrapping/clipping, interaction or aesthetic verdict; use actual rendering for those.',
  },
  scene: {
    resolveSceneCameraView: 'resolveSceneCameraView({orthographic,viewport:{width,height},orthographicSize?,fieldOfView?,framing?}, {width:hostWidth,height:hostHeight}) -> {projection,framing,rect:{x,y,width,height},aspect,halfWidth,halfHeight,verticalFieldOfView}. viewport is the reference composition; rect uses host logical pixels. orthographicSize is world-unit half-height; fieldOfView uses degrees. framing defaults to keep-height; also keep-width/expand/letterbox. Half-extents exist only for orthographic projection; verticalFieldOfView only for perspective. Camera position/rotation are separate from this projection calculation.',
    sceneWorldTransforms2d: 'sceneWorldTransforms2d(data.nodes) -> {poses: Map<id,[a,b,c,d,tx,ty]>, rects: Map<id,{size:[width,height],position:[x,y]}>}; world x=a*x+c*y+tx, y=b*x+d*y+ty. Poses compose all transforms; rects are RectTransform-only, with local unscaled size and pivot offset.',
    inspectSceneLayout2d: 'inspectSceneLayout2d(data,{width,height}) -> {cameraNodeId,view,worldToScreen,nodes,requiredVisibility?,note}; nodes: id,worldOrigin:[x,y],worldBounds?,screenBounds?,fullyInside?,geometryUnavailable?. Bounds={left,top,right,bottom}; nonvisual nodes can lack bounds.',
    sceneNodeClientPoint2d: 'sceneNodeClientPoint2d(data, nodeId, {width,height}, canvas.getBoundingClientRect(), localPoint?) -> client point',
    renderProductionScene2d: 'renderProductionScene2d(canvas,data,{width,height},assets?,fonts?) -> static 2D only. Pass loadProductionResources maps. Declared Text fonts must be loaded/registered. World-space Canvas only; layers then zIndex, ties keep source order. Authored color tint and opacity (including nested material values and legacy alpha) are consumed. No component sorting overrides or simulation.',
  },
  limitations: 'Optional browser renderer, not a game engine or required project template. capabilities lists this renderer’s supported UI/Scene subset, not every valid Content field; project code owns other rendering and gameplay. --inspect checks saved inputs for static support, not design/gameplay acceptance. Document fields: check-content --format.',
} as const
export function contentConsumerHelp(modulePath: string): string {
  return `Optional browser-safe BGS JSON consumer supplied at ${JSON.stringify(modulePath)}. This is not a gameplay engine, Unity/Godot adapter, or acceptance result. Do not read the generated bundle as API documentation.
Commands on consumer.mjs: --api returns readable signatures, return shapes, resources and lifecycle without loading the bundle; --inspect FILE ... reads explicit public project-relative Scene/UI documents and reports shared-surface compatibility; --install installs to vendor/bgs-runtime/content-consumer.mjs by default; --install public-target.mjs selects another location. Both include the exact source map with embedded source, api.json, provenance.json, README.md and NOTICE.md, and never overwrite differing files. --install-runtime-files scripts/bgs-runtime-files.mjs copies the small Node publication helper; call await copyRegisteredRuntimeFiles(process.cwd(), 'dist', [optional explicit local license files]) from the existing build script after bundling. It copies the content registry, all registered resources/dependencies and manifest modules, not production originals or reference boards unless registered. Publication preserves every registered resource file_paths entry and dependency local_path, including on-demand resources and required licenses. Do not copy all production material, auto-delete advisory inventory entries or create another packaging manifest. Repeated install of identical bytes is read-only. Neither command chooses the engine, rewrites content or proves consumption. Unsupported project actions/styles need an explicit project adapter, not deleted fields.
If you choose this helper, copy it once into your normal exportable project source, e.g. vendor/bgs-runtime/content-consumer.mjs, and import that local copy. Do not import .beegame directly: host tool files are excluded from isolated builds and editable exports. Use your own source organization; never overwrite an existing module without inspecting it.
Minimal UI (example source in src/, default runtime under vendor/):
  import { readUiData, createProductionUiSurface } from '../vendor/bgs-runtime/content-consumer.mjs';
  const surface = await createProductionUiSurface(hostHTMLElement);
  surface.render(readUiData(savedDocument), {width: hostWidth, height: hostHeight}, {state, onAction: (action, nodeId) => handleAction(action, nodeId)});
  surface.dispose();
Use actual host logical pixels. The shared implementation handles anchors/pivots/stretch, hierarchy, responsive/container allocation, enabled subtrees and numeric CSS font units. state maps binding keys to values; onAction handles declared click actions. Supply loaded fonts/assets when referenced. Unsupported roles/styles/behaviors fail explicitly; consult exported PRODUCTION_SURFACE_CAPABILITIES. Do not silently drop fields to make rendering succeed.
Custom UI rendering can reuse initializeUiLayout() and resolveUiNodesForViewport(data.nodes, data.rootId, {width: hostWidth, height: hostHeight}); use inspectUiLayout for composed bounds/transforms. Recompute on host resize instead of reimplementing anchors/containers or scaling the entire HUD with the world. Scene camera framing remains a separate gameplay choice.
Scene geometry (custom rendering/gameplay stays yours):
  readSceneData(savedDocument) validates the envelope;
  sceneWorldTransforms2d(data.nodes) returns composed parent-local transforms;
  inspectSceneLayout2d(data, {width,height}) returns view, worldToScreen and nodes using the authored Camera, not just camera.viewport;
  sceneNodeClientPoint2d(data, nodeId, {width,height}, canvasBoundingBox, localPoint?) projects a node to the actual canvas;
  renderProductionScene2d(canvas, data, {width,height}, assets?, fonts?) uses resources.assets/resources.fonts for limited static 2D presentation, not simulation/animation/physics.
readUiData/readSceneData accept document objects, not file names. Fetch and gameplay remain project code. contentDocumentPath(index,id), fetchStartupContentDocuments(index,indexUrl,fetcher?) and fetchContentDocument(index,id,indexUrl,fetcher?) consume the saved registry and preserve deployment bases. A compiled copy is derived; content/ remains the editable source.
Using this helper is optional; promised JSON semantics are not. For either shared or custom consumers, compare authored numeric fontSize against computed CSS pixels, actual allocated bounds against the saved layout, and world projection against Camera center AND orthographicSize/framing, not just viewport. Use the existing check-content.mjs --layout <registered-content-path> <w> <h> --details (or --layout-draft for a draft) to obtain current calculated geometry and input hashes; do not copy coordinates from prose or from the observed rendered output. Compare exact source-derived projected points/bounds; a wide colored region can hide wrong coordinates. Test the unmodified data as well as a change. Exercise representative data changes in the actual game without rewriting saved sources: install context.route overrides in the Preview Node helper's beforeNavigate, then observe the first load. Its runtimeErrors counters begin before first navigation even without custom listeners; check them, not only errors from a reload. Restore routes/contexts afterwards. Test inputs, authored expected results and actual observations belong in the reusable test/report; a fetch, screenshot or unchanged output is not proof of consumption. No helper success certifies visual or gameplay quality.`
}

/** Explicit Agent-requested materialization. No startup game writes or engine
 * choice; the copied browser module remains independent of temporary tools. */
export function contentConsumerCommand(workspace: string, modulePath: string): string {
  return [
    'import {realpath,lstat,mkdir,readFile,writeFile} from "node:fs/promises";',
    'import {resolve,dirname} from "node:path";import {createHash} from "node:crypto";',
    'const help='+JSON.stringify(contentConsumerHelp(modulePath))+';',
    'const root='+JSON.stringify(workspace)+';const source=new URL("./content-consumer.mjs",import.meta.url);',
    'const hash=b=>createHash("sha256").update(b).digest("hex");',
    'function publicPath(p){if(!p||p.startsWith("/")||p.includes("\\\\")||p.split("/").some(x=>!x||x.startsWith(".")||x==="node_modules"||x==="transcripts"))throw Error("Explicit public project-relative path required: "+p);return resolve(root,p)}',
    'try{const args=process.argv.slice(2);if(args.length===1&&args[0]==="--help"){console.log(help)}else if(args.length===1&&args[0]==="--api"){console.log('+JSON.stringify(JSON.stringify(CONTENT_CONSUMER_API,null,2))+')}else{',
    'if(await realpath(process.cwd())!==root)throw Error("Consumer command belongs to another workspace");',
    'if(args[0]==="--install"&&(args.length===1||args.length===2)||args[0]==="--install-runtime-files"&&args.length===2){const selected=args[1]??"vendor/bgs-runtime/content-consumer.mjs";const path=publicPath(selected);if(!path.endsWith(".mjs"))throw Error("Use an exportable .mjs target");',
    'const names=args[0]==="--install-runtime-files"?["registered-runtime-files.mjs"]:'+JSON.stringify(CONTENT_CONSUMER_FILES)+';',
    'const writes=await Promise.all(names.map(async(name,i)=>({path:i===0?path:resolve(dirname(path),name),bytes:await readFile(new URL("./"+name,import.meta.url)),existing:false})));',
    'for(const item of writes){let parent=root;for(const part of dirname(item.path).slice(root.length).split("/").filter(Boolean)){parent=resolve(parent,part);try{await mkdir(parent)}catch(e){if(e.code!=="EEXIST")throw e}if(await realpath(parent)!==parent||!(await lstat(parent)).isDirectory())throw Error("Consumer target parent must not resolve through a link")}try{const st=await lstat(item.path);if(!st.isFile()||st.isSymbolicLink())throw Error("Consumer target must be a regular non-link file");if(!(await readFile(item.path)).equals(item.bytes))throw Error("Consumer target differs; no overwrite: "+item.path);item.existing=true}catch(e){if(e.code!=="ENOENT")throw e}}',
    'for(const item of writes)if(!item.existing)await writeFile(item.path,item.bytes,{flag:"wx",mode:0o600});console.log(JSON.stringify({path:selected,sha256:hash(writes[0].bytes),alreadyPresent:writes.every(x=>x.existing),files:writes.map(x=>({path:x.path.slice(root.length+1),sha256:hash(x.bytes)})),runtimeVerified:false,note:"Local dependency installed only; wire and verify the actual project build. Existing projects are not upgraded."}))}',

    'else if(args[0]==="--inspect"&&args.length>1){const lib=await import(source.href);const results=[];for(const p of args.slice(1)){const path=publicPath(p);if(await realpath(path)!==path)throw Error("Consumer source must not resolve through a link: "+p);const bytes=await readFile(path);const doc=JSON.parse(bytes.toString("utf8"));let support;if(doc.kind==="ui-screen"||doc.kind==="ui-hud")support=lib.inspectProductionUiSupport(lib.readUiData(doc));else{const data=lib.readSceneData(doc);support={...lib.inspectProductionSceneSupport(data),geometryAvailable:doc.kind==="scene-2d"}}results.push({path:p,sha256:hash(bytes),kind:doc.kind,support})}console.log(JSON.stringify({results,capabilities:lib.PRODUCTION_SURFACE_CAPABILITIES,runtimeVerified:false}))}',
    'else throw Error("Usage: consumer.mjs --help | --api | --inspect FILE ... | --install [public-target.mjs] | --install-runtime-files scripts/bgs-runtime-files.mjs");}}catch(e){console.error(JSON.stringify({valid:false,issues:[e.message]}));process.exitCode=1}',
  ].join('\n')
}
/** The same browser consumer, delivered with its exact source/debug references.
 * No registry, dependency download, game template or runtime upgrade step. */
export async function contentConsumerDistribution(): Promise<Record<string, string>> {
  return cachedDistribution ??= (async () => {
    const entry = fileURLToPath(new URL('./game-content-consumer.ts', import.meta.url))
    const repository = fileURLToPath(new URL('../../../../', import.meta.url))
    // Keep the fresh-process boundary; collect artifacts explicitly instead of
    // relying on CLI output paths or reusing Bun's long-lived resolver cache.
    const build = 'const r=await Bun.build({entrypoints:[' + JSON.stringify(entry) +
      '],target:"browser",root:' + JSON.stringify(repository) + ',sourcemap:"external",minify:false});' +
      'if(!r.success)throw Error(r.logs.join("\\n"));process.stdout.write(JSON.stringify(await Promise.all(r.outputs.map(async o=>({kind:o.kind,text:await o.text()})))));'
    const child = Bun.spawn([process.execPath, '-e', build], { cwd: repository, stdout: 'pipe', stderr: 'pipe' })
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code !== 0) throw new Error(`Content consumer bundle failed: ${error}`)
    const artifacts = JSON.parse(output) as Array<{kind:string;text:string}>
    const source = artifacts.find(item => item.kind === 'entry-point')?.text
    const rawMap = artifacts.find(item => item.kind === 'sourcemap')?.text
    if (!source || !rawMap) throw new Error('Content consumer bundle is incomplete')
    const module = source + '\n//# sourceMappingURL=content-consumer.mjs.map\n'
    const map = JSON.parse(rawMap)
    if (!map.sources?.length || map.sources.length !== map.sourcesContent?.length ||
      map.sourcesContent.some((source: unknown) => typeof source !== 'string'))
      throw new Error('Content consumer source map is incomplete')
    // Preserve mappings and embedded source, but never ship developer paths.
    map.sources = map.sources.map((source: string) => {
      const path = relative(repository, resolve(repository, map.sourceRoot ?? '', source)).split('\\').join('/')
      if (path.startsWith('../') || path === '..') throw new Error('Consumer source outside repository: ' + source)
      return path
    })
    delete map.sourceRoot
    map.file = 'content-consumer.mjs'
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
    const sourceMap = JSON.stringify(map) + '\n'
    const version = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8')).version
    const dependencyRoots = [...new Set<string>(map.sources.flatMap((path: string) => {
      const match = /^(.*(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(path)
      return match ? [match[1]!] : []
    }))]
    let notices = await readFile(new URL('./content-runtime-NOTICE.md', import.meta.url), 'utf8')
    const dependencies = []
    for (const path of dependencyRoots) {
      const pkg = JSON.parse(await readFile(join(repository, path, 'package.json'), 'utf8'))
      dependencies.push({name:pkg.name,version:pkg.version,license:pkg.license})
      // yoga-layout omits its LICENSE from the npm tarball; its existing MIT
      // source notice is retained in content-runtime-NOTICE.md above.
      if (pkg.name !== 'yoga-layout') notices += '\n## ' + pkg.name + ' ' + pkg.version + '\n\n' + await readFile(join(repository, path, 'LICENSE'), 'utf8')
    }
    const provenance = { name: 'bgs-content-runtime', version, dependencies,
      entry: 'packages/agent-workflow-server/src/beegame/game-content-consumer.ts',
      moduleSha256: sha256(module), sourceMapSha256: sha256(sourceMap),
      sources: map.sources.map((path: string, index: number) => ({ path, sha256: sha256(map.sourcesContent[index]) })),
      note: 'Source hashes identify these exact bytes, including local changes; a product version alone does not identify this runtime.' }
    return {
      'content-consumer.mjs': module, 'content-consumer.mjs.map': sourceMap,
      'api.json': JSON.stringify(CONTENT_CONSUMER_API, null, 2) + '\n',
      'provenance.json': JSON.stringify(provenance, null, 2) + '\n',
      'README.md': `# BGS content runtime

This directory is a local, self-contained browser dependency. Keep game business code in its owning project modules. No BGS server, temporary tools or npm package is needed to import this copy.

Import the installed .mjs module (default content-consumer.mjs); api.json contains the existing signatures, return shapes and limitations. This is a content consumer, not a gameplay engine. Gameplay, input, simulation and audio integration remain project code. content/ and the registered resources remain the editable sources; do not copy their layouts into this module.

provenance.json records the product version and exact module/source hashes. content-consumer.mjs.map embeds the corresponding source, with repository-relative names. Development servers can expose that map directly, and Node --enable-source-maps can resolve failures in this module. Vite build.sourcemap emits a production debug map containing the readable installed module and business source; it does not automatically chain this dependency map back to the original TypeScript. The original source remains embedded in content-consumer.mjs.map. Compression remains the project's build choice.

Use the project's saved package.json scripts and lockfile to install/build with its chosen tools. Keep this whole directory in the editable export. Copy registered content and resources with the existing publication helper after bundling. No host absolute paths or .beegame imports belong in project code.

Installation never overwrites a differing file. A runtime update is an explicit dependency change: inspect the version/API, update the local dependency and imports deliberately, then rebuild and verify the affected behavior. Existing projects are not upgraded automatically.

See NOTICE.md for source and bundled dependency notices. This copy is not evidence of runtime or game-quality verification.
`,
      'NOTICE.md': notices,
    }
  })().catch(error => { cachedDistribution = undefined; throw error })
}
export async function bundleContentConsumer(): Promise<string> {
  return (await contentConsumerDistribution())['content-consumer.mjs']!
}

if (import.meta.main) {
  try { process.stdout.write(await bundleContentConsumer()) }
  catch (error) { console.error(String(error)); process.exitCode = 1 }
}

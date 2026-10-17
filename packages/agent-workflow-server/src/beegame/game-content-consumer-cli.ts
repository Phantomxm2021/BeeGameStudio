/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
export const registeredRuntimeFilesSource = () => readFile(new URL('./registered-runtime-files.mjs',import.meta.url),'utf8')
let cachedBundle: Promise<string> | undefined
// Readable interface for the optional helper, not a second renderer or a
// project execution plan. Keep signatures checked against the exported module.
export const CONTENT_CONSUMER_API = {
  createGameStorage: {
    signature: 'await createGameStorage() -> {kind:"preview"|"deployment", getItem, setItem, removeItem}; all methods return Promises',
    usage: 'const saves=await createGameStorage(); const best=Number(await saves.getItem("best") ?? 0); await saves.setItem("best",String(nextBest)); await saves.removeItem("best"); keys are nonempty strings (256 UTF-8 bytes max), values are strings (64 KiB max). Await writes and report errors; no silent in-memory fallback.',
    isolation: 'Production Preview uses BGS host saves isolated by the authorized user and project, surviving new Preview URLs, browser sessions and BGS restarts on the same persistent dashboard data root (128 keys / 256 KiB per project). Deployment uses its own origin/path-scoped native localStorage; never Preview saves. Native localStorage/sessionStorage still throw in the opaque Preview iframe. No HTML or existing game sources are rewritten. Existing consumers must deliberately integrate this async API.',
    measurement: 'Isolated measurement uses disposable saves with the same request validation and quotas. It cannot read or overwrite actual Preview saves, and is not proof of cross-session persistence.',
  },
  createProductionUiSurface: {
    signature: 'await createProductionUiSurface(host: HTMLElement) -> {render, dispose}',
    render: 'surface.render(data, {width,height}, {state?, assets?, fonts?, onAction?, camera?}) -> resolved geometry array',
    state: 'Record<string, unknown>; bindings.text/enabled read keys here. enabled activates/hides a subtree, not a visible control\'s disabled/interactable state. widthRatio accepts 0..1 for a fixed-width fill (including responsive fixed sizes; no stretch); styleColor binds text color or non-text backgroundColor. All use shared layout; invalid/missing values fail. onAction(action: string, nodeId: string) handles actions.click.',
    assets: 'Use loadProductionResources(manifestUrl, documents, fetcher?) -> {assets,fonts,resourceUrl,dispose}. It reads the existing modular manifest and decodes referenced images/fonts; named frames/member aliases use the same editor keys. Call dispose on teardown. Manual maps remain supported; explicit members/frames must resolve, not fall back.',
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
    renderProductionScene2d: 'renderProductionScene2d(canvas, data, {width,height}, assets?) -> static presentation; no simulation, animation or physics',
  },
  limitations: 'Optional browser-only helpers. --inspect FILE ... reports supported fields and per-node bitmap/procedural visual sources, not whether those choices match the selected design (visualDesign remains unverified). --format on check-content describes document fields. No gameplay or quality acceptance.',
} as const
export function contentConsumerHelp(modulePath: string): string {
  return `Optional browser-safe BGS JSON consumer supplied at ${JSON.stringify(modulePath)}. This is not a gameplay engine, Unity/Godot adapter, or acceptance result. Do not read the generated bundle as API documentation.
Commands on consumer.mjs: --api returns readable signatures, return shapes, resources and lifecycle without loading the bundle; --inspect FILE ... reads explicit public project-relative Scene/UI documents and reports shared-surface compatibility; --install src/bgs-content-consumer.mjs copies the supplied module without overwriting a different file. --install-runtime-files scripts/bgs-runtime-files.mjs copies the small Node publication helper; call await copyRegisteredRuntimeFiles(process.cwd(), 'dist', [optional explicit local license files]) from the existing build script after bundling. It copies the content registry, all registered resources/dependencies and manifest modules, not production originals or reference boards unless registered. Repeated install of identical bytes is read-only. Neither command chooses the engine, rewrites content or proves consumption. Unsupported project actions/styles need an explicit project adapter, not deleted fields.
If you choose this helper, copy it once into your normal exportable project source, e.g. src/bgs-content-consumer.mjs, and import that local copy. Do not import .beegame directly: host tool files are excluded from isolated builds and editable exports. Use your own source organization; never overwrite an existing module without inspecting it.
Minimal UI (example source and copied module both in src/):
  import { readUiData, createProductionUiSurface } from './bgs-content-consumer.mjs';
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
  renderProductionScene2d(canvas, data, {width,height}, assets?) supports limited static 2D presentation only, not simulation/animation/physics.
readUiData/readSceneData accept document objects, not file names. Fetch and gameplay remain project code. contentDocumentPath(index,id), fetchStartupContentDocuments(index,indexUrl,fetcher?) and fetchContentDocument(index,id,indexUrl,fetcher?) consume the saved registry and preserve deployment bases. A compiled copy is derived; content/ remains the editable source.
Using this helper is optional; promised JSON semantics are not. For either shared or custom consumers, compare authored numeric fontSize against computed CSS pixels, actual allocated bounds against the saved layout, and world projection against Camera center AND orthographicSize/framing, not just viewport. Use the existing check-content.mjs --layout <registered-content-path> <w> <h> --details (or --layout-draft for a draft) to obtain current calculated geometry and input hashes; do not copy coordinates from prose or from the observed rendered output. Compare exact source-derived projected points/bounds; a wide colored region can hide wrong coordinates. Test the unmodified data as well as a change. Exercise representative data changes in the actual game without rewriting saved sources: install context.route overrides in the Preview Node helper's beforeNavigate, then observe the first load. Its runtimeErrors counters begin before first navigation even without custom listeners; check them, not only errors from a reload. Restore routes/contexts afterwards. Test inputs, authored expected results and actual observations belong in the reusable test/report; a fetch, screenshot or unchanged output is not proof of consumption. No helper success certifies visual or gameplay quality.`
}

/** Explicit Agent-requested materialization. No startup game writes or engine
 * choice; the copied browser module remains independent of temporary tools. */
export function contentConsumerCommand(workspace: string, modulePath: string): string {
  return [
    'import {realpath,lstat,readFile,writeFile} from "node:fs/promises";',
    'import {resolve,dirname} from "node:path";import {createHash} from "node:crypto";',
    'const help='+JSON.stringify(contentConsumerHelp(modulePath))+';',
    'const root='+JSON.stringify(workspace)+';const source=new URL("./content-consumer.mjs",import.meta.url);',
    'const hash=b=>createHash("sha256").update(b).digest("hex");',
    'function publicPath(p){if(!p||p.startsWith("/")||p.includes("\\\\")||p.split("/").some(x=>!x||x.startsWith(".")||x==="node_modules"||x==="transcripts"))throw Error("Explicit public project-relative path required: "+p);return resolve(root,p)}',
    'try{const args=process.argv.slice(2);if(args.length===1&&args[0]==="--help"){console.log(help)}else if(args.length===1&&args[0]==="--api"){console.log('+JSON.stringify(JSON.stringify(CONTENT_CONSUMER_API,null,2))+')}else{',
    'if(await realpath(process.cwd())!==root)throw Error("Consumer command belongs to another workspace");',
    'if(["--install","--install-runtime-files"].includes(args[0])&&args.length===2){const path=publicPath(args[1]);if(!path.endsWith(".mjs"))throw Error("Use an exportable .mjs target");if(await realpath(dirname(path))!==dirname(path))throw Error("Consumer target parent must not resolve through a link");const bytes=await readFile(args[0]==="--install-runtime-files"?new URL("./registered-runtime-files.mjs",import.meta.url):source);let existing;try{const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())throw Error("Consumer target must be a regular non-link file");existing=await readFile(path)}catch(e){if(e.code!=="ENOENT")throw e}if(existing&&!existing.equals(bytes))throw Error("Consumer target differs; no overwrite: "+args[1]);if(!existing)await writeFile(path,bytes,{flag:"wx",mode:0o600});console.log(JSON.stringify({path:args[1],sha256:hash(bytes),alreadyPresent:Boolean(existing),runtimeVerified:false,api:["readUiData","createProductionUiSurface","inspectUiLayout","inspectSceneLayout2d","sceneNodeClientPoint2d"],note:"Module copied only; attach actual state/actions/resources and verify the real build. No source/content migration."}))}',
    'else if(args[0]==="--inspect"&&args.length>1){const lib=await import(source.href);const results=[];for(const p of args.slice(1)){const path=publicPath(p);if(await realpath(path)!==path)throw Error("Consumer source must not resolve through a link: "+p);const bytes=await readFile(path);const doc=JSON.parse(bytes.toString("utf8"));let support;if(doc.kind==="ui-screen"||doc.kind==="ui-hud")support=lib.inspectProductionUiSupport(lib.readUiData(doc));else{const data=lib.readSceneData(doc);support={nodeCount:data.nodes.length,geometryAvailable:doc.kind==="scene-2d",staticRenderingOnly:true,runtimeVerified:false}}results.push({path:p,sha256:hash(bytes),kind:doc.kind,support})}console.log(JSON.stringify({results,capabilities:lib.PRODUCTION_SURFACE_CAPABILITIES,runtimeVerified:false}))}',
    'else throw Error("Usage: consumer.mjs --help | --api | --inspect FILE ... | --install public-target.mjs | --install-runtime-files scripts/bgs-runtime-files.mjs");}}catch(e){console.error(JSON.stringify({valid:false,issues:[e.message]}));process.exitCode=1}',
  ].join('\n')
}
export async function bundleContentConsumer(): Promise<string> {
  // Like the content checker, build in a fresh process: repeated in-process
  // Bun builds can misresolve package-scoped dependencies in a long-lived runtime.
  return cachedBundle ??= (async () => {
    const child = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./game-content-consumer.ts', import.meta.url)),
      '--target=browser', '--minify'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, source, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code !== 0 || !source) throw new Error(`Content consumer bundle failed: ${error}`)
    return source
  })().catch(error => {
    cachedBundle = undefined
    throw error
  })
}

if (import.meta.main) {
  try { process.stdout.write(await bundleContentConsumer()) }
  catch (error) { console.error(String(error)); process.exitCode = 1 }
}

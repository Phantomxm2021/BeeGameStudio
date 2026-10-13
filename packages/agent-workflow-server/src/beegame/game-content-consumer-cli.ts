/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
import { fileURLToPath } from 'node:url'
let cachedBundle: Promise<string> | undefined
// Readable interface for the optional helper, not a second renderer or a
// project execution plan. Keep signatures checked against the exported module.
export const CONTENT_CONSUMER_API = {
  createProductionUiSurface: {
    signature: 'await createProductionUiSurface(host: HTMLElement) -> {render, dispose}',
    render: 'surface.render(data, {width,height}, {state?, assets?, fonts?, onAction?, camera?}) -> resolved geometry array',
    state: 'Record<string, unknown>; bindings.text/enabled read keys here. onAction(action: string, nodeId: string) handles actions.click.',
    assets: 'Map<assetRef, {source: CanvasImageSource, url: string, frame?: [x,y,width,height]}>; fonts: Map<assetRef, loaded FontFace>, also registered in document.fonts.',
    lifecycle: 'render replaces nodes; call it again with changed data/state/viewport. No update/setState/element lookup methods. Use host.querySelector with [data-node-id] for observations. dispose removes the surface.',
  },
  documents: {
    readUiData: 'readUiData(document object) -> validated document.data; not a path, DOM element or Promise',
    readSceneData: 'readSceneData(document object) -> validated document.data',
    fetchStartupContentDocuments: 'await fetchStartupContentDocuments(index object, absolute indexUrl, fetcher?) -> document[] (not a Map)',
    fetchContentDocument: 'await fetchContentDocument(index object, documentId, absolute indexUrl, fetcher?) -> one on-demand document',
    contentDocumentPath: 'contentDocumentPath(index object, documentId) -> registered content-relative path',
  },
  scene: {
    sceneWorldTransforms2d: 'sceneWorldTransforms2d(data.nodes) -> {poses: Map<nodeId, affine matrix>, rects: Map<nodeId, resolved rect>}',
    inspectSceneLayout2d: 'inspectSceneLayout2d(data, {width,height}) -> {cameraNodeId, view, worldToScreen, nodes, requiredVisibility?, note}; nodes include screenBounds/worldBounds/fullyInside/geometryUnavailable',
    sceneNodeClientPoint2d: 'sceneNodeClientPoint2d(data, nodeId, {width,height}, canvas.getBoundingClientRect(), localPoint?) -> client point',
    renderProductionScene2d: 'renderProductionScene2d(canvas, data, {width,height}, assets?) -> static presentation; no simulation, animation or physics',
  },
  limitations: 'Optional browser-only helpers. --inspect FILE ... reports actual supported fields/capabilities; --format on check-content describes document fields. No gameplay or quality acceptance.',
} as const
export function contentConsumerHelp(modulePath: string): string {
  return `Optional browser-safe BGS JSON consumer supplied at ${JSON.stringify(modulePath)}. This is not a gameplay engine, Unity/Godot adapter, or acceptance result. Do not read the generated bundle as API documentation.
Commands on consumer.mjs: --api returns readable signatures, return shapes, resources and lifecycle without loading the bundle; --inspect FILE ... reads explicit public project-relative Scene/UI documents and reports shared-surface compatibility; --install src/bgs-content-consumer.mjs copies the supplied module without overwriting a different file. Repeated install of identical bytes is read-only. Neither command chooses the engine, rewrites content or proves consumption. Unsupported project actions/styles need an explicit project adapter, not deleted fields.
If you choose this helper, copy it once into your normal exportable project source, e.g. src/bgs-content-consumer.mjs, and import that local copy. Do not import .beegame directly: host tool files are excluded from isolated builds and editable exports. Use your own source organization; never overwrite an existing module without inspecting it.
Minimal UI (example source and copied module both in src/):
  import { readUiData, createProductionUiSurface } from './bgs-content-consumer.mjs';
  const surface = await createProductionUiSurface(hostHTMLElement);
  surface.render(readUiData(savedDocument), {width: hostWidth, height: hostHeight}, {state, onAction: (action, nodeId) => handleAction(action, nodeId)});
  surface.dispose();
Use actual host logical pixels. The shared implementation handles anchors/pivots/stretch, hierarchy, responsive/container allocation, enabled subtrees and numeric CSS font units. state maps binding keys to values; onAction handles declared click actions. Supply loaded fonts/assets when referenced. Unsupported roles/styles/behaviors fail explicitly; consult exported PRODUCTION_SURFACE_CAPABILITIES. Do not silently drop fields to make rendering succeed.
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
    'if(args[0]==="--install"&&args.length===2){const path=publicPath(args[1]);if(!path.endsWith(".mjs"))throw Error("Use an exportable .mjs target");if(await realpath(dirname(path))!==dirname(path))throw Error("Consumer target parent must not resolve through a link");const bytes=await readFile(source);let existing;try{const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink())throw Error("Consumer target must be a regular non-link file");existing=await readFile(path)}catch(e){if(e.code!=="ENOENT")throw e}if(existing&&!existing.equals(bytes))throw Error("Consumer target differs; no overwrite: "+args[1]);if(!existing)await writeFile(path,bytes,{flag:"wx",mode:0o600});console.log(JSON.stringify({path:args[1],sha256:hash(bytes),alreadyPresent:Boolean(existing),runtimeVerified:false,api:["readUiData","createProductionUiSurface","inspectUiLayout","inspectSceneLayout2d","sceneNodeClientPoint2d"],note:"Module copied only; attach actual state/actions/resources and verify the real build. No source/content migration."}))}',
    'else if(args[0]==="--inspect"&&args.length>1){const lib=await import(source.href);const results=[];for(const p of args.slice(1)){const path=publicPath(p);if(await realpath(path)!==path)throw Error("Consumer source must not resolve through a link: "+p);const bytes=await readFile(path);const doc=JSON.parse(bytes.toString("utf8"));let support;if(doc.kind==="ui-screen"||doc.kind==="ui-hud")support=lib.inspectProductionUiSupport(lib.readUiData(doc));else{const data=lib.readSceneData(doc);support={nodeCount:data.nodes.length,geometryAvailable:doc.kind==="scene-2d",staticRenderingOnly:true,runtimeVerified:false}}results.push({path:p,sha256:hash(bytes),kind:doc.kind,support})}console.log(JSON.stringify({results,capabilities:lib.PRODUCTION_SURFACE_CAPABILITIES,runtimeVerified:false}))}',
    'else throw Error("Usage: consumer.mjs --help | --api | --inspect FILE ... | --install public-target.mjs");}}catch(e){console.error(JSON.stringify({valid:false,issues:[e.message]}));process.exitCode=1}',
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

/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
import { fileURLToPath } from 'node:url'
let cachedBundle: Promise<string> | undefined
export function contentConsumerHelp(modulePath: string): string {
  return `Optional browser-safe BGS JSON consumer supplied at ${JSON.stringify(modulePath)}. This is not a gameplay engine, Unity/Godot adapter, or acceptance result. Do not read the generated bundle as API documentation.
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

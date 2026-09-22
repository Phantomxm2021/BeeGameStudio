/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
export async function bundleContentConsumer(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [new URL('./game-content-consumer.ts', import.meta.url).pathname],
    target: 'browser', format: 'esm', minify: true,
  })
  if (!result.success || result.outputs.length !== 1)
    throw new Error(`Content consumer bundle failed: ${result.logs.join('\n')}`)
  return result.outputs[0]!.text()
}

export const CONTENT_CONSUMER_INSTRUCTION = [
  'Read content/index.json, its Scene/UI documents and the registered Manifest resources as the layout authority. Implement data loading/mapping with your chosen game technology; do not independently hardcode a second Scene/UI layout. BGS does not provide or require a game engine. Preserve parent-local transforms, coordinate/atlas semantics and component sorting. For versioned Tilemap data, resolve its registered TileSet JSON and cells, rather than drawing the entire atlas as one sprite.',
  'Node IDs are opaque identities, not position encodings. Consume authored position/rotation/scale and UI anchor/pivot; do not reconstruct layout from node names. Include referenced screens and authored events. A structural validator cannot verify your consumer; choose checks that demonstrate edited data changes the rendered result, using fixtures or copies without rewriting the accepted layout.',
  'Optional browser-safe Content helpers are available from BGS, using the exact host schema and editor coordinate/atlas functions.',
  `Emit the portable ES module to stdout: ${JSON.stringify(process.execPath)} ${JSON.stringify(new URL('./game-content-consumer-cli.ts', import.meta.url).pathname)}`,
  'You may save/import it in your own source if useful. readSceneData(document) / readUiData(document) return the canonical data (nodes, settings/rootId); parseBeeGameContentDocument preserves the whole envelope. uiPaintOrder(nodes, rootId) and UI_PAINT_CONFORMANCE_FIXTURE define the renderer-independent background/content/child order; background or border must never be emitted as an overlay after the node text or image. Coordinate and sprite-sheet helpers are also exported. This does not implement gameplay or prove playability. No package install or project change is performed by BGS.',
  'For UI runtime verification, exercise the shared paint-order fixture and inspect the rendered output. DOM textContent, a clickable selector or a successful navigation does not establish that a label is visually visible.',
].join('\n')

if (import.meta.main) {
  try { process.stdout.write(await bundleContentConsumer()) }
  catch (error) { console.error(String(error)); process.exitCode = 1 }
}

/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
let cachedBundle: Promise<string> | undefined
export async function bundleContentConsumer(): Promise<string> {
  return cachedBundle ??= Bun.build({
    entrypoints: [new URL('./game-content-consumer.ts', import.meta.url).pathname],
    target: 'browser', format: 'esm', minify: true,
  }).then(async result => {
    if (!result.success || result.outputs.length !== 1)
      throw new Error(`Content consumer bundle failed: ${result.logs.join('\n')}`)
    return result.outputs[0]!.text()
  }).catch(error => {
    cachedBundle = undefined
    throw error
  })
}

if (import.meta.main) {
  try { process.stdout.write(await bundleContentConsumer()) }
  catch (error) { console.error(String(error)); process.exitCode = 1 }
}

/** Emits a portable ES module to stdout only. The Agent chooses whether/where
 * to use it. Never installs dependencies or changes a generated project. */
import { fileURLToPath } from 'node:url'
let cachedBundle: Promise<string> | undefined
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

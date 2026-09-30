import { fileURLToPath } from 'node:url'
let bundle: Promise<string> | undefined

export function bundleAcceptanceChecker(): Promise<string> {
  // Isolate bundling from the long-lived runtime's browser-target build cache.
  // Bun's in-process bundler can fail reading zod after the content helper build.
  return bundle ??= (async () => {
    const child = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./acceptance-check-cli.ts', import.meta.url)), '--target=bun', '--format=esm', '--minify'], { stdout: 'pipe', stderr: 'pipe' })
    const [source, errors, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    if (code !== 0 || !source.trim()) throw new Error(`Acceptance checker bundle failed: ${errors}`)
    return source
  })().catch(error => { bundle = undefined; throw error })
}

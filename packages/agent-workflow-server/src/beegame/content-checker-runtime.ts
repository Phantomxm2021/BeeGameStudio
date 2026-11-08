import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type RuntimeModule = { root: string; path: string; moduleUrl: string }
let checker: Promise<RuntimeModule> | undefined
function productionEntry(kind: string, method: string) {
  return `// BGS-managed ${kind} entry; run --help for the interface.
try {
  if (!process.versions.bun) throw new Error('BGS_BUN_REQUIRED: Run this entry with bun, not node (including --help). The shared media/resource implementation targets Bun; this is not a missing project dependency.');
  const moduleUrl = process.env.BEEGAME_CONTENT_CHECKER_MODULE;
  if (!moduleUrl) throw new Error('Resource/media runtime is unavailable. Run this command in the BGS project execution environment.');
  const { ${method} } = await import(moduleUrl);
  await ${method}(process.argv.slice(2), { profile: 'current' });
} catch (error) {
  console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }));
  process.exitCode = 1;
}
`
}
export const MEDIA_PRODUCTION_ENTRY = productionEntry('media', 'runMediaProductionCli')
export const RESOURCE_PRODUCTION_ENTRY = productionEntry('resource', 'runResourceProductionCli')
async function bundleRuntime(entry: string, filename: string): Promise<RuntimeModule> {
  // Use a fresh process: Bun can misresolve package-scoped imports after repeated builds.
  const child = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL(entry, import.meta.url)),
    '--target=bun', '--production'], { stdout: 'pipe', stderr: 'pipe' })
  const [code, source, error] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (code !== 0 || !source) throw Error('Cannot prepare ' + filename + ': ' + error)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beegame-checker-')))
  const path = join(root, filename)
  await writeFile(path, source, { flag: 'wx', mode: 0o400 })
  return { root, path, moduleUrl: pathToFileURL(path).href }
}

export function sharedContentChecker(): Promise<RuntimeModule> {
  return checker ??= bundleRuntime('./resource-tools-runtime.ts', 'resource-tools.mjs')
    .catch(error => { checker = undefined; throw error })
}

import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Project-local entry stays readable; the implementation belongs to BGS.
 * Runtime access grants only its private module directory, not server sources. */
export const CONTENT_CHECKER_ENTRY = `// BGS-managed checker entry. Run --help for the interface; this is not game source.
try {
  if (!process.versions.bun) throw new Error('BGS_BUN_REQUIRED: Run this entry with bun, not node (including --help). The shared content/media/resource implementation targets Bun; this is not a missing project dependency.');
  const moduleUrl = process.env.BEEGAME_CONTENT_CHECKER_MODULE;
  if (!moduleUrl) throw new Error('Content checker runtime is unavailable. Run this command in the BGS project execution environment.');
  const { runGameContentCli } = await import(moduleUrl);
  await runGameContentCli(process.argv.slice(2), { profile: 'current' });
} catch (error) {
  console.log(JSON.stringify({ valid: false, issues: [error instanceof Error ? error.message : String(error)] }));
  process.exitCode = 1;
}
`

type RuntimeModule = { root: string; path: string; moduleUrl: string }
let checker: Promise<RuntimeModule> | undefined
let projectReads: Promise<RuntimeModule> | undefined
export const CONTENT_BINDING_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'binding entry').replace('runGameContentCli', 'runContentBindingCli').replace('runGameContentCli', 'runContentBindingCli')
export const MEDIA_PRODUCTION_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'media entry').replaceAll('runGameContentCli', 'runMediaProductionCli')
export const RESOURCE_PRODUCTION_ENTRY = CONTENT_CHECKER_ENTRY.replace('checker entry', 'resource entry').replaceAll('runGameContentCli', 'runResourceProductionCli')
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
  return checker ??= bundleRuntime('./game-content-validation-cli.ts', 'check-content.mjs')
    .catch(error => { checker = undefined; throw error })
}

export function sharedProjectReads(): Promise<RuntimeModule> {
  return projectReads ??= bundleRuntime('./ui-layout-tool.ts', 'ui-layout-tool.mjs')
    .catch(error => { projectReads = undefined; throw error })
}

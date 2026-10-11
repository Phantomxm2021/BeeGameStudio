import { readFileSync, realpathSync } from 'node:fs'
import { cp, mkdtemp, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

let runtime: Promise<{ roots: string[]; moduleUrl: string }> | undefined
let fontRuntime: typeof runtime
export function sharedFont() {
  return fontRuntime ??= prepareDependency('fonteditor-core', 'lib/main.js', 'beegame-font-')
    .catch(error => { fontRuntime = undefined; throw error })
}
/** Resolve once per host, then isolate installed dependencies. Package-manager
 * symlinks require denied parent directories under the project sandbox. Copy
 * this small pinned closure, rather than granting the server's node_modules. */
export function sharedSharp() {
  return runtime ??= prepareDependency('sharp', 'lib/index.js', 'beegame-media-').catch(error => { runtime = undefined; throw error })
}
async function prepareDependency(name: string, entry: string, prefix: string) {
  const require = createRequire(import.meta.url)
  const roots = new Set<string>()
  const packages = new Map<string, string>()
  const visit = (manifest: string) => {
    manifest = realpathSync(manifest)
    const root = dirname(manifest)
    if (roots.has(root)) return
    roots.add(root)
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    if (packages.has(pkg.name) && packages.get(pkg.name) !== root)
      throw Error('Media dependency requires conflicting installed versions: ' + pkg.name)
    packages.set(pkg.name, root)
    const resolve = createRequire(manifest)
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
      let dependency: string
      try { dependency = resolve.resolve(name + '/package.json') }
      catch (error) {
        if (pkg.optionalDependencies?.[name]) continue
        throw error
      }
      visit(dependency)
    }
  }
  // Some packages export their entry but not package.json.
  let manifest = dirname(require.resolve(name))
  while (true) {
    try { if (JSON.parse(readFileSync(join(manifest, 'package.json'), 'utf8')).name === name) break } catch {}
    const parent = dirname(manifest)
    if (parent === manifest) throw Error('Cannot locate installed dependency: ' + name)
    manifest = parent
  }
  visit(join(manifest, 'package.json'))
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  for (const [name, source] of packages) {
    const target = join(root, 'node_modules', name)
    await mkdir(dirname(target), { recursive: true })
    await cp(source, target, { recursive: true, dereference: true,
      filter: path => path === source || basename(path) !== 'node_modules' })
  }
  return { roots: [root], moduleUrl: pathToFileURL(join(root, 'node_modules', name, entry)).href }
}

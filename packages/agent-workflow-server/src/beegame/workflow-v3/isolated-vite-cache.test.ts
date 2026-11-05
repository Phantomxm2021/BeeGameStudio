import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGamePreviewManager } from '../preview-manager'
import { projectDependencies, projectFiles } from './editable-project'
import { rebuildPublication } from './publication-build'
import { createRun } from './state'

// Use the Vite installation already used by the frontend. The fixture is a
// disposable package project; it never installs from a registry or touches a
// real game workspace.
const frontendRequire = createRequire(new URL('../../../../../apps/frontend/package.json', import.meta.url))
const fixtureSupported = process.platform === 'darwin' && process.arch === 'arm64'

type PackageSpec = { name: string; entry?: string }

async function packageRoot(entry: string): Promise<string> {
  let current = dirname(await realpath(entry))
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(join(current, 'package.json'), 'utf8')) as { name?: string }
      if (manifest.name) return current
    } catch { /* Keep walking until the package root. */ }
    const parent = parse(current).dir
    if (parent === current) throw new Error(`Could not locate package root for ${entry}`)
    current = parent
  }
}

function resolvePackage(spec: PackageSpec, resolver: { resolve(id: string): string }): string {
  return resolver.resolve(spec.entry ? `${spec.name}/${spec.entry}` : spec.name)
}

async function copyViteDependencies(root: string): Promise<string> {
  // Resolve only when the supported host actually runs this fixture; skipped
  // platforms need not have the macOS frontend dependency closure installed.
  const vitePackagePath = frontendRequire.resolve('vite/package.json')
  const vitePackageRoot = dirname(vitePackagePath)
  const viteRequire = createRequire(vitePackagePath)
  const manifest = JSON.parse(await readFile(join(vitePackageRoot, 'package.json'), 'utf8')) as { version: string }

  // Vite 7's runtime closure on this macOS arm64 host. The two native
  // packages are needed by esbuild/Rollup; copying package bytes (rather than
  // the frontend's Bun-store links) keeps the fixture canonical and portable
  // through the publication dependency copier.
  const packages: PackageSpec[] = [
    { name: 'vite' },
    { name: 'esbuild' },
    { name: '@esbuild/darwin-arm64', entry: 'bin/esbuild' },
    { name: 'rollup' },
    { name: '@rollup/rollup-darwin-arm64' },
    { name: 'fdir' },
    { name: 'fsevents' },
    { name: 'nanoid' },
    { name: 'picocolors' },
    { name: 'picomatch' },
    { name: 'postcss' },
    { name: 'source-map-js' },
    { name: 'tinyglobby' },
  ]
  const esbuildRoot = await packageRoot(resolvePackage({ name: 'esbuild' }, viteRequire))
  const rollupRoot = await packageRoot(resolvePackage({ name: 'rollup' }, viteRequire))
  const esbuildRequire = createRequire(join(esbuildRoot, 'package.json'))
  const rollupRequire = createRequire(join(rollupRoot, 'package.json'))
  const modules = join(root, 'node_modules')
  await mkdir(modules, { recursive: true })
  for (const spec of packages) {
    const resolver = spec.name.startsWith('@esbuild/') ? esbuildRequire
      : spec.name.startsWith('@rollup/') ? rollupRequire : viteRequire
    const source = await packageRoot(resolvePackage(spec, resolver))
    const destination = join(modules, spec.name)
    await mkdir(dirname(destination), { recursive: true })
    await cp(source, destination, { recursive: true, dereference: true })
    expect((await lstat(destination)).isDirectory(), spec.name).toBe(true)
  }
  await mkdir(join(modules, '.bin'), { recursive: true })
  await symlink('../vite/bin/vite.js', join(modules, '.bin/vite'))
  return manifest.version
}

async function filesUnder(directory: string, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) result.push(...await filesUnder(join(directory, entry.name), path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

async function cacheState(directory: string): Promise<{ entries: string[]; sentinel: string } | undefined> {
  let entries: string[]
  try {
    entries = (await readdir(directory)).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  return { entries, sentinel: await readFile(join(directory, 'fixture-sentinel.txt'), 'base64') }
}

for (const preexistingCache of [false, true] as const) {
  test.skipIf(!fixtureSupported)(
    `isolated normal Vite build preserves source and dependency cache state: ${preexistingCache ? 'preexisting' : 'absent'} .vite-temp`,
    async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-isolated-vite-cache-')))
      const cache = join(root, 'node_modules', '.vite-temp')
      const marker = 'BGS_ISOLATED_VITE_CONFIG_MARKER'
      try {
        const viteVersion = await copyViteDependencies(root)
        if (preexistingCache) {
          await mkdir(cache, { recursive: true })
          await writeFile(join(cache, 'fixture-sentinel.txt'), 'preserve-me')
        }
        await writeFile(join(root, 'package.json'), JSON.stringify({
          name: 'bgs-isolated-vite-fixture', private: true, type: 'module',
          scripts: { build: preexistingCache ? 'node --version && vite build' : 'vite build' }, devDependencies: { vite: viteVersion },
        }))
        await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'bgs-isolated-vite-fixture', lockfileVersion: 3, requires: true, packages: {} }))
        await mkdir(join(root, 'src'), { recursive: true })
        await writeFile(join(root, 'index.html'), '<!doctype html><html><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>')
        await writeFile(join(root, 'src/style.css'), 'body { background: #234; color: white; }')
        await writeFile(join(root, 'src/main.js'), `import './style.css'; document.querySelector('#app').textContent = __BGS_ISOLATED_VITE_CONFIG_MARKER__\n`)
        await writeFile(join(root, 'vite.config.ts'), `import { defineConfig } from 'vite'
import { readdirSync } from 'node:fs'
if (!readdirSync('node_modules/.vite-temp').some(name => name.includes('vite.config'))) throw new Error('Vite config was not loaded from .vite-temp')
export default defineConfig({
  define: { __BGS_ISOLATED_VITE_CONFIG_MARKER__: ${JSON.stringify(JSON.stringify(marker))} },
  build: { outDir: 'dist' },
})
`)

        const sourceBefore = await projectFiles(root, 'dist', [])
        const dependencyBefore = await projectDependencies(root)
        const cacheBefore = await cacheState(cache)
        const run=createRun({projectId:'vite-fixture',ownerId:'fixture',workspacePath:root,chatSessionId:'fixture',
          requestKey:'fixture',text:'Vite publication fixture',constraints:{},ids:['fixture']})
        const published=join(root,'.publication-fixture')
        const result = await rebuildPublication(run,{runtimeArtifact:'dist'},published,async()=>{})
        expect(result.artifact.path).toBe('dist')
        const html = await readFile(join(published, 'dist/index.html'), 'utf8')
        expect(html).toMatch(/src="\.\/assets\/[^"]+\.js"/)
        expect(html).toMatch(/href="\.\/assets\/[^"]+\.css"/)
        expect(html).not.toContain('src="/assets/')
        const smoke = JSON.parse(result.buildLog).checks.find((check: {id:string}) => check.id === 'runtime-smoke')
        expect(JSON.parse(smoke.observation)).toMatchObject({environment:{embedding:'standalone',storage:'deployment-native'},errors:[],missingFiles:[]})
        expect(await projectFiles(root, 'dist', [])).toEqual(sourceBefore)
        expect(await projectDependencies(root)).toBe(dependencyBefore)
        expect(await cacheState(cache)).toEqual(cacheBefore)

        const built = await Promise.all((await filesUnder(join(published, 'dist'))).map(async path =>
          readFile(join(published, 'dist', path), 'utf8').catch(() => '')))
        expect(built.join('\n')).toContain(marker)
        expect(built).not.toHaveLength(0)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )
}


test.skipIf(!fixtureSupported)('managed Vite observes source and imported content edits inside Seatbelt without a restart',async()=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-vite-watch-')))
  const manager=new BeeGamePreviewManager()
  const options={sessionId:'offline-watch',workspacePath:root,mode:'development' as const}
  try {
    const version=await copyViteDependencies(root)
    await mkdir(join(root,'content'))
    await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{dev:'vite'},devDependencies:{vite:version}}))
    await writeFile(join(root,'index.html'),'<script type="module" src="/main.js"></script>')
    await writeFile(join(root,'main.js'),'export const value = "source-before";')
    await writeFile(join(root,'content/data.json'),'{"value":"content-before"}')
    const started=await manager.start(options)
    expect(started.status,started.message).toBe('running')
    const serverUrl=manager.internalUrl(options.sessionId)!
    const read=async(path:string)=>await(await fetch(new URL('/previews/offline-watch/'+path,serverUrl))).text()
    expect(await read('main.js')).toContain('source-before')
    expect(await read('content/data.json?import&raw')).toContain('content-before')
    await writeFile(join(root,'main.js'),'export const value = "source-after";')
    await writeFile(join(root,'content/data.json'),'{"value":"content-after"}')
    expect(await manager.start(options)).toEqual(started)
    let source='',content=''
    const deadline=Date.now()+5000
    do {
      await Bun.sleep(50)
      source=await read('main.js');content=await read('content/data.json?import&raw')
      if(source.includes('source-after') && content.includes('content-after'))break
    }while(Date.now()<deadline)
    expect(source).toContain('source-after')
    expect(content).toContain('content-after')
    expect(manager.internalUrl(options.sessionId)).toBe(serverUrl)
  } finally {
    manager.dispose()
    // The owned process group exits asynchronously before fixture removal.
    await Bun.sleep(1100)
    await rm(root,{recursive:true,force:true})
  }
},30000)

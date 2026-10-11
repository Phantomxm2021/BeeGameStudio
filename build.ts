import { readdir, readFile, writeFile, cp, mkdir, mkdtemp, rename } from 'fs/promises'
import { basename, join, resolve } from 'path'
import { getMacroDefines } from './scripts/defines.ts'
import { getBuildFeatures } from './scripts/defines.ts'

const outdirFlag = process.argv.indexOf('--outdir')
const requestedOutdir = outdirFlag === -1 ? undefined : process.argv[outdirFlag + 1]
if (outdirFlag !== -1 && (!requestedOutdir || requestedOutdir.startsWith('--'))) throw new Error('Usage: bun build.ts [--outdir EMPTY_DIRECTORY]')

// Never clear live chunks. Build into a unique generation and publish only
// after bundling, asset copying and startup checks all succeed.
if (requestedOutdir) {
  const contents = await readdir(requestedOutdir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (contents.length) throw new Error('--outdir must name a new or empty directory; existing files are preserved')
}
if (!requestedOutdir) await mkdir('dist', { recursive: true })
const outdir = requestedOutdir ?? await mkdtemp(join('dist', 'build-'))
const packageMetadata = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
const runtimeDependencies = { sharp: packageMetadata.dependencies.sharp }

// Collect FEATURE_* env vars → Bun.build features
const features = getBuildFeatures()

// Step 2: Bundle with splitting
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  // A Node-compatible bundle also runs on Bun. A Bun-targeted bundle leaves
  // Bun-provided "ws", "undici" and "node-fetch" imports external, hiding
  // missing runtime dependencies until the files leave the source checkout.
  target: 'node',
  // Sharp locates platform .node/libvips files relative to its installed
  // package. Inlining its JS into dist breaks that lookup at runtime.
  external: Object.keys(runtimeDependencies),
  splitting: true,
  sourcemap: 'linked',
  define: {
    ...getMacroDefines(),
    // React production mode — eliminates _debugStack Error objects
    // (6,889 objects × ~1.7KB = 12MB in development builds) and removes
    // prop-type / key warnings not useful in a production CLI tool.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir)
const IMPORT_META_REQUIRE = 'var __require = import.meta.require;'
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`

let patched = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (content.includes(IMPORT_META_REQUIRE)) {
    await writeFile(
      filePath,
      content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
    )
    patched++
  }
}

// Also patch unguarded globalThis.Bun destructuring from third-party deps
// (e.g. @anthropic-ai/sandbox-runtime) so Node.js doesn't crash at import time.
let bunPatched = 0
const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
const BUN_DESTRUCTURE_SAFE =
  'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  BUN_DESTRUCTURE.lastIndex = 0
  if (BUN_DESTRUCTURE.test(content)) {
    await writeFile(
      filePath,
      content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
    )
    bunPatched++
  }
}
BUN_DESTRUCTURE.lastIndex = 0

console.log(
  `Bundled ${result.outputs.length} files to ${outdir}/ (patched ${patched} for import.meta.require, ${bunPatched} for Bun destructure)`,
)

// Step 4: Copy native .node addon files (audio-capture) and vendored binaries (ripgrep)
const audioCaptureDir = join(outdir, 'vendor', 'audio-capture')
await cp('vendor/audio-capture', audioCaptureDir, { recursive: true })
console.log(`Copied vendor/audio-capture/ → ${audioCaptureDir}/`)

const ripgrepDir = join(outdir, 'vendor', 'ripgrep')
await cp('src/utils/vendor/ripgrep', ripgrepDir, { recursive: true })
console.log(`Copied src/utils/vendor/ripgrep/ → ${ripgrepDir}/`)
await mkdir(join(outdir, 'scripts'), { recursive: true })
await cp(new URL('./scripts/postinstall.cjs', import.meta.url), join(outdir, 'scripts', 'postinstall.cjs'))

await cp('.beegame/skills/builtinskills', join(outdir, 'skills', 'builtinskills'), { recursive: true })
await writeFile(join(outdir, 'package.json'), JSON.stringify({
  name: 'bgs-runtime', private: true, type: 'module', dependencies: runtimeDependencies,
}, null, 2) + '\n')

// Step 5: Generate cli-bun and cli-node executable entry points
const cliBun = join(outdir, 'cli-bun.js')
const cliNode = join(outdir, 'cli-node.js')

await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')

await writeFile(cliNode, '#!/usr/bin/env node\nimport "./cli.js"\n')

// Make both executable
const { chmodSync } = await import('fs')
chmodSync(cliBun, 0o755)
chmodSync(cliNode, 0o755)

console.log(`Generated ${cliBun} (shebang: bun) and ${cliNode} (shebang: node)`)

// --version checks the bootstrap only. Also load the real command tree before
// publishing a live generation. Raw --outdir builds have not installed their
// external dependencies yet; their full startup is checked after installation.
for (const [runtime, entry] of [[process.execPath, cliBun], ['node', cliNode]]) {
  for (const args of [['--version'], ...(requestedOutdir ? [] : [['--bare', '--help']])]) {
    const child = Bun.spawn([runtime!, resolve(entry!), ...args], {
      stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, BGS_SIMPLE: '1', BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ])
    if (code !== 0 || !stdout.trim()) throw new Error(`Build startup check failed (${runtime} ${args.join(' ')}): ${stderr || stdout}`)
  }
}
if (requestedOutdir) console.log('Raw build created; install its runtime dependencies and verify --bare --help before deployment.')

if (!requestedOutdir) {
  // Stable launchers share one entry. Atomic file replacement prevents readers
  // from seeing a partial script; previous generation files remain untouched.
  const entries = [
    ['cli.js', `import "./${basename(outdir)}/cli.js"\n`],
    ['cli-bun.js', '#!/usr/bin/env bun\nimport "./cli.js"\n'],
    ['cli-node.js', '#!/usr/bin/env node\nimport "./cli.js"\n'],
  ] as const
  for (const [name, content] of entries) {
    const temporary = join(outdir, `publish-${name}`)
    await writeFile(temporary, content, { flag: 'wx', mode: 0o755 })
  }
  for (const [name] of entries) await rename(join(outdir, `publish-${name}`), join('dist', name))
  console.log(`Published ${outdir}; previous build files retained for running processes.`)
}

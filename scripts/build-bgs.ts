import { access, copyFile, mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../vendor/bgs/codex-rs/', import.meta.url))
await access(join(source, 'Cargo.toml')).catch(() => {
  throw Error('Initialize the Bgs source first: git submodule update --init vendor/bgs')
})
const cargo = Bun.which('cargo') ?? join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
await access(cargo, constants.X_OK).catch(() => {
  throw Error('Install Rust with rustup; vendor/bgs/codex-rs/rust-toolchain.toml pins the required toolchain')
})
const args = process.argv.slice(2)
if (args.length > 1 || args.some(arg => arg !== '--release')) throw Error('Usage: bun run bgs:build [--release]')
const git = (...args: string[]) => {
  const result = Bun.spawnSync(['git', ...args], { cwd: source, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw Error('Could not record BGS source provenance')
  return result.stdout.toString().trim()
}
const metadata = {
  sourceCommit: git('rev-parse', 'HEAD'),
  upstreamTag: git('describe', '--tags', '--match', 'rust-v*', '--abbrev=0'),
  dirty: Boolean(git('status', '--porcelain', '--untracked-files=no')),
  platform: process.platform, arch: process.arch,
}
if (args.includes('--release') && metadata.dirty) throw Error('Commit the BGS source changes before packaging a release')
// Match the sandbox-enabled V8 pair pinned by the vendored CI. The default
// rusty_v8 download location does not publish this required build variant.
const buildEnv: NodeJS.ProcessEnv = { ...process.env, PATH: dirname(cargo) + delimiter + (process.env.PATH ?? '') }
if (!buildEnv.RUSTY_V8_ARCHIVE && !buildEnv.RUSTY_V8_SRC_BINDING_PATH && buildEnv.V8_FROM_SOURCE !== '1') {
  const lock = await readFile(join(source, 'Cargo.lock'), 'utf8')
  const version = /\[\[package\]\]\s+name = "v8"\s+version = "([^"]+)"/.exec(lock)?.[1]
  if (!version) throw Error('The locked V8 version is missing')
  const rustc = Bun.spawn([join(dirname(cargo), process.platform === 'win32' ? 'rustc.exe' : 'rustc'), '-vV'], {
    cwd: source, stdout: 'pipe', stderr: 'pipe',
  })
  const [rustCode, rustVersion] = await Promise.all([rustc.exited, new Response(rustc.stdout).text(), new Response(rustc.stderr).text()])
  const target = /^host: (.+)$/m.exec(rustVersion)?.[1]
  if (rustCode !== 0 || !target) throw Error('Could not determine the Rust host target')
  const checksums = new Map((await readFile(join(source, '..', 'third_party', 'v8', `rusty_v8_${version.replaceAll('.', '_')}.sha256`), 'utf8'))
    .trim().split(/\r?\n/).map(line => { const [hash, name] = line.trim().split(/\s+/); return [name, hash] }))
  const cache = join(source, 'target', 'bgs-v8', version)
  await mkdir(cache, { recursive: true })
  const names = [target.endsWith('-pc-windows-msvc') ? `rusty_v8_ptrcomp_sandbox_release_${target}.lib.gz`
    : `librusty_v8_ptrcomp_sandbox_release_${target}.a.gz`, `src_binding_ptrcomp_sandbox_release_${target}.rs`]
  for (const name of names) {
    const expected = checksums.get(name)
    if (!expected) throw Error('No pinned sandboxed V8 artifact for ' + target)
    const path = join(cache, name)
    let bytes = await readFile(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (!bytes) {
      console.log('Downloading pinned V8 artifact: ' + name)
      const response = await fetch(`https://github.com/openai/codex/releases/download/rusty-v8-v${version}/${name}`)
      if (!response.ok) throw Error(`V8 artifact download failed: ${name} (HTTP ${response.status})`)
      bytes = Buffer.from(await response.arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('V8 artifact checksum mismatch: ' + name)
      await writeFile(path + '.new', bytes)
      await rename(path + '.new', path)
    } else if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw Error('Cached V8 artifact checksum mismatch: ' + path)
    }
  }
  buildEnv.RUSTY_V8_ARCHIVE = join(cache, names[0])
  buildEnv.RUSTY_V8_SRC_BINDING_PATH = join(cache, names[1])
}
// Dependency resolution stays locked. Workspace-version lock corrections are
// committed separately in the maintained source branch.
const child = Bun.spawn([cargo, 'build', '--offline', '--locked',
  '-p', 'codex-cli', '--bin', 'codex', '-p', 'codex-code-mode-host', '--bin', 'codex-code-mode-host', ...args], {
  cwd: source,
  env: buildEnv,
  stdout: 'inherit', stderr: 'inherit',
})
const code = await child.exited
if (code !== 0) process.exit(code)
const binary = join(source, 'target', args.length ? 'release' : 'debug', process.platform === 'win32' ? 'codex.exe' : 'codex')
const versionProcess = Bun.spawn([binary, '--version'], { stdout: 'pipe', stderr: 'pipe' })
const [versionCode, output] = await Promise.all([versionProcess.exited, new Response(versionProcess.stdout).text()])
const version = output.trim()
if (versionCode !== 0 || !/^bgs \d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
  throw Error('The source did not produce a BGS binary. Restore the branding commits before packaging.')
}
const destination = fileURLToPath(new URL('../dist/bgs-runtime/', import.meta.url))
await mkdir(destination, { recursive: true })
for (const name of ['LICENSE', 'NOTICE']) {
  await copyFile(join(source, '..', name), join(destination, name))
}
await writeFile(join(destination, 'BGS-NOTICE.txt'),
  'BGS is a PhantomLab distribution based on OpenAI Codex. Product branding and update entry points are modified. See LICENSE and NOTICE for upstream attribution.\n')
// Publish the companion first, then replace the CLI atomically so existing
// processes keep their inode and new processes can find their required host.
for (const [name, sourceName] of [['codex-code-mode-host', 'codex-code-mode-host'], ['bgs', 'codex']]) {
  const executable = process.platform === 'win32' ? name + '.exe' : name
  const target = join(destination, executable)
  await copyFile(join(dirname(binary), process.platform === 'win32' ? sourceName + '.exe' : sourceName), target + '.new')
  await rename(target + '.new', target)
}
await writeFile(join(destination, 'build.json'), JSON.stringify({ ...metadata, version }, null, 2) + '\n')
console.log('Built BGS runtime: ' + destination)
console.log(JSON.stringify({ ...metadata, version }))

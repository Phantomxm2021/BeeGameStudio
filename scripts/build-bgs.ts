import { access, copyFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../vendor/bgs/bgs-rs/', import.meta.url))
await access(join(source, 'Cargo.toml')).catch(() => {
  throw Error('Initialize the Bgs source first: git submodule update --init vendor/bgs')
})
const cargo = Bun.which('cargo') ?? join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo')
await access(cargo, constants.X_OK).catch(() => {
  throw Error('Install Rust with rustup; vendor/bgs/bgs-rs/rust-toolchain.toml pins the required toolchain')
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
// Dependency resolution stays locked. Workspace-version lock corrections are
// committed separately in the maintained source branch.
const child = Bun.spawn([cargo, 'build', '--offline', '--locked', '-p', 'bgs-cli', '--bin', 'bgs', ...args], {
  cwd: source,
  env: { ...process.env, PATH: dirname(cargo) + delimiter + (process.env.PATH ?? '') },
  stdout: 'inherit', stderr: 'inherit',
})
const code = await child.exited
if (code !== 0) process.exit(code)
const binary = join(source, 'target', args.length ? 'release' : 'debug', process.platform === 'win32' ? 'bgs.exe' : 'bgs')
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
const target = join(destination, process.platform === 'win32' ? 'bgs.exe' : 'bgs')
// Replace the executable atomically so an already running process keeps its inode.
await copyFile(binary, target + '.new')
await rename(target + '.new', target)
await writeFile(join(destination, 'build.json'), JSON.stringify({ ...metadata, version }, null, 2) + '\n')
console.log('Built BGS: ' + target)
console.log(JSON.stringify({ ...metadata, version }))

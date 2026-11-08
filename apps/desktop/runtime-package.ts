import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, chmod, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { publicRuntimeConfig } from './src/localRuntime'

const exec = promisify(execFile)

/** Forge build preparation, not a runtime downloader or dependency loader. */
export async function prepareLocalRuntime(repo: string, desktop: string, platform: string, arch: string,
  publicEnvironment: Record<string, string | undefined>) {
  const native = path.join(repo, 'dist/bgs-runtime')
  const metadata = JSON.parse(await readFile(path.join(native, 'build.json'), 'utf8'))
  if (metadata.platform !== platform || metadata.arch !== arch || platform !== process.platform || arch !== process.arch)
    throw Error(`Provide Bun, native dependencies and BGS built on ${platform}/${arch}; host artifacts cannot be repackaged for another target`)
  const config = publicRuntimeConfig(publicEnvironment)
  const probe = await exec(process.env.BEEGAME_DESKTOP_BUN_PATH || 'bun', ['-e',
    'console.log(JSON.stringify({executable:process.execPath,version:Bun.version,platform:process.platform,arch:process.arch}))'])
  const bun = JSON.parse(probe.stdout)
  const [major, minor, patch] = String(bun.version).split('.').map(Number)
  if (bun.platform !== platform || bun.arch !== arch || !(major > 1 || major === 1 && (minor > 4 || minor === 4 && patch >= 3)))
    throw Error('The local desktop runtime requires matching Bun >= 1.4.3')
  const staging = await mkdtemp(path.join(desktop, '.runtime-package-'))
  try {
    for (const name of ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'tsconfig.base.json'])
      await copyFile(path.join(repo, name), path.join(staging, name))
    // Keep the frozen workspace graph intact. Applications contribute manifests,
    // not frontend sources or development credentials. Relative runtime imports
    // still require the existing packages tree (including scene/resource helpers).
    for (const group of ['apps', 'packages']) for (const entry of await readdir(path.join(repo, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = path.join(repo, group, entry.name), target = path.join(staging, group, entry.name)
      let manifest: string
      try { manifest = await readFile(path.join(source, 'package.json'), 'utf8') }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
      await mkdir(target, { recursive: true })
      await writeFile(path.join(target, 'package.json'), manifest)
      if (group === 'packages') await cp(path.join(source, 'src'), path.join(target, 'src'), {
        recursive: true, filter: file => !['node_modules', '__tests__', 'fixtures'].includes(path.basename(file)) && !/\.test\.[^.]+$/.test(file),
      })
    }
    await mkdir(path.join(staging, 'bin'))
    const executable = path.join(staging, 'bin', platform === 'win32' ? 'bun.exe' : 'bun')
    await copyFile(bun.executable, executable); await chmod(executable, 0o755)
    await cp(native, path.join(staging, 'dist/bgs-runtime'), { recursive: true })
    await cp(path.join(repo, '.beegame/plugins/bgs-game-development'), path.join(staging, '.beegame/plugins/bgs-game-development'), { recursive: true })
    await writeFile(path.join(staging, 'public-config.json'), JSON.stringify(config, null, 2) + '\n')
    const rootManifest = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'))
    // The normal workspace install already populated this platform's Bun cache.
    // Official filtered production install preserves links within the artifact.
    await exec(executable, ['install', '--offline', '--production', '--frozen-lockfile', '--ignore-scripts',
      '--filter', './packages/*', '--filter', rootManifest.name], { cwd: staging, maxBuffer: 10 * 1024 * 1024 })
    // Packaging does not execute the copied native CLI (which can trigger OS
    // trust dialogs). The native build owns executable/version verification.
    for (const name of ['bgs', 'codex-code-mode-host'])
      await access(path.join(staging, 'dist/bgs-runtime', platform === 'win32' ? name + '.exe' : name), constants.X_OK)
    const destination = path.join(desktop, 'runtime')
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error }
}

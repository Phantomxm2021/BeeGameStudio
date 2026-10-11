import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

/** Stage only one fresh build; never rewrite or clear a running dist. */
export async function stageReleaseMetadata(repository: string, staging: string): Promise<void> {
  const pkg = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
  const paths: string[] = [...pkg.files.filter((p: string) => p !== 'dist'), 'README.md']
  for (const path of paths) {
    await mkdir(dirname(join(staging, path)), { recursive: true })
    await cp(join(repository, path), join(staging, path), { recursive: true })
  }
  // Workspace scripts/dev dependencies are not part of the installed CLI.
  delete pkg.workspaces
  delete pkg.devDependencies
  delete pkg.patchedDependencies
  delete pkg['lint-staged']
  pkg.scripts = { postinstall: pkg.scripts.postinstall }
  await writeFile(join(staging, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
}

async function command(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  if (code !== 0) throw new Error(stderr || stdout || `Command failed (${code})`)
  return stdout
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 2 || (args.length > 0 && (args[0] !== '--output' || !args[1]))) {
    throw new Error('Usage: bun run release:pack [--output DIRECTORY]')
  }
  const repository = resolve(import.meta.dir, '..')
  const output = resolve(args[1] ?? process.cwd())
  await mkdir(output, { recursive: true })
  const root = await mkdtemp(join(tmpdir(), 'bgs-release-'))
  try {
    const staging = join(root, 'package')
    await mkdir(staging)
    await command([process.execPath, join(repository, 'build.ts'), '--outdir', join(staging, 'dist')], repository)
    await stageReleaseMetadata(repository, staging)
    const result = JSON.parse(await command(['npm', 'pack', '--ignore-scripts', '--json', '--cache', join(root, 'npm-cache'), '--pack-destination', output], staging))
    const archive = result[0]
    console.log(JSON.stringify({ path: join(output, archive.filename), size: archive.size,
      unpackedSize: archive.unpackedSize, files: archive.files.length }, null, 2))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) await main()

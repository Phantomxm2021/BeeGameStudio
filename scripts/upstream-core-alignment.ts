import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
} from 'node:fs/promises'
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type LiteralSubstitution = {
  from: string
  to: string
}

export type AlignmentManifest = {
  version: number
  upstreamRepository: string
  upstreamCommit: string
  synchronizedDirectories: string[]
  synchronizedFiles: string[]
  literalSubstitutions: LiteralSubstitution[]
  fileSubstitutions: Record<string, LiteralSubstitution[]>
  rootExceptions: Record<string, string>
  generatedPaths: string[]
}

export type AlignmentDifference = {
  kind: 'missing' | 'local-only' | 'modified'
  path: string
}

export type AlignmentInput = {
  manifest: AlignmentManifest
  upstreamRoot: string
  localRoot: string
  verifyCommit?: boolean
}

const textDecoder = new TextDecoder('utf-8', { fatal: true })
const textEncoder = new TextEncoder()

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    posix.normalize(path) !== path ||
    path.split('/').some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Alignment path must be a safe relative path: ${path}`)
  }
}

function assertManifest(value: unknown): asserts value is AlignmentManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Alignment manifest must be an object')
  }
  const manifest = value as Partial<AlignmentManifest>
  if (manifest.version !== 1) {
    throw new Error('Alignment manifest version must be 1')
  }
  if (
    typeof manifest.upstreamRepository !== 'string' ||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      manifest.upstreamRepository,
    )
  ) {
    throw new Error('Alignment manifest upstreamRepository is invalid')
  }
  if (
    typeof manifest.upstreamCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(manifest.upstreamCommit)
  ) {
    throw new Error('Alignment manifest upstreamCommit must be a 40-byte hash')
  }
  if (
    !Array.isArray(manifest.synchronizedDirectories) ||
    !Array.isArray(manifest.synchronizedFiles) ||
    !Array.isArray(manifest.literalSubstitutions) ||
    !manifest.fileSubstitutions ||
    typeof manifest.fileSubstitutions !== 'object' ||
    !manifest.rootExceptions ||
    typeof manifest.rootExceptions !== 'object' ||
    !Array.isArray(manifest.generatedPaths)
  ) {
    throw new Error('Alignment manifest collections are invalid')
  }
  for (const path of [
    ...manifest.synchronizedDirectories,
    ...manifest.synchronizedFiles,
    ...Object.keys(manifest.fileSubstitutions),
    ...Object.keys(manifest.rootExceptions),
    ...manifest.generatedPaths,
  ]) {
    if (typeof path !== 'string') {
      throw new Error('Alignment manifest paths must be strings')
    }
    assertSafeRelativePath(path)
  }
  for (const substitution of [
    ...manifest.literalSubstitutions,
    ...Object.values(manifest.fileSubstitutions).flat(),
  ]) {
    if (
      !substitution ||
      typeof substitution.from !== 'string' ||
      substitution.from.length === 0 ||
      typeof substitution.to !== 'string'
    ) {
      throw new Error('Alignment substitutions must contain from and to text')
    }
  }
}

export async function loadAlignmentManifest(
  path: string,
): Promise<AlignmentManifest> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  assertManifest(value)
  return value
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function assertRoot(path: string): Promise<string> {
  const absolute = resolve(path)
  const stats = await lstat(absolute)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Alignment root must be a real directory: ${path}`)
  }
  return realpath(absolute)
}

function resolveInside(root: string, path: string): string {
  assertSafeRelativePath(path)
  const absolute = resolve(root, ...path.split('/'))
  const fromRoot = relative(root, absolute)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Alignment path escapes its root: ${path}`)
  }
  return absolute
}

async function assertNoSymlinkPath(root: string, path: string): Promise<void> {
  assertSafeRelativePath(path)
  let current = root
  for (const part of path.split('/')) {
    current = resolve(current, part)
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Alignment symbolic links are not allowed: ${path}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

async function enumeratePath(
  root: string,
  path: string,
  expectedKind: 'directory' | 'file',
): Promise<string[]> {
  const absolute = resolveInside(root, path)
  await assertNoSymlinkPath(root, path)
  if (!(await pathExists(absolute))) return []
  const stats = await lstat(absolute)
  if (stats.isSymbolicLink()) {
    throw new Error(`Alignment symbolic links are not allowed: ${path}`)
  }
  if (expectedKind === 'file') {
    if (!stats.isFile()) {
      throw new Error(`Alignment file is not a regular file: ${path}`)
    }
    return [path]
  }
  if (!stats.isDirectory()) {
    throw new Error(`Alignment directory is not a directory: ${path}`)
  }

  const files: string[] = []
  async function walk(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => comparePaths(left.name, right.name))
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const relativePath = `${relativeDirectory}/${entry.name}`
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Alignment symbolic links are not allowed: ${relativePath}`,
        )
      }
      const child = resolveInside(root, relativePath)
      if (entry.isDirectory()) {
        await walk(child, relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Alignment path is not a regular file: ${relativePath}`)
      }
    }
  }
  await walk(absolute, path)
  return files
}

async function enumerateConfiguredPaths(
  root: string,
  manifest: AlignmentManifest,
): Promise<string[]> {
  const paths = new Set<string>()
  for (const directory of manifest.synchronizedDirectories) {
    for (const path of await enumeratePath(root, directory, 'directory')) {
      paths.add(path)
    }
  }
  for (const file of manifest.synchronizedFiles) {
    for (const path of await enumeratePath(root, file, 'file')) paths.add(path)
  }
  return [...paths].sort(comparePaths)
}

function decodeText(bytes: Uint8Array): string | undefined {
  try {
    return textDecoder.decode(bytes)
  } catch {
    return undefined
  }
}

function expectedBytes(
  path: string,
  upstreamBytes: Uint8Array,
  manifest: AlignmentManifest,
): Uint8Array {
  const text = decodeText(upstreamBytes)
  if (text === undefined) return upstreamBytes
  let transformed = text
  for (const substitution of manifest.literalSubstitutions) {
    transformed = transformed.replaceAll(substitution.from, substitution.to)
  }
  for (const substitution of manifest.fileSubstitutions[path] ?? []) {
    transformed = transformed.replaceAll(substitution.from, substitution.to)
  }
  return textEncoder.encode(transformed)
}

async function verifyUpstreamCommit(
  root: string,
  manifest: AlignmentManifest,
): Promise<void> {
  const process = Bun.spawn(['git', '-C', root, 'rev-parse', 'HEAD'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  if (exitCode !== 0) {
    throw new Error(`Unable to resolve upstream HEAD: ${stderr.trim()}`)
  }
  if (stdout.trim() !== manifest.upstreamCommit) {
    throw new Error(
      `Upstream HEAD ${stdout.trim()} does not match pinned commit ${manifest.upstreamCommit}`,
    )
  }
}

async function prepareInput(input: AlignmentInput): Promise<{
  upstreamRoot: string
  localRoot: string
}> {
  assertManifest(input.manifest)
  const upstreamRoot = await assertRoot(input.upstreamRoot)
  const localRoot = await assertRoot(input.localRoot)
  if (input.verifyCommit !== false) {
    await verifyUpstreamCommit(upstreamRoot, input.manifest)
  }
  return { upstreamRoot, localRoot }
}

export async function auditCoreAlignment(
  input: AlignmentInput,
): Promise<{ differences: AlignmentDifference[] }> {
  const { upstreamRoot, localRoot } = await prepareInput(input)
  const upstreamPaths = await enumerateConfiguredPaths(
    upstreamRoot,
    input.manifest,
  )
  const localPaths = await enumerateConfiguredPaths(localRoot, input.manifest)
  const upstreamSet = new Set(upstreamPaths)
  const localSet = new Set(localPaths)
  const generatedSet = new Set(input.manifest.generatedPaths)
  const paths = [...new Set([...upstreamPaths, ...localPaths])].sort(comparePaths)
  const differences: AlignmentDifference[] = []

  for (const path of paths) {
    if (!upstreamSet.has(path)) {
      if (generatedSet.has(path)) continue
      differences.push({ kind: 'local-only', path })
      continue
    }
    if (!localSet.has(path)) {
      differences.push({ kind: 'missing', path })
      continue
    }
    const upstreamBytes = new Uint8Array(
      await readFile(resolveInside(upstreamRoot, path)),
    )
    const localBytes = new Uint8Array(
      await readFile(resolveInside(localRoot, path)),
    )
    if (
      !Buffer.from(expectedBytes(path, upstreamBytes, input.manifest)).equals(
        Buffer.from(localBytes),
      )
    ) {
      differences.push({ kind: 'modified', path })
    }
  }
  return { differences }
}

export async function syncCoreAlignment(input: AlignmentInput): Promise<void> {
  const { upstreamRoot, localRoot } = await prepareInput(input)
  const upstreamPaths = await enumerateConfiguredPaths(
    upstreamRoot,
    input.manifest,
  )
  const localPaths = await enumerateConfiguredPaths(localRoot, input.manifest)
  const upstreamSet = new Set(upstreamPaths)
  const generatedSet = new Set(input.manifest.generatedPaths)
  // Explicit product exceptions need a manual upstream merge. Keep reporting
  // their differences in audit; sync must neither delete nor overwrite them.
  const manualMergeSet = new Set(Object.keys(input.manifest.rootExceptions))

  for (const path of localPaths) {
    if (!upstreamSet.has(path) && !generatedSet.has(path) && !manualMergeSet.has(path)) {
      await rm(resolveInside(localRoot, path), { force: true })
    }
  }
  for (const path of upstreamPaths) {
    if (manualMergeSet.has(path)) continue
    const destination = resolveInside(localRoot, path)
    const upstreamBytes = new Uint8Array(
      await readFile(resolveInside(upstreamRoot, path)),
    )
    await assertNoSymlinkPath(localRoot, path)
    await mkdir(dirname(destination), { recursive: true })
    await assertNoSymlinkPath(localRoot, path)
    await Bun.write(destination, expectedBytes(path, upstreamBytes, input.manifest))
  }
}

function argumentValue(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

async function main(): Promise<void> {
  const command = Bun.argv[2]
  const upstreamRoot = argumentValue('--upstream')
  if ((command !== 'audit' && command !== 'sync') || !upstreamRoot) {
    throw new Error(
      'Usage: bun run scripts/upstream-core-alignment.ts <audit|sync> --upstream <absolute-path>',
    )
  }
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = await loadAlignmentManifest(
    resolve(repositoryRoot, 'config/upstream-core-alignment.json'),
  )
  const input = { manifest, upstreamRoot, localRoot: repositoryRoot }
  if (command === 'sync') await syncCoreAlignment(input)
  const result = await auditCoreAlignment(input)
  for (const difference of result.differences) {
    console.error(`${difference.kind}\t${difference.path}`)
  }
  if (result.differences.length > 0) {
    console.error(`${result.differences.length} differences`)
    process.exitCode = 1
  } else {
    console.log('0 differences')
  }
}

if (import.meta.main) {
  await main()
}

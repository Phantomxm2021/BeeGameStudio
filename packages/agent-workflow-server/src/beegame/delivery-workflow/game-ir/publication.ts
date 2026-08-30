import { createHash } from 'node:crypto'
import {
  mkdir,
  open,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import {
  GAME_IR_SCHEMA_VERSION,
  parseGameIrCompileRequest,
  parseGameIrReadyReceipt,
  type GameIrCompileRequest,
  type GameIrReadyReceipt,
} from './contracts'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrModuleCandidate,
  type GameIrSourceSection,
} from './model'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  admitGameIrSemanticValidationResult,
  type GameIrSemanticValidationPacket,
  type GameIrSemanticValidationResult,
} from './semantic-admission'

const ROOT = '.beegame/ir/game-ir.v1'
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const MODULES = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.map(
  item => item.moduleId,
)
const MODULE_SET = new Set(MODULES)
const publicationLocks = new Map<string, Promise<unknown>>()

export type GameIrPublicationAdmission = Readonly<{
  moduleId: string
  packet: GameIrSemanticValidationPacket
  result: GameIrSemanticValidationResult
}>

export type GameIrPublicationAuthority = Readonly<{
  workspacePath: string
  publicationId: string
  compileRequest: GameIrCompileRequest
  candidate: GameIrCandidate
  sectionIndex: readonly GameIrSourceSection[]
  admissions: readonly GameIrPublicationAdmission[]
}>

export type GameIrPublicationPrepared = Readonly<{
  preparedPath: string
  journalPath: string
  committedPath: string
  authorityDigest: string
}>

type Artifact = Readonly<{ path: string; bytes: string; digest: string }>
type Plan = Readonly<{
  authority: GameIrPublicationAuthority
  workspacePath: string
  revision: string
  publicationId: string
  stage: string
  journal: string
  final: string
  authorityDigest: string
  artifacts: readonly Artifact[]
  marker: Artifact
  journalBytes: string
  ready: GameIrReadyReceipt
  prepared: GameIrPublicationPrepared
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR publication: ${message}`)
}
function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non-finite canonical value')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail('canonical value is not JSON')
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`
}
function json(path: string, value: unknown): Artifact {
  const bytes = `${canonical(value)}\n`
  return { path, bytes, digest: sha(bytes) }
}
function safe(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SAFE.test(value)) fail(`${label} is unsafe`)
}
function object(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label} is not an object`)
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = ownDataKeys(value, label).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, i) => key !== expected[i])
  )
    fail(`${label} has unknown or missing fields`)
}
function ownDataKeys(value: object, label: string): string[] {
  const keys = Reflect.ownKeys(value)
  const names: string[] = []
  for (const key of keys) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      descriptor.get ||
      descriptor.set
    )
      fail(`${label} has a non-enumerable or accessor property`)
    names.push(key)
  }
  return names
}
function strictAuthorityValue(
  value: unknown,
  label: string,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value)
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    if (!lengthDescriptor || lengthDescriptor.value !== value.length)
      fail(`${label} has an invalid array length`)
    const indexes: number[] = []
    for (const key of keys) {
      if (key === 'length') continue
      if (typeof key !== 'string' || !/^\d+$/.test(key))
        fail(`${label} has a symbol or custom array property`)
      const index = Number(key)
      if (!Number.isSafeInteger(index) || index >= value.length)
        fail(`${label} has a sparse or custom array property`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        descriptor.get ||
        descriptor.set
      )
        fail(`${label} has a sparse or accessor array property`)
      indexes.push(index)
      strictAuthorityValue(value[index], `${label}[${index}]`, seen)
    }
    indexes.sort((left, right) => left - right)
    if (
      indexes.length !== value.length ||
      indexes.some((index, position) => index !== position)
    )
      fail(`${label} is sparse or has custom array properties`)
    return
  }
  if (Object.getPrototypeOf(value) !== Object.prototype)
    fail(`${label} is not a plain object`)
  for (const key of ownDataKeys(value, label)) {
    strictAuthorityValue(
      (value as Record<string, unknown>)[key],
      `${label}.${key}`,
      seen,
    )
  }
}
function frozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Object.values(value as Record<string, unknown>).every(child =>
    frozen(child, seen),
  )
}
function pathOf(workspace: string, relativePath: string): string {
  const result = resolve(workspace, relativePath)
  const rel = relative(workspace, result)
  if (rel.startsWith('..')) fail('artifact path escapes workspace')
  return result
}
async function existing(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
async function safeWorkspace(value: string): Promise<string> {
  const root = await realpath(value)
  const info = await lstat(root)
  if (!info.isDirectory()) fail('workspace is not a directory')
  return root
}
async function componentsSafe(
  root: string,
  target: string,
  file = false,
): Promise<void> {
  const rel = relative(root, resolve(target))
  if (rel.startsWith('..')) fail('path escapes workspace')
  const parts = rel.split('/').filter(Boolean)
  let current = root
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]!)
    if (!(await existing(current))) continue
    const info = await lstat(current)
    if (info.isSymbolicLink() || (!file && !info.isDirectory()))
      fail('existing path component is symlink or non-directory')
    if (file && i < parts.length - 1 && !info.isDirectory())
      fail('existing path component is not a directory')
  }
}
function temporaryPath(path: string, authorityDigest: string): string {
  return `${path}.tmp-${authorityDigest}`
}
async function writeAtomic(
  root: string,
  path: string,
  bytes: string,
  authorityDigest: string,
): Promise<void> {
  await componentsSafe(root, path, true)
  const temporary = temporaryPath(path, authorityDigest)
  await componentsSafe(root, temporary, true)
  if (await existing(path)) {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile())
      fail(`conflicting path is not a regular file: ${path}`)
    if ((await readFile(path, 'utf8')) !== bytes)
      fail(`conflicting bytes at ${path}`)
    if (await existing(temporary)) {
      await componentsSafe(root, temporary, true)
      await rm(temporary, { force: true })
    }
    return
  }
  let temporaryReady = false
  while (!temporaryReady) {
    if (await existing(temporary)) {
      const info = await lstat(temporary)
      if (info.isSymbolicLink() || !info.isFile())
        fail(`temporary path is not a regular file: ${temporary}`)
      if ((await readFile(temporary, 'utf8')) === bytes) {
        temporaryReady = true
      } else {
        await rm(temporary, { force: true })
      }
      continue
    }
    try {
      const handle = await open(temporary, 'wx')
      try {
        await handle.writeFile(bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
      temporaryReady = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  try {
    await rename(temporary, path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      if (!(await existing(path)))
        fail(`atomic rename race requires safe retry for ${path}`)
    } else if (code !== 'EEXIST') throw error
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile())
      fail(`conflicting path is not a regular file: ${path}`)
    if ((await readFile(path, 'utf8')) !== bytes)
      fail(`conflicting bytes at ${path}`)
  }
}
async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = publicationLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const chain = previous.then(() => current)
  publicationLocks.set(key, chain)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (publicationLocks.get(key) === chain) publicationLocks.delete(key)
  }
}
async function ensureDir(root: string, path: string): Promise<void> {
  await componentsSafe(root, path)
  await mkdir(path, { recursive: true })
  await componentsSafe(root, path)
}
function artifactNames(
  plan: Plan,
  prefix: string,
  includeTemporary: boolean,
): string[] {
  const names = plan.artifacts
    .filter(artifact =>
      prefix === ''
        ? !artifact.path.startsWith('modules/') &&
          !artifact.path.startsWith('source-maps/')
        : artifact.path.startsWith(prefix),
    )
    .map(artifact => artifact.path.slice(prefix.length))
  if (prefix === '') names.push('COMMITTED.json')
  if (!includeTemporary) return names
  return [
    ...names,
    ...names.map(name => temporaryPath(name, plan.authorityDigest)),
  ]
}
async function exactDirectory(
  path: string,
  expected: readonly string[],
  label: string,
  subset = false,
): Promise<void> {
  const actual = (await readdir(path)).sort()
  const allowed = [...expected].sort()
  if (
    subset
      ? actual.some(item => !allowed.includes(item))
      : canonical(actual) !== canonical(allowed)
  )
    fail(`${label} has unexpected or missing entries`)
}
function sourceMap(
  module: GameIrModuleCandidate,
  revision: string,
): Record<string, unknown> {
  const bindings = module.nodes.flatMap(node =>
    Object.keys(node.bindings)
      .sort()
      .map(pointer => ({
        nodeId: node.id,
        pointer,
        binding: node.bindings[pointer],
      })),
  )
  return {
    schemaVersion: 'game-ir-source-map.v1',
    foundationRevision: revision,
    moduleId: module.moduleId,
    bindings,
  }
}
function graph(candidate: GameIrCandidate): Record<string, unknown> {
  const edges = candidate.modules.flatMap(module =>
    module.nodes.flatMap(node =>
      Object.entries(node.bindings).flatMap(([pointer, binding]) =>
        binding.kind === 'derived'
          ? binding.inputPointers.map(input => ({
              from: `${module.moduleId}/${node.id}${pointer}`,
              to: `${module.moduleId}/${node.id}${input}`,
            }))
          : [],
      ),
    ),
  )
  edges.sort((a, b) => canonical(a).localeCompare(canonical(b)))
  return {
    schemaVersion: 'game-ir-dependency-graph.v1',
    foundationRevision: candidate.foundationRevision,
    edges,
  }
}

function validateAdmissions(
  authority: GameIrPublicationAuthority,
  request: GameIrCompileRequest,
  candidate: GameIrCandidate,
): readonly GameIrPublicationAdmission[] {
  if (
    !Array.isArray(authority.admissions) ||
    authority.admissions.length !== MODULES.length
  )
    fail('semantic admission coverage is incomplete')
  const admitted: GameIrPublicationAdmission[] = []
  for (let i = 0; i < MODULES.length; i += 1) {
    const admission = authority.admissions[i]
    if (!admission || admission.moduleId !== MODULES[i])
      fail('semantic admission modules are not canonical and sorted')
    object(admission as unknown, 'semantic admission')
    exact(
      admission as unknown as Record<string, unknown>,
      ['moduleId', 'packet', 'result'],
      'semantic admission',
    )
    const packet = admission.packet
    const result = admitGameIrSemanticValidationResult(packet, admission.result)
    if (result.outcome !== 'PASS' || packet.moduleId !== admission.moduleId)
      fail(`semantic module ${admission.moduleId} is not admitted PASS`)
    if (
      packet.taskId !== request.taskId ||
      packet.publicationId !== request.publicationId ||
      packet.foundationRevision !== request.foundation.foundationRevision ||
      packet.foundationReceiptDigest !== request.foundation.receiptDigest
    )
      fail('semantic packet identity is stale')
    if (
      packet.candidateBytes !== canonicalGameIrJson(candidate) ||
      packet.candidateDigest !== digestGameIrValue(candidate) ||
      canonical(packet.compileRequest) !== canonical(request)
    )
      fail('semantic packet is detached from authority')
    admitted.push(
      Object.freeze({ moduleId: admission.moduleId, packet, result }),
    )
  }
  return Object.freeze(admitted)
}

function buildPlan(authorityInput: GameIrPublicationAuthority): Plan {
  strictAuthorityValue(authorityInput, 'publication authority')
  object(authorityInput as unknown, 'publication authority')
  exact(
    authorityInput as unknown as Record<string, unknown>,
    [
      'workspacePath',
      'publicationId',
      'compileRequest',
      'candidate',
      'sectionIndex',
      'admissions',
    ],
    'publication authority',
  )
  safe(authorityInput.publicationId, 'publicationId')
  const request = parseGameIrCompileRequest(authorityInput.compileRequest)
  if (request.publicationId !== authorityInput.publicationId)
    fail('publicationId does not match compile request')
  safe(request.foundation.foundationRevision, 'foundationRevision')
  if (
    !frozen(authorityInput.candidate) ||
    !frozen(authorityInput.sectionIndex) ||
    !frozen(authorityInput.admissions)
  )
    fail('authority inputs must be immutable')
  const candidate = parseGameIrCandidate(authorityInput.candidate, {
    request,
    sections: authorityInput.sectionIndex,
  })
  if (
    candidate.modules.length !== MODULES.length ||
    candidate.modules.some(
      (module, i) =>
        module.moduleId !== MODULES[i] || !MODULE_SET.has(module.moduleId),
    )
  )
    fail('candidate canonical module coverage is invalid')
  const admissions = validateAdmissions(authorityInput, request, candidate)
  const authority: GameIrPublicationAuthority = {
    workspacePath: authorityInput.workspacePath,
    publicationId: authorityInput.publicationId,
    compileRequest: request,
    candidate,
    sectionIndex: authorityInput.sectionIndex,
    admissions,
  }
  const workspacePath = resolve(authority.workspacePath)
  const revision = request.foundation.foundationRevision
  const stage = pathOf(
    workspacePath,
    `${ROOT}/.staging/${authority.publicationId}`,
  )
  const journal = pathOf(
    workspacePath,
    `${ROOT}/.journal/${authority.publicationId}.json`,
  )
  const final = pathOf(workspacePath, `${ROOT}/revisions/${revision}`)
  const candidateDigest = digestGameIrValue(candidate)
  const modules: Artifact[] = []
  const sourceMaps: Artifact[] = []
  const moduleDigests: Record<string, string> = {}
  const sourceMapDigests: Record<string, string> = {}
  for (const module of candidate.modules) {
    const moduleArtifact = json(`modules/${module.moduleId}.json`, {
      schemaVersion: 'game-ir-module.v1',
      foundationRevision: revision,
      moduleId: module.moduleId,
      candidateDigest,
      nodes: module.nodes,
    })
    const sourceArtifact = json(
      `source-maps/${module.moduleId}.json`,
      sourceMap(module, revision),
    )
    modules.push(moduleArtifact)
    sourceMaps.push(sourceArtifact)
    moduleDigests[module.moduleId] = moduleArtifact.digest
    sourceMapDigests[module.moduleId] = sourceArtifact.digest
  }
  const dependency = json('dependency-graph.json', graph(candidate))
  const compileRequestDigest = sha(canonical(request))
  const semanticEvidence = admissions.map(admission => ({
    moduleId: admission.moduleId,
    packetDigest: admission.packet.packetDigest,
    result: admission.result,
  }))
  const manifest = json('manifest.json', {
    schemaVersion: 'game-ir-manifest.v1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    publicationId: authority.publicationId,
    foundationRevision: revision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    compileRequestDigest,
    compileRequest: request,
    candidateDigest,
    semanticEvidence,
    modules: candidate.modules.map(module => ({
      moduleId: module.moduleId,
      path: `modules/${module.moduleId}.json`,
      digest: moduleDigests[module.moduleId],
      sourceMapPath: `source-maps/${module.moduleId}.json`,
      sourceMapDigest: sourceMapDigests[module.moduleId],
    })),
    dependencyGraphPath: dependency.path,
    dependencyGraphDigest: dependency.digest,
  })
  const artifacts = [...modules, ...sourceMaps, dependency, manifest]
  const authorityDigest = sha(
    canonical({
      publicationId: authority.publicationId,
      compileRequest: request,
      candidateDigest,
      sectionIndex: authority.sectionIndex,
      semanticEvidence,
      artifacts: artifacts.map(item => ({
        path: item.path,
        digest: item.digest,
      })),
    }),
  )
  const marker = json('COMMITTED.json', {
    schemaVersion: 'game-ir-commit.v1',
    status: 'committed',
    authorityDigest,
    manifestDigest: manifest.digest,
    candidateDigest,
    compileRequestDigest,
    publicationId: authority.publicationId,
    foundationRevision: revision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: dependency.digest,
  })
  const ready = parseGameIrReadyReceipt({
    schemaVersion: 'game-ir-ready-receipt.v1',
    taskId: request.taskId,
    publicationId: authority.publicationId,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundationRevision: revision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    manifestDigest: manifest.digest,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: dependency.digest,
    committedPath: `${ROOT}/revisions/${revision}/COMMITTED.json`,
  })
  const entries = [...artifacts, marker].map(item => ({
    path: item.path,
    digest: item.digest,
  }))
  const journalBytes = `${canonical({ schemaVersion: 'game-ir-publication-journal.v1', status: 'PREPARED', authorityDigest, publicationId: authority.publicationId, foundationRevision: revision, foundationReceiptDigest: request.foundation.receiptDigest, compileRequestDigest, candidateDigest, entries })}\n`
  const prepared = {
    preparedPath: `${ROOT}/.staging/${authority.publicationId}`,
    journalPath: `${ROOT}/.journal/${authority.publicationId}.json`,
    committedPath: ready.committedPath,
    authorityDigest,
  }
  return {
    authority,
    workspacePath,
    revision,
    publicationId: authority.publicationId,
    stage,
    journal,
    final,
    authorityDigest,
    artifacts,
    marker,
    journalBytes,
    ready,
    prepared,
  }
}

async function writeStage(plan: Plan): Promise<void> {
  await ensureDir(plan.workspacePath, pathOf(plan.workspacePath, ROOT))
  await ensureDir(
    plan.workspacePath,
    pathOf(plan.workspacePath, `${ROOT}/.journal`),
  )
  await ensureDir(
    plan.workspacePath,
    pathOf(plan.workspacePath, `${ROOT}/.staging`),
  )
  await writeAtomic(
    plan.workspacePath,
    plan.journal,
    plan.journalBytes,
    plan.authorityDigest,
  )
  if (await existing(plan.stage)) {
    await componentsSafe(plan.workspacePath, plan.stage)
    await exactDirectory(
      plan.stage,
      [
        'modules',
        'source-maps',
        ...artifactNames(plan, '', true).filter(
          name => name !== 'COMMITTED.json',
        ),
        'COMMITTED.json',
        temporaryPath('COMMITTED.json', plan.authorityDigest),
      ],
      'staging',
      true,
    )
  } else await ensureDir(plan.workspacePath, plan.stage)
  await ensureDir(plan.workspacePath, join(plan.stage, 'modules'))
  await ensureDir(plan.workspacePath, join(plan.stage, 'source-maps'))
  await exactDirectory(
    join(plan.stage, 'modules'),
    artifactNames(plan, 'modules/', true),
    'staging modules',
    true,
  )
  await exactDirectory(
    join(plan.stage, 'source-maps'),
    artifactNames(plan, 'source-maps/', true),
    'staging source maps',
    true,
  )
  for (const artifact of [...plan.artifacts, plan.marker]) {
    try {
      await writeAtomic(
        plan.workspacePath,
        join(plan.stage, artifact.path),
        artifact.bytes,
        plan.authorityDigest,
      )
    } catch (error) {
      if (!(await existing(plan.stage)) && (await existing(plan.final))) {
        await exactFiles(plan, plan.final)
        return
      }
      throw error
    }
  }
  for (const artifact of [...plan.artifacts, plan.marker]) {
    const artifactPath = join(plan.stage, artifact.path)
    if ((await readFile(artifactPath, 'utf8')) !== artifact.bytes)
      fail(`staging artifact disagrees for ${artifact.path}`)
  }
  await removeStageTemporaryFiles(plan)
  await exactDirectory(
    plan.stage,
    [
      'modules',
      'source-maps',
      ...artifactNames(plan, '', false).filter(
        name => name !== 'COMMITTED.json',
      ),
      'COMMITTED.json',
    ],
    'staging',
  )
  await exactDirectory(
    join(plan.stage, 'modules'),
    artifactNames(plan, 'modules/', false),
    'staging modules',
  )
  await exactDirectory(
    join(plan.stage, 'source-maps'),
    artifactNames(plan, 'source-maps/', false),
    'staging source maps',
  )
}

async function exactFiles(plan: Plan, root: string): Promise<void> {
  await componentsSafe(plan.workspacePath, root)
  await exactDirectory(
    root,
    [
      'modules',
      'source-maps',
      ...plan.artifacts
        .filter(
          a =>
            !a.path.startsWith('modules/') &&
            !a.path.startsWith('source-maps/'),
        )
        .map(a => a.path),
      'COMMITTED.json',
    ],
    'final',
  )
  await componentsSafe(plan.workspacePath, join(root, 'modules'))
  await componentsSafe(plan.workspacePath, join(root, 'source-maps'))
  await exactDirectory(
    join(root, 'modules'),
    plan.artifacts
      .filter(a => a.path.startsWith('modules/'))
      .map(a => a.path.slice(8)),
    'final modules',
  )
  await exactDirectory(
    join(root, 'source-maps'),
    plan.artifacts
      .filter(a => a.path.startsWith('source-maps/'))
      .map(a => a.path.slice(12)),
    'final source maps',
  )
  for (const artifact of [...plan.artifacts, plan.marker]) {
    const artifactPath = join(root, artifact.path)
    await componentsSafe(plan.workspacePath, artifactPath, true)
    const bytes = await readFile(artifactPath, 'utf8')
    if (bytes !== artifact.bytes)
      fail(`artifact bytes disagree for ${artifact.path}`)
  }
}
async function removeStageTemporaryFiles(plan: Plan): Promise<void> {
  for (const artifact of [...plan.artifacts, plan.marker]) {
    const target = join(plan.stage, artifact.path)
    const temporary = temporaryPath(target, plan.authorityDigest)
    if (!(await existing(temporary))) continue
    await componentsSafe(plan.workspacePath, temporary, true)
    if (!(await existing(target)))
      fail(`temporary artifact has no complete target: ${artifact.path}`)
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isFile())
      fail(`temporary artifact target is not a regular file: ${artifact.path}`)
    if ((await readFile(target, 'utf8')) !== artifact.bytes)
      fail(`temporary artifact target disagrees: ${artifact.path}`)
    await rm(temporary, { force: true })
  }
}
async function cleanup(plan: Plan): Promise<void> {
  await rm(plan.stage, { recursive: true, force: true })
  await rm(plan.journal, { force: true })
  await rm(temporaryPath(plan.journal, plan.authorityDigest), { force: true })
  for (const path of [
    join(plan.workspacePath, ROOT, '.staging'),
    join(plan.workspacePath, ROOT, '.journal'),
  ]) {
    try {
      if ((await readdir(path)).length === 0) await rmdir(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}
async function publish(plan: Plan): Promise<GameIrReadyReceipt> {
  await writeStage(plan)
  const revisions = pathOf(plan.workspacePath, `${ROOT}/revisions`)
  await ensureDir(plan.workspacePath, revisions)
  await componentsSafe(plan.workspacePath, plan.final)
  if (await existing(plan.final)) {
    await exactFiles(plan, plan.final)
    await cleanup(plan)
    return plan.ready
  }
  try {
    await rename(plan.stage, plan.final)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOENT')
      throw error
    if (!(await existing(plan.final)))
      fail('rename race winner is not yet visible; retry safely')
    await exactFiles(plan, plan.final)
  }
  await exactFiles(plan, plan.final)
  await cleanup(plan)
  return plan.ready
}

export function expectedGameIrPublicationArtifacts(
  authority: GameIrPublicationAuthority,
): readonly Readonly<{ path: string; bytes: string; digest: string }>[] {
  const plan = buildPlan(authority)
  return Object.freeze([...plan.artifacts, plan.marker])
}
function withWorkspace(plan: Plan, workspacePath: string): Plan {
  return {
    ...plan,
    workspacePath,
    stage: pathOf(workspacePath, `${ROOT}/.staging/${plan.publicationId}`),
    journal: pathOf(
      workspacePath,
      `${ROOT}/.journal/${plan.publicationId}.json`,
    ),
    final: pathOf(workspacePath, `${ROOT}/revisions/${plan.revision}`),
  }
}
export async function prepareGameIrPublication(
  authority: GameIrPublicationAuthority,
): Promise<GameIrPublicationPrepared> {
  const plan = withWorkspace(
    buildPlan(authority),
    await safeWorkspace(authority.workspacePath),
  )
  return locked(plan.final, async () => {
    await writeStage(plan)
    return plan.prepared
  })
}
export async function commitGameIrPublication(
  authority: GameIrPublicationAuthority,
): Promise<GameIrReadyReceipt> {
  const plan = withWorkspace(
    buildPlan(authority),
    await safeWorkspace(authority.workspacePath),
  )
  return locked(plan.final, () => publish(plan))
}
export async function recoverGameIrPublication(
  authority: GameIrPublicationAuthority,
): Promise<GameIrReadyReceipt> {
  return commitGameIrPublication(authority)
}
export async function validateCommittedGameIr(
  authority: GameIrPublicationAuthority,
): Promise<GameIrReadyReceipt> {
  const plan = withWorkspace(
    buildPlan(authority),
    await safeWorkspace(authority.workspacePath),
  )
  if (!(await existing(plan.final))) fail('COMMITTED revision is missing')
  await exactFiles(plan, plan.final)
  return plan.ready
}

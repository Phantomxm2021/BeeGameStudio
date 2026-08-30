import { createHash, randomBytes } from 'node:crypto'
import {
  link,
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
import { dirname, join, relative, resolve } from 'node:path'
import {
  GAME_IR_PUBLICATION_ROOT,
  GAME_IR_SCHEMA_VERSION,
  gameIrCommittedPath,
  gameIrRevisionPath,
  parseGameIrCompileRequest,
  parseGameIrReadyReceipt,
  type GameIrCompileRequest,
  type GameIrReadyReceipt,
} from './contracts'
import {
  canonicalGameIrJson,
  compareCodeUnits,
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
import { digestSectionIndex } from '../foundation-section-index'

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

export type GameIrPublicationTestEvent = Readonly<{
  type: 'directory-sync' | 'before-rename' | 'stage-work' | 'rename'
  path?: string
  from?: string
  to?: string
}>
export type GameIrPublicationTestHooks = Readonly<{
  onEvent?: (event: GameIrPublicationTestEvent) => void
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
  privateRoot: string
  authorityDigest: string
  artifacts: readonly Artifact[]
  marker: Artifact
  journalBytes: string
  ready: GameIrReadyReceipt
  prepared: GameIrPublicationPrepared
  testHooks?: GameIrPublicationTestHooks
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR publication: ${message}`)
}
function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function json(path: string, value: unknown): Artifact {
  const bytes = `${canonicalGameIrJson(value)}\n`
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
// Directory fsync is required for publication durability; unsupported
// platforms/filesystems fail closed instead of claiming READY durability.
async function syncDirectory(
  root: string,
  target: string,
  testHooks?: GameIrPublicationTestHooks,
): Promise<void> {
  await componentsSafe(root, target)
  const handle = await open(target, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  testHooks?.onEvent?.({ type: 'directory-sync', path: target })
}
async function durableMkdir(
  root: string,
  target: string,
  testHooks?: GameIrPublicationTestHooks,
): Promise<void> {
  const rel = relative(root, resolve(target))
  if (rel.startsWith('..')) fail('path escapes workspace')
  let current = root
  for (const part of rel.split('/').filter(Boolean)) {
    const parent = current
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        fail('existing path component is symlink or non-directory')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      try {
        await mkdir(current)
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST')
          throw mkdirError
      }
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        fail('existing path component is symlink or non-directory')
    }
    await syncDirectory(root, parent, testHooks)
  }
}
async function writePrivateFile(
  root: string,
  path: string,
  bytes: string,
): Promise<void> {
  await componentsSafe(root, path, true)
  const handle = await open(path, 'wx')
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}
async function installNoReplace(
  root: string,
  source: string,
  target: string,
  bytes: string,
): Promise<void> {
  await componentsSafe(root, source, true)
  await componentsSafe(root, target, true)
  try {
    await link(source, target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST') throw error
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isFile())
      fail(`conflicting path is not a regular file: ${target}`)
    if ((await readFile(target, 'utf8')) !== bytes)
      fail(`conflicting bytes at ${target}`)
  } finally {
    await rm(source, { force: true })
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
async function ensureDir(
  root: string,
  path: string,
  testHooks?: GameIrPublicationTestHooks,
): Promise<void> {
  await durableMkdir(root, path, testHooks)
}
async function installArtifact(
  plan: Plan,
  artifact: Artifact,
  target: string,
): Promise<void> {
  const source = join(plan.privateRoot, artifact.path)
  await ensureDir(plan.workspacePath, resolve(source, '..'), plan.testHooks)
  await writePrivateFile(plan.workspacePath, source, artifact.bytes)
  await installNoReplace(plan.workspacePath, source, target, artifact.bytes)
}
function artifactNames(plan: Plan, prefix: string): string[] {
  const names = plan.artifacts
    .filter(artifact =>
      prefix === ''
        ? !artifact.path.startsWith('modules/') &&
          !artifact.path.startsWith('source-maps/')
        : artifact.path.startsWith(prefix),
    )
    .map(artifact => artifact.path.slice(prefix.length))
  if (prefix === '') names.push('COMMITTED.json')
  return names
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
      : canonicalGameIrJson(actual) !== canonicalGameIrJson(allowed)
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
    module.nodes.flatMap(node => [
      ...Object.entries(node.bindings).flatMap(([pointer, binding]) =>
        binding.kind === 'derived'
          ? binding.inputPointers.map(input => ({
              kind: 'derived',
              from: `${module.moduleId}/${node.id}${pointer}`,
              to: `${module.moduleId}/${node.id}${input}`,
            }))
          : [],
      ),
      ...node.references.map(reference => ({
        kind: 'reference',
        type: 'reference',
        from: `${module.moduleId}/${node.id}`,
        to: reference.targetId,
        targetType: reference.targetType,
      })),
      ...node.edges.map(edge => ({
        kind: 'relationship',
        type: edge.type,
        from: `${module.moduleId}/${node.id}`,
        to: edge.targetId,
        targetType: edge.targetType,
      })),
    ]),
  )
  edges.sort((a, b) =>
    compareCodeUnits(canonicalGameIrJson(a), canonicalGameIrJson(b)),
  )
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
    const authoritySectionIndexDigest = digestSectionIndex(
      authority.sectionIndex,
    )
    if (
      request.foundation.sectionIndexDigest !== authoritySectionIndexDigest ||
      packet.sectionIndexDigest !== authoritySectionIndexDigest ||
      canonicalGameIrJson(packet.sectionIndex) !==
        canonicalGameIrJson(authority.sectionIndex)
    )
      fail(
        'semantic packet Section Index is detached from publication authority',
      )
    if (
      packet.candidateBytes !== canonicalGameIrJson(candidate) ||
      packet.candidateDigest !== digestGameIrValue(candidate) ||
      canonicalGameIrJson(packet.compileRequest) !==
        canonicalGameIrJson(request)
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
  if (
    digestSectionIndex(authorityInput.sectionIndex) !==
    request.foundation.sectionIndexDigest
  )
    fail(
      'publication authority Section Index does not match Foundation receipt',
    )
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
  const preparedPath = `${GAME_IR_PUBLICATION_ROOT}/.staging/${authority.publicationId}`
  const journalPath = `${GAME_IR_PUBLICATION_ROOT}/.journal/${authority.publicationId}.json`
  const stage = pathOf(workspacePath, preparedPath)
  const journal = pathOf(workspacePath, journalPath)
  const final = pathOf(workspacePath, gameIrRevisionPath(revision))
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
  const compileRequestDigest = sha(canonicalGameIrJson(request))
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
    canonicalGameIrJson({
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
    committedPath: gameIrCommittedPath(revision),
  })
  const entries = [...artifacts, marker].map(item => ({
    path: item.path,
    digest: item.digest,
  }))
  const journalBytes = `${canonicalGameIrJson({ schemaVersion: 'game-ir-publication-journal.v1', status: 'PREPARED', authorityDigest, publicationId: authority.publicationId, foundationRevision: revision, foundationReceiptDigest: request.foundation.receiptDigest, compileRequestDigest, candidateDigest, entries })}\n`
  const prepared = {
    preparedPath,
    journalPath,
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
    privateRoot: pathOf(workspacePath, '.beegame/.game-ir-private/placeholder'),
    authorityDigest,
    artifacts,
    marker,
    journalBytes,
    ready,
    prepared,
  }
}

async function writeStage(plan: Plan): Promise<void> {
  const journalDirectory = dirname(plan.journal)
  const stageDirectory = dirname(plan.stage)
  await ensureDir(
    plan.workspacePath,
    pathOf(plan.workspacePath, GAME_IR_PUBLICATION_ROOT),
    plan.testHooks,
  )
  await ensureDir(plan.workspacePath, journalDirectory, plan.testHooks)
  const journalExists = await existing(plan.journal)
  const stageExists = await existing(plan.stage)
  const finalExists = await existing(plan.final)
  if (!journalExists && (stageExists || finalExists))
    fail('immutable PREPARED journal is missing')
  await installArtifact(
    plan,
    {
      path: 'journal.json',
      bytes: plan.journalBytes,
      digest: sha(plan.journalBytes),
    },
    plan.journal,
  )
  await syncDirectory(plan.workspacePath, journalDirectory, plan.testHooks)
  await syncDirectory(
    plan.workspacePath,
    dirname(journalDirectory),
    plan.testHooks,
  )
  plan.testHooks?.onEvent?.({ type: 'stage-work' })
  await ensureDir(plan.workspacePath, stageDirectory, plan.testHooks)
  if (await existing(plan.stage)) {
    await componentsSafe(plan.workspacePath, plan.stage)
    await exactDirectory(
      plan.stage,
      [
        'modules',
        'source-maps',
        ...artifactNames(plan, '').filter(name => name !== 'COMMITTED.json'),
        'COMMITTED.json',
      ],
      'staging',
      true,
    )
  } else await ensureDir(plan.workspacePath, plan.stage, plan.testHooks)
  await ensureDir(
    plan.workspacePath,
    join(plan.stage, 'modules'),
    plan.testHooks,
  )
  await ensureDir(
    plan.workspacePath,
    join(plan.stage, 'source-maps'),
    plan.testHooks,
  )
  await exactDirectory(
    join(plan.stage, 'modules'),
    artifactNames(plan, 'modules/'),
    'staging modules',
    true,
  )
  await exactDirectory(
    join(plan.stage, 'source-maps'),
    artifactNames(plan, 'source-maps/'),
    'staging source maps',
    true,
  )
  for (const artifact of [...plan.artifacts, plan.marker]) {
    try {
      await installArtifact(plan, artifact, join(plan.stage, artifact.path))
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
    if (
      (await readRegularFile(
        plan.workspacePath,
        artifactPath,
        `staging artifact ${artifact.path}`,
      )) !== artifact.bytes
    )
      fail(`staging artifact disagrees for ${artifact.path}`)
  }
  await exactDirectory(
    plan.stage,
    [
      'modules',
      'source-maps',
      ...artifactNames(plan, '').filter(name => name !== 'COMMITTED.json'),
      'COMMITTED.json',
    ],
    'staging',
  )
  await exactDirectory(
    join(plan.stage, 'modules'),
    artifactNames(plan, 'modules/'),
    'staging modules',
  )
  await exactDirectory(
    join(plan.stage, 'source-maps'),
    artifactNames(plan, 'source-maps/'),
    'staging source maps',
  )
  await syncDirectory(
    plan.workspacePath,
    join(plan.stage, 'modules'),
    plan.testHooks,
  )
  await syncDirectory(
    plan.workspacePath,
    join(plan.stage, 'source-maps'),
    plan.testHooks,
  )
  await syncDirectory(plan.workspacePath, plan.stage, plan.testHooks)
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
    const bytes = await readRegularFile(
      plan.workspacePath,
      artifactPath,
      `artifact ${artifact.path}`,
    )
    if (bytes !== artifact.bytes)
      fail(`artifact bytes disagree for ${artifact.path}`)
  }
}
async function readRegularFile(
  root: string,
  target: string,
  label: string,
): Promise<string> {
  await componentsSafe(root, target, true)
  const info = await lstat(target)
  if (info.isSymbolicLink() || !info.isFile())
    fail(`${label} is not a regular file`)
  return readFile(target, 'utf8')
}
async function exactJournal(plan: Plan): Promise<void> {
  await componentsSafe(plan.workspacePath, plan.journal, true)
  try {
    if (
      (await readRegularFile(
        plan.workspacePath,
        plan.journal,
        'immutable PREPARED journal',
      )) !== plan.journalBytes
    )
      fail('immutable PREPARED journal disagrees with authority')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      fail('immutable PREPARED journal is missing')
    throw error
  }
}
async function cleanup(plan: Plan): Promise<void> {
  const privateCleanup = join(plan.privateRoot, 'cleanup')
  const stageDirectory = dirname(plan.stage)
  try {
    await rename(plan.stage, privateCleanup)
    await rm(privateCleanup, { recursive: true, force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return
  }
  try {
    if ((await readdir(stageDirectory)).length === 0)
      await rmdir(stageDirectory)
  } catch {
    return
  }
}
async function durabilityBarrier(plan: Plan, revisions: string): Promise<void> {
  await syncDirectory(plan.workspacePath, plan.final, plan.testHooks)
  await syncDirectory(plan.workspacePath, revisions, plan.testHooks)
}
async function ready(
  plan: Plan,
  revisions: string,
): Promise<GameIrReadyReceipt> {
  await exactFiles(plan, plan.final)
  await durabilityBarrier(plan, revisions)
  await cleanup(plan)
  return plan.ready
}
async function publish(plan: Plan): Promise<GameIrReadyReceipt> {
  await componentsSafe(plan.workspacePath, plan.journal, true)
  if (
    !(await existing(plan.journal)) &&
    ((await existing(plan.stage)) || (await existing(plan.final)))
  )
    fail('immutable PREPARED journal is missing')
  const finalDirectory = dirname(plan.final)
  try {
    await writeStage(plan)
  } catch (error) {
    if (!(await existing(plan.stage)) && (await existing(plan.final))) {
      await exactJournal(plan)
      return ready(plan, finalDirectory)
    }
    throw error
  }
  await ensureDir(plan.workspacePath, finalDirectory, plan.testHooks)
  await componentsSafe(plan.workspacePath, plan.final)
  if (await existing(plan.final)) {
    return ready(plan, finalDirectory)
  }
  const stageDirectory = dirname(plan.stage)
  try {
    plan.testHooks?.onEvent?.({
      type: 'before-rename',
      from: plan.stage,
      to: plan.final,
    })
    await rename(plan.stage, plan.final)
    plan.testHooks?.onEvent?.({
      type: 'rename',
      from: plan.stage,
      to: plan.final,
    })
    await syncDirectory(plan.workspacePath, stageDirectory, plan.testHooks)
    await syncDirectory(plan.workspacePath, finalDirectory, plan.testHooks)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'ENOTEMPTY' && code !== 'ENOENT')
      throw error
    if (!(await existing(plan.final)))
      fail('rename race winner is not yet visible; retry safely')
    await exactFiles(plan, plan.final)
  }
  return ready(plan, finalDirectory)
}

function withWorkspace(
  plan: Plan,
  workspacePath: string,
  privateRoot = plan.privateRoot,
): Plan {
  const { preparedPath, journalPath } = plan.prepared
  return {
    ...plan,
    workspacePath,
    stage: pathOf(workspacePath, preparedPath),
    journal: pathOf(workspacePath, journalPath),
    final: pathOf(workspacePath, gameIrRevisionPath(plan.revision)),
    privateRoot,
  }
}
async function runtimePlan(
  authority: GameIrPublicationAuthority,
  testHooks?: GameIrPublicationTestHooks,
): Promise<Plan> {
  const plan = withWorkspace(
    buildPlan(authority),
    await safeWorkspace(authority.workspacePath),
  )
  const parent = pathOf(plan.workspacePath, '.beegame/.game-ir-private')
  await ensureDir(plan.workspacePath, parent, testHooks)
  const segment = `${plan.publicationId}-${process.pid}-${randomBytes(16).toString('hex')}`
  safe(segment, 'private temp segment')
  const privateRoot = pathOf(plan.workspacePath, join(parent, segment))
  await mkdir(privateRoot)
  await componentsSafe(plan.workspacePath, privateRoot)
  return { ...plan, privateRoot, testHooks }
}
async function cleanupPrivate(plan: Plan): Promise<void> {
  try {
    await rm(plan.privateRoot, { recursive: true, force: true })
  } catch {
    return
  }
}
export async function prepareGameIrPublication(
  authority: GameIrPublicationAuthority,
): Promise<GameIrPublicationPrepared> {
  const plan = await runtimePlan(authority)
  try {
    return await locked(plan.final, async () => {
      await writeStage(plan)
      return plan.prepared
    })
  } finally {
    await cleanupPrivate(plan)
  }
}
export async function commitGameIrPublication(
  authority: GameIrPublicationAuthority,
  testHooks?: GameIrPublicationTestHooks,
): Promise<GameIrReadyReceipt> {
  const plan = await runtimePlan(authority, testHooks)
  try {
    return await locked(plan.final, () => publish(plan))
  } finally {
    await cleanupPrivate(plan)
  }
}
export async function recoverGameIrPublication(
  authority: GameIrPublicationAuthority,
): Promise<GameIrReadyReceipt> {
  return commitGameIrPublication(authority)
}
export async function validateCommittedGameIr(
  authority: GameIrPublicationAuthority,
  testHooks?: GameIrPublicationTestHooks,
): Promise<GameIrReadyReceipt> {
  const plan = {
    ...withWorkspace(
      buildPlan(authority),
      await safeWorkspace(authority.workspacePath),
    ),
    testHooks,
  }
  await exactJournal(plan)
  if (!(await existing(plan.final))) fail('COMMITTED revision is missing')
  await exactFiles(plan, plan.final)
  const finalDirectory = dirname(plan.final)
  await durabilityBarrier(plan, finalDirectory)
  return plan.ready
}

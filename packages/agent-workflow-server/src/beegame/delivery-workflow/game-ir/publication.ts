import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
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
  type GameIrCandidate,
  type GameIrModuleCandidate,
} from './model'
import {
  GAME_IR_SEMANTIC_VALIDATOR_MANIFEST,
  type GameIrSemanticValidationResult,
} from './semantic-admission'

const SHA256 = /^[a-f0-9]{64}$/
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ROOT = '.beegame/ir/game-ir.v1'
const JOURNAL_SCHEMA = 'game-ir-publication-journal.v1'
const MANIFEST_SCHEMA = 'game-ir-manifest.v1'
const MODULE_SCHEMA = 'game-ir-module.v1'
const SOURCE_MAP_SCHEMA = 'game-ir-source-map.v1'
const GRAPH_SCHEMA = 'game-ir-dependency-graph.v1'
const COMMIT_SCHEMA = 'game-ir-commit.v1'

type PassReceipt = Extract<GameIrSemanticValidationResult, { outcome: 'PASS' }>

export type GameIrPublicationInput = Readonly<{
  workspacePath: string
  request?: GameIrCompileRequest
  compileRequest?: GameIrCompileRequest
  candidate: GameIrCandidate
  semanticPassReceipts?: Readonly<
    Record<string, GameIrSemanticValidationResult>
  >
  semanticReceipts?: Readonly<Record<string, GameIrSemanticValidationResult>>
}>

export type GameIrPublicationRecoveryInput = Readonly<{
  workspacePath: string
  request?: GameIrCompileRequest
  compileRequest?: GameIrCompileRequest
  candidate?: GameIrCandidate
  semanticPassReceipts?: Readonly<
    Record<string, GameIrSemanticValidationResult>
  >
  semanticReceipts?: Readonly<Record<string, GameIrSemanticValidationResult>>
}>

export type GameIrPublicationPrepared = Readonly<{
  kind: 'prepared'
  workspacePath: string
  request: GameIrCompileRequest
  publicationId: string
  foundationRevision: string
  preparedPath: string
  journalPath: string
  committedPath: string
  manifestDigest: string
  candidateDigest: string
  moduleDigests: Readonly<Record<string, string>>
  sourceMapDigests: Readonly<Record<string, string>>
  dependencyGraphDigest: string
}>

type Artifact = Readonly<{
  path: string
  bytes: string
  digest: string
}>

type Plan = Readonly<{
  workspacePath: string
  request: GameIrCompileRequest
  publicationId: string
  foundationRevision: string
  candidateDigest: string
  artifacts: readonly Artifact[]
  manifest: Record<string, unknown>
  manifestArtifact: Artifact
  moduleDigests: Readonly<Record<string, string>>
  sourceMapDigests: Readonly<Record<string, string>>
  dependencyGraphDigest: string
  committedPath: string
  stagingRoot: string
  finalRoot: string
  journalPath: string
  prepared: GameIrPublicationPrepared
}>

type JournalEntry = Readonly<{
  path: string
  digest: string
}>

type Journal = Readonly<{
  schema: typeof JOURNAL_SCHEMA
  status: 'PREPARED'
  publicationId: string
  foundationRevision: string
  foundationReceiptDigest: string
  candidateDigest: string
  stagingPath: string
  finalPath: string
  entries: readonly JournalEntry[]
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR publication: ${message}`)
}

function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      fail('canonical JSON contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (
    !value ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail('canonical JSON contains a non-plain object')
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      key =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(',')}}`
}

function jsonArtifact(path: string, value: unknown): Artifact {
  const bytes = `${canonical(value)}\n`
  return { path, bytes, digest: digest(bytes) }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value))
    fail(`${label} is not a SHA-256 digest`)
}

function assertSafeSegment(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    !SAFE_SEGMENT.test(value) ||
    value === '.' ||
    value === '..'
  )
    fail(`${label} is not a safe path segment`)
}

function assertObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(`${label} must be a plain object`)
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function assertRecordDigests(
  value: unknown,
  label: string,
): Record<string, string> {
  assertObject(value, label)
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    assertSafeSegment(key, `${label} key`)
    assertDigest(entry, `${label}.${key}`)
    result[key] = entry
  }
  return result
}

function deepFrozen(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value !== 'object') return true
  if (seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  return Object.values(value as Record<string, unknown>).every(child =>
    deepFrozen(child, seen),
  )
}

function ensureWithin(base: string, path: string, label: string): string {
  const resolved = resolve(path)
  const rel = relative(resolve(base), resolved)
  if (rel.startsWith('..') || isAbsolute(rel))
    fail(`${label} escapes workspace`)
  return resolved
}

function stagePath(workspacePath: string, publicationId: string): string {
  return ensureWithin(
    workspacePath,
    join(workspacePath, ROOT, '.staging', publicationId),
    'staging path',
  )
}

function finalPath(workspacePath: string, foundationRevision: string): string {
  return ensureWithin(
    workspacePath,
    join(workspacePath, ROOT, 'revisions', foundationRevision),
    'revision path',
  )
}

function sourceMap(
  module: GameIrModuleCandidate,
  foundationRevision: string,
): Record<string, unknown> {
  const bindings: Record<string, unknown>[] = []
  for (const node of module.nodes) {
    for (const pointer of Object.keys(node.bindings).sort()) {
      bindings.push({
        nodeId: node.id,
        pointer,
        binding: node.bindings[pointer],
      })
    }
  }
  return {
    schemaVersion: SOURCE_MAP_SCHEMA,
    foundationRevision,
    moduleId: module.moduleId,
    bindings,
  }
}

function dependencyGraph(candidate: GameIrCandidate): Record<string, unknown> {
  const edges: Record<string, unknown>[] = []
  for (const module of candidate.modules) {
    for (const node of module.nodes) {
      for (const [pointer, binding] of Object.entries(node.bindings)) {
        if (binding.kind !== 'derived') continue
        for (const input of binding.inputPointers)
          edges.push({
            from: `${module.moduleId}/${node.id}${pointer}`,
            to: `${module.moduleId}/${node.id}${input}`,
          })
      }
    }
  }
  edges.sort((left, right) => canonical(left).localeCompare(canonical(right)))
  return {
    schemaVersion: GRAPH_SCHEMA,
    foundationRevision: candidate.foundationRevision,
    edges,
  }
}

function semanticReceiptMap(
  input: GameIrPublicationInput,
): Readonly<Record<string, GameIrSemanticValidationResult>> {
  return input.semanticPassReceipts ?? input.semanticReceipts ?? {}
}

function inputRequest(input: {
  request?: GameIrCompileRequest
  compileRequest?: GameIrCompileRequest
}): GameIrCompileRequest {
  const value = input.request ?? input.compileRequest
  if (!value) fail('compile request is missing')
  return value
}

function assertSemanticPasses(input: GameIrPublicationInput): void {
  const expected = new Set(
    input.candidate.modules
      .filter(module =>
        module.nodes.some(node => node.producerMode === 'semantic'),
      )
      .map(module => module.moduleId),
  )
  const receipts = semanticReceiptMap(input)
  for (const moduleId of Object.keys(receipts))
    if (!expected.has(moduleId))
      fail(`unexpected semantic receipt for ${moduleId}`)
  for (const moduleId of expected) {
    const receipt = receipts[moduleId]
    if (!receipt || receipt.outcome !== 'PASS')
      fail(`semantic module ${moduleId} lacks PASS admission`)
    assertPassReceipt(receipt, moduleId)
  }
}

function assertPassReceipt(
  receipt: GameIrSemanticValidationResult,
  moduleId: string,
): asserts receipt is PassReceipt {
  if (receipt.outcome !== 'PASS')
    fail(`semantic module ${moduleId} is not PASS`)
  assertExactKeys(
    receipt as unknown as Record<string, unknown>,
    ['outcome', 'packetDigest', 'checkIds'],
    `${moduleId} PASS receipt`,
  )
  assertDigest(receipt.packetDigest, `${moduleId} PASS packetDigest`)
  if (
    !Array.isArray(receipt.checkIds) ||
    receipt.checkIds.length === 0 ||
    receipt.checkIds.some(item => typeof item !== 'string')
  )
    fail(`${moduleId} PASS receipt has invalid check coverage`)
  const manifest = GAME_IR_SEMANTIC_VALIDATOR_MANIFEST.modules.find(
    item => item.moduleId === moduleId,
  )
  if (manifest && canonical(receipt.checkIds) !== canonical(manifest.checkIds))
    fail(`${moduleId} PASS receipt has incomplete check coverage`)
}

function buildPlan(input: GameIrPublicationInput): Plan {
  const request = parseGameIrCompileRequest(inputRequest(input))
  assertSafeSegment(request.publicationId, 'publicationId')
  assertSafeSegment(request.foundation.foundationRevision, 'foundationRevision')
  if (
    input.candidate.taskId !== request.taskId ||
    input.candidate.foundationRevision !== request.foundation.foundationRevision
  )
    fail('candidate is stale for compile request')
  if (!deepFrozen(input.candidate))
    fail('candidate must be immutable after admission')
  const candidateBytes = canonicalGameIrJson(input.candidate)
  if (digestGameIrValue(input.candidate) !== digest(candidateBytes))
    fail('candidate digest is inconsistent')
  assertSemanticPasses({ ...input, request })

  const workspacePath = resolve(input.workspacePath)
  const stagingRoot = stagePath(workspacePath, request.publicationId)
  const finalRoot = finalPath(
    workspacePath,
    request.foundation.foundationRevision,
  )
  const committedPath = join(finalRoot, 'COMMITTED.json')
  const journalPath = join(
    workspacePath,
    ROOT,
    '.journal',
    `${request.publicationId}.json`,
  )
  const moduleArtifacts: Artifact[] = []
  const sourceMapArtifacts: Artifact[] = []
  const moduleDigests: Record<string, string> = {}
  const sourceMapDigests: Record<string, string> = {}
  for (const module of input.candidate.modules) {
    const moduleArtifact = jsonArtifact(`modules/${module.moduleId}.json`, {
      schemaVersion: MODULE_SCHEMA,
      foundationRevision: input.candidate.foundationRevision,
      moduleId: module.moduleId,
      candidateDigest: digest(candidateBytes),
      nodes: module.nodes,
    })
    const sourceMapArtifact = jsonArtifact(
      `source-maps/${module.moduleId}.json`,
      sourceMap(module, input.candidate.foundationRevision),
    )
    moduleArtifacts.push(moduleArtifact)
    sourceMapArtifacts.push(sourceMapArtifact)
    moduleDigests[module.moduleId] = moduleArtifact.digest
    sourceMapDigests[module.moduleId] = sourceMapArtifact.digest
  }
  const graphArtifact = jsonArtifact(
    'dependency-graph.json',
    dependencyGraph(input.candidate),
  )
  const manifestBody = {
    schemaVersion: MANIFEST_SCHEMA,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: request.taskId,
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    candidateDigest: digest(candidateBytes),
    modules: input.candidate.modules.map(module => ({
      moduleId: module.moduleId,
      path: `modules/${module.moduleId}.json`,
      digest: moduleDigests[module.moduleId],
      sourceMapPath: `source-maps/${module.moduleId}.json`,
      sourceMapDigest: sourceMapDigests[module.moduleId],
    })),
    dependencyGraphPath: graphArtifact.path,
    dependencyGraphDigest: graphArtifact.digest,
  }
  const manifestArtifact = jsonArtifact('manifest.json', manifestBody)
  const artifacts = [
    ...moduleArtifacts,
    ...sourceMapArtifacts,
    graphArtifact,
    manifestArtifact,
  ]
  const journal: Journal = {
    schema: JOURNAL_SCHEMA,
    status: 'PREPARED',
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    candidateDigest: digest(candidateBytes),
    stagingPath: `.beegame/ir/game-ir.v1/.staging/${request.publicationId}`,
    finalPath: `.beegame/ir/game-ir.v1/revisions/${request.foundation.foundationRevision}`,
    entries: artifacts.map(artifact => ({
      path: artifact.path,
      digest: artifact.digest,
    })),
  }
  const prepared: GameIrPublicationPrepared = {
    kind: 'prepared',
    workspacePath,
    request,
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    preparedPath: journal.stagingPath,
    journalPath: `.beegame/ir/game-ir.v1/.journal/${request.publicationId}.json`,
    committedPath: `${journal.finalPath}/COMMITTED.json`,
    manifestDigest: manifestArtifact.digest,
    candidateDigest: digest(candidateBytes),
    moduleDigests: Object.freeze({ ...moduleDigests }),
    sourceMapDigests: Object.freeze({ ...sourceMapDigests }),
    dependencyGraphDigest: graphArtifact.digest,
  }
  return {
    workspacePath,
    request,
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    candidateDigest: digest(candidateBytes),
    artifacts,
    manifest: manifestBody,
    manifestArtifact,
    moduleDigests: Object.freeze(moduleDigests),
    sourceMapDigests: Object.freeze(sourceMapDigests),
    dependencyGraphDigest: graphArtifact.digest,
    committedPath,
    stagingRoot,
    finalRoot,
    journalPath,
    prepared,
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function atomicWrite(path: string, bytes: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true })
  if (await exists(path)) {
    const current = await readFile(path, 'utf8')
    if (current !== bytes) fail(`conflicting bytes at ${path}`)
    return
  }
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, bytes, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

function validateJournal(value: unknown, plan: Plan): Journal {
  assertObject(value, 'journal')
  assertExactKeys(
    value,
    [
      'schema',
      'status',
      'publicationId',
      'foundationRevision',
      'foundationReceiptDigest',
      'candidateDigest',
      'stagingPath',
      'finalPath',
      'entries',
    ],
    'journal',
  )
  if (
    value.schema !== JOURNAL_SCHEMA ||
    value.status !== 'PREPARED' ||
    value.publicationId !== plan.publicationId ||
    value.foundationRevision !== plan.foundationRevision ||
    value.foundationReceiptDigest !== plan.request.foundation.receiptDigest ||
    value.candidateDigest !== plan.candidateDigest
  )
    fail('journal authority is stale or conflicting')
  if (
    value.stagingPath !==
      `.beegame/ir/game-ir.v1/.staging/${plan.publicationId}` ||
    value.finalPath !==
      `.beegame/ir/game-ir.v1/revisions/${plan.foundationRevision}` ||
    !Array.isArray(value.entries)
  )
    fail('journal paths are invalid')
  const entries = value.entries.map((entry, index) => {
    assertObject(entry, `journal entry ${index}`)
    assertExactKeys(entry, ['path', 'digest'], `journal entry ${index}`)
    if (
      typeof entry.path !== 'string' ||
      !/^(?:modules|source-maps)\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$|^manifest\.json$|^dependency-graph\.json$/.test(
        entry.path,
      )
    )
      fail('journal contains an unsafe artifact path')
    assertDigest(entry.digest, `journal entry ${index} digest`)
    return { path: entry.path, digest: entry.digest }
  })
  if (new Set(entries.map(entry => entry.path)).size !== entries.length)
    fail('journal contains duplicate artifact paths')
  const expected = plan.artifacts
    .map(artifact => `${artifact.path}:${artifact.digest}`)
    .sort()
  const actual = entries.map(entry => `${entry.path}:${entry.digest}`).sort()
  if (canonical(actual) !== canonical(expected))
    fail('journal artifact authority does not match PREPARED')
  return {
    schema: value.schema as typeof JOURNAL_SCHEMA,
    status: value.status as 'PREPARED',
    publicationId: value.publicationId as string,
    foundationRevision: value.foundationRevision as string,
    foundationReceiptDigest: value.foundationReceiptDigest as string,
    candidateDigest: value.candidateDigest as string,
    stagingPath: value.stagingPath as string,
    finalPath: value.finalPath as string,
    entries,
  }
}

async function readJournal(plan: Plan): Promise<Journal> {
  try {
    return validateJournal(
      JSON.parse(await readFile(plan.journalPath, 'utf8')),
      plan,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      fail('PREPARED journal is missing')
    throw error
  }
}

async function assertDirectoryOnly(
  path: string,
  allowed: readonly string[],
  label: string,
): Promise<void> {
  if (!(await exists(path))) return
  const entries = await readdir(path)
  const expected = [...allowed].sort()
  if (canonical(entries.sort()) !== canonical(expected))
    fail(
      `${label} contains an unexpected entry (${entries.join(',')} != ${expected.join(',')})`,
    )
}

async function assertDirectorySubset(
  path: string,
  allowed: readonly string[],
  label: string,
): Promise<void> {
  if (!(await exists(path))) return
  const entries = await readdir(path)
  const permitted = new Set(allowed)
  if (entries.some(entry => !permitted.has(entry)))
    fail(`${label} contains an unexpected entry`)
}

async function removeIfEmpty(path: string): Promise<void> {
  try {
    if ((await readdir(path)).length === 0) await rmdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function writeStaging(plan: Plan): Promise<void> {
  await mkdir(join(plan.workspacePath, ROOT, '.journal'), { recursive: true })
  await mkdir(join(plan.workspacePath, ROOT, '.staging'), { recursive: true })
  const stagingExisted = await exists(plan.stagingRoot)
  await mkdir(plan.stagingRoot, { recursive: true })
  const moduleIds = plan.artifacts
    .filter(artifact => artifact.path.startsWith('modules/'))
    .map(artifact => artifact.path.slice('modules/'.length, -'.json'.length))
  const sourceMapIds = plan.artifacts
    .filter(artifact => artifact.path.startsWith('source-maps/'))
    .map(artifact =>
      artifact.path.slice('source-maps/'.length, -'.json'.length),
    )
  await assertDirectoryOnly(
    plan.stagingRoot,
    stagingExisted
      ? ['manifest.json', 'dependency-graph.json', 'modules', 'source-maps']
      : [],
    'staging',
  )
  await mkdir(join(plan.stagingRoot, 'modules'), { recursive: true })
  await mkdir(join(plan.stagingRoot, 'source-maps'), { recursive: true })
  await assertDirectoryOnly(
    join(plan.stagingRoot, 'modules'),
    stagingExisted ? moduleIds.map(id => `${id}.json`) : [],
    'staging modules',
  )
  await assertDirectoryOnly(
    join(plan.stagingRoot, 'source-maps'),
    stagingExisted ? sourceMapIds.map(id => `${id}.json`) : [],
    'staging source maps',
  )
  for (const artifact of plan.artifacts)
    await atomicWrite(join(plan.stagingRoot, artifact.path), artifact.bytes)
  await assertDirectoryOnly(
    plan.stagingRoot,
    ['manifest.json', 'dependency-graph.json', 'modules', 'source-maps'],
    'staging',
  )
  await assertDirectoryOnly(
    join(plan.stagingRoot, 'modules'),
    moduleIds.map(id => `${id}.json`),
    'staging modules',
  )
  await assertDirectoryOnly(
    join(plan.stagingRoot, 'source-maps'),
    sourceMapIds.map(id => `${id}.json`),
    'staging source maps',
  )
  const journal: Journal = {
    schema: JOURNAL_SCHEMA,
    status: 'PREPARED',
    publicationId: plan.publicationId,
    foundationRevision: plan.foundationRevision,
    foundationReceiptDigest: plan.request.foundation.receiptDigest,
    candidateDigest: plan.candidateDigest,
    stagingPath: `.beegame/ir/game-ir.v1/.staging/${plan.publicationId}`,
    finalPath: `.beegame/ir/game-ir.v1/revisions/${plan.foundationRevision}`,
    entries: plan.artifacts.map(artifact => ({
      path: artifact.path,
      digest: artifact.digest,
    })),
  }
  await atomicWrite(plan.journalPath, `${canonical(journal)}\n`)
}

async function assertStaging(plan: Plan, journal: Journal): Promise<void> {
  for (const entry of journal.entries) {
    const path = join(plan.stagingRoot, entry.path)
    const bytes = await readFile(path, 'utf8')
    if (digest(bytes) !== entry.digest)
      fail(`staging bytes are corrupt for ${entry.path}`)
  }
}

function assertArtifactPath(path: unknown): asserts path is string {
  if (
    typeof path !== 'string' ||
    !/^(?:modules|source-maps)\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$|^manifest\.json$|^dependency-graph\.json$/.test(
      path,
    )
  )
    fail('artifact path is unsafe')
}

function commitMarker(plan: Plan): Record<string, unknown> {
  return {
    schema: COMMIT_SCHEMA,
    status: 'committed',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: plan.request.taskId,
    publicationId: plan.publicationId,
    foundationRevision: plan.foundationRevision,
    foundationReceiptDigest: plan.request.foundation.receiptDigest,
    candidateDigest: plan.candidateDigest,
    manifestDigest: plan.manifestArtifact.digest,
    moduleDigests: plan.moduleDigests,
    sourceMapDigests: plan.sourceMapDigests,
    dependencyGraphDigest: plan.dependencyGraphDigest,
  }
}

async function rollForward(
  plan: Plan,
  journal: Journal,
): Promise<GameIrReadyReceipt> {
  await assertStaging(plan, journal)
  await mkdir(plan.finalRoot, { recursive: true })
  await mkdir(join(plan.finalRoot, 'modules'), { recursive: true })
  await mkdir(join(plan.finalRoot, 'source-maps'), { recursive: true })
  await assertDirectorySubset(
    plan.finalRoot,
    [
      'manifest.json',
      'dependency-graph.json',
      'modules',
      'source-maps',
      'COMMITTED.json',
    ],
    'final revision',
  )
  const moduleIds = plan.artifacts
    .filter(artifact => artifact.path.startsWith('modules/'))
    .map(artifact => artifact.path.slice('modules/'.length))
  const sourceMapIds = plan.artifacts
    .filter(artifact => artifact.path.startsWith('source-maps/'))
    .map(artifact => artifact.path.slice('source-maps/'.length))
  await assertDirectorySubset(
    join(plan.finalRoot, 'modules'),
    moduleIds,
    'final modules',
  )
  await assertDirectorySubset(
    join(plan.finalRoot, 'source-maps'),
    sourceMapIds,
    'final source maps',
  )
  for (const artifact of plan.artifacts)
    await atomicWrite(join(plan.finalRoot, artifact.path), artifact.bytes)
  await assertDirectoryOnly(
    plan.finalRoot,
    ['manifest.json', 'dependency-graph.json', 'modules', 'source-maps'],
    'final revision',
  )
  const markerBytes = `${canonical(commitMarker(plan))}\n`
  await atomicWrite(plan.committedPath, markerBytes)
  const receipt = await validateCommittedGameIr({
    workspacePath: plan.workspacePath,
    request: plan.request,
  })
  await rm(plan.stagingRoot, { recursive: true, force: true })
  await rm(plan.journalPath, { force: true })
  await removeIfEmpty(join(plan.workspacePath, ROOT, '.staging'))
  await removeIfEmpty(join(plan.workspacePath, ROOT, '.journal'))
  return receipt
}

export async function prepareGameIrPublication(
  input: GameIrPublicationInput,
): Promise<GameIrPublicationPrepared> {
  const plan = buildPlan(input)
  await writeStaging(plan)
  return plan.prepared
}

export async function commitGameIrPublication(
  input: GameIrPublicationInput | GameIrPublicationPrepared,
): Promise<GameIrReadyReceipt> {
  if ('kind' in input && input.kind === 'prepared') {
    const workspacePath = resolve(input.workspacePath)
    const committedPath = join(
      finalPath(workspacePath, input.foundationRevision),
      'COMMITTED.json',
    )
    const journalPath = join(
      workspacePath,
      ROOT,
      '.journal',
      `${input.publicationId}.json`,
    )
    if (!(await exists(journalPath)) && (await exists(committedPath)))
      return validateCommittedGameIr({ workspacePath, request: input.request })
    const plan = await planFromJournal(workspacePath, input.request)
    return rollForward(plan, await readJournal(plan))
  }
  const plan = buildPlan(input as GameIrPublicationInput)
  await writeStaging(plan)
  const journal = await readJournal(plan)
  return rollForward(plan, journal)
}

export async function recoverGameIrPublication(
  input: GameIrPublicationRecoveryInput,
): Promise<GameIrReadyReceipt> {
  const request = parseGameIrCompileRequest(inputRequest(input))
  assertSafeSegment(request.publicationId, 'publicationId')
  assertSafeSegment(request.foundation.foundationRevision, 'foundationRevision')
  const workspacePath = resolve(input.workspacePath)
  const committedPath = join(
    finalPath(workspacePath, request.foundation.foundationRevision),
    'COMMITTED.json',
  )
  const journalPath = join(
    workspacePath,
    ROOT,
    '.journal',
    `${request.publicationId}.json`,
  )
  if (!(await exists(journalPath)) && (await exists(committedPath))) {
    const receipt = await validateCommittedGameIr({
      workspacePath,
      request,
      candidate: input.candidate,
    })
    await rm(stagePath(workspacePath, request.publicationId), {
      recursive: true,
      force: true,
    })
    await removeIfEmpty(join(workspacePath, ROOT, '.staging'))
    return receipt
  }
  const hasReceipts =
    input.semanticPassReceipts !== undefined ||
    input.semanticReceipts !== undefined
  const plan =
    input.candidate && hasReceipts
      ? buildPlan({ ...input, request } as GameIrPublicationInput)
      : await planFromJournal(workspacePath, request)
  if (
    input.candidate &&
    digestGameIrValue(input.candidate) !== plan.candidateDigest
  )
    fail('candidate is stale for PREPARED authority')
  const journal = await readJournal(plan)
  return rollForward(plan, journal)
}

async function planFromJournal(
  workspacePath: string,
  request: GameIrCompileRequest,
): Promise<Plan> {
  const journalPath = join(
    workspacePath,
    ROOT,
    '.journal',
    `${request.publicationId}.json`,
  )
  const raw = JSON.parse(await readFile(journalPath, 'utf8')) as Record<
    string,
    unknown
  >
  const rawBytes = await readFile(journalPath, 'utf8')
  assertObject(raw, 'journal')
  if (`${canonical(raw)}\n` !== rawBytes)
    fail('journal bytes are not canonical')
  if (
    raw.schema !== JOURNAL_SCHEMA ||
    raw.publicationId !== request.publicationId ||
    raw.foundationRevision !== request.foundation.foundationRevision ||
    raw.foundationReceiptDigest !== request.foundation.receiptDigest
  )
    fail('journal is stale for compile request')
  const entries = Array.isArray(raw.entries) ? raw.entries : []
  const artifacts: Artifact[] = []
  for (const entry of entries) {
    assertObject(entry, 'journal entry')
    assertArtifactPath(entry.path)
    assertDigest(entry.digest, 'journal entry digest')
    const stagingRoot = stagePath(workspacePath, request.publicationId)
    const bytes = await readFile(join(stagingRoot, entry.path), 'utf8')
    if (digest(bytes) !== entry.digest) fail('staging bytes are corrupt')
    artifacts.push({ path: entry.path, bytes, digest: entry.digest })
  }
  const manifestArtifact = artifacts.find(
    artifact => artifact.path === 'manifest.json',
  )
  const graphArtifact = artifacts.find(
    artifact => artifact.path === 'dependency-graph.json',
  )
  if (!manifestArtifact || !graphArtifact)
    fail('journal lacks required artifacts')
  const manifest = JSON.parse(manifestArtifact.bytes) as Record<string, unknown>
  assertObject(manifest, 'manifest')
  const moduleDigests = assertRecordDigests(
    Object.fromEntries(
      (Array.isArray(manifest.modules) ? manifest.modules : []).map(
        (value: unknown) => {
          assertObject(value, 'manifest module')
          return [value.moduleId as string, value.digest]
        },
      ),
    ),
    'module digests',
  )
  const sourceMapDigests = assertRecordDigests(
    Object.fromEntries(
      (Array.isArray(manifest.modules) ? manifest.modules : []).map(
        (value: unknown) => {
          assertObject(value, 'manifest module')
          return [value.moduleId as string, value.sourceMapDigest]
        },
      ),
    ),
    'source map digests',
  )
  return {
    workspacePath,
    request,
    publicationId: request.publicationId,
    foundationRevision: request.foundation.foundationRevision,
    candidateDigest:
      typeof manifest.candidateDigest === 'string'
        ? manifest.candidateDigest
        : fail('manifest candidateDigest is missing'),
    artifacts,
    manifest,
    manifestArtifact,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: graphArtifact.digest,
    committedPath: join(
      finalPath(workspacePath, request.foundation.foundationRevision),
      'COMMITTED.json',
    ),
    stagingRoot: stagePath(workspacePath, request.publicationId),
    finalRoot: finalPath(workspacePath, request.foundation.foundationRevision),
    journalPath,
    prepared: {
      kind: 'prepared',
      workspacePath,
      request,
      publicationId: request.publicationId,
      foundationRevision: request.foundation.foundationRevision,
      preparedPath: `.beegame/ir/game-ir.v1/.staging/${request.publicationId}`,
      journalPath: `.beegame/ir/game-ir.v1/.journal/${request.publicationId}.json`,
      committedPath: `.beegame/ir/game-ir.v1/revisions/${request.foundation.foundationRevision}/COMMITTED.json`,
      manifestDigest: manifestArtifact.digest,
      candidateDigest:
        typeof manifest.candidateDigest === 'string'
          ? manifest.candidateDigest
          : '',
      moduleDigests,
      sourceMapDigests,
      dependencyGraphDigest: graphArtifact.digest,
    },
  }
}

export async function validateCommittedGameIr(
  input: Readonly<{
    workspacePath: string
    request?: GameIrCompileRequest
    compileRequest?: GameIrCompileRequest
    candidate?: GameIrCandidate
  }>,
): Promise<GameIrReadyReceipt> {
  const request = parseGameIrCompileRequest(inputRequest(input))
  assertSafeSegment(request.foundation.foundationRevision, 'foundationRevision')
  assertSafeSegment(request.publicationId, 'publicationId')
  const workspacePath = resolve(input.workspacePath)
  const finalRoot = finalPath(
    workspacePath,
    request.foundation.foundationRevision,
  )
  const committedPath = join(finalRoot, 'COMMITTED.json')
  const marker = JSON.parse(await readFile(committedPath, 'utf8')) as unknown
  const markerBytes = await readFile(committedPath, 'utf8')
  assertObject(marker, 'COMMITTED marker')
  if (`${canonical(marker)}\n` !== markerBytes)
    fail('COMMITTED marker bytes are not canonical')
  assertExactKeys(
    marker,
    [
      'schema',
      'status',
      'gameIrSchemaVersion',
      'taskId',
      'publicationId',
      'foundationRevision',
      'foundationReceiptDigest',
      'candidateDigest',
      'manifestDigest',
      'moduleDigests',
      'sourceMapDigests',
      'dependencyGraphDigest',
    ],
    'COMMITTED marker',
  )
  if (
    marker.schema !== COMMIT_SCHEMA ||
    marker.status !== 'committed' ||
    marker.gameIrSchemaVersion !== GAME_IR_SCHEMA_VERSION ||
    marker.taskId !== request.taskId ||
    marker.publicationId !== request.publicationId ||
    marker.foundationRevision !== request.foundation.foundationRevision ||
    marker.foundationReceiptDigest !== request.foundation.receiptDigest
  )
    fail('COMMITTED marker authority is stale')
  assertDigest(marker.candidateDigest, 'COMMITTED candidateDigest')
  const moduleDigests = assertRecordDigests(
    marker.moduleDigests,
    'COMMITTED moduleDigests',
  )
  const sourceMapDigests = assertRecordDigests(
    marker.sourceMapDigests,
    'COMMITTED sourceMapDigests',
  )
  assertDigest(marker.manifestDigest, 'COMMITTED manifestDigest')
  assertDigest(marker.dependencyGraphDigest, 'COMMITTED dependencyGraphDigest')
  const manifestBytes = await readFile(join(finalRoot, 'manifest.json'), 'utf8')
  if (digest(manifestBytes) !== marker.manifestDigest)
    fail('manifest digest is stale')
  const manifest = JSON.parse(manifestBytes) as Record<string, unknown>
  assertObject(manifest, 'manifest')
  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'gameIrSchemaVersion',
      'taskId',
      'publicationId',
      'foundationRevision',
      'foundationReceiptDigest',
      'candidateDigest',
      'modules',
      'dependencyGraphPath',
      'dependencyGraphDigest',
    ],
    'manifest',
  )
  if (
    manifest.schemaVersion !== MANIFEST_SCHEMA ||
    manifest.taskId !== request.taskId ||
    manifest.publicationId !== request.publicationId ||
    manifest.foundationRevision !== request.foundation.foundationRevision ||
    manifest.foundationReceiptDigest !== request.foundation.receiptDigest ||
    manifest.candidateDigest !== marker.candidateDigest
  )
    fail('manifest authority is stale')
  if (
    manifest.dependencyGraphPath !== 'dependency-graph.json' ||
    manifest.dependencyGraphDigest !== marker.dependencyGraphDigest
  )
    fail('manifest dependency graph authority is stale')
  const graphBytes = await readFile(
    join(finalRoot, 'dependency-graph.json'),
    'utf8',
  )
  if (digest(graphBytes) !== marker.dependencyGraphDigest)
    fail('dependency graph digest is stale')
  const graph = JSON.parse(graphBytes) as unknown
  assertObject(graph, 'dependency graph')
  assertExactKeys(
    graph,
    ['schemaVersion', 'foundationRevision', 'edges'],
    'dependency graph',
  )
  if (
    graph.schemaVersion !== GRAPH_SCHEMA ||
    graph.foundationRevision !== request.foundation.foundationRevision ||
    !Array.isArray(graph.edges)
  )
    fail('dependency graph authority is invalid')
  if (!Array.isArray(manifest.modules)) fail('manifest modules are missing')
  const seen = new Set<string>()
  for (const entry of manifest.modules) {
    assertObject(entry, 'manifest module')
    assertExactKeys(
      entry,
      ['moduleId', 'path', 'digest', 'sourceMapPath', 'sourceMapDigest'],
      'manifest module',
    )
    if (
      typeof entry.moduleId !== 'string' ||
      !SAFE_SEGMENT.test(entry.moduleId) ||
      seen.has(entry.moduleId) ||
      entry.digest !== moduleDigests[entry.moduleId] ||
      entry.sourceMapDigest !== sourceMapDigests[entry.moduleId]
    )
      fail('manifest module authority is invalid')
    seen.add(entry.moduleId)
    if (
      entry.path !== `modules/${entry.moduleId}.json` ||
      entry.sourceMapPath !== `source-maps/${entry.moduleId}.json`
    )
      fail('manifest module paths are invalid')
    assertDigest(entry.digest, 'module digest')
    assertDigest(entry.sourceMapDigest, 'source map digest')
    if (
      digest(await readFile(join(finalRoot, entry.path), 'utf8')) !==
      entry.digest
    )
      fail(`module bytes are stale for ${entry.moduleId}`)
    if (
      digest(await readFile(join(finalRoot, entry.sourceMapPath), 'utf8')) !==
      entry.sourceMapDigest
    )
      fail(`source map bytes are stale for ${entry.moduleId}`)
    const module = JSON.parse(
      await readFile(join(finalRoot, entry.path), 'utf8'),
    ) as unknown
    assertObject(module, `module ${entry.moduleId}`)
    assertExactKeys(
      module,
      [
        'schemaVersion',
        'foundationRevision',
        'moduleId',
        'candidateDigest',
        'nodes',
      ],
      `module ${entry.moduleId}`,
    )
    if (
      module.schemaVersion !== MODULE_SCHEMA ||
      module.foundationRevision !== request.foundation.foundationRevision ||
      module.moduleId !== entry.moduleId ||
      !Array.isArray(module.nodes)
    )
      fail(`module ${entry.moduleId} authority is invalid`)
    const sourceMap = JSON.parse(
      await readFile(join(finalRoot, entry.sourceMapPath), 'utf8'),
    ) as unknown
    assertObject(sourceMap, `source map ${entry.moduleId}`)
    assertExactKeys(
      sourceMap,
      ['schemaVersion', 'foundationRevision', 'moduleId', 'bindings'],
      `source map ${entry.moduleId}`,
    )
    if (
      sourceMap.schemaVersion !== SOURCE_MAP_SCHEMA ||
      sourceMap.foundationRevision !== request.foundation.foundationRevision ||
      sourceMap.moduleId !== entry.moduleId ||
      !Array.isArray(sourceMap.bindings)
    )
      fail(`source map ${entry.moduleId} authority is invalid`)
  }
  const moduleIds = [...seen]
  if (
    moduleIds.some(
      (moduleId, index) => index > 0 && moduleIds[index - 1]! >= moduleId,
    )
  )
    fail('manifest modules are not in canonical order')
  if (
    seen.size !== Object.keys(moduleDigests).length ||
    Object.keys(moduleDigests).some(moduleId => !seen.has(moduleId)) ||
    seen.size !== Object.keys(sourceMapDigests).length ||
    Object.keys(sourceMapDigests).some(moduleId => !seen.has(moduleId))
  )
    fail('COMMITTED module coverage is inconsistent')
  await assertDirectoryOnly(
    join(finalRoot, 'modules'),
    moduleIds.map(moduleId => `${moduleId}.json`),
    'final modules',
  )
  await assertDirectoryOnly(
    join(finalRoot, 'source-maps'),
    [...seen].map(moduleId => `${moduleId}.json`),
    'final source maps',
  )
  if (
    input.candidate &&
    digestGameIrValue(input.candidate) !== marker.candidateDigest
  )
    fail('COMMITTED candidate does not match authority')
  const receipt = {
    schemaVersion: 'game-ir-ready-receipt.v1' as const,
    taskId: request.taskId,
    publicationId: request.publicationId,
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundationRevision: request.foundation.foundationRevision,
    foundationReceiptDigest: request.foundation.receiptDigest,
    manifestDigest: marker.manifestDigest,
    moduleDigests,
    sourceMapDigests,
    dependencyGraphDigest: marker.dependencyGraphDigest,
    committedPath: `.beegame/ir/game-ir.v1/revisions/${request.foundation.foundationRevision}/COMMITTED.json`,
  }
  return parseGameIrReadyReceipt(receipt)
}

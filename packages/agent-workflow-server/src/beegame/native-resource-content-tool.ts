import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { z } from 'zod/v4'
import {
  readBeeGameAssetManifest,
  readBeeGameAssetManifestSync,
} from './asset-contracts'
import {
  computeResourceInventoryRevision,
  computeResourceRevision,
} from './delivery-workflow/revision'
import {
  BEEGAME_CONTENT_SCHEMA,
  BEEGAME_JSON_CONTENT_KINDS,
  BEEGAME_YAML_CONTENT_KINDS,
  type BeeGameContentDocument,
  validateBeeGameContentDocuments,
} from './content-contracts'
import { auditAssetContract } from './asset-contract-audit'
import { resourceContentAuthorTerminalSchema } from './delivery-workflow/worker-contracts'

export const resourceContentCommitContractSchema = z
  .object({
    dispatchId: z.string().trim().min(1),
    inventoryRevision: z.string().trim().min(1),
    baselineResourceRevision: z.string().trim().min(1),
    requiredRequirementIds: z.array(z.string().trim().min(1)),
    verifiedResourceIds: z.array(z.string().trim().min(1)),
    inventoryBindings: z.array(
      z
        .object({
          requirementId: z.string().trim().min(1),
          resourceIds: z.array(z.string().trim().min(1)).min(1),
        })
        .strict(),
    ),
    protectedPaths: z.array(z.string().trim().min(1)),
  })
  .strict()

export type ResourceContentCommitContract = z.infer<
  typeof resourceContentCommitContractSchema
>

const documentSchema = z
  .object({
    path: z.string().trim().min(1),
    schema: z.literal(BEEGAME_CONTENT_SCHEMA),
    id: z.string().trim().min(1),
    kind: z.enum([
      ...BEEGAME_JSON_CONTENT_KINDS,
      ...BEEGAME_YAML_CONTENT_KINDS,
    ]),
    fulfills: z.array(z.string().trim().min(1)),
    resources: z.array(z.string().trim().min(1)),
    data: z.record(z.string(), z.unknown()),
  })
  .strict()

const inputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('commit'),
      documents: z.array(documentSchema).min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('needs_inventory'),
      missingRequirementIds: z.array(z.string().trim().min(1)).min(1),
    })
    .strict(),
])

type ResourceContentInput = z.infer<typeof inputSchema>

type ResourceContentToolDefinition = Record<string, unknown> & {
  name: 'CommitResourceContent'
  mapToolResultToToolResultBlockParam(
    output: unknown,
    toolUseID: string,
  ): {
    tool_use_id: string
    type: 'tool_result'
    content: string
  }
}

type BuildTool = (definition: ResourceContentToolDefinition) => unknown

export function createNativeResourceContentTool(options: {
  buildTool: BuildTool
  workspacePath: string
  contract: ResourceContentCommitContract
  assertMutationAuthority: () => void | Promise<void>
}): unknown {
  return options.buildTool({
    name: 'CommitResourceContent',
    alwaysLoad: true,
    inputSchema,
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    async description() {
      return 'Validate and commit the complete canonical JSON/YAML content set, or report the exact requirements missing verified inventory.'
    },
    async prompt() {
      return 'This is the only Resource Content mutation and terminal. Submit the complete canonical set once. Invalid content writes nothing. Use needs_inventory only for the exact required requirement IDs without verified inventory bindings.'
    },
    async checkPermissions(input: ResourceContentInput) {
      return { behavior: 'allow', updatedInput: input }
    },
    async call(input: unknown) {
      const parsed = inputSchema.safeParse(input)
      if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
      if (parsed.data.action === 'needs_inventory')
        return submitMissingInventory({
          workspacePath: options.workspacePath,
          contract: options.contract,
          input: parsed.data,
          assertMutationAuthority: options.assertMutationAuthority,
        })
      await options.assertMutationAuthority()
      return commitResourceContent({
        workspacePath: options.workspacePath,
        contract: options.contract,
        documents: parsed.data.documents,
        assertMutationAuthority: options.assertMutationAuthority,
      })
    },
    renderToolUseMessage() {
      return '提交规范资源内容'
    },
    mapToolResultToToolResultBlockParam(output: unknown, toolUseID: string) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: JSON.stringify(output),
      }
    },
  })
}

async function submitMissingInventory(input: {
  workspacePath: string
  contract: ResourceContentCommitContract
  input: Extract<ResourceContentInput, { action: 'needs_inventory' }>
  assertMutationAuthority: () => void | Promise<void>
}) {
  const { contract } = input
  const verified = new Set(contract.verifiedResourceIds)
  const covered = new Set(
    contract.inventoryBindings.flatMap(binding =>
      binding.resourceIds.some(id => verified.has(id))
        ? [binding.requirementId]
        : [],
    ),
  )
  const expected = contract.requiredRequirementIds.filter(
    id => !covered.has(id),
  )
  if (!sameOrderedSet(input.input.missingRequirementIds, expected))
    throw new Error(
      `needs_inventory must contain the exact missing requirement IDs: ${expected.join(', ') || '<none>'}.`,
    )
  await input.assertMutationAuthority()
  await writeReceipt(
    resourceContentReceiptPath(input.workspacePath, contract.dispatchId),
    {
      schema: 'beegame-resource-content-commit-v1',
      dispatchId: contract.dispatchId,
      status: 'committed',
      action: 'needs_inventory',
      missingRequirementIds: expected,
    },
  )
  return {
    data: {
      accepted: true,
      status: 'needs_inventory',
      contentIds: [],
      writtenPaths: [],
      missingRequirementIds: expected,
    },
  }
}

async function commitResourceContent(input: {
  workspacePath: string
  contract: ResourceContentCommitContract
  documents: z.infer<typeof documentSchema>[]
  assertMutationAuthority: () => void | Promise<void>
}) {
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  assertFrozenContract(input.contract, manifest)
  const contentRoot = resolve(
    input.workspacePath,
    manifest.project_target?.content_root ?? 'assets/content',
  )
  const submitted = input.documents.map(document => ({
    path: normalizeContentPath(input.workspacePath, contentRoot, document.path),
    value: {
      schema: document.schema,
      id: document.id,
      kind: document.kind,
      fulfills: document.fulfills,
      resources: document.resources,
      data: document.data,
    },
  }))
  const submittedPaths = new Set(submitted.map(document => document.path))
  const protectedDocuments = input.contract.protectedPaths.map(path => {
    const normalized = normalizeContentPath(
      input.workspacePath,
      contentRoot,
      path,
    )
    if (submittedPaths.has(normalized))
      throw new Error(
        `Protected content path cannot be replaced: ${normalized}.`,
      )
    return {
      document: readContentDocument(input.workspacePath, normalized),
      content: readFileSync(resolve(input.workspacePath, normalized)),
    }
  })
  const completeSet = [
    ...protectedDocuments.map(item => item.document),
    ...submitted,
  ]
  const audit = validateBeeGameContentDocuments(completeSet, manifest)
  if (!audit.valid)
    throw new Error(
      `Invalid canonical resource content: ${audit.issues.join('; ')}`,
    )

  assertInventoryBindings(input.contract, completeSet)
  await input.assertMutationAuthority()
  await replaceContentRoot({
    workspacePath: input.workspacePath,
    contentRoot,
    submittedDocuments: submitted,
    protectedDocuments,
    contract: input.contract,
    assertMutationAuthority: input.assertMutationAuthority,
  })
  return {
    data: {
      accepted: true,
      status: 'completed',
      contentIds: audit.files.map(file => file.id),
      writtenPaths: submitted.map(document => document.path),
      missingRequirementIds: [],
    },
  }
}

function assertFrozenContract(
  contract: ResourceContentCommitContract,
  manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
): void {
  const required = manifest.requirements
    .filter(requirement => requirement.required !== false)
    .map(requirement => requirement.id)
  const verified = manifest.resources
    .filter(resource => resource.status === 'verified')
    .map(resource => resource.id)
  if (!sameOrderedSet(contract.requiredRequirementIds, required))
    throw new Error(
      'Resource Content contract no longer matches current requirements.',
    )
  if (!sameOrderedSet(contract.verifiedResourceIds, verified))
    throw new Error(
      'Resource Content contract no longer matches verified resources.',
    )
}

function normalizeContentPath(
  workspacePath: string,
  contentRoot: string,
  path: string,
): string {
  const absolute = resolve(workspacePath, path)
  const withinRoot = relative(contentRoot, absolute)
  if (!withinRoot || withinRoot.startsWith(`..${sep}`) || withinRoot === '..')
    throw new Error(
      `Content path must be inside the canonical content root: ${path}.`,
    )
  return relative(resolve(workspacePath), absolute).split(sep).join('/')
}

function readContentDocument(
  workspacePath: string,
  path: string,
): BeeGameContentDocument {
  const absolute = resolve(workspacePath, path)
  const text = readFileSync(absolute, 'utf8')
  if (extname(absolute).toLowerCase() === '.json')
    return { path, value: JSON.parse(text) }
  const document = parseDocument(text, { uniqueKeys: true })
  if (document.errors.length)
    throw new Error(
      `${path}: ${document.errors.map(error => error.message).join(' ')}`,
    )
  return { path, value: document.toJS({ maxAliasCount: 0 }) }
}

async function replaceContentRoot(input: {
  workspacePath: string
  contentRoot: string
  submittedDocuments: BeeGameContentDocument[]
  protectedDocuments: Array<{
    document: BeeGameContentDocument
    content: Uint8Array
  }>
  contract: ResourceContentCommitContract
  assertMutationAuthority: () => void | Promise<void>
}): Promise<void> {
  const nonce = randomUUID()
  const stagingRoot = `${input.contentRoot}.staging-${nonce}`
  const backupRoot = `${input.contentRoot}.backup-${nonce}`
  const receiptPath = resolve(
    input.workspacePath,
    '.beegame/workflow/resource-content-commits',
    `${input.contract.dispatchId}.json`,
  )
  await mkdir(stagingRoot, { recursive: true })
  try {
    for (const item of input.protectedDocuments) {
      const relativePath = relative(
        input.contentRoot,
        resolve(input.workspacePath, item.document.path),
      )
      const target = resolve(stagingRoot, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, item.content)
    }
    for (const document of input.submittedDocuments) {
      const relativePath = relative(
        input.contentRoot,
        resolve(input.workspacePath, document.path),
      )
      const target = resolve(stagingRoot, relativePath)
      await mkdir(dirname(target), { recursive: true })
      const serialized =
        extname(target).toLowerCase() === '.json'
          ? `${JSON.stringify(document.value, null, 2)}\n`
          : stringify(document.value)
      await writeFile(target, serialized, 'utf8')
    }
    const finalRootDigest = digestDirectory(stagingRoot)
    const priorReceipt = readCommitReceipt(receiptPath)
    if (priorReceipt?.action === 'needs_inventory')
      throw new Error(
        'Resource Content dispatch already completed with needs_inventory.',
      )
    if (
      priorReceipt?.status === 'committed' &&
      priorReceipt.finalRootDigest === finalRootDigest &&
      existsSync(input.contentRoot) &&
      digestDirectory(input.contentRoot) === finalRootDigest
    )
      return
    if (priorReceipt?.status === 'prepared') {
      const recovered = await recoverPreparedResourceContentCommit({
        receiptPath,
        receipt: priorReceipt,
        contentRoot: input.contentRoot,
        assertMutationAuthority: input.assertMutationAuthority,
      })
      if (recovered) {
        if (recovered.finalRootDigest !== finalRootDigest)
          throw new Error(
            'Resource Content dispatch was already prepared with different content.',
          )
        return
      }
    }
    await assertResourceRevisions(input.workspacePath, input.contract)
    await input.assertMutationAuthority()
    const prepared = {
      schema: 'beegame-resource-content-commit-v1' as const,
      dispatchId: input.contract.dispatchId,
      status: 'prepared' as const,
      action: 'commit' as const,
      baselineResourceRevision: input.contract.baselineResourceRevision,
      finalRootDigest,
      stagingRoot,
      backupRoot,
      writtenPaths: input.submittedDocuments.map(document => document.path),
    }
    await writeReceipt(receiptPath, prepared)
    const hadExistingRoot = existsSync(input.contentRoot)
    if (hadExistingRoot) await rename(input.contentRoot, backupRoot)
    let published = false
    try {
      await rename(stagingRoot, input.contentRoot)
      published = true
      await input.assertMutationAuthority()
    } catch (error) {
      if (published && existsSync(input.contentRoot))
        await rename(input.contentRoot, stagingRoot)
      if (hadExistingRoot && !existsSync(input.contentRoot))
        await rename(backupRoot, input.contentRoot)
      await rm(receiptPath, { force: true })
      throw error
    }
    if (hadExistingRoot) await rm(backupRoot, { recursive: true, force: true })
    await writeReceipt(receiptPath, { ...prepared, status: 'committed' })
  } finally {
    await rm(stagingRoot, { recursive: true, force: true })
  }
}

export type ResourceContentCommitReceipt = {
  schema: 'beegame-resource-content-commit-v1'
  dispatchId: string
  status: 'prepared' | 'committed'
  action: 'commit'
  baselineResourceRevision: string
  finalRootDigest: string
  stagingRoot: string
  backupRoot: string
  writtenPaths: string[]
}

export type ResourceContentNeedsInventoryReceipt = {
  schema: 'beegame-resource-content-commit-v1'
  dispatchId: string
  status: 'committed'
  action: 'needs_inventory'
  missingRequirementIds: string[]
}

export type ResourceContentTerminalReceipt =
  | ResourceContentCommitReceipt
  | ResourceContentNeedsInventoryReceipt

function readCommitReceipt(
  path: string,
): ResourceContentTerminalReceipt | undefined {
  if (!existsSync(path)) return undefined
  const value = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as ResourceContentTerminalReceipt
  if (
    value.schema !== 'beegame-resource-content-commit-v1' ||
    !value.dispatchId ||
    (value.status !== 'prepared' && value.status !== 'committed')
  )
    throw new Error(`Invalid Resource Content commit receipt: ${path}.`)
  if (value.action === 'needs_inventory') {
    if (
      value.status !== 'committed' ||
      !Array.isArray(value.missingRequirementIds) ||
      value.missingRequirementIds.length === 0 ||
      value.missingRequirementIds.some(id => typeof id !== 'string' || !id)
    )
      throw new Error(`Invalid Resource Content terminal receipt: ${path}.`)
    return value
  }
  if (
    value.action !== 'commit' ||
    typeof value.baselineResourceRevision !== 'string' ||
    typeof value.finalRootDigest !== 'string' ||
    typeof value.stagingRoot !== 'string' ||
    typeof value.backupRoot !== 'string' ||
    !Array.isArray(value.writtenPaths)
  )
    throw new Error(`Invalid Resource Content commit receipt: ${path}.`)
  return value
}

/** Read one dispatch-bound receipt without changing its state or the workspace. */
export function readResourceContentCommitReceipt(
  workspacePath: string,
  dispatchId: string,
): ResourceContentTerminalReceipt | undefined {
  const receipt = readCommitReceipt(
    resourceContentReceiptPath(workspacePath, dispatchId),
  )
  if (receipt && receipt.dispatchId !== dispatchId)
    throw new Error('Resource Content commit receipt identity is invalid.')
  return receipt
}

/** Digest the currently published canonical content root without reconciling it. */
export function computeResourceContentRootDigest(
  workspacePath: string,
): string {
  const manifest = readBeeGameAssetManifestSync(workspacePath)
  const contentRoot = resolve(
    workspacePath,
    manifest.project_target?.content_root ?? 'assets/content',
  )
  return digestDirectory(contentRoot)
}

async function recoverPreparedResourceContentCommit(input: {
  receiptPath: string
  receipt: ResourceContentCommitReceipt
  contentRoot: string
  assertMutationAuthority: () => void | Promise<void>
}): Promise<ResourceContentCommitReceipt | undefined> {
  assertPreparedResourceContentPaths(input.receipt, input.contentRoot)
  await input.assertMutationAuthority()
  const rootMatches =
    existsSync(input.contentRoot) &&
    digestDirectory(input.contentRoot) === input.receipt.finalRootDigest
  if (rootMatches) {
    await input.assertMutationAuthority()
    await rm(input.receipt.stagingRoot, { recursive: true, force: true })
    await rm(input.receipt.backupRoot, { recursive: true, force: true })
    const committed = { ...input.receipt, status: 'committed' as const }
    await writeReceipt(input.receiptPath, committed)
    return committed
  }

  const stagingMatches =
    existsSync(input.receipt.stagingRoot) &&
    digestDirectory(input.receipt.stagingRoot) === input.receipt.finalRootDigest
  if (stagingMatches) {
    await input.assertMutationAuthority()
    const hadExistingRoot = existsSync(input.contentRoot)
    if (hadExistingRoot) {
      if (existsSync(input.receipt.backupRoot))
        throw new Error(
          'Resource Content prepared commit has conflicting canonical and backup roots.',
        )
      await rename(input.contentRoot, input.receipt.backupRoot)
    }
    await rename(input.receipt.stagingRoot, input.contentRoot)
    try {
      await input.assertMutationAuthority()
    } catch (error) {
      await rename(input.contentRoot, input.receipt.stagingRoot)
      if (existsSync(input.receipt.backupRoot))
        await rename(input.receipt.backupRoot, input.contentRoot)
      throw error
    }
    await rm(input.receipt.backupRoot, { recursive: true, force: true })
    const committed = { ...input.receipt, status: 'committed' as const }
    await writeReceipt(input.receiptPath, committed)
    return committed
  }

  await input.assertMutationAuthority()
  if (!existsSync(input.contentRoot) && existsSync(input.receipt.backupRoot))
    await rename(input.receipt.backupRoot, input.contentRoot)
  await rm(input.receipt.stagingRoot, { recursive: true, force: true })
  throw new Error(
    'Resource Content prepared commit rolled back because its staged publication is unavailable.',
  )
}

function assertPreparedResourceContentPaths(
  receipt: ResourceContentCommitReceipt,
  contentRoot: string,
): void {
  const stagingPrefix = `${contentRoot}.staging-`
  const backupPrefix = `${contentRoot}.backup-`
  const isRecordedSibling = (path: string, prefix: string) =>
    resolve(path) === path &&
    dirname(path) === dirname(contentRoot) &&
    path.startsWith(prefix) &&
    path.length > prefix.length
  if (
    !isRecordedSibling(receipt.stagingRoot, stagingPrefix) ||
    !isRecordedSibling(receipt.backupRoot, backupPrefix)
  )
    throw new Error(
      'Resource Content prepared commit transaction paths are invalid.',
    )
}

export async function reconcileResourceContentCommitReceipt(input: {
  workspacePath: string
  dispatchId: string
  assertMutationAuthority?: () => void | Promise<void>
}): Promise<ResourceContentTerminalReceipt | undefined> {
  const receiptPath = resourceContentReceiptPath(
    input.workspacePath,
    input.dispatchId,
  )
  const receipt = readResourceContentCommitReceipt(
    input.workspacePath,
    input.dispatchId,
  )
  if (!receipt) return undefined
  if (receipt.dispatchId !== input.dispatchId)
    throw new Error('Resource Content commit receipt dispatch is invalid.')
  if (receipt.action === 'needs_inventory') return receipt
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const contentRoot = resolve(
    input.workspacePath,
    manifest.project_target?.content_root ?? 'assets/content',
  )
  if (receipt.status === 'prepared') {
    if (!input.assertMutationAuthority)
      throw new Error(
        'Resource Content prepared commit recovery requires exact dispatch authority.',
      )
    return recoverPreparedResourceContentCommit({
      receiptPath,
      receipt,
      contentRoot,
      assertMutationAuthority: input.assertMutationAuthority,
    })
  }
  if (
    !existsSync(contentRoot) ||
    digestDirectory(contentRoot) !== receipt.finalRootDigest
  )
    return undefined
  return receipt
}

export function createResourceContentTerminalFromReceipt(input: {
  workspacePath: string
  revision: string
  receipt: ResourceContentTerminalReceipt
}) {
  if (input.receipt.action === 'needs_inventory')
    return resourceContentAuthorTerminalSchema.parse({
      revision: input.revision,
      workerType: 'resource-content-author' as const,
      status: 'needs_inventory' as const,
      contentIds: [],
      writtenPaths: [],
      missingRequirementIds: input.receipt.missingRequirementIds,
      taskMetrics: {
        catalogPayloadBytes: 0,
        catalogCallTypes: [],
        canonicalMutationCount: 0,
      },
    })
  const contract = auditAssetContract(input.workspacePath)
  if (!contract.content.valid)
    throw new Error(
      `resource content is invalid: ${contract.content.issues.join('; ')}`,
    )
  return resourceContentAuthorTerminalSchema.parse({
    revision: input.revision,
    workerType: 'resource-content-author' as const,
    status: 'completed' as const,
    contentIds: contract.content.files.map(file => file.id),
    writtenPaths: input.receipt.writtenPaths,
    missingRequirementIds: [],
    taskMetrics: {
      catalogPayloadBytes: 0,
      catalogCallTypes: [],
      canonicalMutationCount: 1,
    },
  })
}

function resourceContentReceiptPath(
  workspacePath: string,
  dispatchId: string,
): string {
  const allowed = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split(
      '',
    ),
  )
  if (!dispatchId || [...dispatchId].some(character => !allowed.has(character)))
    throw new Error('Resource Content dispatch identity is invalid.')
  return resolve(
    workspacePath,
    '.beegame/workflow/resource-content-commits',
    `${dispatchId}.json`,
  )
}

async function writeReceipt(
  path: string,
  receipt: ResourceContentTerminalReceipt,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function digestDirectory(root: string): string {
  const hash = createHash('sha256')
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const absolute = resolve(directory, entry.name)
      const path = relative(root, absolute).split(sep).join('/')
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) {
        hash
          .update(path)
          .update('\0')
          .update(readFileSync(absolute))
          .update('\0')
      }
    }
  }
  if (existsSync(root) && statSync(root).isDirectory()) visit(root)
  return hash.digest('hex')
}

async function assertResourceRevisions(
  workspacePath: string,
  contract: ResourceContentCommitContract,
): Promise<void> {
  if (
    (await computeResourceInventoryRevision(workspacePath)) !==
    contract.inventoryRevision
  )
    throw new Error('Resource inventory changed after Content dispatch.')
  if (
    (await computeResourceRevision(workspacePath, '')) !==
    contract.baselineResourceRevision
  )
    throw new Error('Resource content baseline changed after Content dispatch.')
}

function assertInventoryBindings(
  contract: ResourceContentCommitContract,
  documents: BeeGameContentDocument[],
): void {
  const registry = documents.find(document => {
    const value = document.value
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind === 'resource-registry'
    )
  })
  const value = registry?.value as Record<string, unknown> | undefined
  const data = value?.data as Record<string, unknown> | undefined
  const actual = Array.isArray(data?.bindings) ? data.bindings : []
  const normalized = (bindings: unknown[]) =>
    bindings
      .map(binding => {
        const record = binding as Record<string, unknown>
        return {
          requirementId: record.requirementId,
          resourceIds: Array.isArray(record.resourceIds)
            ? [...record.resourceIds].sort()
            : [],
        }
      })
      .sort((left, right) =>
        String(left.requirementId).localeCompare(String(right.requirementId)),
      )
  if (
    JSON.stringify(normalized(actual)) !==
    JSON.stringify(normalized(contract.inventoryBindings))
  )
    throw new Error(
      'resource-registry bindings must exactly match the frozen inventory receipt.',
    )
}

function sameOrderedSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...new Set(left)]
      .sort()
      .every((value, index) => value === [...new Set(right)].sort()[index])
  )
}

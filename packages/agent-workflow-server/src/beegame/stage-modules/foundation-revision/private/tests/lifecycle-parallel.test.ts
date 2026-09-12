import { afterEach, expect, test } from 'bun:test'
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
  mkdir,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  BeeGameUsageBillingClient,
  BeeGameUsageBillingRecordInput,
  BeeGameUsageBillingRecordResult,
} from '@bee-game-studio/beegame-billing-core/usage-control-client'
import { createUsageBillingClient } from '../../../../../billing/public'
import {
  createFoundationRevision,
  foundationRevisionInputDigest,
  type RevisionHandle,
  type RevisionResult,
  type RevisionStartInput,
} from '../../public'
import { buildSingleReviewFixture, reviewFixtureDocuments } from './single-review-fixture'
import type { RuntimeConfigurationClient } from '../../../../../runtime-configuration/public'
import { revisionDigest } from '../json-digest'
import { readRevisionRequestByHandle } from '../request-store'
import { openRevisionExecutionLease } from '../execution-lease'

const parallelDocuments = reviewFixtureDocuments()
  .slice(0, 5)
  .map(document => document.path)
const roots: string[] = []
const live: Array<{
  root: string
  stage: ReturnType<typeof createFoundationRevision>
  handle: RevisionHandle
}> = []

async function workspace() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'revision-lifecycle-parallel-')),
  )
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const { root, stage, handle } of live.splice(0)) {
    try {
      await stage.stop({
        handle,
        requestId: `test-cleanup-${crypto.randomUUID()}`,
        reason: 'shutdown',
      })
    } catch {
      /* an already closed handle needs no stop */
    }
    const deadline = Date.now() + 5000
    let closed = false
    while (Date.now() < deadline) {
      try {
        const registration = await readRevisionRequestByHandle(
          root,
          handle.id,
          'owner',
        )
        const leases = await openRevisionExecutionLease(
          root,
          registration.prepared.request,
          { readOnlyHandle: handle.id },
        )
        if ((await leases.status()) === 'free') {
          closed = true
          break
        }
      } catch {
        /* allow the owner to finish its stop acknowledgement */
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(closed).toBe(true)
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true })
})

function requestInput(requestId = 'parallel-request') {
  const documents = reviewFixtureDocuments()
  for (const documentPath of parallelDocuments)
    documents.find(document => document.path === documentPath)!.content =
      `# incomplete ${documentPath}`
  const sourceResult = buildSingleReviewFixture({
    documents,
    identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: {
      kind: 'initial',
      sourceResultId: 'author',
      sourceDocumentRevision: 'a'.repeat(64),
      confirmedBriefDigest: 'b'.repeat(64),
    },
  })
  const input = {
    sourceResult,
    sourceBinding: {
      ownerId: 'owner',
      projectId: 'project',
      resultId: sourceResult.resultId,
      resultDigest: revisionDigest(sourceResult),
    },
  }
  const start: RevisionStartInput = {
    protocolVersion: 1,
    requestId,
    ownerId: 'owner',
    projectId: 'project',
    inputDigest: foundationRevisionInputDigest({
      ownerId: 'owner',
      projectId: 'project',
      input,
    }),
    input,
  }
  return {
    start,
    validDocuments: new Map(
      reviewFixtureDocuments().map(document => [
        document.path,
        document.content,
      ]),
    ),
  }
}

function backendResult(
  input: BeeGameUsageBillingRecordInput,
  id: string,
): BeeGameUsageBillingRecordResult {
  const usage = input.usage
  return {
    duplicate: false,
    event: {
      id,
      idempotencyKey: input.idempotencyKey,
      userId: 'owner',
      sessionId: input.sessionId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      pricingVersion: input.pricingVersion ?? 'weighted-v1',
      usageSource: input.usageSource ?? 'runtime_snapshot',
      usage,
      delta: usage,
      weightedTokens: usage.total_tokens,
      weightedTokensDelta: usage.total_tokens,
      creditsMicro: usage.total_tokens,
      createdAt: '2026-09-06T00:00:00.000Z',
      metadata: input.metadata ?? {},
    },
    cumulativeUsage: usage,
    cumulativeWeightedTokens: usage.total_tokens,
    creditsMicro: usage.total_tokens,
  }
}

function billing() {
  const calls: string[] = []
  const authority: BeeGameUsageBillingClient = {
    async recordUsage(_ownerId, input) {
      calls.push(`record:${input.idempotencyKey}`)
      return backendResult(input, 'record-event')
    },
    async debitRealTimeUsage(_ownerId, input) {
      calls.push(`debit:${input.idempotencyKey}`)
      return backendResult(input, 'debit-event')
    },
  }
  return {
    client: createUsageBillingClient({
      ownerId: 'owner',
      billingClient: authority,
    }),
    calls,
  }
}

function runtime(controlDirectory: string) {
  let calls = 0
  const client: RuntimeConfigurationClient = {
    protocolVersion: 1,
    ownerId: 'owner',
    async resolve() {
      calls += 1
      return {
        command: [
          process.execPath,
          join(import.meta.dir, 'native-file-revision.ts'), 'valid',
          Buffer.from(JSON.stringify({documents:Object.fromEntries(reviewFixtureDocuments().slice(0,5).map(document => [document.path, document.content]))})).toString('base64'),
        ],
        env: { BEEGAME_CONFIG_DIR: controlDirectory },
      }
    },
  }
  return { client, calls: () => calls }
}

async function waitFor(
  stage: ReturnType<typeof createFoundationRevision>,
  handle: RevisionHandle,
  predicate: (result: RevisionResult) => boolean,
  timeout = 10_000,
) {
  const deadline = Date.now() + timeout
  let latest: RevisionResult | undefined
  while (Date.now() < deadline) {
    latest = await stage.getResult(handle)
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(
    `parallel lifecycle did not reach expected state: ${latest?.status ?? 'unknown'}`,
  )
}

test('repairs five documents in one native task without overwriting canonical files', async () => {
  const root = await workspace()
  const controlDirectory = join(root, 'parallel-control')
  await mkdir(join(root, 'docs'), { recursive: true })
  const requests = requestInput()
  const canonical = new Map<string, string>()
  for (const document of reviewFixtureDocuments()) {
    const path = join(root, document.path)
    const bytes = `canonical-${document.path}`
    canonical.set(path, bytes)
    await writeFile(path, bytes)
  }

  const configured = runtime(controlDirectory)
  const charged = billing()
  const stage = createFoundationRevision(
    { workspacePath: root },
    { runtimeConfiguration: configured.client, billing: charged.client },
  )
  const handle = await stage.start(requests.start)
  live.push({ root, stage, handle })

  const completed = await waitFor(
    stage,
    handle,
    result =>
      result.status === 'completed' && result.billingStatus === 'settled',
  )
  expect(completed.status).toBe('completed')
  expect(configured.calls()).toBe(1)
  expect(charged.calls.filter(call=>call.startsWith('record:'))).toHaveLength(1)
  expect(charged.calls.filter(call=>call.startsWith('debit:'))).toHaveLength(1)
  if (completed.status === 'completed') {
    for (const documentPath of parallelDocuments)
      expect(
        completed.result.documents.find(
          document => document.path === documentPath,
        )?.content,
      ).toBe(requests.validDocuments.get(documentPath))
  }
  for (const [path, bytes] of canonical)
    expect(await readFile(path, 'utf8')).toBe(bytes)
})

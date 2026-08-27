import { describe, expect, test } from 'bun:test'
import Ajv from 'ajv'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  FOUNDATION_WORKER_OUTPUT_MAX_BYTES,
  buildDocumentAuthorAuthorityBlock,
  createBeeGameDeliveryWorkerPort,
} from '../beegame/delivery-worker-session-port'
import {
  registerBeeGameAuthoredResources,
  writeBeeGameAssetManifest,
} from '../beegame/asset-contracts'
import type { BeeGameSessionManager } from '../beegame/session-manager'
import type { WorkerDispatchRequest } from '../beegame/delivery-workflow/types'
import type { FoundationFactPacket } from '../beegame/delivery-workflow/foundation-fact-extraction'
import { createNativeResourceContentTool } from '../beegame/native-resource-content-tool'
import {
  computeDocumentRevision,
  computeResourceInventoryRevision,
  computeResourceRevision,
} from '../beegame/delivery-workflow/revision'
import { getGameDocumentContract } from '../beegame/delivery-workflow/game-document-contracts'
import { buildWorkerPrompt } from '../beegame/delivery-workflow/worker-prompts'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../beegame/delivery-workflow/types'
import { createFoundationRevisionStage, foundationRevisionPacketPath, revisionTaskReceiptTerminalDigest } from '../beegame/delivery-workflow/foundation-revision-stage'
import {
  buildFoundationFactStructuredOutputJsonSchema,
  foundationFactExtractorTerminalSchema,
  foundationFactModelPayloadSchema,
  foundationFactStructuredOutputJsonSchema,
  foundationSemanticModelPayloadSchema,
  foundationSemanticRecheckStructuredOutputJsonSchema,
  foundationSemanticReviewerStructuredOutputJsonSchema,
} from '../beegame/delivery-workflow/worker-contracts'

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1
}

describe('delivery worker session credentials', () => {
  test('builds a packet-specific closed schema for typed present facts', () => {
    const schema = buildFoundationFactStructuredOutputJsonSchema({
      revision: 'revision',
      keys: ['audio.event_ids', 'game.players.max'],
      sections: [
        { documentPath: 'docs/AUDIO_DESIGN.md', sectionId: 'event_taxonomy', heading: 'Events', startLine: 65, endLine: 80, digest: 'a'.repeat(64), text: 'events' },
        { documentPath: 'docs/GDD.md', sectionId: 'vision', heading: 'Vision', startLine: 10, endLine: 20, digest: 'b'.repeat(64), text: 'vision' },
      ],
      bytesUtf8: 1,
      packetDigest: 'c'.repeat(64),
    } satisfies FoundationFactPacket) as { properties: { results: { items: { oneOf: Array<Record<string, unknown>> } } } }
    expect(schema.properties.results).toMatchObject({ minItems: 2, maxItems: 2 })
    const branches = schema.properties.results.items.oneOf
    expect(branches).toHaveLength(6)
    const presentAudio = branches.find(branch =>
      (branch.properties as { key: { enum: string[] }; status: { enum: string[] } }).key.enum[0] === 'audio.event_ids' &&
      (branch.properties as { status: { enum: string[] } }).status.enum[0] === 'present',
    )!
    expect(presentAudio.additionalProperties).toBe(false)
    expect(presentAudio.required).toEqual(['key', 'status', 'value'])
    expect(presentAudio.properties).not.toHaveProperty('evidence')
    expect(presentAudio.properties).toMatchObject({
      value: {
        type: 'array',
        minItems: 1,
        maxItems: 256,
        items: { type: 'string', pattern: '^\\S(?:.*\\S)?$' },
      },
    })
    const absentAudio = branches.find(branch =>
      (branch.properties as { key: { enum: string[] }; status: { enum: string[] } }).key.enum[0] === 'audio.event_ids' &&
      (branch.properties as { status: { enum: string[] } }).status.enum[0] === 'absent',
    )!
    expect(absentAudio.required).toEqual(['key', 'status'])
    expect(absentAudio.properties).not.toHaveProperty('value')
    expect(absentAudio.properties).not.toHaveProperty('evidence')
    expect(absentAudio.properties).not.toHaveProperty('reason')
    const uncertainAudio = branches.find(branch =>
      (branch.properties as { key: { enum: string[] }; status: { enum: string[] } }).key.enum[0] === 'audio.event_ids' &&
      (branch.properties as { status: { enum: string[] } }).status.enum[0] === 'uncertain',
    )!
    expect(uncertainAudio.required).toEqual(['key', 'status', 'reason'])
    expect(uncertainAudio.properties).not.toHaveProperty('evidence')
    const validate = new Ajv().compile(schema)
    expect(validate({ status: 'completed', results: [{ key: 'audio.event_ids', status: 'absent' }, { key: 'game.players.max', status: 'absent' }] })).toBe(true)
    expect(validate({
      status: 'completed',
      results: [{
        key: 'audio.event_ids',
        status: 'absent',
        value: ['unexpected'],
        evidence: { documentPath: 'docs/AUDIO_DESIGN.md', sectionId: 'event_taxonomy', startLine: 65, endLine: 80, digest: 'a'.repeat(64) },
        reason: 'unexpected extra fields',
      }, { key: 'game.players.max', status: 'absent' }],
    })).toBe(false)
    expect(validate({
      status: 'completed',
      results: [{
        key: 'audio.event_ids',
        status: 'present',
        value: ['player.jump'],
        evidence: [],
      }, { key: 'game.players.max', status: 'absent' }],
    })).toBe(false)
    expect(validate({
      status: 'completed',
      results: [{
        key: 'audio.event_ids',
        status: 'present',
        value: ['player.jump'],
        evidence: {},
      }, { key: 'game.players.max', status: 'absent' }],
    })).toBe(false)
    expect(validate({
      status: 'completed',
      results: [{
        key: 'audio.event_ids',
        status: 'present',
        value: ['player.jump'],
        evidence: { documentPath: 'docs/GDD.md', sectionId: 'vision', startLine: 10, endLine: 20, digest: 'a'.repeat(64) },
      }, { key: 'game.players.max', status: 'absent' }],
    })).toBe(false)
    expect(validate({
      status: 'completed',
      results: [{ key: 'audio.event_ids', status: 'uncertain', reason: 'ambiguous' }, { key: 'game.players.max', status: 'absent' }],
    })).toBe(true)
  })

  test('exposes the foundation revision terminal and derives a terminal from its successful tool event', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'revision-session-port-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const contract = getGameDocumentContract('docs/GDD.md')
      const canonical = `# GDD\n\n${contract.sections.map(section => `<!-- beegame-section:${section.sectionId} -->\n## ${section.title}\n\noriginal ${section.sectionId}\n`).join('\n')}`
      await writeFile(join(workspacePath, 'docs/GDD.md'), canonical)
      const stage = await createFoundationRevisionStage({ workspacePath, revision: 'rev-1', documentPath: 'docs/GDD.md' })
      const staged = canonical.replace('original vision', 'revised vision')
      await writeFile(join(workspacePath, stage.stagedPath), staged)
      const receiptWithoutTerminal = {
        taskId: 'revision-task-1', round: 1 as const, documentPath: 'docs/GDD.md' as const, issueIds: ['AUD-1'],
        baseDocumentDigest: stage.baseDocumentDigest,
        stagedDocumentDigest: createHash('sha256').update(staged).digest('hex'),
        changedSectionIds: ['vision'], stagedPath: stage.stagedPath,
      }
      const receipt = { ...receiptWithoutTerminal, terminalDigest: revisionTaskReceiptTerminalDigest(receiptWithoutTerminal) }
      const starts: Array<Record<string, unknown>> = []
      const prompts: string[] = []
      const sessions = {
        start(input: Record<string, unknown>) { starts.push(input); return { id: 'session-revision' } },
        updateAuthToken() {},
        async sendWithDisplay(_sessionId: string, text: string) { prompts.push(text); return {} },
        events() { return [
          { id: 'revision-tool-use', type: 'tool.started' as const, text: 'SubmitFoundationRevisionResult', createdAt: new Date(), payload: { type: 'tool.started', toolName: 'SubmitFoundationRevisionResult', input: { status: 'APPLIED', changedSectionIds: ['vision'], receipt: { forged: true } } } },
          { id: 'revision-tool-result', type: 'tool.completed' as const, text: 'SubmitFoundationRevisionResult completed', createdAt: new Date(), payload: { type: 'tool.completed', toolName: 'SubmitFoundationRevisionResult', output: JSON.stringify({ status: 'APPLIED', receipt }) } },
          { id: 'revision-end-turn', type: 'turn.completed' as const, text: 'turn completed', createdAt: new Date(), payload: { type: 'turn.completed' } },
        ] },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1', confirmedBriefContext: 'CONFIRMED_SENTINEL' })
      await port.start({
        dispatchId: 'dispatch-revision', runId: 'run-revision', ownerId: 'user-1', projectId: 'project-revision', workspacePath,
        workerType: 'foundation-document-reviser', phase: 'DOCUMENT_REVIEW', taskId: 'revision-task-1', revision: 'rev-1',
        allowedPaths: [stage.stagedPath], protectedPaths: ['docs/GDD.md'], projectReadScope: 'allowed',
        contract: { workerType: 'foundation-document-reviser', taskId: 'revision-task-1', round: 1, documentPath: 'docs/GDD.md', issueIds: ['AUD-1'], sectionIds: ['vision'], stagedPath: stage.stagedPath, baseDocumentDigest: stage.baseDocumentDigest, packetPath: foundationRevisionPacketPath('rev-1', 1, 'revision-task-1'), packetDigest: 'a'.repeat(64) },
      })
      await expect(port.waitForTerminal?.('dispatch-revision')).resolves.toMatchObject({ workerType: 'foundation-document-reviser', status: 'completed', declaration: { status: 'APPLIED', receipt } })
      expect(starts[0]).toMatchObject({ workflowAllowedPaths: [stage.stagedPath], workflowProjectReadScope: 'allowed', workflowProtectedPaths: ['docs/GDD.md'], workflowRevisionContract: expect.objectContaining({ taskId: 'revision-task-1', stagedPath: stage.stagedPath }) })
      expect(starts[0]?.workflowRevisionContract).not.toHaveProperty('packet')
      await port.submit('dispatch-revision', `Immutable revision packet: {"sections":[]}\nAssigned staged path: ${join(workspacePath, stage.stagedPath)}\nRead and edit only the assigned staged path. After the revision, call SubmitFoundationRevisionResult exactly once with status APPLIED and the exact changedSectionIds; do not return terminal JSON or prose completion text.`)
      expect(prompts[0]).toContain(join(workspacePath, stage.stagedPath))
      expect(prompts[0]).not.toContain('CONFIRMED_SENTINEL')
      expect(prompts[0]).not.toContain('Workspace root:')
      expect(prompts[0]).not.toContain('README.md')

      const legacySessions = {
        ...sessions,
        events() {
          return [
            {
              id: 'legacy-revision-tool-result',
              type: 'tool.completed' as const,
              text: 'SubmitFoundationRevisionResult completed',
              createdAt: new Date(),
              payload: {
                type: 'tool.completed',
                toolName: 'SubmitFoundationRevisionResult',
                output: JSON.stringify({ accepted: true, data: { receipt } }),
              },
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const legacyPort = createBeeGameDeliveryWorkerPort({
        sessions: legacySessions,
        userId: 'user-1',
      })
      await legacyPort.start({
        dispatchId: 'dispatch-revision-legacy', runId: 'run-revision', ownerId: 'user-1', projectId: 'project-revision', workspacePath,
        workerType: 'foundation-document-reviser', phase: 'DOCUMENT_REVIEW', taskId: 'revision-task-1', revision: 'rev-1',
        allowedPaths: [stage.stagedPath], protectedPaths: ['docs/GDD.md'], projectReadScope: 'allowed',
        contract: { workerType: 'foundation-document-reviser', taskId: 'revision-task-1', round: 1, documentPath: 'docs/GDD.md', issueIds: ['AUD-1'], sectionIds: ['vision'], stagedPath: stage.stagedPath, baseDocumentDigest: stage.baseDocumentDigest, packetPath: foundationRevisionPacketPath('rev-1', 1, 'revision-task-1'), packetDigest: 'a'.repeat(64) },
      })
      await expect(legacyPort.waitForTerminal?.('dispatch-revision-legacy')).rejects.toThrow()
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })

  test('uses the native StructuredOutput result for fact extraction and passes its strict schema to the runner', async () => {
    const starts: Array<Record<string, unknown>> = []
    const structured = {
      status: 'completed',
      results: [],
    }
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: 'session-facts' }
      },
      events() {
        return [{
          id: 'fact-result',
          type: 'result' as const,
          text: 'Structured output accepted',
          createdAt: new Date(),
          payload: { type: 'result', subtype: 'success', structured_output: structured },
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    const request = {
      dispatchId: 'dispatch-facts',
      runId: 'run-facts',
      ownerId: 'user-1',
      workspacePath: '/tmp/fact-project',
      workerType: 'foundation-fact-extractor' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: 'task-facts',
      revision: 'revision-facts',
      allowedPaths: [],
      projectReadScope: 'empty' as const,
      contract: { taskId: 'task-facts', packetDigest: 'a'.repeat(64), modelTier: 'fast', workerType: 'foundation-fact-extractor', packet: { keys: ['audio.event_ids'], sections: [{ documentPath: 'docs/AUDIO_DESIGN.md', sectionId: 'event_taxonomy', startLine: 65, endLine: 80, digest: 'b'.repeat(64) }] } },
    } as unknown as WorkerDispatchRequest
    await port.start(request)
    const terminal = await port.waitForTerminal?.('dispatch-facts')
    expect(terminal).toEqual({
      workerType: 'foundation-fact-extractor',
      status: 'completed',
      runId: 'run-facts',
      dispatchId: 'dispatch-facts',
      taskId: 'task-facts',
      revision: 'revision-facts',
      packetDigest: 'a'.repeat(64),
      results: [],
    })
    const schema = starts[0]?.workflowJsonSchema as {
      required?: unknown[]
      properties?: { results?: unknown }
    } | undefined
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['status', 'results'],
    })
    expect(schema?.required).not.toContain('runId')
    expect(schema?.required).not.toContain('dispatchId')
    expect(schema?.required).not.toContain('taskId')
    expect(schema?.required).not.toContain('revision')
    expect(schema?.required).not.toContain('packetDigest')
    const itemSchema = schema?.properties?.results as { items?: { oneOf?: Array<Record<string, unknown>> } } | undefined
    expect(itemSchema?.items?.oneOf).toHaveLength(3)
  })

  test('binds semantic PASS, ISSUES and UNDECIDABLE payloads to each request', async () => {
    const issue = {
      problem: 'The loop is contradictory.',
      expected: 'A coherent loop.',
      actual: 'Two incompatible rules.',
      sourceSectionKey: 'GDD#core_loop',
      remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] },
    }
    const payloads = [
      { status: 'completed' as const, outcome: 'PASS' as const },
      { status: 'completed' as const, outcome: 'ISSUES' as const, issues: [issue] },
      { status: 'completed' as const, outcome: 'UNDECIDABLE' as const, reason: 'The packet is ambiguous.' },
    ]

    for (const [index, payload] of payloads.entries()) {
      const request = {
        dispatchId: `dispatch-semantic-${index}`,
        runId: `run-semantic-${index}`,
        ownerId: 'user-1',
        projectId: 'project-semantic',
        workspacePath: '/tmp/semantic-project',
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: `task-semantic-${index}`,
        revision: `revision-semantic-${index}`,
        allowedPaths: [],
        projectReadScope: 'empty' as const,
        contract: {
          taskId: `task-semantic-${index}`,
          packetDigest: 'a'.repeat(64),
          modelTier: 'balanced' as const,
          workerType: 'foundation-semantic-reviewer' as const,
        },
      } as unknown as WorkerDispatchRequest
      const sessions = {
        start() { return { id: `session-semantic-${index}` } },
        events() {
          return [{
            id: `semantic-result-${index}`,
            type: 'result' as const,
            text: 'Structured output accepted',
            createdAt: new Date(),
            payload: { type: 'result', subtype: 'success', structured_output: payload },
          }]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
      await port.start(request)
      await expect(port.waitForTerminal?.(request.dispatchId!)).resolves.toEqual({
        ...payload,
        workerType: 'foundation-semantic-reviewer',
        runId: request.runId,
        dispatchId: request.dispatchId,
        taskId: request.taskId,
        revision: request.revision,
        packetDigest: request.contract.packetDigest,
      })
    }

    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'completed', outcome: 'PASS', issues: [issue] })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'completed', outcome: 'ISSUES' })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'completed', outcome: 'UNDECIDABLE' })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'completed', outcome: 'UNDECIDABLE', issues: [issue], reason: 'ambiguous' })).toThrow()
    const validate = new Ajv().compile(foundationSemanticReviewerStructuredOutputJsonSchema)
    expect(validate({ status: 'completed', outcome: 'PASS', reason: 'provider-added explanation' })).toBe(false)
    expect(validate({ status: 'completed', outcome: 'ISSUES', issues: [issue], reason: 'provider-added explanation' })).toBe(false)
    expect(validate({ status: 'completed', outcome: 'ISSUES', issues: [issue] })).toBe(true)
    expect(validate({ status: 'completed', outcome: 'UNDECIDABLE', reason: 'ambiguous packet' })).toBe(true)
  })

  test('binds a targeted semantic recheck FAIL payload to a completed FAIL terminal', async () => {
    const diagnostic = {
      observedActual: 'The Boot to MainMenu transition row remains absent.',
      evidence: [{ documentPath: 'docs/GDD.md' as const, sectionId: 'flow', digest: 'b'.repeat(64) }],
      failureReasonCode: 'expected_not_met' as const,
    }
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) { starts.push(input); return { id: 'session-semantic-recheck' } },
      events() {
        return [{
          id: 'semantic-recheck-result',
          type: 'result' as const,
          text: 'Structured output accepted',
          createdAt: new Date(),
      payload: { type: 'result', subtype: 'success', structured_output: { status: 'FAIL', diagnostic } },
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start({
      dispatchId: 'dispatch-semantic-recheck',
      runId: 'run-semantic-recheck',
      ownerId: 'user-1',
      projectId: 'project-semantic',
      workspacePath: '/tmp/semantic-project',
      workerType: 'foundation-semantic-reviewer',
      phase: 'DOCUMENT_REVIEW',
      taskId: 'task-semantic-recheck',
      revision: 'revision-semantic-recheck',
      allowedPaths: [],
      projectReadScope: 'empty',
      workflowJsonSchema: foundationSemanticRecheckStructuredOutputJsonSchema as unknown as Record<string, unknown>,
      contract: {
        taskId: 'task-semantic-recheck',
        issueId: 'AUD-1',
        packetDigest: 'a'.repeat(64),
        packet: { issueId: 'AUD-1', expected: 'transition exists', actual: 'transition absent', sections: [] },
        modelTier: 'strong',
        workerType: 'foundation-semantic-reviewer',
      },
    })

    await expect(port.waitForTerminal?.('dispatch-semantic-recheck')).resolves.toEqual({
      workerType: 'foundation-semantic-reviewer',
      status: 'completed',
      runId: 'run-semantic-recheck',
      dispatchId: 'dispatch-semantic-recheck',
      taskId: 'task-semantic-recheck',
      revision: 'revision-semantic-recheck',
      packetDigest: 'a'.repeat(64),
      outcome: 'FAIL',
      diagnostic: { ...diagnostic, scopeAssessment: 'repairable_in_scope' },
    })
    expect(starts[0]?.workflowJsonSchema).toEqual(foundationSemanticRecheckStructuredOutputJsonSchema)
  })

  test('rejects oversized foundation structured output at the infrastructure boundary', async () => {
    const request = {
      dispatchId: 'dispatch-semantic-oversized',
      runId: 'run-semantic-oversized',
      ownerId: 'user-1',
      projectId: 'project-semantic',
      workspacePath: '/tmp/semantic-project',
      workerType: 'foundation-semantic-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: 'task-semantic-oversized',
      revision: 'revision-semantic-oversized',
      allowedPaths: [],
      projectReadScope: 'empty' as const,
      contract: {
        taskId: 'task-semantic-oversized',
        packetDigest: 'a'.repeat(64),
        modelTier: 'balanced' as const,
        workerType: 'foundation-semantic-reviewer' as const,
      },
    } as unknown as WorkerDispatchRequest
    const sessions = {
      start() { return { id: 'session-semantic-oversized' } },
      events() {
        return [{
          id: 'semantic-result-oversized',
          type: 'result' as const,
          text: 'Structured output accepted',
          createdAt: new Date(),
          payload: {
            type: 'result',
            subtype: 'success',
            structured_output: {
              status: 'completed',
              outcome: 'UNDECIDABLE',
              reason: 'x'.repeat(FOUNDATION_WORKER_OUTPUT_MAX_BYTES),
            },
          },
        }]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    await port.start(request)
    await expect(port.waitForTerminal?.(request.dispatchId!)).rejects.toThrow(
      /structured output exceeds infrastructure boundary/i,
    )
  })

  test('rejects forged identity, extra fields and malformed model payloads', () => {
    expect(() => foundationFactModelPayloadSchema.parse({ status: 'completed', results: [], taskId: 'spoofed' })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'completed', outcome: 'PASS', runId: 'spoofed' })).toThrow()
    expect(() => foundationFactModelPayloadSchema.parse({ status: 'completed', results: [{ status: 'present' }] })).toThrow()
    expect(() => foundationSemanticModelPayloadSchema.parse({ status: 'unknown', outcome: 'PASS' })).toThrow()
    expect(foundationFactStructuredOutputJsonSchema.additionalProperties).toBe(false)
    expect(foundationSemanticReviewerStructuredOutputJsonSchema.additionalProperties).toBe(false)
    expect(foundationFactStructuredOutputJsonSchema.properties).not.toHaveProperty('taskId')
    expect(foundationSemanticReviewerStructuredOutputJsonSchema.properties).not.toHaveProperty('packetDigest')
    expect(foundationFactStructuredOutputJsonSchema.required).toEqual(['status', 'results'])
    expect(foundationSemanticReviewerStructuredOutputJsonSchema.required).toEqual(['status', 'outcome'])
  })

  test('enforces status-specific foundation fact fields in model and terminal Zod shapes', () => {
    const evidence = {
      documentPath: 'docs/GDD.md',
      sectionId: 'vision',
      startLine: 1,
      endLine: 1,
      digest: 'a'.repeat(64),
    }
    const absent = { key: 'game.boss.count', status: 'absent' as const }
    expect(
      foundationFactModelPayloadSchema.parse({ status: 'completed', results: [absent] }),
    ).toEqual({ status: 'completed', results: [absent] })
    expect(
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ key: absent.key, status: 'present', value: 1 }],
      }),
    ).toMatchObject({ results: [{ key: absent.key, status: 'present', value: 1 }] })
    expect(
      foundationFactExtractorTerminalSchema.parse({
        workerType: 'foundation-fact-extractor',
        status: 'completed',
        runId: 'run',
        dispatchId: 'dispatch',
        taskId: 'task',
        revision: 'revision',
        packetDigest: 'a'.repeat(64),
        results: [absent],
      }),
    ).toMatchObject({ results: [absent] })
    expect(
      foundationFactExtractorTerminalSchema.parse({
        workerType: 'foundation-fact-extractor',
        status: 'completed',
        runId: 'run',
        dispatchId: 'dispatch',
        taskId: 'task',
        revision: 'revision',
        packetDigest: 'a'.repeat(64),
        results: [{ key: absent.key, status: 'present', value: 1, evidence }],
      }),
    ).toMatchObject({ results: [{ status: 'present', evidence }] })
    expect(() =>
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ ...absent, value: 0, evidence, reason: 'not found' }],
      }),
    ).toThrow()
    expect(() =>
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ key: absent.key, status: 'uncertain' }],
      }),
    ).toThrow()
    expect(() =>
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ key: absent.key, status: 'uncertain', reason: 'ambiguous', evidence }],
      }),
    ).toThrow()
    expect(() =>
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ key: absent.key, status: 'present' }],
      }),
    ).toThrow()
    expect(() =>
      foundationFactModelPayloadSchema.parse({
        status: 'completed',
        results: [{ key: absent.key, status: 'present', value: undefined, evidence }],
      }),
    ).toThrow()
  })

  test('binds model facts to immutable packet owner evidence and rejects missing owners', async () => {
    const ownerSection = {
      documentPath: 'docs/AUDIO_DESIGN.md',
      sectionId: 'event_taxonomy',
      heading: 'Event Taxonomy',
      startLine: 65,
      endLine: 80,
      digest: 'b'.repeat(64),
      text: '## Event Taxonomy',
    }
    const ownerEvidence = {
      documentPath: ownerSection.documentPath,
      sectionId: ownerSection.sectionId,
      startLine: ownerSection.startLine,
      endLine: ownerSection.endLine,
      digest: ownerSection.digest,
    }
    const request = {
      dispatchId: 'dispatch-facts-bound',
      runId: 'run-facts-bound',
      ownerId: 'user-1',
      projectId: 'project-facts-bound',
      workspacePath: '/tmp/fact-project',
      workerType: 'foundation-fact-extractor' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      taskId: 'task-facts-bound',
      revision: 'revision-facts-bound',
      allowedPaths: [],
      projectReadScope: 'empty' as const,
      contract: {
        taskId: 'task-facts-bound',
        packetDigest: 'a'.repeat(64),
        modelTier: 'fast' as const,
        workerType: 'foundation-fact-extractor' as const,
        packet: { keys: ['audio.event_ids'], sections: [ownerSection] },
      },
    } as unknown as WorkerDispatchRequest
    const payloads = [
      { key: 'audio.event_ids', status: 'present' as const, value: ['player.jump'] },
      { key: 'audio.event_ids', status: 'uncertain' as const, reason: 'ambiguous packet text' },
      { key: 'audio.event_ids', status: 'absent' as const },
    ]
    for (const [index, result] of payloads.entries()) {
      const sessions = {
        start() { return { id: `session-facts-bound-${index}` } },
        events() {
          return [{
            id: `fact-result-bound-${index}`,
            type: 'result' as const,
            text: 'Structured output accepted',
            createdAt: new Date(),
            payload: { type: 'result', subtype: 'success', structured_output: { status: 'completed', results: [result] } },
          }]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
      await port.start({ ...request, dispatchId: `dispatch-facts-bound-${index}` })
      await expect(port.waitForTerminal?.(`dispatch-facts-bound-${index}`)).resolves.toMatchObject({
        results: [
          result.status === 'present' || result.status === 'uncertain'
            ? { ...result, evidence: ownerEvidence }
            : result,
        ],
      })
    }

    const missingOwnerSessions = {
      start() { return { id: 'session-facts-missing-owner' } },
      events() {
        return [{ id: 'fact-result-missing-owner', type: 'result' as const, text: 'Structured output accepted', createdAt: new Date(), payload: { type: 'result', subtype: 'success', structured_output: { status: 'completed', results: [{ key: 'audio.event_ids', status: 'present', value: ['player.jump'] }] } } }]
      },
    } as unknown as BeeGameSessionManager
    const missingOwnerPort = createBeeGameDeliveryWorkerPort({ sessions: missingOwnerSessions, userId: 'user-1' })
    await expect(missingOwnerPort.start({
      ...request,
      dispatchId: 'dispatch-facts-missing-owner',
      contract: { ...request.contract, packet: { keys: ['audio.event_ids'], sections: [] } },
    })).rejects.toThrow(/owner section|missing/i)
  })

  test('binds identical model payloads to different request identities', async () => {
    const startFact = async (suffix: string) => {
      const request = {
        dispatchId: `dispatch-${suffix}`,
        runId: `run-${suffix}`,
        ownerId: 'user-1',
        projectId: 'project-facts',
        workspacePath: '/tmp/fact-project',
        workerType: 'foundation-fact-extractor' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: `task-${suffix}`,
        revision: `revision-${suffix}`,
        allowedPaths: [],
        projectReadScope: 'empty' as const,
        contract: {
          taskId: `task-${suffix}`,
          packetDigest: 'a'.repeat(64),
          modelTier: 'fast' as const,
          workerType: 'foundation-fact-extractor' as const,
          packet: {
            keys: ['audio.event_ids'],
            sections: [{ documentPath: 'docs/AUDIO_DESIGN.md', sectionId: 'event_taxonomy', startLine: 65, endLine: 80, digest: 'b'.repeat(64) }],
          },
        },
      } as unknown as WorkerDispatchRequest
      const sessions = {
        start() { return { id: `session-${suffix}` } },
        events() {
          return [{ id: `result-${suffix}`, type: 'result' as const, text: '', createdAt: new Date(), payload: { type: 'result', structured_output: { status: 'completed', results: [] } } }]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
      await port.start(request)
      return port.waitForTerminal!(request.dispatchId!)
    }

    const first = await startFact('one')
    const second = await startFact('two')
    expect(first).toMatchObject({ runId: 'run-one', dispatchId: 'dispatch-one', taskId: 'task-one', revision: 'revision-one' })
    expect(second).toMatchObject({ runId: 'run-two', dispatchId: 'dispatch-two', taskId: 'task-two', revision: 'revision-two' })
    expect(first).not.toEqual(second)
  })

  test('does not reject a remote model config missing from the local registry', async () => {
    const port = createBeeGameDeliveryWorkerPort({
      sessions: {} as unknown as BeeGameSessionManager,
      userId: 'user-1',
      modelConfigId: 'remote-model-config',
    })
    await port.assertFoundationFactFastReady!({ workerType: 'foundation-fact-extractor' } as unknown as WorkerDispatchRequest)
    await port.assertFoundationSemanticModelReady!({
      workerType: 'foundation-semantic-reviewer',
      contract: { modelTier: 'balanced' },
    } as unknown as WorkerDispatchRequest)
  })

  test('accepts only the planner resource-plan terminal contract', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-planner',
        toolName: 'AssetManifest',
        toolInput: { action: 'submit_resource_plan' },
      })

      expect(terminal).toEqual({
        revision: 'revision-resource-terminal',
        workerType: 'resource-planner',
        status: 'completed',
        writtenPaths: ['assets/asset-manifest.json'],
        taskMetrics: {
          catalogPayloadBytes: 0,
          catalogCallTypes: [],
          canonicalMutationCount: 1,
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects curator tool history when no durable inventory receipt exists', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
      await writeFile(join(workspacePath, 'assets/runtime/world.dat'), 'world')
      await registerBeeGameAuthoredResources(workspacePath, [
        {
          id: 'world-resource',
          root_path: 'assets/runtime/world.dat',
          file_paths: ['assets/runtime/world.dat'],
          provisional: true,
          reason: 'Independent resource terminal fixture.',
          selection_reason: ['Exercises the curator receipt boundary.'],
          asset_kind: 'data',
        },
      ])
      await expect(
        runResourceTerminal({
          workspacePath,
          workerType: 'resource-curator',
          catalogObserved: true,
          toolName: 'CommitResourceInventory',
          toolInput: {
            decisions: [
              {
                requirement_id: 'world.visual',
                resource_id: 'world-resource',
                kind: 'placeholder',
              },
            ],
          },
        }),
      ).rejects.toThrow('without an accepted durable inventory receipt')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('accepts a content inventory request only for exact manifest requirement IDs', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      const contract = {
        dispatchId: 'dispatch-resource-content-author',
        inventoryRevision:
          await computeResourceInventoryRevision(workspacePath),
        baselineResourceRevision: await computeResourceRevision(
          workspacePath,
          '',
        ),
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: [],
        inventoryBindings: [],
        writablePaths: ['assets/content/resource-registry.json'],
        repairPaths: ['assets/content/resource-registry.json'],
      }
      const tool = createNativeResourceContentTool({
        buildTool: definition => definition,
        workspacePath,
        contract,
        assertMutationAuthority: () => undefined,
      }) as { call(input: unknown): Promise<unknown> }
      await tool.call({
        action: 'needs_inventory',
        missingRequirementIds: ['world.visual'],
      })
      const terminal = await runResourceTerminal({
        workspacePath,
        workerType: 'resource-content-author',
        toolName: 'CommitResourceContent',
        toolInput: {
          action: 'needs_inventory',
          missingRequirementIds: ['world.visual'],
        },
        contract: {
          ...contract,
        },
      })

      expect(terminal).toMatchObject({
        revision: 'revision-resource-terminal',
        workerType: 'resource-content-author',
        status: 'needs_inventory',
        missingRequirementIds: ['world.visual'],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('waits through a prepared resource receipt and accepts only its committed proof', async () => {
    const workspacePath = await createResourceWorkspace()
    try {
      await writeBeeGameAssetManifest(workspacePath, resourcePlanManifest())
      await mkdir(join(workspacePath, 'assets/runtime'), { recursive: true })
      await writeFile(join(workspacePath, 'assets/runtime/world.dat'), 'world')
      await registerBeeGameAuthoredResources(workspacePath, [
        {
          id: 'world-resource',
          root_path: 'assets/runtime/world.dat',
          file_paths: ['assets/runtime/world.dat'],
          provisional: true,
          reason: 'Durable Resource Content receipt fixture.',
          selection_reason: ['Exercises restart recovery.'],
          asset_kind: 'data',
        },
      ])
      const contract = {
        dispatchId: 'dispatch-content-receipt',
        inventoryRevision:
          await computeResourceInventoryRevision(workspacePath),
        baselineResourceRevision: await computeResourceRevision(
          workspacePath,
          '',
        ),
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: ['world-resource'],
        inventoryBindings: [
          {
            requirementId: 'world.visual',
            resourceIds: ['world-resource'],
          },
        ],
        writablePaths: ['assets/content/resource-registry.json'],
        repairPaths: ['assets/content/resource-registry.json'],
      }
      const tool = createNativeResourceContentTool({
        buildTool: definition => definition,
        workspacePath,
        contract,
        assertMutationAuthority: () => undefined,
      }) as {
        call(input: unknown): Promise<unknown>
      }
      await tool.call({
        action: 'commit',
        documents: {
          'assets/content/resource-registry.json': {
            schema: 'beegame-content-v1',
            id: 'resource-registry',
            kind: 'resource-registry',
            fulfills: ['world.visual'],
            resources: ['world-resource'],
            data: {
              bindings: [
                {
                  requirementId: 'world.visual',
                  resourceIds: ['world-resource'],
                },
              ],
            },
          },
        },
      })
      const receiptPath = join(
        workspacePath,
        '.beegame/workflow/resource-content-commits',
        `${contract.dispatchId}.json`,
      )
      const committedReceipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      await writeFile(
        receiptPath,
        `${JSON.stringify({ ...committedReceipt, status: 'prepared' }, null, 2)}\n`,
      )

      const sessions = {
        start() {
          return { id: 'session-content-receipt' }
        },
        events() {
          return [
            {
              id: 'content-result-without-tool-event',
              type: 'result' as const,
              text: 'completed',
              createdAt: new Date(),
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })
      await port.start({
        dispatchId: contract.dispatchId,
        runId: 'run-content-receipt',
        ownerId: 'user-1',
        projectId: 'project-content-receipt',
        workspacePath,
        workerType: 'resource-content-author',
        phase: 'RESOURCE_PREPARATION',
        revision: 'revision-content-receipt',
        contract: {
          ...contract,
        },
      })

      const terminalResult = port.waitForTerminal!(contract.dispatchId).then(
        value => ({ value }),
        error => ({ error }),
      )
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toMatchObject({
        status: 'prepared',
      })
      await writeFile(
        receiptPath,
        `${JSON.stringify(committedReceipt, null, 2)}\n`,
      )

      await expect(terminalResult).resolves.toEqual({
        value: {
          revision: 'revision-content-receipt',
          workerType: 'resource-content-author',
          status: 'completed',
          contentIds: ['resource-registry'],
          writtenPaths: ['assets/content/resource-registry.json'],
          missingRequirementIds: [],
          taskMetrics: {
            catalogPayloadBytes: 0,
            catalogCallTypes: [],
            canonicalMutationCount: 1,
          },
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('gives Resource Content Author read access to its existing content set', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: 'session-resource-content' }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })

    await port.start({
      dispatchId: 'dispatch-resource-content',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-content-author',
      phase: 'RESOURCE_PREPARATION',
      taskId: 'RESOURCE_CONTENT',
      revision: 'revision-1',
      allowedPaths: ['assets/content/'],
      contract: {
        authorityPaths: ['docs/GDD.md'],
        repairPaths: ['assets/content/entity-definitions.json'],
        inventoryRevision: 'inventory-revision',
        baselineResourceRevision: 'resource-revision',
        requiredRequirementIds: ['world.visual'],
        verifiedResourceIds: ['world-resource'],
        inventoryBindings: [
          { requirementId: 'world.visual', resourceIds: ['world-resource'] },
        ],
      },
    })

    expect(starts[0]).toMatchObject({
      workflowAllowedPaths: ['assets/content/'],
      workflowReadOnlyPaths: [
        'docs/GDD.md',
        'assets/content/entity-definitions.json',
      ],
    })
    expect(starts[0].workflowProtectedPaths).toBeUndefined()
  })

  test('does not inject a custom document commit contract during initial authoring', async () => {
    const starts: Array<Record<string, unknown>> = []
    const sessions = {
      start(input: Record<string, unknown>) {
        starts.push(input)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken() {},
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    const base = {
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author' as const,
      phase: 'DOCUMENT_DRAFTING' as const,
      revision: 'revision-1',
    }
    await port.start({
      ...base,
      dispatchId: 'dispatch-gdd',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
      },
    })
    await port.start({
      ...base,
      dispatchId: 'dispatch-level',
      allowedPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/LEVEL_SCENE_DESIGN.md',
      },
    })

    expect(starts[0]?.workflowCanonicalDocumentCommitContract).toBeUndefined()
    expect(starts[1]?.workflowCanonicalDocumentCommitContract).toBeUndefined()
  })

  test('does not expose stale target content or native file instructions', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'initial-authority-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        'stale target content',
      )
      const block = await buildDocumentAuthorAuthorityBlock({
        dispatchId: 'dispatch-gdd-baseline',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          availableUpstreamPaths: [],
        },
      })
      expect(block).toBe('')
      expect(block).not.toContain('stale target content')
      expect(block).not.toContain('CommitCanonicalDocument')
      expect(block).not.toContain(
        'Write the complete assigned Markdown document directly',
      )
      expect(block).not.toContain('complete when the turn ends')
      expect(block).not.toContain('file-operation sequence')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('sends one authoritative initial document instruction without wrapper repetition', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-prompt-once-'))
    let submittedPrompt = ''
    const sessions = {
      start() {
        return { id: 'session-document-prompt-once' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-document-prompt-once',
      runId: 'run-document-prompt-once',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        documentSet: 'foundation',
        foundationDocumentPath: 'docs/GDD.md',
        availableUpstreamPaths: [],
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
      },
    }
    try {
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
        confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
      })
      await port.start(request)
      await port.submit(request.dispatchId!, buildWorkerPrompt(request))

      expect(submittedPrompt).not.toContain(
        'Author the assigned Markdown document',
      )
      expect(submittedPrompt).not.toContain('complete when the turn ends')
      expect(submittedPrompt).not.toContain('file-operation sequence')
      expect(submittedPrompt).toContain(
        'Return exactly one complete raw Markdown body for docs/GDD.md',
      )
      expect(submittedPrompt).toContain('Do not call tools')
      expect(submittedPrompt).not.toContain(
        'Continuous bounded document sequence',
      )
      expect(submittedPrompt).not.toContain('original complete document prompt')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('assembles the final initial author prompt without repeated assignment or authority text', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-prompt-dedup-'))
    let submittedPrompt = ''
    const sessions = {
      start() {
        return { id: 'session-document-prompt-dedup' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-document-prompt-dedup',
      runId: 'run-document-prompt-dedup',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath,
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        documentSet: 'foundation',
        foundationDocumentPath: 'docs/GDD.md',
        availableUpstreamPaths: [],
        completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
      },
    }
    try {
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
        confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
      })
      await port.start(request)
      await port.submit(request.dispatchId!, buildWorkerPrompt(request))

      expect(countOccurrences(submittedPrompt, 'Return exactly one complete raw Markdown body')).toBe(1)
      expect(countOccurrences(submittedPrompt, 'Do not call tools')).toBe(1)
      expect(countOccurrences(submittedPrompt, 'completeDocumentContract')).toBe(1)
      expect(countOccurrences(submittedPrompt, 'confirmed_build_brief')).toBe(1)
      expect(countOccurrences(submittedPrompt, 'This document has no upstream document dependency.')).toBe(0)
      expect(countOccurrences(submittedPrompt, 'The assigned target is docs/GDD.md.')).toBe(1)
      for (const material of getGameDocumentContract('docs/GDD.md').productionMaterials)
        expect(countOccurrences(submittedPrompt, material.materialId)).toBe(1)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('does not synthesize retry failure evidence for any foundation author', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'document-prompt-retry-dedup-'))
    let submittedPrompt = ''
    let sessionCount = 0
    const sessions = {
      start() {
        sessionCount += 1
        return { id: `session-document-prompt-retry-dedup-${sessionCount}` }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const reason = 'UNIQUE_DOCUMENT_FAILURE_EVIDENCE'
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
        const contract = getGameDocumentContract(path)
        await writeFile(
          join(workspacePath, path),
          [
            `# ${contract.discipline}`,
            ...contract.sections.flatMap(section => [
              `<!-- beegame-section:${section.sectionId} -->`,
              `## ${section.title}`,
              `Authority content for ${section.sectionId}.`,
            ]),
            '<!-- beegame-production-materials -->',
            '## Production Materials',
          ].join('\n'),
        )
      }

      for (const authoringMode of ['initial', 'parallel-draft'] as const) {
        for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
          const contract = getGameDocumentContract(path)
          const dispatchId = `dispatch-document-prompt-retry-${authoringMode}-${path.replaceAll('/', '-').replaceAll('.', '-')}`
          const request: WorkerDispatchRequest = {
            dispatchId,
            runId: 'run-document-prompt-retry-dedup',
            ownerId: 'user-1',
            projectId: 'project-1',
            workspacePath,
            workerType: 'document-author',
            phase: 'DOCUMENT_DRAFTING',
            revision: 'revision-1',
            allowedPaths: [path],
            contract: {
              authoringMode,
              documentSet: 'foundation',
              foundationDocumentPath: path,
              completeDocumentContract: contract,
              ...(authoringMode === 'initial'
                ? { availableUpstreamPaths: contract.upstreamSections.map(source => source.path) }
                : { availableUpstreamPaths: [] }),
            },
          }

          const port = createBeeGameDeliveryWorkerPort({
            sessions,
            userId: 'user-1',
            confirmedBriefContext: '{"kind":"confirmed_build_brief"}',
          })
          await port.start(request)
          await port.submit(dispatchId, buildWorkerPrompt(request))

          expect(countOccurrences(submittedPrompt, reason)).toBe(0)
          expect(submittedPrompt).not.toContain('"priorFailureReason"')
          if (authoringMode === 'parallel-draft')
            expect(submittedPrompt).not.toContain('this initial stream')
          if (path === 'docs/GDD.md')
            expect(submittedPrompt).not.toContain(
              'Use the confirmed brief and document contract directly.',
            )
        }
      }
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('omits brief and authority display metadata for packet workers', async () => {
    for (const workerType of ['foundation-fact-extractor', 'foundation-semantic-reviewer'] as const) {
      let submittedPrompt = ''
      let display: Record<string, unknown> | undefined
      const sessions = {
        start() { return { id: `session-${workerType}` } },
        updateAuthToken() {},
        async sendWithDisplay(_sessionId: string, prompt: string, metadata: Record<string, unknown>) {
          submittedPrompt = prompt
          display = metadata
        },
      } as unknown as BeeGameSessionManager
      const request: WorkerDispatchRequest = {
        dispatchId: `dispatch-${workerType}`,
        runId: 'run-packet', ownerId: 'user-1', projectId: 'project-packet', workspacePath: '/workspace-secret',
        workerType, phase: 'DOCUMENT_REVIEW', taskId: `task-${workerType}`, revision: 'revision-packet', allowedPaths: [], projectReadScope: 'empty',
        contract: {
          workerType, taskId: `task-${workerType}`, revision: 'revision-packet', packetDigest: 'a'.repeat(64), modelTier: workerType === 'foundation-fact-extractor' ? 'fast' : 'balanced',
          packet: workerType === 'foundation-fact-extractor'
            ? {
                revision: 'revision-packet',
                keys: ['audio.event_ids'],
                sections: [{ documentPath: 'docs/AUDIO_DESIGN.md', sectionId: 'event_taxonomy', startLine: 65, endLine: 80, digest: 'b'.repeat(64), text: 'Audio event authority.' }],
                packetDigest: 'a'.repeat(64),
              }
            : { revision: 'revision-packet', keys: ['GDD.player_loop'], sections: [], packetDigest: 'a'.repeat(64) },
          confirmedBriefContext: 'CONFIRMED_BRIEF_SENTINEL',
        },
      }
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
        confirmedBriefContext: 'CONFIRMED_BRIEF_SENTINEL',
        async getConfirmedBriefContext() { throw new Error('packet workers must not load the confirmed brief') },
      })
      await port.start(request)
      await port.submit(request.dispatchId!, 'CONFIRMED_BRIEF_SENTINEL /workspace-secret')
      expect(submittedPrompt).not.toContain('CONFIRMED_BRIEF_SENTINEL')
      expect(submittedPrompt).not.toContain('/workspace-secret')
      expect(submittedPrompt).toContain('Model packet contract')
      expect(display).not.toHaveProperty('confirmedBriefContext')
    }
  })

  test('assigns the atomic planner one structured submission lane', async () => {
    let submittedPrompt = ''
    const sessions = {
      start() {
        return { id: 'session-task-planner' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-task-prompt-'))
    try {
      await port.start({
        dispatchId: 'dispatch-unique-plan',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'atomic-task-planner',
        phase: 'ATOMIC_TASK_PLANNING',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {},
      })
      await port.submit('dispatch-unique-plan', 'Plan the tasks')

      expect(submittedPrompt).toContain('SubmitAtomicTaskPlan exactly once')
      expect(submittedPrompt).toContain(
        'workflow service persists the accepted plan as canonical evidence',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives implementation terminal from one structured submission', async () => {
    let submittedPrompt = ''
    const resultInput = {
      status: 'completed',
      changedPaths: [],
      verificationObservations: ['The scene artifact exists.'],
    }
    const sessions = {
      start() {
        return { id: 'session-implementation' }
      },
      updateAuthToken() {},
      async sendWithDisplay(_sessionId: string, prompt: string) {
        submittedPrompt = prompt
      },
      events() {
        return [
          {
            id: 'event-1',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-result',
              toolName: 'SubmitImplementationResult',
              input: resultInput,
            },
          },
          {
            id: 'event-invalid-later',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'submit-invalid-result',
              toolName: 'SubmitImplementationResult',
              input: {
                ...resultInput,
                verificationObservations: [],
              },
            },
          },
          {
            id: 'event-2',
            type: 'result',
            text: 'Implementation complete.',
            createdAt: new Date(),
            payload: { result: 'Implementation complete.' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })
    await port.start({
      dispatchId: 'dispatch-implementation',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'implementation-worker',
      phase: 'IMPLEMENTATION',
      taskId: 'task-scene',
      revision: 'revision-1',
      allowedPaths: ['src/render/Scene.tsx'],
      contract: {
        task: {
          expectedArtifacts: ['src/render/Scene.tsx'],
          contentIds: [],
          verification: [
            {
              kind: 'file',
              commandOrAction: 'Inspect scene artifact',
              expectedResult: 'The scene exists',
            },
          ],
        },
      },
    })
    await port.submit('dispatch-implementation', 'Implement the scene')

    expect(submittedPrompt).toContain('SubmitImplementationResult exactly once')
    expect(submittedPrompt).toContain(
      "Bee Game Studio's native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged",
    )
    const {
      verificationObservations: _verificationObservations,
      ...terminalInput
    } = resultInput
    expect(await port.waitForTerminal?.('dispatch-implementation')).toEqual({
      workerType: 'implementation-worker',
      taskId: 'task-scene',
      revision: 'revision-1',
      ...terminalInput,
      verifiedArtifacts: ['src/render/Scene.tsx'],
      verificationResults: [
        {
          verificationIndex: 0,
          status: 'passed',
          observations: ['The scene artifact exists.'],
        },
      ],
      evidenceRefs: [
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
      ],
      evidencePath:
        '.beegame/workflow/evidence/implementation-dispatch-implementation.json',
    })
  })

  test('derives validation identity and evidence from the active contract', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'beegame-validation-'))
    const sessions = {
      start() {
        return { id: 'session-auditor' }
      },
      updateAuthToken() {},
      async sendWithDisplay() {},
      events() {
        return [
          {
            id: 'validation-tool',
            type: 'tool.completed',
            text: '',
            createdAt: new Date(),
            payload: {
              toolName: 'SubmitValidationResult',
              input: {
                status: 'failed',
                findings: [
                  {
                    artifactPaths: ['src/game.ts'],
                    description: 'The game entry is disconnected.',
                    requiredAction: 'Connect the game entry.',
                  },
                ],
              },
            },
          },
          {
            id: 'validation-result',
            type: 'result',
            text: '',
            createdAt: new Date(),
            payload: { result: 'done' },
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-audit',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'implementation-auditor',
        phase: 'IMPLEMENTATION_AUDIT',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {
          taskIds: ['task-1'],
          tasks: [
            {
              id: 'task-1',
              allowedPaths: ['src/'],
              checklistIds: ['check-1'],
            },
          ],
          checklistIds: ['check-1'],
          resourceIds: ['resource-1'],
          contentIds: [],
        },
      })
      await port.submit('dispatch-audit', 'Audit implementation')
      const terminal = await port.waitForTerminal?.('dispatch-audit')
      expect(terminal).toEqual({
        workerType: 'implementation-auditor',
        revision: 'revision-1',
        status: 'failed',
        auditedTaskIds: ['task-1'],
        checklistIds: ['check-1'],
        resourceIds: ['resource-1'],
        contentIds: [],
        findings: [
          {
            taskIds: ['task-1'],
            checklistIds: ['check-1'],
            artifactPaths: ['src/game.ts'],
            description: 'The game entry is disconnected.',
            requiredAction: 'Connect the game entry.',
          },
        ],
        evidencePath:
          '.beegame/workflow/evidence/implementation-auditor-dispatch-audit.json',
      })
      expect(
        await readFile(
          join(
            workspacePath,
            '.beegame/workflow/evidence/implementation-auditor-dispatch-audit.json',
          ),
          'utf8',
        ),
      ).toContain('"revision":"revision-1"')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('derives the document terminal from a normal Claude result and assigned file', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-canonical-author-'),
    )
    const sessions = {
      start() {
        return { id: 'session-canonical-author' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'normal-document-result',
            type: 'result' as const,
            text: 'Document complete.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-canonical-author',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          availableUpstreamPaths: [],
        },
      })
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        '# Game Design\n\nCanonical rules.\n',
      )
      await expect(
        port.waitForTerminal?.('dispatch-canonical-author'),
      ).resolves.toEqual({
        workerType: 'document-author',
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        resolvedFindingIds: [],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reports a missing assigned document instead of a missing BeeGame tool', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-missing-author-'),
    )
    const sessions = {
      start() {
        return { id: 'session-missing-author' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'normal-result-without-document',
            type: 'result' as const,
            text: 'Document complete.',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
    try {
      await port.start({
        dispatchId: 'dispatch-missing-author',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision-1',
        allowedPaths: ['docs/GDD.md'],
        contract: {
          authoringMode: 'initial',
          foundationDocumentPath: 'docs/GDD.md',
          availableUpstreamPaths: [],
        },
      })
      await expect(
        port.waitForTerminal?.('dispatch-missing-author'),
      ).rejects.toThrow('document author output is missing: docs/GDD.md')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('classifies exhausted foundation transport recovery as worker needs action', async () => {
    const sessions = {
      start() {
        return { id: 'session-foundation-transport-failure' }
      },
      updateAuthToken() {},
      events() {
        return [
          {
            id: 'foundation-transport-failure',
            type: 'turn.failed' as const,
            text: 'foundation_transport_needs_action: provider completion reason missing',
            createdAt: new Date(),
          },
        ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })

    await port.start({
      dispatchId: 'dispatch-foundation-transport-failure',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        availableUpstreamPaths: [],
      },
    })

    let error: Error | undefined
    try {
      await port.waitForTerminal?.('dispatch-foundation-transport-failure')
    } catch (value) {
      error = value as Error
    }
    expect(error).toMatchObject({
      name: 'WorkerNeedsActionError',
      message: 'foundation_transport_needs_action: provider completion reason missing',
    })
  })

  test('resolves the current auth token for every worker start and submit', async () => {
    const starts: Array<{ authToken?: string }> = []
    const updates: Array<{ sessionId: string; authToken?: string }> = []
    const displays: Array<{ authToken?: string }> = []
    const tokenResolvers: Array<
      ((options?: { forceRefresh?: boolean }) => unknown) | undefined
    > = []
    const sessions = {
      start(input: {
        authToken?: string
        getValidAuthToken?: (options?: { forceRefresh?: boolean }) => unknown
      }) {
        starts.push(input)
        tokenResolvers.push(input.getValidAuthToken)
        return { id: `session-${starts.length}` }
      },
      updateAuthToken(sessionId: string, authToken?: string) {
        updates.push({ sessionId, authToken })
      },
      async sendWithDisplay(
        _sessionId: string,
        _prompt: string,
        display: { authToken?: string },
      ) {
        displays.push(display)
      },
    } as unknown as BeeGameSessionManager
    let authToken = 'author-token'
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
      getAuthToken: () => authToken,
    })
    const request: WorkerDispatchRequest = {
      dispatchId: 'dispatch-1',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-1',
      allowedPaths: ['docs/GDD.md'],
      contract: {
        authoringMode: 'initial',
        foundationDocumentPath: 'docs/GDD.md',
        availableUpstreamPaths: [],
      },
    }

    await port.start(request)
    authToken = 'reviewer-token'
    await port.submit('dispatch-1', 'Review the documents')
    authToken = 'next-phase-token'
    await port.start({
      ...request,
      dispatchId: 'dispatch-2',
      workerType: 'document-author',
      phase: 'DOCUMENT_DRAFTING',
      revision: 'revision-2',
    })

    expect(starts.map(start => start.authToken)).toEqual([
      'author-token',
      'next-phase-token',
    ])
    expect(updates).toEqual([
      { sessionId: 'session-1', authToken: 'reviewer-token' },
    ])
    expect(displays.map(display => display.authToken)).toEqual([
      'reviewer-token',
    ])
    authToken = 'forced-refresh-token'
    expect(await tokenResolvers[1]?.({ forceRefresh: true })).toBe(
      'forced-refresh-token',
    )
  })

  test('derives and persists the atomic task planner terminal from one structured tool call', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'beegame-task-terminal-'),
    )
    const evidencePath =
      '.beegame/workflow/evidence/atomic-task-plan-dispatch-task-plan.json'
    try {
      await mkdir(join(workspacePath, '.beegame/workflow/evidence'), {
        recursive: true,
      })
      const planInput = {
        tasks: [
          {
            id: 'task-1',
            title: 'Create the runtime entry point',
            dependsOn: [],
            allowedPaths: ['src/'],
            expectedArtifacts: ['src/main.ts'],
            resourceIds: [],
            contentIds: [],
            verification: [
              {
                kind: 'build',
                commandOrAction: 'bun run build',
                expectedResult: 'Build exits successfully',
              },
            ],
          },
        ],
        ownership: {
          checklistItems: [{ id: 'check-1', taskId: 'task-1' }],
        },
      }
      const sessions = {
        start() {
          return { id: 'session-task-planner' }
        },
        events() {
          return [
            {
              id: 'event-1',
              type: 'tool.started',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'submit-plan',
                toolName: 'SubmitAtomicTaskPlan',
                input: planInput,
              },
            },
            {
              id: 'event-2',
              type: 'tool.completed',
              text: '',
              createdAt: new Date(),
              payload: {
                toolUseID: 'submit-plan',
                toolName: 'SubmitAtomicTaskPlan',
                input: planInput,
              },
            },
            {
              id: 'event-3',
              type: 'result',
              text: 'Task plan ready.',
              createdAt: new Date(),
              payload: { result: 'Task plan ready.' },
            },
          ]
        },
      } as unknown as BeeGameSessionManager
      const port = createBeeGameDeliveryWorkerPort({
        sessions,
        userId: 'user-1',
      })

      await port.start({
        dispatchId: 'dispatch-task-plan',
        runId: 'run-1',
        ownerId: 'user-1',
        projectId: 'project-1',
        workspacePath,
        workerType: 'atomic-task-planner',
        phase: 'ATOMIC_TASK_PLANNING',
        revision: 'revision-1',
        allowedPaths: ['.beegame/workflow/evidence/'],
        contract: {},
      })

      expect(await port.waitForTerminal?.('dispatch-task-plan')).toMatchObject({
        workerType: 'atomic-task-planner',
        status: 'completed',
        revision: 'revision-1',
        evidencePath,
        tasks: [
          {
            id: 'task-1',
            contentIds: [],
            expectedArtifacts: ['src/main.ts'],
          },
        ],
      })
      expect(
        JSON.parse(await readFile(join(workspacePath, evidencePath), 'utf8')),
      ).toMatchObject({
        workerType: 'atomic-task-planner',
        tasks: [{ id: 'task-1' }],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reports an in-flight inventory commit as unsafe to interrupt', async () => {
    const events: Array<{
      id: string
      type: 'tool.started' | 'tool.completed'
      text: string
      createdAt: Date
      payload: {
        toolUseID: string
        toolName: string
        input: Record<string, unknown>
      }
    }> = [
      {
        id: 'event-import-started',
        type: 'tool.started' as const,
        text: '',
        createdAt: new Date(),
        payload: {
          toolUseID: 'import-batch',
          toolName: 'CommitResourceInventory',
          input: { decisions: [] },
        },
      },
    ]
    const sessions = {
      start() {
        return { id: 'session-resource-import' }
      },
      events() {
        return events
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })

    await port.start({
      dispatchId: 'dispatch-resource-import',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.hasInFlightMutation?.('dispatch-resource-import'),
    ).resolves.toBe(true)
    events.push({
      id: 'event-import-completed',
      type: 'tool.completed',
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'import-batch',
        toolName: 'CommitResourceInventory',
        input: { decisions: [] },
      },
    })
    await expect(
      port.hasInFlightMutation?.('dispatch-resource-import'),
    ).resolves.toBe(false)
  })

  test('does not classify rejected unsupported resource calls as catalog reads', async () => {
    const rejectedOutput = 'Unsupported ResourceLibrary action.'
    const rejectedEvents = Array.from({ length: 4 }, (_, index) => ({
      id: `event-${index}`,
      type: 'tool.failed' as const,
      text: rejectedOutput,
      createdAt: new Date(),
      payload: {
        toolUseID: `unsupported-${index}`,
        toolName: 'ResourceLibrary',
        input: {
          action: 'unsupported_action',
        },
        output: rejectedOutput,
      },
    }))
    let reads = 0
    const sessions = {
      start() {
        return { id: 'session-resource-rejected-parallel' }
      },
      events() {
        reads += 1
        return reads === 1
          ? rejectedEvents
          : [
              ...rejectedEvents,
              {
                id: 'terminal-failure',
                type: 'turn.failed' as const,
                text: 'model turn ended after rejected calls',
                createdAt: new Date(),
              },
            ]
      },
    } as unknown as BeeGameSessionManager
    const port = createBeeGameDeliveryWorkerPort({
      sessions,
      userId: 'user-1',
    })

    await port.start({
      dispatchId: 'dispatch-resource-rejected-parallel',
      runId: 'run-1',
      ownerId: 'user-1',
      projectId: 'project-1',
      workspacePath: '/tmp/project-1',
      workerType: 'resource-curator',
      phase: 'RESOURCE_PREPARATION',
      revision: 'revision-1',
      contract: {},
    })

    await expect(
      port.waitForTerminal?.('dispatch-resource-rejected-parallel'),
    ).rejects.toThrow('model turn ended after rejected calls')
  })

})

async function createResourceWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'beegame-resource-terminal-'))
}

function resourcePlanManifest() {
  return {
    version: 8 as const,
    project_target: {
      asset_format_capabilities: ['dat', 'json'],
      resource_library_usage: 'optional' as const,
      runtime_asset_root: 'assets/runtime',
      content_root: 'assets/content',
      generated_asset_root: 'assets/generated',
    },
    requirements: [
      {
        id: 'world.visual',
        required: true,
        acquisition_profile: {
          dimensions: ['agnostic' as const],
          asset_kinds: ['data' as const],
          usage_tags: [],
          capabilities: [],
          styles: [],
        },
      },
    ],
    resources: [],
  }
}

async function runResourceTerminal(input: {
  workspacePath: string
  workerType:
    | 'resource-planner'
    | 'resource-curator'
    | 'resource-content-author'
  toolName:
    | 'AssetManifest'
    | 'CommitResourceInventory'
    | 'CommitResourceContent'
  toolInput: Record<string, unknown>
  contract?: Record<string, unknown>
  catalogObserved?: boolean
}) {
  const events = [
    ...(input.catalogObserved
      ? [
          {
            id: 'resource-catalog-tool',
            type: 'tool.completed' as const,
            text: '',
            createdAt: new Date(),
            payload: {
              toolUseID: 'resource-catalog-tool',
              toolName: 'ResourceLibrary',
              input: { action: 'match_requirements' },
              output: JSON.stringify({ groups: [] }),
            },
          },
        ]
      : []),
    {
      id: 'resource-terminal-tool',
      type: 'tool.completed' as const,
      text: '',
      createdAt: new Date(),
      payload: {
        toolUseID: 'resource-terminal-tool',
        toolName: input.toolName,
        input: input.toolInput,
      },
    },
    {
      id: 'resource-terminal-result',
      type: 'result' as const,
      text: 'completed',
      createdAt: new Date(),
    },
  ]
  const sessions = {
    start() {
      return { id: `session-${input.workerType}` }
    },
    events() {
      return events
    },
  } as unknown as BeeGameSessionManager
  const port = createBeeGameDeliveryWorkerPort({ sessions, userId: 'user-1' })
  await port.start({
    dispatchId: `dispatch-${input.workerType}`,
    runId: 'run-resource-terminal',
    ownerId: 'user-1',
    projectId: 'project-resource-terminal',
    workspacePath: input.workspacePath,
    workerType: input.workerType,
    phase: 'RESOURCE_PREPARATION',
    revision: 'revision-resource-terminal',
    contract: input.contract ?? {},
  })
  return port.waitForTerminal!(`dispatch-${input.workerType}`)
}

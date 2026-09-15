import { isAbsolute } from 'node:path'
import { z } from 'zod/v4'
import type { ReviewerReviewResult } from '../foundation-reviewer/public'
import type { RuntimeConfigurationClient } from '../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../billing/public'
import { createGameIrLifecycle } from './private/lifecycle'
import { gameIrReadyReceiptSchema } from './private/core/contracts'

export type GameIrConfiguration = Readonly<{ workspacePath: string }>
export type GameIrInfrastructure = Readonly<{
  runtimeConfiguration: RuntimeConfigurationClient
  billing: UsageBillingClient
}>

export type GameIrStartInput = Readonly<{
  protocolVersion: 1
  ownerId: string
  projectId: string
  requestId: string
  acceptedReview: ReviewerReviewResult
  publishedDocumentRevision: string
}>

export type GameIrHandle = Readonly<{
  protocolVersion: 1
  producer: 'game-ir'
  id: string
}>

export type GameIrProgress = Readonly<{
  operation?: string
  completedOperations: number
  totalOperations: number
  message: string
}>

export type GameIrReadyResult = import('./private/core/contracts').GameIrReadyReceipt
export type GameIrPublishedView = import('./private/reader').GameIrPublishedView

export type GameIrResult = (
  | { status: 'running' | 'stopped'; handle: GameIrHandle }
  | { status: 'needs_action'; handle: GameIrHandle; reason: string; resumable: boolean }
  | { status: 'failed'; handle: GameIrHandle; code: string; reason: string }
  | { status: 'completed'; handle: GameIrHandle; result: GameIrReadyResult }
) & {
  billingStatus: 'pending' | 'settled'
  progress?: GameIrProgress
  elapsedMs?: number
}

export type GameIrResumeInput = Readonly<{ handle: GameIrHandle; requestId: string }>
export type GameIrStopInput = GameIrResumeInput & Readonly<{ reason: string }>

export const gameIrHandleSchema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('game-ir'), id: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
const progressSchema = z.object({ operation: z.string().optional(), completedOperations: z.number().int().nonnegative(),
  totalOperations: z.number().int().nonnegative(), message: z.string() }).strict().optional()
const resultBase = {
  handle: gameIrHandleSchema,
  billingStatus: z.enum(['pending', 'settled']),
  progress: progressSchema,
  elapsedMs: z.number().int().nonnegative().optional(),
} as const
export const gameIrResultSchema = z.discriminatedUnion('status', [
  z.object({ ...resultBase, status: z.enum(['running', 'stopped']) }).strict(),
  z.object({ ...resultBase, status: z.literal('needs_action'), reason: z.string(), resumable: z.boolean() }).strict(),
  z.object({ ...resultBase, status: z.literal('failed'), code: z.string(), reason: z.string() }).strict(),
  z.object({ ...resultBase, status: z.literal('completed'), result: gameIrReadyReceiptSchema }).strict(),
]) as unknown as z.ZodType<GameIrResult>
export function parseGameIrResult(value: unknown): GameIrResult {
  return gameIrResultSchema.parse(structuredClone(value)) as GameIrResult
}

export type GameIrOperations = Readonly<{
  start(input: GameIrStartInput): Promise<GameIrHandle>
  getResult(handle: GameIrHandle): Promise<GameIrResult>
  resume(input: GameIrResumeInput): Promise<GameIrResult>
  stop(input: GameIrStopInput): Promise<GameIrResult>
  readResult(input: Readonly<{ handle: GameIrHandle; foundationRevision: string }>): Promise<GameIrPublishedView>
}>

/** Public boundary: only the four lifecycle operations and a verified result reader escape. */
export function createGameIrStage(
  config: GameIrConfiguration,
  infrastructure: GameIrInfrastructure,
): GameIrOperations {
  const parsed = z.object({ workspacePath: z.string().min(1) }).strict().parse(config)
  if (!isAbsolute(parsed.workspacePath)) throw new Error('Game IR workspace must be absolute')
  const operations = createGameIrLifecycle(parsed.workspacePath, infrastructure)
  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch { throw new Error('Game IR operation could not be accepted or safely completed') }
  }
  return Object.freeze({
    start: input => invoke(() => operations.start(input)),
    getResult: handle => invoke(() => operations.getResult(handle)),
    resume: input => invoke(() => operations.resume(input)),
    stop: input => invoke(() => operations.stop(input)),
    readResult: input => invoke(() => operations.readResult(input)),
  })
}

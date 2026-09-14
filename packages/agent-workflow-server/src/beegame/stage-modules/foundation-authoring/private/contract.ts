import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { authorExecutionLimitsSchema } from './execution-budget'

const identity = z.string().min(1).max(256)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
export const authorStartSchema = z.strictObject({
  protocolVersion: z.literal(1),
  requestId: identity,
  ownerId: identity,
  projectId: identity,
  inputDigest: digest,
  input: z.strictObject({
    confirmedBrief: z.string().min(1),
    confirmedBriefDigest: digest,
    changeRequest: z.string().min(1).optional(),
  }),
})
export const authorHandleSchema = z.strictObject({
  protocolVersion: z.literal(1),
  producer: z.literal('foundation-authoring'),
  id: z.string().uuid(),
})
export const authorResumeSchema = z.strictObject({
  handle: authorHandleSchema,
  requestId: identity,
})
export const authorStopSchema = authorResumeSchema.extend({ reason: z.string().min(1).max(2000) })

export type AuthorStartInput = z.infer<typeof authorStartSchema>
export type AuthorHandle = z.infer<typeof authorHandleSchema>
export type AuthorResumeInput = z.infer<typeof authorResumeSchema>
export type AuthorStopInput = z.infer<typeof authorStopSchema>
export type AuthorConfiguration = {
  workspacePath: string
  privateRootPath: string
  language?: string
  executionLimits?: import('./execution-budget').AuthorExecutionLimits
  model: { command: string[]; env: Record<string, string> }
}
export type AuthorDocumentArtifact = {
  path: string
  digest: string
  byteLength: number
  artifactPath: string
}
export type AuthorDocumentsResult = {
  protocolVersion: 1
  producer: 'foundation-authoring'
  kind: 'foundation_documents'
  resultId: string
  inputDigest: string
  ownerId: string
  projectId: string
  confirmedBriefDigest: string
  documents: AuthorDocumentArtifact[]
  documentRevision: string
  workspaceRevision: string
  receiptSetDigest: string
}
export type AuthorResult = (
  | { status: 'running'; handle: AuthorHandle }
  | { status: 'stopped'; handle: AuthorHandle }
  | { status: 'needs_action'; handle: AuthorHandle; reason: string; resumable: boolean }
  | { status: 'failed'; handle: AuthorHandle; code: string; reason: string }
  | { status: 'completed'; handle: AuthorHandle; result: AuthorDocumentsResult }
) & { billingStatus?: 'pending' | 'settled'; progress?: { modelResponses: number; message: string };
  timing?: { currentCallElapsedMs: number; historicalElapsedMs: number } }
export type AuthorOperations = {
  start(input: AuthorStartInput): Promise<AuthorHandle>
  resume(input: AuthorResumeInput): Promise<AuthorHandle>
  stop(input: AuthorStopInput): Promise<AuthorResult>
  getResult(handle: AuthorHandle): Promise<AuthorResult>
}
export type AuthorUsage = {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  total_tokens: number
}

/** Canonical encoding: sorted object keys, array order preserved, UTF-8 JSON. */
export function canonicalAuthorJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorJson).join(',')}]`
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalAuthorJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  throw new Error('author contract requires finite JSON data')
}
export function authorDigest(value: unknown): string {
  return createHash('sha256').update(canonicalAuthorJson(value)).digest('hex')
}
export function parseAuthorStart(value: unknown): AuthorStartInput {
  const parsed = authorStartSchema.parse(value)
  if (createHash('sha256').update(parsed.input.confirmedBrief).digest('hex') !== parsed.input.confirmedBriefDigest)
    throw new Error('confirmed brief digest mismatch')
  if (authorDigest({ ownerId: parsed.ownerId, projectId: parsed.projectId, input: parsed.input }) !== parsed.inputDigest)
    throw new Error('author input digest mismatch')
  return parsed
}
export function parseAuthorConfiguration(value: unknown): AuthorConfiguration {
  return z.strictObject({
    workspacePath: z.string().refine(isAbsolute, 'workspacePath must be absolute'),
    privateRootPath: z.string().refine(isAbsolute, 'privateRootPath must be absolute'),
    language: z.string().min(1).optional(),
    executionLimits: authorExecutionLimitsSchema.optional(),
    model: z.strictObject({
      command: z.array(z.string().min(1)).min(1),
      env: z.record(z.string(), z.string()),
    }),
  }).parse(value)
}

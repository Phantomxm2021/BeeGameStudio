import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ResourceLibraryUsage } from '@bee-game-studio/beegame-resource-core'

export type ConfirmedBriefEvidence = {
  version: 1
  sessionId: string
  contextDigest: string
  resourceLibraryUsage: ResourceLibraryUsage
  documentLanguage: string
  gameUserVisibleLanguage: string
  agentResponseLanguage: string
  createdAt: string
}

/**
 * Persists only user-confirmed product facts. This record is not an Agent
 * phase or workflow state; generated files and summaries cannot replace it.
 */
export function recordConfirmedBriefEvidence(input: {
  dataRoot: string
  sessionId: string
  confirmedBriefContext: string
  createdAt: Date
}): ConfirmedBriefEvidence {
  const brief = parseConfirmedBrief(input.confirmedBriefContext)
  const evidence: ConfirmedBriefEvidence = {
    version: 1,
    sessionId: input.sessionId,
    contextDigest: createHash('sha256')
      .update(input.confirmedBriefContext.trim())
      .digest('hex'),
    resourceLibraryUsage: brief.resourceLibraryUsage,
    documentLanguage: brief.documentLanguage,
    gameUserVisibleLanguage: brief.gameUserVisibleLanguage,
    agentResponseLanguage: brief.agentResponseLanguage,
    createdAt: input.createdAt.toISOString(),
  }
  const path = evidencePath(input.dataRoot, input.sessionId)
  const temporary = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  try {
    writeFileSync(temporary, `${JSON.stringify(evidence)}\n`, 'utf8')
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
  return evidence
}

export function getConfirmedBriefEvidence(input: {
  dataRoot: string
  sessionId: string
}): ConfirmedBriefEvidence | undefined {
  const path = evidencePath(input.dataRoot, input.sessionId)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!isRecord(value) || value.version !== 1 || value.sessionId !== input.sessionId) return undefined
    const resourceLibraryUsage = parseResourceLibraryUsage(value.resourceLibraryUsage)
    const contextDigest = stringValue(value.contextDigest)
    const createdAt = stringValue(value.createdAt)
    const documentLanguage = stringValue(value.documentLanguage)
    const gameUserVisibleLanguage = stringValue(value.gameUserVisibleLanguage)
    const agentResponseLanguage = stringValue(value.agentResponseLanguage)
    if (
      !resourceLibraryUsage ||
      !contextDigest ||
      !createdAt ||
      !documentLanguage ||
      !gameUserVisibleLanguage ||
      !agentResponseLanguage
    ) return undefined
    return {
      version: 1,
      sessionId: input.sessionId,
      contextDigest,
      resourceLibraryUsage,
      documentLanguage,
      gameUserVisibleLanguage,
      agentResponseLanguage,
      createdAt,
    }
  } catch {
    return undefined
  }
}

function parseConfirmedBrief(value: string): {
  resourceLibraryUsage: ResourceLibraryUsage
  documentLanguage: string
  gameUserVisibleLanguage: string
  agentResponseLanguage: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Confirmed brief context must be valid JSON')
  }
  if (!isRecord(parsed) || parsed.kind !== 'confirmed_build_brief') {
    throw new Error('Confirmed brief context has an invalid kind')
  }
  const resourceLibraryUsage = parseResourceLibraryUsage(parsed.resource_library_usage)
  if (!resourceLibraryUsage) {
    throw new Error('Confirmed brief context has an invalid resource_library_usage')
  }
  const documentLanguage = stringValue(parsed.document_language)
  const gameUserVisibleLanguage = stringValue(parsed.game_user_visible_language)
  const agentResponseLanguage = stringValue(parsed.agent_response_language)
  if (!documentLanguage || !gameUserVisibleLanguage || !agentResponseLanguage) {
    throw new Error('Confirmed brief context must contain explicit response, document, and player-visible languages')
  }
  return {
    resourceLibraryUsage,
    documentLanguage,
    gameUserVisibleLanguage,
    agentResponseLanguage,
  }
}

function evidencePath(dataRoot: string, sessionId: string): string {
  return join(dataRoot, 'confirmed-brief-evidence', `${sessionId}.json`)
}

function parseResourceLibraryUsage(value: unknown): ResourceLibraryUsage | undefined {
  return value === 'optional' || value === 'preferred' || value === 'required'
    ? value
    : undefined
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

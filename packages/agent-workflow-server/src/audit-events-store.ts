import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STORE_FILE = 'audit-events.jsonl'

export type BeeGameAuditEvent = {
  id: string
  actorId: string
  action: string
  targetType: string
  targetId: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type AuditEventsStoreOptions = {
  dataDir?: string
}

export type AppendAuditEventInput = Omit<BeeGameAuditEvent, 'id' | 'createdAt'> & {
  projectReference?: 'linked' | 'detached'
}

export function getDefaultAuditEventsStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function appendAuditEvent(
  input: AppendAuditEventInput,
  options: AuditEventsStoreOptions = {},
): BeeGameAuditEvent {
  const event: BeeGameAuditEvent = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: new Date().toISOString(),
  }
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  return event
}

export function listAuditEvents(
  options: AuditEventsStoreOptions = {},
): BeeGameAuditEvent[] {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => normalizeAuditEvent(JSON.parse(line)))
    .filter((event): event is BeeGameAuditEvent => event !== undefined)
}

function normalizeAuditEvent(value: unknown): BeeGameAuditEvent | undefined {
  if (!isRecord(value)) return undefined
  const id = stringField(value.id)
  const actorId = stringField(value.actorId)
  const action = stringField(value.action)
  const targetType = stringField(value.targetType)
  const targetId = stringField(value.targetId)
  const createdAt = stringField(value.createdAt)
  if (!id || !actorId || !action || !targetType || !targetId || !createdAt) {
    return undefined
  }
  return {
    id,
    actorId,
    action,
    targetType,
    targetId,
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
    createdAt,
  }
}

function getStoreFilePath(options: AuditEventsStoreOptions): string {
  return join(options.dataDir ?? getDefaultAuditEventsStoreDir(), STORE_FILE)
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

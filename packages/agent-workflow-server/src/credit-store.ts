import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const STORE_FILE = 'credits.json'
export const DEFAULT_FREE_CREDITS = 300
export const CREDIT_UNIT_WEIGHTED_TOKENS = 10_000

export type CreditEstimateRange = {
  minCredits: number
  maxCredits: number
}

export type CreditBalance = {
  userId: string
  plan: 'free'
  balanceCredits: number
  includedCredits: number
  consumedCredits: number
  reservedCredits: number
  creditUnitWeightedTokens: number
  estimates: {
    ideaIntake: CreditEstimateRange
    planningDocs: CreditEstimateRange
    smallPlayableGame: CreditEstimateRange
    standardGame: CreditEstimateRange
    complexGame: CreditEstimateRange
  }
}

type CreditStorePayload = {
  version: 1
  accounts: Record<string, CreditAccountRecord>
  ledger?: CreditLedgerRecord[]
}

type CreditAccountRecord = {
  plan?: 'free'
  includedCredits?: number
  consumedCredits?: number
  reservedCredits?: number
}

export type CreditLedgerKind =
  | 'estimate'
  | 'reserve'
  | 'settle'
  | 'grant'
  | 'refund'

export type CreditLedgerEntry = {
  id: string
  userId: string
  kind: CreditLedgerKind
  credits: number
  projectId?: string
  reservationId?: string
  weightedTokens?: number
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreditLedgerSummary = {
  entriesCount: number
  reservedCredits: number
  settledCredits: number
  refundedCredits: number
  outstandingReservedCredits: number
  weightedTokens: number
}

export type CreditLedgerFilters = {
  userId?: string
  projectId?: string
  kind?: CreditLedgerKind
  reservationId?: string
}

export type CreditAuditLedger = {
  entries: CreditLedgerEntry[]
  summary: CreditLedgerSummary
}

type CreditLedgerRecord = {
  id?: string
  userId?: string
  kind?: CreditLedgerKind
  credits?: number
  projectId?: string
  reservationId?: string
  weightedTokens?: number
  metadata?: Record<string, unknown>
  createdAt?: string
}

export type CreditStoreOptions = {
  dataDir: string
}

export type CreditGrant = {
  grantedCredits: number
  balance: CreditBalance
}

export function getCreditBalance(
  userId: string,
  options: CreditStoreOptions,
): CreditBalance {
  const payload = loadCreditStore(options)
  const account = payload.accounts[userId] ?? {}
  const includedCredits = normalizeNonNegativeNumber(
    account.includedCredits,
    getDefaultFreeCredits(),
  )
  const consumedCredits = normalizeNonNegativeNumber(account.consumedCredits, 0)
  const reservedCredits = normalizeNonNegativeNumber(account.reservedCredits, 0)
  const balanceCredits = Math.max(
    0,
    includedCredits - consumedCredits - reservedCredits,
  )
  if (!payload.accounts[userId]) {
    payload.accounts[userId] = {
      plan: 'free',
      includedCredits,
      consumedCredits,
      reservedCredits,
    }
    saveCreditStore(payload, options)
  }
  return {
    userId,
    plan: 'free',
    balanceCredits,
    includedCredits,
    consumedCredits,
    reservedCredits,
    creditUnitWeightedTokens: CREDIT_UNIT_WEIGHTED_TOKENS,
    estimates: getCreditEstimates(),
  }
}

export function hasEnoughCreditsForIdeaIntake(balance: CreditBalance): boolean {
  return balance.balanceCredits >= balance.estimates.ideaIntake.minCredits
}

export function grantCredits(
  userId: string,
  options: CreditStoreOptions & {
    credits: number
    metadata?: Record<string, unknown>
    now?: Date
  },
): CreditGrant {
  const credits = normalizePositiveCreditAmount(options.credits)
  const payload = loadCreditStore(options)
  const account = ensureCreditAccount(payload, userId)
  account.includedCredits =
    normalizeNonNegativeNumber(
      account.includedCredits,
      getDefaultFreeCredits(),
    ) + credits
  appendLedgerRecord(payload, {
    userId,
    kind: 'grant',
    credits,
    metadata: options.metadata ?? { source: 'manual' },
    ...(options.now ? { createdAt: options.now.toISOString() } : {}),
  })
  saveCreditStore(payload, options)
  return {
    grantedCredits: credits,
    balance: deriveCreditBalance(userId, account),
  }
}

export function listCreditLedger(
  userId: string,
  options: CreditStoreOptions,
): CreditLedgerEntry[] {
  return normalizeLedger(loadCreditStore(options)).filter(
    entry => entry.userId === userId,
  )
}

export function listCreditAuditLedger(options: {
  dashboardDataRoot: string
  filters?: CreditLedgerFilters
}): CreditAuditLedger {
  const entries = listLocalCreditDataDirs(options.dashboardDataRoot)
    .flatMap(dataDir => normalizeLedger(loadCreditStore({ dataDir })))
    .filter(entry => matchesCreditLedgerFilters(entry, options.filters))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return {
    entries,
    summary: summarizeCreditLedgerEntries(entries),
  }
}

export function summarizeCreditLedger(
  userId: string,
  options: CreditStoreOptions & {
    projectId?: string
  },
): CreditLedgerSummary {
  const entries = normalizeLedger(loadCreditStore(options)).filter(
    entry =>
      entry.userId === userId &&
      (!options.projectId || entry.projectId === options.projectId),
  )
  return summarizeCreditLedgerEntries(entries)
}

function sumCreditKind(
  entries: CreditLedgerEntry[],
  kind: CreditLedgerKind,
): number {
  return entries
    .filter(entry => entry.kind === kind)
    .reduce((sum, entry) => sum + entry.credits, 0)
}

export function summarizeCreditLedgerEntries(
  entries: CreditLedgerEntry[],
): CreditLedgerSummary {
  const reservedCredits = sumCreditKind(entries, 'reserve')
  const settledCredits = sumCreditKind(entries, 'settle')
  const refundedCredits = sumCreditKind(entries, 'refund')
  return {
    entriesCount: entries.length,
    reservedCredits,
    settledCredits,
    refundedCredits,
    outstandingReservedCredits: Math.max(
      0,
      reservedCredits - settledCredits - refundedCredits,
    ),
    weightedTokens: entries.reduce(
      (sum, entry) => sum + normalizeNonNegativeNumber(entry.weightedTokens, 0),
      0,
    ),
  }
}

function matchesCreditLedgerFilters(
  entry: CreditLedgerEntry,
  filters: CreditLedgerFilters | undefined,
): boolean {
  return (
    (!filters?.userId || entry.userId === filters.userId) &&
    (!filters?.projectId || entry.projectId === filters.projectId) &&
    (!filters?.kind || entry.kind === filters.kind) &&
    (!filters?.reservationId || entry.reservationId === filters.reservationId)
  )
}

function listLocalCreditDataDirs(dashboardDataRoot: string): string[] {
  const dataDirs: string[] = []
  if (existsSync(getStoreFilePath({ dataDir: dashboardDataRoot }))) {
    dataDirs.push(dashboardDataRoot)
  }
  const usersRoot = join(dashboardDataRoot, 'users')
  if (!existsSync(usersRoot)) return dataDirs
  for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dataDir = join(usersRoot, entry.name)
    if (existsSync(getStoreFilePath({ dataDir }))) dataDirs.push(dataDir)
  }
  return dataDirs
}

export function getCreditEstimates(): CreditBalance['estimates'] {
  return {
    ideaIntake: { minCredits: 3, maxCredits: 3 },
    planningDocs: { minCredits: 8, maxCredits: 30 },
    smallPlayableGame: { minCredits: 80, maxCredits: 200 },
    standardGame: { minCredits: 200, maxCredits: 600 },
    complexGame: { minCredits: 600, maxCredits: 1500 },
  }
}

function ensureCreditAccount(
  payload: CreditStorePayload,
  userId: string,
): CreditAccountRecord {
  const account = payload.accounts[userId] ?? {}
  const normalized = {
    plan: 'free' as const,
    includedCredits: normalizeNonNegativeNumber(
      account.includedCredits,
      getDefaultFreeCredits(),
    ),
    consumedCredits: normalizeNonNegativeNumber(account.consumedCredits, 0),
    reservedCredits: normalizeNonNegativeNumber(account.reservedCredits, 0),
  }
  payload.accounts[userId] = normalized
  return normalized
}

function deriveCreditBalance(
  userId: string,
  account: CreditAccountRecord,
): CreditBalance {
  const includedCredits = normalizeNonNegativeNumber(
    account.includedCredits,
    getDefaultFreeCredits(),
  )
  const consumedCredits = normalizeNonNegativeNumber(account.consumedCredits, 0)
  const reservedCredits = normalizeNonNegativeNumber(account.reservedCredits, 0)
  return {
    userId,
    plan: 'free',
    balanceCredits: Math.max(
      0,
      includedCredits - consumedCredits - reservedCredits,
    ),
    includedCredits,
    consumedCredits,
    reservedCredits,
    creditUnitWeightedTokens: CREDIT_UNIT_WEIGHTED_TOKENS,
    estimates: getCreditEstimates(),
  }
}

function appendLedgerRecord(
  payload: CreditStorePayload,
  record: Omit<CreditLedgerEntry, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  },
): void {
  payload.ledger = [
    ...(Array.isArray(payload.ledger) ? payload.ledger : []),
    {
      id: record.id ?? randomUUID(),
      userId: record.userId,
      kind: record.kind,
      credits: record.credits,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      ...(record.reservationId ? { reservationId: record.reservationId } : {}),
      ...(typeof record.weightedTokens === 'number'
        ? { weightedTokens: record.weightedTokens }
        : {}),
      metadata: record.metadata,
      createdAt: record.createdAt ?? new Date().toISOString(),
    },
  ]
}

function normalizeLedger(payload: CreditStorePayload): CreditLedgerEntry[] {
  return Array.isArray(payload.ledger)
    ? payload.ledger
        .filter(
          record =>
            typeof record.id === 'string' &&
            typeof record.userId === 'string' &&
            isCreditLedgerKind(record.kind) &&
            typeof record.credits === 'number' &&
            Number.isFinite(record.credits),
        )
        .map(record => ({
          id: record.id!,
          userId: record.userId!,
          kind: record.kind!,
          credits: Math.max(0, Math.floor(record.credits!)),
          ...(typeof record.projectId === 'string'
            ? { projectId: record.projectId }
            : {}),
          ...(typeof record.reservationId === 'string'
            ? { reservationId: record.reservationId }
            : {}),
          ...(typeof record.weightedTokens === 'number' &&
          Number.isFinite(record.weightedTokens)
            ? { weightedTokens: Math.max(0, Math.floor(record.weightedTokens)) }
            : {}),
          metadata: isRecord(record.metadata) ? record.metadata : {},
          createdAt:
            typeof record.createdAt === 'string'
              ? record.createdAt
              : new Date(0).toISOString(),
        }))
    : []
}

export function isCreditLedgerKind(value: unknown): value is CreditLedgerKind {
  return (
    value === 'estimate' ||
    value === 'reserve' ||
    value === 'settle' ||
    value === 'grant' ||
    value === 'refund'
  )
}

export function getDefaultFreeCredits(): number {
  return normalizeNonNegativeNumber(
    Number.parseInt(process.env.BEEGAME_FREE_CREDITS ?? '', 10),
    DEFAULT_FREE_CREDITS,
  )
}

function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback
}

function normalizePositiveCreditAmount(value: unknown): number {
  const normalized = normalizeNonNegativeNumber(value, 0)
  if (normalized <= 0) throw new Error('Credit amount must be positive')
  return normalized
}

function loadCreditStore(options: CreditStoreOptions): CreditStorePayload {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) {
    return {
      version: 1,
      accounts: {},
      ledger: [],
    }
  }
  const payload = JSON.parse(
    readFileSync(filePath, 'utf8'),
  ) as CreditStorePayload
  if (payload.version !== 1 || !isRecord(payload.accounts)) {
    throw new Error('Unsupported credit store format')
  }
  if (!Array.isArray(payload.ledger)) payload.ledger = []
  return payload
}

function saveCreditStore(
  payload: CreditStorePayload,
  options: CreditStoreOptions,
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function getStoreFilePath(options: CreditStoreOptions): string {
  return join(options.dataDir, STORE_FILE)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

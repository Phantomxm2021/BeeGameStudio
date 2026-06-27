import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const STORE_FILE = 'credits.json'
const DEFAULT_FREE_CREDITS = 300
const CREDIT_UNIT_WEIGHTED_TOKENS = 10_000

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
}

type CreditAccountRecord = {
  plan?: 'free'
  includedCredits?: number
  consumedCredits?: number
  reservedCredits?: number
}

export type CreditStoreOptions = {
  dataDir: string
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
  const balanceCredits = Math.max(0, includedCredits - consumedCredits - reservedCredits)
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

export function hasEnoughCreditsForIdeaIntake(
  balance: CreditBalance,
): boolean {
  return balance.balanceCredits >= balance.estimates.ideaIntake.minCredits
}

function getCreditEstimates(): CreditBalance['estimates'] {
  return {
    ideaIntake: { minCredits: 1, maxCredits: 3 },
    planningDocs: { minCredits: 8, maxCredits: 30 },
    smallPlayableGame: { minCredits: 80, maxCredits: 200 },
    standardGame: { minCredits: 200, maxCredits: 600 },
    complexGame: { minCredits: 600, maxCredits: 1500 },
  }
}

function getDefaultFreeCredits(): number {
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

function loadCreditStore(options: CreditStoreOptions): CreditStorePayload {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) {
    return {
      version: 1,
      accounts: {},
    }
  }
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as CreditStorePayload
  if (payload.version !== 1 || !isRecord(payload.accounts)) {
    throw new Error('Unsupported credit store format')
  }
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

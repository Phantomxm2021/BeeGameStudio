import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecordUsageResult } from './usage-billing'

const WALLET_FILE = 'realtime-usage-wallet.json'
const INITIAL_CREDITS_MICRO = 300 * 1_000_000

type WalletAccount = {
  includedCreditsMicro: number
  consumedCreditsMicro: number
  debits: Record<string, number>
}

type WalletStore = {
  version: 1
  accounts: Record<string, WalletAccount>
}

export type RealtimeUsageWallet = {
  userId: string
  includedCreditsMicro: number
  consumedCreditsMicro: number
  balanceCreditsMicro: number
}

export type CreditBalance = RealtimeUsageWallet & {
  plan: 'free'
  balanceCredits: number
  includedCredits: number
  consumedCredits: number
  creditUnitWeightedTokens: number
  estimates: Record<string, { minCredits: number; maxCredits: number }>
}

export type CreditGrant = {
  grantedCredits: number
  balance: CreditBalance
}

export function grantLocalRealtimeCredits(input: {
  dataDir: string
  userId: string
  credits: number
  idempotencyKey?: string
}): RealtimeUsageWallet {
  const store = loadWallet(input.dataDir)
  const account = store.accounts[input.userId] ?? {
    includedCreditsMicro: INITIAL_CREDITS_MICRO,
    consumedCreditsMicro: 0,
    debits: {},
  }
  const amountMicro = Math.max(0, Math.round(input.credits * 1_000_000))
  if (input.idempotencyKey && account.debits[`grant:${input.idempotencyKey}`] !== undefined) {
    store.accounts[input.userId] = account
    saveWallet(input.dataDir, store)
    return getLocalRealtimeUsageWallet(input)
  }
  account.includedCreditsMicro += amountMicro
  if (input.idempotencyKey) account.debits[`grant:${input.idempotencyKey}`] = amountMicro
  store.accounts[input.userId] = account
  saveWallet(input.dataDir, store)
  return getLocalRealtimeUsageWallet(input)
}

export function debitLocalRealtimeUsage(input: {
  dataDir: string
  userId: string
  idempotencyKey: string
  usage: RecordUsageResult
}): RecordUsageResult {
  const store = loadWallet(input.dataDir)
  const account = store.accounts[input.userId] ?? {
    includedCreditsMicro: INITIAL_CREDITS_MICRO,
    consumedCreditsMicro: 0,
    debits: {},
  }
  const existingDebit = account.debits[input.idempotencyKey]
  if (existingDebit !== undefined) {
    saveWallet(input.dataDir, store)
    return { ...input.usage, duplicate: true }
  }
  const amount = Math.max(0, input.usage.event.creditsMicro)
  const available = account.includedCreditsMicro - account.consumedCreditsMicro
  if (available < amount) throw new Error('Insufficient realtime usage credits')
  account.consumedCreditsMicro += amount
  account.debits[input.idempotencyKey] = amount
  store.accounts[input.userId] = account
  saveWallet(input.dataDir, store)
  return input.usage
}

export function getLocalRealtimeUsageWallet(input: {
  dataDir: string
  userId: string
}): RealtimeUsageWallet {
  const store = loadWallet(input.dataDir)
  const account = store.accounts[input.userId] ?? {
    includedCreditsMicro: INITIAL_CREDITS_MICRO,
    consumedCreditsMicro: 0,
    debits: {},
  }
  return {
    userId: input.userId,
    includedCreditsMicro: account.includedCreditsMicro,
    consumedCreditsMicro: account.consumedCreditsMicro,
    balanceCreditsMicro: Math.max(
      0,
      account.includedCreditsMicro - account.consumedCreditsMicro,
    ),
  }
}

function loadWallet(dataDir: string): WalletStore {
  const path = join(dataDir, WALLET_FILE)
  if (!existsSync(path)) return { version: 1, accounts: {} }
  try {
    const parsed = JSON.parse(
      readFileSync(path, 'utf8'),
    ) as Partial<WalletStore>
    return parsed.version === 1 && parsed.accounts
      ? { version: 1, accounts: parsed.accounts }
      : { version: 1, accounts: {} }
  } catch {
    return { version: 1, accounts: {} }
  }
}

function saveWallet(dataDir: string, store: WalletStore): void {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, WALLET_FILE)
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}

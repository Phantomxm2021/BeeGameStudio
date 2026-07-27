import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type { RecordShadowUsageResult } from './usage-billing-shadow'

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

export function debitLocalRealtimeUsage(input: {
  dataDir: string
  userId: string
  idempotencyKey: string
  shadow: RecordShadowUsageResult
}): RecordShadowUsageResult {
  const store = loadWallet(input.dataDir)
  const account = store.accounts[input.userId] ?? {
    includedCreditsMicro: INITIAL_CREDITS_MICRO,
    consumedCreditsMicro: 0,
    debits: {},
  }
  const existingDebit = account.debits[input.idempotencyKey]
  if (existingDebit !== undefined) {
    saveWallet(input.dataDir, store)
    return { ...input.shadow, duplicate: true }
  }
  const amount = Math.max(0, input.shadow.event.shadowCreditsMicro)
  const available = account.includedCreditsMicro - account.consumedCreditsMicro
  if (available < amount) throw new Error('Insufficient realtime usage credits')
  account.consumedCreditsMicro += amount
  account.debits[input.idempotencyKey] = amount
  store.accounts[input.userId] = account
  saveWallet(input.dataDir, store)
  return input.shadow
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

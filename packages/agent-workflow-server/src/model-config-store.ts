import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  exportModelConfigSnapshot,
  importModelConfigSnapshot,
  type ModelConfigSnapshotRecord,
} from '@bee-game-studio/agent-workflow'
import {
  decryptSecret,
  encryptSecret,
  isSecretEnvelope,
} from './security/secret-crypto'

const STORE_FILE = 'model-configs.json'

export type ModelConfigStoreOptions = {
  dataDir?: string
}

type StorePayload = {
  version: 1
  configs: ModelConfigSnapshotRecord[]
}

export function getDefaultModelConfigStoreDir(): string {
  return (
    process.env.AGENT_WORKFLOW_DATA_DIR ??
    join(homedir(), '.beegame', 'dashboard')
  )
}

export function loadModelConfigsFromStore(
  options: ModelConfigStoreOptions = {},
): void {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return

  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !Array.isArray(payload.configs)) {
    throw new Error('Unsupported model config store format')
  }

  const { configs, hasLegacySecrets } = decryptModelConfigSnapshot(payload.configs)
  importModelConfigSnapshot(configs)
  if (hasLegacySecrets) saveModelConfigsToStore(options)
}

export function readModelConfigSnapshotFromStore(
  options: ModelConfigStoreOptions = {},
): ModelConfigSnapshotRecord[] {
  const filePath = getStoreFilePath(options)
  if (!existsSync(filePath)) return []
  const payload = JSON.parse(readFileSync(filePath, 'utf8')) as StorePayload
  if (payload.version !== 1 || !Array.isArray(payload.configs)) {
    throw new Error('Unsupported model config store format')
  }
  const { configs, hasLegacySecrets } = decryptModelConfigSnapshot(payload.configs)
  if (hasLegacySecrets) {
    mkdirSync(dirname(filePath), { recursive: true })
    const encryptedPayload: StorePayload = {
      version: 1,
      configs: payload.configs.map(config => ({
        ...config,
        apiKey: encryptSecret(config.apiKey, 'model-config:api-key'),
      })),
    }
    const tempPath = `${filePath}.tmp`
    writeFileSync(tempPath, `${JSON.stringify(encryptedPayload, null, 2)}\n`, 'utf8')
    renameSync(tempPath, filePath)
  }
  return configs
}

export function saveModelConfigsToStore(
  options: ModelConfigStoreOptions = {},
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })

  const payload: StorePayload = {
    version: 1,
    configs: exportModelConfigSnapshot().map(config => ({
      ...config,
      apiKey: encryptSecret(config.apiKey, 'model-config:api-key'),
    })),
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function decryptModelConfigSnapshot(
  configs: ModelConfigSnapshotRecord[],
): { configs: ModelConfigSnapshotRecord[]; hasLegacySecrets: boolean } {
  let hasLegacySecrets = false
  const decrypted = configs.map(config => {
    if (!isSecretEnvelope(config.apiKey)) hasLegacySecrets = true
    return {
      ...config,
      apiKey: decryptSecret(config.apiKey, 'model-config:api-key'),
    }
  })
  return { configs: decrypted, hasLegacySecrets }
}

function getStoreFilePath(options: ModelConfigStoreOptions): string {
  return join(options.dataDir ?? getDefaultModelConfigStoreDir(), STORE_FILE)
}

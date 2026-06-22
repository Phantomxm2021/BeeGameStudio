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
} from '@claude-code-best/agent-workflow'

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

  importModelConfigSnapshot(payload.configs)
}

export function saveModelConfigsToStore(
  options: ModelConfigStoreOptions = {},
): void {
  const filePath = getStoreFilePath(options)
  mkdirSync(dirname(filePath), { recursive: true })

  const payload: StorePayload = {
    version: 1,
    configs: exportModelConfigSnapshot(),
  }
  const tempPath = `${filePath}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function getStoreFilePath(options: ModelConfigStoreOptions): string {
  return join(options.dataDir ?? getDefaultModelConfigStoreDir(), STORE_FILE)
}

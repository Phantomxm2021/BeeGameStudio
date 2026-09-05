import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import {
  documentAuthoringResponseMetrics,
  type DocumentAuthoringRawRecord,
} from '../packages/agent-workflow-server/src/beegame/document-authoring-metrics'
import {
  modelFoundationAuthorityProjectionBytes,
  type FoundationAuthorityProjection,
} from '../packages/agent-workflow-server/src/beegame/foundation-authority-projection'

type JsonRecord = Record<string, unknown>

type DispatchInfo = {
  taskId?: string
  workerType?: string
  startedAt?: string
  finishedAt?: string
  documentPerformance?: JsonRecord
}

async function main(): Promise<void> {
  const projectPath = process.argv[2]
  if (!projectPath) {
    console.error('usage: bun run scripts/stage2-authoring-observations.ts <project-directory>')
    process.exitCode = 2
    return
  }
  const project = resolve(projectPath)
  const workflow = join(project, '.beegame', 'workflow')
  const run = await readJson(join(workflow, 'run.json'))
  const runId = run && typeof run.runId === 'string' ? run.runId : undefined
  if (!runId) throw new Error('workflow/run.json is missing a current runId')
  const dispatches = await readDispatches(join(workflow, 'events.jsonl'), runId)
  const rawPaths = await findFiles(join(workflow, 'logs', runId), 'agent.raw.jsonl')
  const documents = []
  for (const rawPath of rawPaths.sort()) {
    const dispatchId = basename(dirname(rawPath))
    const info = dispatches.get(dispatchId)
    if (!info || info.workerType !== 'document-author') continue
    const raw = await readRawRecords(rawPath)
    const records = raw.records
    if (!records.length) continue
    const terminal = [...records]
      .reverse()
      .find(record => record.message.type === 'result')?.message
    const observation = documentAuthoringResponseMetrics(records)
    const projectionPath = join(
      workflow,
      'document-projections',
      `${dispatchId}.json`,
    )
    const projection = await readJson(projectionPath)
    const projectionArtifactBytes = await fileBytes(projectionPath)
    const projectionModelBytes = projection
      ? modelProjectionBytes(projection)
      : 0
    const terminalUsage = terminal ? object(terminal.usage) : undefined
    documents.push({
      dispatchId,
      taskId: info?.taskId ?? null,
      rawPath: relative(project, rawPath),
      rawRecordCount: records.length,
      ...(raw.partialLastLine || raw.malformedRecordCount > 0
        ? {
            rawParse: {
              partialLastLine: raw.partialLastLine,
              malformedRecordCount: raw.malformedRecordCount,
            },
          }
        : {}),
      responseObservation: observation,
      terminal: terminal
        ? {
            subtype: stringValue(terminal.subtype),
            isError: terminal.is_error === true,
            stopReason: stringValue(terminal.stop_reason),
            resultBytes: byteLength(stringValue(terminal.result) ?? ''),
            usage: terminalUsage ?? null,
          }
        : null,
      projection: projection
        ? {
            path: relative(project, projectionPath),
            modelBytes: projectionModelBytes,
            artifactBytes: projectionArtifactBytes,
            fallbackUsed: Array.isArray(projection.sources)
              ? projection.sources.some(source => object(source)?.selectionScope === 'document')
              : false,
            sourceCount: Array.isArray(projection.sources)
              ? projection.sources.length
              : 0,
          }
        : null,
      performance: info.documentPerformance ?? null,
    })
  }
  const rawProcessedTokens = documents.reduce(
    (sum, document) =>
      sum + (document.responseObservation.terminalUsage?.rawProcessedTokens ?? 0),
    0,
  )
  process.stdout.write(
    `${JSON.stringify({
      projectPath: project,
      scope: 'stage2-document-authoring',
      source: 'workflow/logs/*/*/agent.raw.jsonl',
      runId,
      live: false,
      documents,
      totals: {
        documentCount: documents.length,
        rawRecordCount: documents.reduce(
          (sum, document) => sum + document.rawRecordCount,
          0,
        ),
        responseCount: documents.reduce(
          (sum, document) =>
            sum + document.responseObservation.responses.length,
          0,
        ),
        rawProcessedTokens,
        terminalUsageMissingCount: documents.filter(
          document => !document.responseObservation.terminalUsage,
        ).length,
        nativeTruncationCount: documents.reduce(
          (sum, document) =>
            sum + document.responseObservation.nativeTruncationCount,
          0,
        ),
        nativeContinuationCount: documents.reduce(
          (sum, document) =>
            sum + document.responseObservation.nativeContinuationCount,
          0,
        ),
      },
    }, null, 2)}\n`,
  )
}

async function readDispatches(
  path: string,
  runId: string,
): Promise<Map<string, DispatchInfo>> {
  const result = new Map<string, DispatchInfo>()
  const lines = await readOptional(path)
  if (!lines) return result
  for (const line of lines.split('\n')) {
    const item = parseJson(line)
    if (
      !item ||
      item.runId !== runId ||
      typeof item.dispatchId !== 'string'
    )
      continue
    const current = result.get(item.dispatchId) ?? {}
    result.set(item.dispatchId, {
      ...current,
      ...(typeof item.taskId === 'string' ? { taskId: item.taskId } : {}),
      ...(typeof item.workerType === 'string'
        ? { workerType: item.workerType }
        : {}),
      ...(typeof item.createdAt === 'string'
        ? item.type === 'dispatch.started'
          ? { startedAt: item.createdAt }
          : {}
        : {}),
      ...(typeof item.createdAt === 'string' && item.type === 'dispatch.completed'
        ? { finishedAt: item.createdAt }
        : {}),
      ...(object(item.documentPerformance)
        ? { documentPerformance: object(item.documentPerformance) }
        : {}),
    })
  }
  return result
}

async function readRawRecords(path: string): Promise<{
  records: DocumentAuthoringRawRecord[]
  partialLastLine: boolean
  malformedRecordCount: number
}> {
  const text = await readFile(path, 'utf8')
  const records: DocumentAuthoringRawRecord[] = []
  const lines = text.split('\n')
  let partialLastLine = false
  let malformedRecordCount = 0
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const value = parseJson(line)
    const message = value ? object(value.message) : undefined
    if (!value || !message || typeof value.createdAt !== 'string') {
      if (index === lines.length - 1 && !text.endsWith('\n')) {
        partialLastLine = true
        continue
      }
      malformedRecordCount += 1
      continue
    }
    records.push({
      message,
      createdAt: value.createdAt,
    })
  }
  if (malformedRecordCount > 0)
    throw new Error(`${path} contains ${malformedRecordCount} malformed middle record(s)`)
  return { records, partialLastLine, malformedRecordCount }
}

async function findFiles(root: string, name: string): Promise<string[]> {
  const result: string[] = []
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return result
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...(await findFiles(path, name)))
    else if (entry.isFile() && entry.name === name) result.push(path)
  }
  return result
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

async function readJson(path: string): Promise<JsonRecord | undefined> {
  const value = parseJson(await readOptional(path))
  return value
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function parseJson(value: string | undefined): JsonRecord | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return object(parsed)
  } catch {
    return undefined
  }
}

function object(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function modelProjectionBytes(projection: JsonRecord): number {
  return byteLength(
    modelFoundationAuthorityProjectionBytes(
      projection as unknown as FoundationAuthorityProjection,
    ),
  )
}

await main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

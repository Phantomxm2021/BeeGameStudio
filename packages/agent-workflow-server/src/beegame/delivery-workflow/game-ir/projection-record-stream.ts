import { compareCodeUnits } from './model'
import type { GameIrProjectionSliceNode } from './projection-slice-journal'

type RecordValue = Record<string, unknown>

export type GameIrProjectionNodeRecord = Readonly<{
  fragmentId: string
  node: GameIrProjectionSliceNode
}>

export type GameIrProjectionRecordStreamResult = Readonly<{
  records: readonly GameIrProjectionNodeRecord[]
  done: boolean
  diagnostic?: string
}>

function isRecord(value: unknown): value is RecordValue {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(
  value: RecordValue,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    throw new Error(`${label} has unknown or missing fields`)
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label} must be non-empty text`)
  return value
}

function streamLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function diagnostic(
  records: readonly GameIrProjectionNodeRecord[],
  reason: string,
): GameIrProjectionRecordStreamResult {
  return { records: [...records], done: false, diagnostic: reason }
}

/** Strictly parses a projection NDJSON stream into its valid physical prefix. */
export function parseGameIrProjectionRecordStream(input: {
  expectedSliceId: string
  text: string
}): GameIrProjectionRecordStreamResult {
  const expectedSliceId = nonEmptyText(input.expectedSliceId, 'expectedSliceId')
  const records: GameIrProjectionNodeRecord[] = []
  let previousNodeId: string | undefined
  let doneSeen = false

  for (const [lineIndex, line] of streamLines(input.text).entries()) {
    const lineLabel = `line ${lineIndex + 1}`
    if (line.trim().length === 0)
      return diagnostic(records, `${lineLabel} is an empty internal line`)
    if (doneSeen) return diagnostic(records, `${lineLabel} appears after done`)

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return diagnostic(records, `${lineLabel} is not valid JSON`)
    }
    if (!isRecord(parsed))
      return diagnostic(records, `${lineLabel} must be a JSON object`)

    try {
      if (parsed.record === 'node') {
        exactKeys(
          parsed,
          ['record', 'sliceId', 'fragmentId', 'node'],
          `node record at ${lineLabel}`,
        )
        if (parsed.sliceId !== expectedSliceId)
          throw new Error(`node record at ${lineLabel} has the wrong slice ID`)
        const fragmentId = nonEmptyText(
          parsed.fragmentId,
          `node record at ${lineLabel} fragmentId`,
        )
        if (!isRecord(parsed.node))
          throw new Error(`node record at ${lineLabel} node must be a plain object`)
        const nodeId = nonEmptyText(
          parsed.node.id,
          `node record at ${lineLabel} node.id`,
        )
        if (
          previousNodeId !== undefined &&
          compareCodeUnits(previousNodeId, nodeId) >= 0
        )
          throw new Error(
            `node IDs must be strictly increasing by code units at ${lineLabel}`,
          )
        previousNodeId = nodeId
        records.push({
          fragmentId,
          node: parsed.node as unknown as GameIrProjectionSliceNode,
        })
        continue
      }

      if (parsed.record === 'done') {
        exactKeys(
          parsed,
          ['record', 'sliceId'],
          `done record at ${lineLabel}`,
        )
        if (parsed.sliceId !== expectedSliceId)
          throw new Error(`done record at ${lineLabel} has the wrong slice ID`)
        doneSeen = true
        continue
      }

      throw new Error(`${lineLabel} has an unknown record type`)
    } catch (error) {
      return diagnostic(
        records,
        error instanceof Error ? error.message : `${lineLabel} is invalid`,
      )
    }
  }

  if (!doneSeen)
    return diagnostic(records, 'stream is missing its final done record')
  return { records: [...records], done: true }
}

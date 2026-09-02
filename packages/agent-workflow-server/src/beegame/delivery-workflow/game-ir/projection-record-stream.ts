import { compareCodeUnits } from './model'
import type {
  GameIrProjectionSliceCompletion,
  GameIrProjectionSliceNode,
} from './projection-slice-journal'

type RecordValue = Record<string, unknown>

function fail(message: string): never {
  throw new Error(`invalid Game IR projection record stream: ${message}`)
}

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
    fail(`${label} has unknown or missing fields`)
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0)
    fail(`${label} must be non-empty text`)
  return value
}

function compareEvidenceGroups(
  left: { fragmentId: string; nodeIds: readonly string[] },
  right: { fragmentId: string; nodeIds: readonly string[] },
): number {
  const fragmentOrder = compareCodeUnits(left.fragmentId, right.fragmentId)
  if (fragmentOrder !== 0) return fragmentOrder
  const length = Math.min(left.nodeIds.length, right.nodeIds.length)
  for (let index = 0; index < length; index += 1) {
    const nodeOrder = compareCodeUnits(
      left.nodeIds[index]!,
      right.nodeIds[index]!,
    )
    if (nodeOrder !== 0) return nodeOrder
  }
  return left.nodeIds.length - right.nodeIds.length
}

function streamLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map(line => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

/** Strictly parses the sole projection NDJSON protocol into one slice completion. */
export function parseGameIrProjectionRecordStream(input: {
  expectedSliceId: string
  text: string
}): GameIrProjectionSliceCompletion {
  const expectedSliceId = nonEmptyText(input.expectedSliceId, 'expectedSliceId')
  const nodes: GameIrProjectionSliceNode[] = []
  const evidenceGroups = new Map<string, string[]>()
  let previousNodeId: string | undefined
  let doneSeen = false

  for (const [lineIndex, line] of streamLines(input.text).entries()) {
    if (line.trim().length === 0)
      fail(`line ${lineIndex + 1} is an empty internal line`)
    if (doneSeen) fail(`line ${lineIndex + 1} appears after done`)

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      fail(`line ${lineIndex + 1} is not valid JSON`)
    }
    if (!isRecord(parsed)) fail(`line ${lineIndex + 1} must be a JSON object`)

    if (parsed.record === 'node') {
      exactKeys(
        parsed,
        ['record', 'sliceId', 'fragmentId', 'node'],
        `node record at line ${lineIndex + 1}`,
      )
      if (parsed.sliceId !== expectedSliceId)
        fail(`node record at line ${lineIndex + 1} has the wrong slice ID`)
      const fragmentId = nonEmptyText(
        parsed.fragmentId,
        `node record at line ${lineIndex + 1} fragmentId`,
      )
      if (!isRecord(parsed.node))
        fail(`node record at line ${lineIndex + 1} node must be a plain object`)
      const nodeId = nonEmptyText(
        parsed.node.id,
        `node record at line ${lineIndex + 1} node.id`,
      )
      if (
        previousNodeId !== undefined &&
        compareCodeUnits(previousNodeId, nodeId) >= 0
      )
        fail(
          `node IDs must be strictly increasing by code units at line ${lineIndex + 1}`,
        )
      previousNodeId = nodeId
      const node = parsed.node as unknown as GameIrProjectionSliceNode
      nodes.push(node)
      const nodeIds = evidenceGroups.get(fragmentId) ?? []
      nodeIds.push(nodeId)
      evidenceGroups.set(fragmentId, nodeIds)
      continue
    }

    if (parsed.record === 'done') {
      exactKeys(
        parsed,
        ['record', 'sliceId'],
        `done record at line ${lineIndex + 1}`,
      )
      if (parsed.sliceId !== expectedSliceId)
        fail(`done record at line ${lineIndex + 1} has the wrong slice ID`)
      doneSeen = true
      continue
    }

    fail(`line ${lineIndex + 1} has an unknown record type`)
  }

  if (!doneSeen) fail('stream is missing its final done record')

  const sourceEvidenceGroups = [...evidenceGroups.entries()]
    .map(([fragmentId, nodeIds]) => ({
      fragmentId,
      nodeIds: [...nodeIds].sort(compareCodeUnits),
    }))
    .sort(compareEvidenceGroups)

  return {
    status: 'completed',
    sliceId: expectedSliceId,
    semantic: {
      nodes,
      sourceEvidenceGroups,
    },
  }
}

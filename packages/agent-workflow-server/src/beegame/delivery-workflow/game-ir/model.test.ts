import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import {
  GAME_IR_SCHEMA_VERSION,
  type FoundationReadyReceipt,
  type GameIrCompileRequest,
} from './contracts'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrSourceBinding,
  type GameIrSourceSection,
} from './model'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'

const digest = 'a'.repeat(64)

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

function receiptWithoutDigest(): Omit<FoundationReadyReceipt, 'receiptDigest'> {
  return {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: 'project-1',
    foundationRevision: 'foundation-revision-1',
    confirmedBriefDigest: digest,
    documentDigests: Object.fromEntries(
      CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, digest]),
    ) as FoundationReadyReceipt['documentDigests'],
    sectionIndexPath: '.beegame/foundation/section-index.json',
    sectionIndexDigest: digest,
    authority: {
      kind: 'review',
      reviewDigest: digest,
      issueRegistryDigest: digest,
    },
  }
}

function request(): GameIrCompileRequest {
  const foundation = receiptWithoutDigest()
  return {
    schemaVersion: 'game-ir-compile-request.v1',
    taskId: 'compile-task-1',
    publicationId: 'publication-1',
    gameIrSchemaVersion: GAME_IR_SCHEMA_VERSION,
    foundation: {
      ...foundation,
      receiptDigest: createHash('sha256')
        .update(canonical(foundation))
        .digest('hex'),
    },
  }
}

const sections: readonly GameIrSourceSection[] = [
  {
    documentPath: 'docs/GDD.md',
    sectionId: 'core-loop',
    digest,
  },
  {
    documentPath: 'docs/TECHNICAL_DESIGN.md',
    sectionId: 'runtime-states',
    digest,
  },
]

function candidate(overrides: Partial<GameIrCandidate> = {}): GameIrCandidate {
  return {
    schemaVersion: GAME_IR_SCHEMA_VERSION,
    taskId: 'compile-task-1',
    foundationRevision: 'foundation-revision-1',
    modules: [
      {
        moduleId: 'gameplay',
        nodes: [
          {
            id: 'player',
            kind: 'entity',
            producerMode: 'mechanical',
            value: {
              health: 3,
              state: { initial: 'ready' },
            },
            bindings: {
              '/id': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId: 'core-loop',
                sectionDigest: digest,
                sourcePointer: '/entities/player',
              },
              '/value/health': {
                kind: 'owner',
                documentPath: 'docs/GDD.md',
                sectionId: 'core-loop',
                sectionDigest: digest,
                sourcePointer: '/entities/player/health',
              },
              '/value/state/initial': {
                kind: 'derived',
                derivationRuleId: 'initial-state',
                inputPointers: ['/value/health'],
              },
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('Game IR core candidate and source authority', () => {
  test('parses a revision-bound candidate and freezes all containers', () => {
    const parsed = parseGameIrCandidate(candidate(), {
      request: request(),
      sections,
    })

    expect(parsed).toEqual(candidate())
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.modules)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes[0]!.value)).toBe(true)
    expect(Object.isFrozen(parsed.modules[0]!.nodes[0]!.bindings)).toBe(true)
  })

  test('binds candidate identity to the compile request', () => {
    expect(() =>
      parseGameIrCandidate(candidate({ taskId: 'other-task' }), {
        request: request(),
        sections,
      }),
    ).toThrow(/task/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({ foundationRevision: 'other-revision' }),
        { request: request(), sections },
      ),
    ).toThrow(/revision/i)
  })

  test('rejects duplicate or unsorted module and node IDs', () => {
    const secondModule = {
      ...candidate().modules[0]!,
      moduleId: 'gameplay',
    }
    expect(() =>
      parseGameIrCandidate(
        candidate({ modules: [secondModule, candidate().modules[0]!] }),
        { request: request(), sections },
      ),
    ).toThrow(/module/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                candidate().modules[0]!.nodes[0]!,
                candidate().modules[0]!.nodes[0]!,
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/node/i)
  })

  test('rejects unknown producer modes and unsafe pointers', () => {
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  producerMode: 'unknown' as never,
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/producer/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/../health':
                      candidate().modules[0]!.nodes[0]!.bindings[
                        '/value/health'
                      ]!,
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/pointer/i)
  })

  test('rejects owner bindings outside the receipt or Section Index', () => {
    const owner = candidate().modules[0]!.nodes[0]!.bindings[
      '/value/health'
    ] as Extract<GameIrSourceBinding, { kind: 'owner' }>
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/health': {
                      ...owner,
                      documentPath: 'docs/ASSET_PLAN.md',
                    },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/receipt|section/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...candidate().modules[0]!.nodes[0]!,
                  bindings: {
                    ...candidate().modules[0]!.nodes[0]!.bindings,
                    '/value/health': { ...owner, sectionId: 'missing' },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/section/i)
    expect(() =>
      parseGameIrCandidate(candidate(), {
        request: request(),
        sections: [{ ...sections[0]!, digest: 'b'.repeat(64) }],
      }),
    ).toThrow(/section/i)
  })

  test('rejects malformed derived inputs and incomplete leaf bindings', () => {
    const node = candidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...node,
                  bindings: {
                    ...node.bindings,
                    '/value/state/initial': {
                      kind: 'derived',
                      derivationRuleId: 'initial-state',
                      inputPointers: ['/value/health', '/value/health'],
                    },
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/input/i)
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [{ ...node, bindings: { '/id': node.bindings['/id']! } }],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/binding|leaf/i)
  })

  test('rejects bindings that do not target /id or a value leaf', () => {
    const node = candidate().modules[0]!.nodes[0]!
    expect(() =>
      parseGameIrCandidate(
        candidate({
          modules: [
            {
              ...candidate().modules[0]!,
              nodes: [
                {
                  ...node,
                  bindings: {
                    ...node.bindings,
                    '/value/state': node.bindings['/value/health']!,
                  },
                },
              ],
            },
          ],
        }),
        { request: request(), sections },
      ),
    ).toThrow(/leaf|binding/i)
  })

  test('canonicalizes object keys without changing declared array order', () => {
    const first = { z: 1, a: { d: 2, c: 3 }, list: [{ y: 1, x: 2 }, 0] }
    const second = { list: [{ x: 2, y: 1 }, 0], a: { c: 3, d: 2 }, z: 1 }
    expect(canonicalGameIrJson(first)).toBe(canonicalGameIrJson(second))
    expect(canonicalGameIrJson({ list: [0, 1] })).not.toBe(
      canonicalGameIrJson({ list: [1, 0] }),
    )
    expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))
  })

  test('rejects non-JSON values', () => {
    expect(() => canonicalGameIrJson({ value: Number.NaN })).toThrow(
      /json|finite/i,
    )
    expect(() => canonicalGameIrJson({ value: undefined })).toThrow(
      /json|undefined/i,
    )
    expect(() => canonicalGameIrJson({ value: () => 'nope' })).toThrow(
      /json|function/i,
    )
    expect(() => canonicalGameIrJson(new Date())).toThrow(/json|plain/i)
  })
})

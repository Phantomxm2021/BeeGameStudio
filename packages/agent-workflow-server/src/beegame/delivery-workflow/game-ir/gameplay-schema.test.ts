import { describe, expect, test } from 'bun:test'
import { digestGameIrValue, type GameIrNode } from './model'
import {
  parseGameplayModule,
  type GameplayConditionExpression,
} from './gameplay-schema'

type MutableNode = {
  id: string
  kind: string
  producerMode: 'semantic'
  value: Record<string, unknown>
  references: Array<{ targetId: string; targetType: string }>
  edges: Array<{ type: string; targetId: string; targetType: string }>
  bindings: Record<string, never>
}

type MutableModule = {
  moduleId: 'gameplay'
  nodes: MutableNode[]
}

function node(
  id: string,
  kind: string,
  value: Record<string, unknown>,
  options: Partial<Pick<MutableNode, 'references' | 'edges'>> = {},
): MutableNode {
  return {
    id,
    kind,
    producerMode: 'semantic',
    value,
    references: options.references ?? [],
    edges: options.edges ?? [],
    bindings: {},
  }
}

function edge(type: string, targetId: string, targetType: string) {
  return { type, targetId, targetType }
}

function ref(targetId: string, targetType: string) {
  return { targetId, targetType }
}

function validModule(): MutableModule {
  const nodes: MutableNode[] = [
    node(
      'action.jump',
      'gameplay.action',
      { label: 'Jump' },
      {
        references: [
          ref('condition.can-jump', 'gameplay.condition'),
          ref('effect.jump', 'gameplay.effect'),
          ref('event.jumped', 'gameplay.event'),
        ],
        edges: [
          edge('causes', 'effect.jump', 'gameplay.effect'),
          edge('causes', 'event.jumped', 'gameplay.event'),
          edge('requires', 'condition.can-jump', 'gameplay.condition'),
        ],
      },
    ),
    node(
      'capability.player-jump',
      'gameplay.capability',
      { label: 'Can jump' },
      {
        edges: [edge('belongs-to', 'entity.player', 'gameplay.entity')],
      },
    ),
    node(
      'condition.can-jump',
      'gameplay.condition',
      {
        expression: {
          kind: 'reference',
          referenceIndex: 0,
        } satisfies GameplayConditionExpression,
      },
      { references: [ref('capability.player-jump', 'gameplay.capability')] },
    ),
    node(
      'effect.jump',
      'gameplay.effect',
      {
        effect: { operation: 'set', targetReferenceIndex: 0, value: true },
      },
      { references: [ref('entity.player', 'gameplay.entity')] },
    ),
    node('entity.player', 'gameplay.entity', { label: 'Player' }),
    node('event.jumped', 'gameplay.event', { label: 'Jumped' }),
    node(
      'objective.complete',
      'gameplay.objective',
      { label: 'Complete the game' },
      {
        edges: [
          edge('fails-with', 'outcome.loss', 'gameplay.outcome'),
          edge('succeeds-with', 'outcome.win', 'gameplay.outcome'),
        ],
      },
    ),
    node('outcome.loss', 'gameplay.outcome', { label: 'Loss', result: 'loss' }),
    node('outcome.neutral', 'gameplay.outcome', {
      label: 'Neutral',
      result: 'neutral',
    }),
    node('outcome.win', 'gameplay.outcome', { label: 'Win', result: 'win' }),
    node(
      'rule.jump',
      'gameplay.rule',
      { label: 'Jump rule' },
      {
        edges: [
          edge('guards', 'condition.can-jump', 'gameplay.condition'),
          edge('triggered-by', 'event.jumped', 'gameplay.event'),
        ],
      },
    ),
    node('state.start', 'gameplay.state', {
      label: 'Start',
      initial: true,
      terminal: 'none',
    }),
    node('state.win', 'gameplay.state', {
      label: 'Won',
      initial: false,
      terminal: 'success',
    }),
    node('state.lose', 'gameplay.state', {
      label: 'Lost',
      initial: false,
      terminal: 'failure',
    }),
    node(
      'transition.finish',
      'gameplay.transition',
      { label: 'Finish' },
      {
        edges: [
          edge('from', 'state.start', 'gameplay.state'),
          edge('on', 'event.jumped', 'gameplay.event'),
          edge('to', 'state.win', 'gameplay.state'),
        ],
      },
    ),
    node(
      'transition.lose',
      'gameplay.transition',
      { label: 'Lose' },
      {
        edges: [
          edge('from', 'state.start', 'gameplay.state'),
          edge('to', 'state.lose', 'gameplay.state'),
        ],
      },
    ),
  ]
  nodes.sort((left, right) => left.id.localeCompare(right.id))
  return { moduleId: 'gameplay', nodes }
}

function cloneModule(module: MutableModule): MutableModule {
  return structuredClone(module)
}

describe('Gameplay Game IR schema', () => {
  test('accepts the complete gameplay graph and freezes the result', () => {
    const parsed = parseGameplayModule(validModule())
    expect(parsed.moduleId).toBe('gameplay')
    expect(parsed.nodes).toHaveLength(16)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.nodes)).toBe(true)
    expect(Object.isFrozen(parsed.nodes[0]!.value)).toBe(true)
  })

  test('accepts an external Balance reference when its target is supplied', () => {
    const module = validModule()
    const condition = module.nodes.find(
      node => node.id === 'condition.can-jump',
    )!
    const withBalance = cloneModule(module)
    const conditionCopy = withBalance.nodes.find(
      node => node.id === condition.id,
    )!
    Object.assign(conditionCopy.references, [
      ref('balance.score', 'balance.variable'),
    ])
    conditionCopy.value = {
      expression: { kind: 'reference', referenceIndex: 0 },
    }
    expect(
      parseGameplayModule(
        withBalance,
        new Map([
          [
            'balance.score',
            { id: 'balance.score', kind: 'balance.variable' } as GameIrNode,
          ],
        ]),
      ),
    ).toHaveProperty('moduleId', 'gameplay')
  })

  test('rejects unknown kinds, unknown value fields, and embedded target IDs', () => {
    const unknownKind = cloneModule(validModule())
    unknownKind.nodes[0] = {
      ...unknownKind.nodes[0]!,
      kind: 'gameplay.unknown',
    }
    expect(() => parseGameplayModule(unknownKind)).toThrow(/kind/i)

    const unknownValue = cloneModule(validModule())
    unknownValue.nodes[0] = {
      ...unknownValue.nodes[0]!,
      value: { ...unknownValue.nodes[0]!.value, targetId: 'state.win' },
    }
    expect(() => parseGameplayModule(unknownValue)).toThrow(/field|value/i)

    const embeddedId = cloneModule(validModule())
    const entity = embeddedId.nodes.find(node => node.id === 'entity.player')!
    embeddedId.nodes[embeddedId.nodes.indexOf(entity)] = {
      ...entity,
      value: { label: 'state.win' },
    }
    expect(() => parseGameplayModule(embeddedId)).toThrow(/target|id|value/i)

    const hiddenValueField = cloneModule(validModule())
    Object.defineProperty(hiddenValueField.nodes[0]!.value, 'targetId', {
      value: 'state.win',
      enumerable: false,
    })
    expect(() => parseGameplayModule(hiddenValueField)).toThrow(
      /property|field|value/i,
    )
  })

  test('rejects malformed condition/effect references and relationship edges', () => {
    const badCondition = cloneModule(validModule())
    const condition = badCondition.nodes.find(
      node => node.id === 'condition.can-jump',
    )!
    badCondition.nodes[badCondition.nodes.indexOf(condition)] = {
      ...condition,
      value: { expression: { kind: 'reference', referenceIndex: 4 } },
    }
    expect(() => parseGameplayModule(badCondition)).toThrow(/reference/i)

    const badEffect = cloneModule(validModule())
    const effect = badEffect.nodes.find(node => node.id === 'effect.jump')!
    badEffect.nodes[badEffect.nodes.indexOf(effect)] = {
      ...effect,
      value: { effect: { operation: 'set', targetReferenceIndex: 0 } },
    }
    expect(() => parseGameplayModule(badEffect)).toThrow(/effect|value/i)

    const wrongEdge = cloneModule(validModule())
    const capability = wrongEdge.nodes.find(
      node => node.id === 'capability.player-jump',
    )!
    wrongEdge.nodes[wrongEdge.nodes.indexOf(capability)] = {
      ...capability,
      edges: [edge('belongs-to', 'state.start', 'gameplay.state')],
    }
    expect(() => parseGameplayModule(wrongEdge)).toThrow(/target|role/i)
  })

  test('rejects duplicate singleton roles and incomplete transitions', () => {
    const duplicateRole = cloneModule(validModule())
    const transition = duplicateRole.nodes.find(
      node => node.id === 'transition.finish',
    )!
    duplicateRole.nodes[duplicateRole.nodes.indexOf(transition)] = {
      ...transition,
      edges: [
        ...transition.edges,
        edge('from', 'state.start', 'gameplay.state'),
      ],
    }
    expect(() => parseGameplayModule(duplicateRole)).toThrow(/duplicate|role/i)

    const missingEndpoint = cloneModule(validModule())
    const incomplete = missingEndpoint.nodes.find(
      node => node.id === 'transition.finish',
    )!
    missingEndpoint.nodes[missingEndpoint.nodes.indexOf(incomplete)] = {
      ...incomplete,
      edges: incomplete.edges.filter(candidate => candidate.type !== 'to'),
    }
    expect(() => parseGameplayModule(missingEndpoint)).toThrow(
      /transition|from|to/i,
    )
  })

  test('rejects duplicate action and transition labels', () => {
    const duplicateAction = cloneModule(validModule())
    const action = duplicateAction.nodes.find(
      node => node.id === 'action.jump',
    )!
    duplicateAction.nodes.push({
      ...action,
      id: 'action.jump-copy',
    })
    duplicateAction.nodes.sort((left, right) => left.id.localeCompare(right.id))
    expect(() => parseGameplayModule(duplicateAction)).toThrow(
      /duplicate.*action|action.*duplicate/i,
    )

    const duplicateTransition = cloneModule(validModule())
    const transition = duplicateTransition.nodes.find(
      node => node.id === 'transition.finish',
    )!
    duplicateTransition.nodes.push({
      ...transition,
      id: 'transition.finish-copy',
    })
    duplicateTransition.nodes.sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    expect(() => parseGameplayModule(duplicateTransition)).toThrow(
      /duplicate.*transition|transition.*duplicate/i,
    )
  })

  test('rejects unreachable states and transitions out of terminal states', () => {
    const unreachable = cloneModule(validModule())
    unreachable.nodes.push(
      node('state.unreachable', 'gameplay.state', {
        label: 'Unreachable',
        initial: false,
        terminal: 'none',
      }),
    )
    unreachable.nodes.sort((left, right) => left.id.localeCompare(right.id))
    expect(() => parseGameplayModule(unreachable)).toThrow(/unreachable state/i)

    const terminalOutgoing = cloneModule(validModule())
    terminalOutgoing.nodes.push(
      node(
        'transition.illegal',
        'gameplay.transition',
        { label: 'Illegal' },
        {
          edges: [
            edge('from', 'state.win', 'gameplay.state'),
            edge('to', 'state.lose', 'gameplay.state'),
          ],
        },
      ),
    )
    terminalOutgoing.nodes.sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    expect(() => parseGameplayModule(terminalOutgoing)).toThrow(
      /terminal|outgoing/i,
    )
  })

  test('requires explicit objective outcomes and explicit win/loss values', () => {
    const noOutcome = cloneModule(validModule())
    const objective = noOutcome.nodes.find(
      node => node.id === 'objective.complete',
    )!
    noOutcome.nodes[noOutcome.nodes.indexOf(objective)] = {
      ...objective,
      edges: [],
    }
    expect(() => parseGameplayModule(noOutcome)).toThrow(/objective|outcome/i)

    const inferred = cloneModule(validModule())
    const outcome = inferred.nodes.find(node => node.id === 'outcome.win')!
    inferred.nodes[inferred.nodes.indexOf(outcome)] = {
      ...outcome,
      id: 'outcome.inferred-win',
      value: { label: 'Win' },
    }
    const objective2 = inferred.nodes.find(
      node => node.id === 'objective.complete',
    )!
    inferred.nodes[inferred.nodes.indexOf(objective2)] = {
      ...objective2,
      edges: objective2.edges.map(edgeValue =>
        edgeValue.targetId === 'outcome.win'
          ? { ...edgeValue, targetId: 'outcome.inferred-win' }
          : edgeValue,
      ),
    }
    inferred.nodes.sort((left, right) => left.id.localeCompare(right.id))
    expect(() => parseGameplayModule(inferred)).toThrow(
      /result|explicit|outcome/i,
    )
  })

  test('does not impose a fixed graph size limit', () => {
    const expanded = validModule()
    for (let index = 0; index < 80; index += 1) {
      expanded.nodes.push(
        node(`state.extra-${index}`, 'gameplay.state', {
          label: `Extra ${index}`,
          initial: false,
          terminal: 'none',
        }),
      )
      expanded.nodes.push(
        node(
          `transition.extra-${index}`,
          'gameplay.transition',
          {
            label: `Extra transition ${index}`,
          },
          {
            edges: [
              edge(
                'from',
                index === 0 ? 'state.start' : `state.extra-${index - 1}`,
                'gameplay.state',
              ),
              edge('to', `state.extra-${index}`, 'gameplay.state'),
            ],
          },
        ),
      )
    }
    expanded.nodes.sort((left, right) => left.id.localeCompare(right.id))
    expect(parseGameplayModule(expanded).nodes).toHaveLength(176)
  })

  test('preserves canonical digest and rejects reordered admitted nodes', () => {
    const first = parseGameplayModule(validModule())
    const second = parseGameplayModule(validModule())
    expect(digestGameIrValue(first)).toBe(digestGameIrValue(second))

    const reordered = cloneModule(validModule())
    reordered.nodes.reverse()
    expect(() => parseGameplayModule(reordered)).toThrow(/sorted|unique/i)
  })
})

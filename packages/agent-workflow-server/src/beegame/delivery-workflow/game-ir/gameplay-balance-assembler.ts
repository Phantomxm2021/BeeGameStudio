import {
  prepareGameplayModule,
  type GameIrDomainSemanticReceipt as GameplaySemanticReceipt,
} from './gameplay-producer'
import {
  prepareBalanceModule,
  type GameIrDomainSemanticReceipt as BalanceSemanticReceipt,
} from './balance-producer'
import type { GameIrMechanicalProjectionReceipt } from './domain-projection'
import type { GameIrDomainSourceEnvelope } from './domain-source'
import { parseGameplayModule } from './gameplay-schema'
import { parseBalanceModule } from './balance-schema'
import {
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'

export type GameplayModuleProjection = Readonly<{
  schemaVersion: 'game-ir-gameplay-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'gameplay' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

export type BalanceModuleProjection = Readonly<{
  schemaVersion: 'game-ir-balance-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'balance' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  projectionDigest: string
}>

export type GameplayBalanceModulePair = Readonly<{
  gameplay: GameplayModuleProjection
  balance: BalanceModuleProjection
}>

export type GameplayBalanceAssemblyAuthority = Readonly<{
  gameplay: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: GameplaySemanticReceipt
  }>
  balance: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: BalanceSemanticReceipt
  }>
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR Gameplay-Balance pair: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key !== 'string'))
    fail(`${label} has a symbol property`)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  const actual = (keys as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function validateInput(
  value: unknown,
  label: string,
): asserts value is
  | GameplayBalanceAssemblyAuthority['gameplay']
  | GameplayBalanceAssemblyAuthority['balance'] {
  if (!isRecord(value)) fail(`${label} must be a plain object`)
  exactKeys(value, ['source', 'mechanical', 'semantic'], label)
}

function targetMap(
  nodes: readonly GameIrNode[],
): ReadonlyMap<string, GameIrNode> {
  return new Map(nodes.map(node => [node.id, node]))
}

function projection<
  T extends GameplayModuleProjection | BalanceModuleProjection,
>(body: Omit<T, 'projectionDigest'>): T {
  return Object.freeze({
    ...body,
    projectionDigest: digestGameIrValue(body),
  }) as T
}

export function assembleGameplayBalanceModules(
  input: GameplayBalanceAssemblyAuthority,
): GameplayBalanceModulePair {
  if (!isRecord(input)) fail('input must be a plain object')
  exactKeys(input, ['gameplay', 'balance'], 'input')
  validateInput(input.gameplay, 'gameplay input')
  validateInput(input.balance, 'balance input')

  const gameplay = prepareGameplayModule(input.gameplay)
  const balance = prepareBalanceModule(input.balance)
  const gameplaySource = gameplay.source
  const balanceSource = balance.source
  if (
    gameplaySource.taskId !== balanceSource.taskId ||
    gameplaySource.compileRequest.foundation.foundationRevision !==
      balanceSource.compileRequest.foundation.foundationRevision
  )
    fail('both modules must bind the same taskId and Foundation revision')
  if (
    gameplaySource.compileRequest.foundation.receiptDigest !==
      balanceSource.compileRequest.foundation.receiptDigest ||
    digestGameIrValue(gameplaySource.compileRequest) !==
      digestGameIrValue(balanceSource.compileRequest) ||
    digestGameIrValue(gameplaySource.authoritySectionIndex) !==
      digestGameIrValue(balanceSource.authoritySectionIndex)
  )
    fail('both modules must bind the same READY source identity')

  const ids = new Set(gameplay.module.nodes.map(node => node.id))
  for (const node of balance.module.nodes) {
    if (ids.has(node.id)) fail(`duplicate cross-domain node ID ${node.id}`)
    ids.add(node.id)
  }
  const typedGameplay = parseGameplayModule(
    gameplay.module,
    targetMap(balance.module.nodes),
  ) as GameplayModuleProjection['module']
  const typedBalance = parseBalanceModule(
    balance.module,
    targetMap(gameplay.module.nodes),
  ) as BalanceModuleProjection['module']
  const taskId = gameplaySource.taskId
  const foundationRevision =
    gameplaySource.compileRequest.foundation.foundationRevision

  return Object.freeze({
    gameplay: projection<GameplayModuleProjection>({
      schemaVersion: 'game-ir-gameplay-module.v1',
      taskId,
      foundationRevision,
      module: typedGameplay,
      mechanicalReceiptDigest: gameplay.mechanicalReceiptDigest,
      semanticReceiptDigest: gameplay.semanticReceiptDigest,
    }),
    balance: projection<BalanceModuleProjection>({
      schemaVersion: 'game-ir-balance-module.v1',
      taskId,
      foundationRevision,
      module: typedBalance,
      mechanicalReceiptDigest: balance.mechanicalReceiptDigest,
      semanticReceiptDigest: balance.semanticReceiptDigest,
    }),
  })
}

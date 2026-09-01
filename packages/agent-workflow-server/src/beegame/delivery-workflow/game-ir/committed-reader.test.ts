import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCommittedGameIr } from './committed-reader'
import { parseWorkerTerminalResult } from '../worker-contracts'

describe('committed Game IR reader', () => {
  test('exposes the single workspace/run-bound reader entry point', async () => {
    await expect(
      readCommittedGameIr({ workspacePath: '/tmp/missing-game-ir', deliveryRun: {} as never }),
    ).rejects.toThrow()
  })

  test('rejects caller-supplied alternate reader authority', async () => {
    await expect(
      readCommittedGameIr({
        workspacePath: '/tmp/missing-game-ir',
        deliveryRun: {} as never,
        candidate: {} as never,
      } as never),
    ).rejects.toThrow('reader accepts only workspacePath and deliveryRun')
  })

  test('rejects self-authorizing compiler checkpoint and READY fields', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'completed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      domainResults: [],
      checkpoint: { checkpointPath: 'forged', checkpointDigest: 'c'.repeat(64) },
      readyReceipt: {},
    }
    expect(() => parseWorkerTerminalResult(terminal)).toThrow()
  })

  test('accepts only strict semantic and validation DTOs from the compiler', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'completed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      domainResults: [{
        moduleId: 'gameplay',
        semantic: {
          outcome: 'PROJECTED',
          nodes: [],
          sourceClaims: [],
        },
        mechanical: [],
      }],
    }
    expect(() => parseWorkerTerminalResult(terminal)).toThrow()
  })

  test('requires changed compiler progress to remain in the same identity loop', () => {
    const terminal = {
      workerType: 'game-ir-compiler',
      status: 'failed',
      runId: 'run',
      dispatchId: 'dispatch',
      taskId: 'task',
      revision: 'revision',
      compileRequestDigest: 'a'.repeat(64),
      foundationReadyReceiptDigest: 'b'.repeat(64),
      reason: 'domain result needs repair',
    }
    expect(parseWorkerTerminalResult(terminal)).toMatchObject({ status: 'failed' })
  })

  test('routes admitted domain results through checkpoint, publication, and reader validation', async () => {
    const controllerPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'controller.ts',
    )
    const source = await readFile(controllerPath, 'utf8')
    const routeStart = source.indexOf("if (result.workerType === 'game-ir-compiler')")
    const routeEnd = source.indexOf(
      "if (foundationRevisionTask?.kind === 'impacted-facts'",
      routeStart,
    )
    const route = source.slice(routeStart, routeEnd)
    expect(route.indexOf('admitGameIrCompilerResults')).toBeGreaterThan(-1)
    expect(route.indexOf('writeGameIrStageCheckpoint')).toBeGreaterThan(-1)
    expect(route.indexOf('commitGameIrPublication')).toBeGreaterThan(-1)
    expect(route.indexOf('readCommittedGameIr')).toBeGreaterThan(-1)
    expect(route.indexOf('admitGameIrCompilerResults')).toBeLessThan(
      route.indexOf('writeGameIrStageCheckpoint'),
    )
    expect(route.indexOf('writeGameIrStageCheckpoint')).toBeLessThan(
      route.indexOf('commitGameIrPublication'),
    )
    expect(route.indexOf('commitGameIrPublication')).toBeLessThan(
      route.indexOf('readCommittedGameIr'),
    )
    expect(route).not.toContain('dispatcher.replayTerminal(replayable, handleTerminalUnlocked)')
  })

  test('keeps compiler publication failures on the latest durable checkpoint state', async () => {
    const controllerPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'controller.ts',
    )
    const source = await readFile(controllerPath, 'utf8')
    const attention = source.indexOf('const saveCompilerAttention = async')
    const durableLoad = source.indexOf('await store.load()', attention)
    expect(attention).toBeGreaterThan(-1)
    expect(durableLoad).toBeGreaterThan(attention)
    expect(source.slice(attention, durableLoad)).not.toContain('const run')
  })

  test('keeps the reader matrix fail-closed and free of fallback authorities', async () => {
    const readerPath = join(dirname(fileURLToPath(import.meta.url)), 'committed-reader.ts')
    const source = await readFile(readerPath, 'utf8')
    for (const requiredDiagnostic of [
      'manifest must contain exactly six modules',
      'module is not canonical',
      'candidate digest mismatch',
      'source map',
      'dependency graph digest mismatch',
      'semantic evidence',
      'COMMITTED marker mismatch',
      'committed READY receipt digest mismatch',
    ])
      expect(source).toContain(requiredDiagnostic)
    for (const forbiddenFallback of [
      'old-doc',
      'previous-publication',
      'previousPublication',
      '.journal',
      '.staging',
    ])
      expect(source).not.toContain(forbiddenFallback)
  })
})

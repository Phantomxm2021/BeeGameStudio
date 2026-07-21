import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getNativeValidatorToolCapabilities,
  observeNativeToolProvenance,
} from './native-tool-provenance'

describe('native tool provenance', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  test('derives validator capabilities only from completed descendant calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'native-tool-provenance-'))
    const base = { dataRoot: root, sessionId: 'session-a', createdAt: new Date() }
    for (const [toolUseID, toolName, phase] of [
      ['contract-a', 'ProjectDeliveryContract', 'tool.completed'],
      ['read-a', 'Read', 'tool.completed'],
      ['bash-a', 'Bash', 'tool.completed'],
      ['skill-a', 'Skill', 'tool.completed'],
      ['runtime-a', 'ExecuteExtraTool', 'tool.completed'],
      ['unrelated', 'ExecuteExtraTool', 'tool.completed'],
      ['failed-runtime', 'ExecuteExtraTool', 'tool.failed'],
    ] as const) {
      observeNativeToolProvenance({
        ...base,
        eventType: phase,
        payload: {
          toolUseID,
          toolName,
          ...(toolUseID !== 'unrelated'
            ? { parentToolUseID: 'validator-agent' }
            : { parentToolUseID: 'other-agent' }),
        },
      })
    }

    expect(getNativeValidatorToolCapabilities({
      dataRoot: root,
      sessionId: 'session-a',
      validatorToolUseID: 'validator-agent',
    })).toEqual({ contract: true, executable: true, runtime: true, skill: true })
  })

  test('does not treat source reads or a failed runtime tool as runtime evidence', async () => {
    root = await mkdtemp(join(tmpdir(), 'native-tool-provenance-'))
    for (const [toolUseID, toolName, eventType] of [
      ['read-a', 'Read', 'tool.completed'],
      ['skill-a', 'Skill', 'tool.completed'],
      ['runtime-a', 'ExecuteExtraTool', 'tool.failed'],
    ] as const) {
      observeNativeToolProvenance({
        dataRoot: root,
        sessionId: 'session-a',
        eventType,
        payload: { toolUseID, toolName, parentToolUseID: 'validator-agent' },
        createdAt: new Date(),
      })
    }

    expect(getNativeValidatorToolCapabilities({
      dataRoot: root,
      sessionId: 'session-a',
      validatorToolUseID: 'validator-agent',
    })).toEqual({ contract: false, executable: false, runtime: false, skill: true })
  })
})

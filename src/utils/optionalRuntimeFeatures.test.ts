import { expect, test } from 'bun:test'
import { isVerificationAgentEnabled, isAwaySummaryEnabled } from './optionalRuntimeFeatures'
import { getFlagSettingsInline, setFlagSettingsInline } from '../bootstrap/state'
import { getSettingsForSource } from './settings/settings'
import { resetSettingsCache } from './settings/settingsCache'
import { nativeRuntimeFeatureSettings } from '../../packages/agent-workflow-server/src/runtime-settings-store'
import { isAutoMemoryEnabled, isExtractModeActive } from '../memdir/paths'

test('CLI settings schema retains dashboard feature flags and memory off suppresses background extraction', () => {
  const previousSettings = getFlagSettingsInline()
  const previousMemory = process.env.BGS_DISABLE_AUTO_MEMORY
  try {
    for (const enabled of [true, false]) {
      const native = nativeRuntimeFeatureSettings({
        autoMemoryEnabled: enabled, autoDreamEnabled: enabled, verificationAgentEnabled: enabled,
      })
      setFlagSettingsInline(native)
      resetSettingsCache()
      const loaded = getSettingsForSource('flagSettings')
      expect(loaded).toEqual(native)
      process.env.BGS_DISABLE_AUTO_MEMORY = loaded!.env!.BGS_DISABLE_AUTO_MEMORY
      expect(isAutoMemoryEnabled()).toBe(enabled)
      if (!enabled) expect(isExtractModeActive()).toBe(false)
    }
  } finally {
    setFlagSettingsInline(previousSettings)
    resetSettingsCache()
    if (previousMemory === undefined) delete process.env.BGS_DISABLE_AUTO_MEMORY
    else process.env.BGS_DISABLE_AUTO_MEMORY = previousMemory
  }
})

test('public feature switches override gates in either direction without changing identity', () => {
  const keys = ['CLAUDE_CODE_VERIFICATION_AGENT_ENABLED', 'CLAUDE_CODE_AWAY_SUMMARY_ENABLED'] as const
  const previous = keys.map(key => process.env[key])
  const identity = process.env.USER_TYPE
  try {
    for (const [value, expected] of [['0', false], ['1', true], ['false', false], ['true', true]] as const) {
      for (const key of keys) process.env[key] = value
      expect(isVerificationAgentEnabled()).toBe(expected)
      expect(isAwaySummaryEnabled()).toBe(expected)
    }
    expect(process.env.USER_TYPE).toBe(identity)
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]
    })
  }
})

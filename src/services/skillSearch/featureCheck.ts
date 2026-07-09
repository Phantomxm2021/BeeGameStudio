import { feature } from 'bun:bundle'
import { getInitialSettings } from '../../utils/settings/settings.js'

/**
 * Build-time presence check: is the `/skill-search` slash command compiled
 * into this build? Used by the command registry's `isEnabled` so the
 * command appears in the menu whenever it is buildable. Runtime activation is
 * read from BeeGame/admin-provided runtime settings when present.
 */
export function isSkillSearchCompiledIn(): boolean {
  if (feature('EXPERIMENTAL_SKILL_SEARCH')) return true
  return false
}

export function getSkillSearchSettingsValue(): boolean | undefined {
  return getInitialSettings().skillSearchEnabled
}

/**
 * Runtime activation check: is the skill-search subsystem currently doing
 * work (intentNormalize Haiku calls, prefetch hot path, telemetry)?
 * BeeGame platform/runtime settings are the source of truth when present.
 * `SKILL_SEARCH_ENABLED` remains a fallback for legacy CLI sessions and tests.
 *
 * Build-flag gating is intentionally NOT performed here: the command
 * registry already gates command compilation on the build flag, and this
 * function is only reached from code paths that the build flag has
 * already let through. Decoupling keeps the test surface clean (tests
 * exercise the env-var contract without needing to mock `bun:bundle`).
 */
export function isSkillSearchEnabled(): boolean {
  const settingsValue = getSkillSearchSettingsValue()
  if (settingsValue !== undefined) return settingsValue
  return process.env.SKILL_SEARCH_ENABLED === '1'
}

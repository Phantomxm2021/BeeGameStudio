import { describe, expect, test } from 'bun:test'
import {
  GAME_PRODUCTION_DOCUMENT_PATHS,
  GAME_PRODUCTION_PLAN_DIRECTORY,
  GAME_PRODUCTION_PLAN_INDEX_PATH,
  withGameProductionPlanningContract,
} from './production-planning-contract'

describe('game production planning contract', () => {
  test('defines the complete platform-neutral production bundle', () => {
    expect(GAME_PRODUCTION_DOCUMENT_PATHS).toEqual([
      'docs/production-brief.json',
      'docs/specs/GDD.md',
      'docs/specs/TECHNICAL_DESIGN.md',
      'docs/specs/ART_DIRECTION.md',
      'docs/specs/UI_UX_SPEC.md',
      'docs/specs/AUDIO_DESIGN.md',
      'docs/specs/LEVEL_CONTENT_DESIGN.md',
      'docs/specs/ASSET_PLAN.md',
      'docs/specs/ACCEPTANCE_CRITERIA.md',
      'assets/asset-manifest.json',
      'docs/delivery-contract.json',
    ])
  })

  test('requires native document review, persisted writing plan and bounded implementation', () => {
    const prompt = withGameProductionPlanningContract('confirmed brief')

    expect(prompt).toContain('confirmed brief')
    for (const path of GAME_PRODUCTION_DOCUMENT_PATHS) expect(prompt).toContain(path)
    expect(prompt).toContain('Claude Code is the only task state machine')
    expect(prompt.indexOf('First invoke the applicable game-production skills')).toBeLessThan(
      prompt.indexOf('create and read the complete production document bundle'),
    )
    expect(prompt).toContain('beegame-production-reviewer')
    expect(prompt).toContain('run_in_background=false')
    expect(prompt).toContain('must converge')
    expect(prompt).toContain('Never re-run an unchanged bundle')
    expect(prompt).toContain('Only unresolved blocking contradictions')
    expect(prompt).toContain('deterministic document, asset-contract and delivery-contract checks')
    expect(prompt).toContain('scope leakage')
    expect(prompt).toContain('scope proportional to the approved MVP')
    expect(prompt).toContain('sourceRef locator must be copied verbatim')
    expect(prompt).toContain('native Skill tool')
    expect(prompt).toContain('writing-plans')
    expect(prompt).toContain(GAME_PRODUCTION_PLAN_DIRECTORY)
    expect(prompt).toContain(GAME_PRODUCTION_PLAN_INDEX_PATH)
    expect(prompt).toContain('requirement-to-evidence index')
    expect(prompt).toContain('do not embed complete source files')
    expect(prompt).toContain('executing-plans')
    expect(prompt).toContain('subagent-driven-development')
    expect(prompt).toContain('Read the saved plan back')
    expect(prompt).toContain('sole implementation progress source')
    expect(prompt).toContain('After resume or compaction')
    expect(prompt).toContain('smallest playable vertical slice')
    expect(prompt).toContain('beegame-acceptance-validator')
    expect(prompt).toContain('missing, empty, truncated or non-JSON validator result')
    expect(prompt).toContain('docs/validation-report.md')
    expect(prompt).toContain('Do not assume or hardcode a platform')
  })

  test('defines deterministic brief precedence without keyword matching', () => {
    const prompt = withGameProductionPlanningContract('confirmed brief')

    expect(prompt).toContain('Explicit user settings override recommendation fields')
    expect(prompt).toContain('MVP/prototype scope is distinct from the longer-term product vision')
    expect(prompt).toContain('Compare structured claims and their provenance, never keywords')
  })
})

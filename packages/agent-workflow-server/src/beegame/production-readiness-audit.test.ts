import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  GAME_PRODUCTION_DOCUMENT_PATHS,
  GAME_PRODUCTION_PLAN_INDEX_PATH,
} from './production-planning-contract'
import {
  auditGameProductionDocumentBundle,
  auditGameProductionReadiness,
  evaluateProductionMutationGate,
} from './production-readiness-audit'

describe('game production readiness audit', () => {
  test('allows planning artifacts but blocks implementation writes before valid contracts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-gate-'))

    expect(evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Write',
      toolInput: { file_path: join(workspace, 'docs/specs/GDD.md') },
      toolReadOnly: false,
    })).toEqual({ allowed: true })

    const briefDecision = evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Edit',
      toolInput: { file_path: join(workspace, 'docs/production-brief.json') },
      toolReadOnly: false,
    })
    expect(briefDecision.allowed).toBe(false)
    expect(briefDecision.message).toContain('immutable host-materialized user input')

    const decision = evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Write',
      toolInput: { file_path: join(workspace, 'src/game.ts') },
      toolReadOnly: false,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toContain('Required production artifact is missing or empty')

    const shellDecision = evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Bash',
      toolInput: { command: 'project-native-build-command' },
      toolReadOnly: false,
    })
    expect(shellDecision.allowed).toBe(false)

    expect(evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Bash',
      toolInput: { command: 'an arbitrary command classified by the native tool' },
      toolReadOnly: true,
    })).toEqual({ allowed: true })
  })

  test('accepts a complete platform-neutral production bundle', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-ready-'))
    for (const path of GAME_PRODUCTION_DOCUMENT_PATHS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), path.endsWith('.json') ? '{}' : '# specification\n')
    }
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: [] },
      slots: [],
    }))
    await writeFile(join(workspace, 'docs/delivery-contract.json'), JSON.stringify({
      version: 1,
      requirements: [{
        id: 'REQ-1',
        title: 'Observable behavior',
        scope: 'mvp',
        evidenceRequired: ['runtime'],
        sourceRefs: [{ path: 'docs/specs/GDD.md', locator: 'specification' }],
      }],
      requiredCapabilities: [],
      playerPaths: [{
        id: 'PATH-1',
        requirementIds: ['REQ-1'],
        phases: {
          entry: [{ action: { type: 'project-native-entry' }, assertions: [{ type: 'entry-visible' }] }],
          core_action: [{ action: { type: 'project-native-action' }, assertions: [{ type: 'state-changed' }] }],
          state_change: [{ action: { type: 'observe-state' }, assertions: [{ type: 'state-observed' }] }],
          completion: [{ action: { type: 'complete-session' }, assertions: [{ type: 'completion-visible' }] }],
          recovery: [{ action: { type: 'restart-session' }, assertions: [{ type: 'restart-succeeds' }] }],
        },
      }],
    }))
    await mkdir(join(workspace, 'docs/superpowers/plans'), { recursive: true })
    await writeFile(join(workspace, 'docs/superpowers/plans/implementation.md'), '# plan\n')
    await writeFile(join(workspace, GAME_PRODUCTION_PLAN_INDEX_PATH), JSON.stringify({
      version: 1,
      planPath: 'docs/superpowers/plans/implementation.md',
      tasks: [{
        id: 'TASK-1',
        requirementIds: ['REQ-1'],
        playerPathIds: ['PATH-1'],
        files: ['source/runtime.file'],
        assetSlotIds: [],
        preconditions: [{ description: 'Approved contract exists.' }],
        actions: [{ description: 'Implement the observable vertical slice.' }],
        assertions: [{ description: 'The player-visible state changes.' }],
        check: {
          command: 'project-native-focused-check',
          assertions: [{ description: 'The focused check exits successfully.' }],
        },
      }],
    }))

    expect(auditGameProductionDocumentBundle(workspace)).toMatchObject({ valid: true })
    expect(auditGameProductionReadiness(workspace)).toMatchObject({ valid: true })
    expect(evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Edit',
      toolInput: { file_path: join(workspace, 'source/runtime.file') },
      toolReadOnly: false,
    })).toEqual({ allowed: true })
  })

  test('rejects an unindexed source dump masquerading as an implementation plan', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-plan-audit-'))
    for (const path of GAME_PRODUCTION_DOCUMENT_PATHS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), path.endsWith('.json') ? '{}' : '# specification\n')
    }
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: [] },
      slots: [],
    }))
    await writeFile(join(workspace, 'docs/delivery-contract.json'), JSON.stringify({
      version: 1,
      requirements: [{
        id: 'REQ-1',
        title: 'Observable behavior',
        scope: 'mvp',
        evidenceRequired: ['runtime'],
        sourceRefs: [{ path: 'docs/specs/GDD.md', locator: 'specification' }],
      }],
      requiredCapabilities: [],
      playerPaths: [{
        id: 'PATH-1',
        requirementIds: ['REQ-1'],
        phases: {
          entry: [{ action: { type: 'entry' }, assertions: [{ type: 'visible' }] }],
          core_action: [{ action: { type: 'act' }, assertions: [{ type: 'changed' }] }],
          state_change: [{ action: { type: 'observe' }, assertions: [{ type: 'observed' }] }],
          completion: [{ action: { type: 'finish' }, assertions: [{ type: 'finished' }] }],
          recovery: [{ action: { type: 'restart' }, assertions: [{ type: 'restarted' }] }],
        },
      }],
    }))
    await mkdir(join(workspace, 'docs/superpowers/plans'), { recursive: true })
    await writeFile(join(workspace, 'docs/superpowers/plans/implementation.md'), [
      '# plan',
      '```text',
      ...Array.from({ length: 41 }, (_, index) => `source line ${index}`),
      '```',
    ].join('\n'))
    await writeFile(join(workspace, GAME_PRODUCTION_PLAN_INDEX_PATH), JSON.stringify({
      version: 1,
      planPath: 'docs/superpowers/plans/implementation.md',
      tasks: [{
        id: 'TASK-1',
        requirementIds: ['REQ-1'],
        playerPathIds: ['PATH-1'],
        files: ['source/runtime.file'],
        assetSlotIds: [],
        preconditions: [{ description: 'Approved contract exists.' }],
        actions: [{ description: 'Implement the observable vertical slice.' }],
        assertions: [{ description: 'The player-visible state changes.' }],
        check: {
          command: 'project-native-focused-check',
          assertions: [{ description: 'The focused check exits successfully.' }],
        },
      }],
    }))

    const audit = auditGameProductionReadiness(workspace)
    expect(audit.valid).toBe(false)
    expect(audit.issues).toContain('Implementation plan contains a fenced code block longer than 40 lines; move complete source into implementation tasks.')
  })

  test('blocks the production reviewer on deterministic contract errors without requiring a plan first', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-review-'))
    for (const path of GAME_PRODUCTION_DOCUMENT_PATHS) {
      await mkdir(join(workspace, path, '..'), { recursive: true })
      await writeFile(join(workspace, path), path.endsWith('.json') ? '{}' : '# Approved section\n')
    }
    await writeFile(join(workspace, 'assets/asset-manifest.json'), JSON.stringify({
      project_target: { asset_format_capabilities: [] },
      slots: [],
    }))
    await writeFile(join(workspace, 'docs/delivery-contract.json'), JSON.stringify({
      version: 1,
      requirements: [{
        id: 'REQ-1',
        title: 'Observable behavior',
        scope: 'mvp',
        evidenceRequired: ['runtime'],
        sourceRefs: [{ path: 'docs/specs/GDD.md', locator: 'Missing section' }],
      }],
      requiredCapabilities: [],
      playerPaths: [{
        id: 'PATH-1',
        requirementIds: ['REQ-1'],
        phases: {
          entry: [{ action: { type: 'entry' }, assertions: [{ type: 'visible' }] }],
          core_action: [{ action: { type: 'act' }, assertions: [{ type: 'changed' }] }],
          state_change: [{ action: { type: 'observe' }, assertions: [{ type: 'observed' }] }],
          completion: [{ action: { type: 'finish' }, assertions: [{ type: 'finished' }] }],
          recovery: [{ action: { type: 'restart' }, assertions: [{ type: 'restarted' }] }],
        },
      }],
    }))

    const decision = evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: true,
      toolName: 'Agent',
      toolInput: { subagent_type: 'beegame-production-reviewer' },
      toolReadOnly: true,
    })
    expect(decision.allowed).toBe(false)
    expect(decision.message).toContain('sourceRef locator does not exist')
    expect(decision.message).not.toContain('implementation plan')
  })

  test('does not apply the production gate to ordinary non-build sessions', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'beegame-production-optional-'))
    expect(evaluateProductionMutationGate({
      workspacePath: workspace,
      productionContractRequired: false,
      toolName: 'Write',
      toolInput: { file_path: join(workspace, 'source/runtime.file') },
      toolReadOnly: false,
    })).toEqual({ allowed: true })
  })
})

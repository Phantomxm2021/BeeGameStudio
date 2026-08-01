import { describe, expect, test } from 'bun:test'
import { buildWorkerPrompt } from './worker-prompts'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import type { WorkerDispatchRequest } from './types'

describe('resource-content worker prompts', () => {
  test('instructs one JSON/YAML resource lane', () => {
    const request: WorkerDispatchRequest = {
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'resource-preparer', phase: 'RESOURCE_PREPARATION', revision: 'revision',
      contract: {},
    }
    const prompt = buildWorkerPrompt(request)
    expect(prompt).toContain('JSON')
    expect(prompt).toContain('YAML')
    expect(prompt).toContain('schema-valid JSON/YAML content files')
    expect(prompt).toContain('events, waves and numeric configuration as JSON')
    expect(prompt).toContain('world, scene, hierarchy and instance placement as YAML')
    expect(prompt).toContain('event-definitions, wave-definitions')
  })

  test('requires authors and reviewers to keep one resource loading path', () => {
    const authorPrompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
      contract: {
        documentSet: 'foundation',
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(authorPrompt).toContain('exactly one resource loading path')
    expect(authorPrompt).toContain('Never specify a fallback after the placeholder')
    expect(authorPrompt).toContain('contract.systemDeliveryContract')
    expect(authorPrompt).toContain('assets/asset-manifest.json')
    expect(authorPrompt).toContain('beegame-content-v1')

    const reviewerPrompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-reviewer', phase: 'DOCUMENT_REVIEW', revision: 'revision',
      contract: { reviewScope: 'foundation', reviewMode: 'initial' },
    })
    expect(reviewerPrompt).toContain('technical_feasibility')
    expect(reviewerPrompt).toContain('never a runtime/source substitute or second loader')
    expect(reviewerPrompt).toContain('project documents that agree with each other but conflict with systemDeliveryContract')
  })

  test('requires structured strategy, economy, numeric and pacing derivations', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-reviewer', phase: 'DOCUMENT_REVIEW', revision: 'revision',
      contract: { reviewScope: 'foundation', reviewMode: 'initial' },
    })
    expect(prompt).toContain('gameplay_strategy_viability')
    expect(prompt).toContain('economy_progression_integrity')
    expect(prompt).toContain('numeric_balance_feasibility')
    expect(prompt).toContain('pacing_difficulty_coherence')
    expect(prompt).toContain('level_scene_design_integrity')
    expect(prompt).toContain('spatial_gameplay_support')
    expect(prompt).toContain('scene_state_completeness')
    expect(prompt).toContain('Use only cited document facts')
    expect(prompt).toContain('not final feel or empirical balance')
  })

  test('assigns the eight foundation documents one fact owner each', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
      contract: {
        documentSet: 'foundation',
        systemDeliveryContract: buildSystemDeliveryContract(),
      },
    })
    expect(prompt).toContain('eight canonical foundation documents')
    expect(prompt).toContain('BALANCE_DESIGN owns')
    expect(prompt).toContain('LEVEL_SCENE_DESIGN owns')
    expect(prompt).toContain('Events, waves and numeric configuration')
    expect(prompt).toContain('world, scene, hierarchy and instance placement')
  })
})

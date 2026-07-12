import { describe, expect, test } from 'bun:test'
import {
  buildDeliveryRepairPrompt,
  createDeliveryContract,
  createDeliveryGateFailure,
  parseDeliveryReview,
} from './delivery-contract'

describe('delivery contract', () => {
  test('requires runtime evidence before accepting an MVP player path', () => {
    const review = parseDeliveryReview(JSON.stringify({
      status: 'passed',
      summary: 'Reviewed.',
      requiredCapabilities: ['skill:game-acceptance'],
      requirements: [{
        id: 'core-loop',
        title: 'Core player path',
        scope: 'mvp',
        status: 'accepted',
        evidenceRequired: ['implementation', 'runtime'],
        evidence: [{ kind: 'implementation', eventId: 'read-1', detail: 'Entry point inspected.' }],
      }],
      findings: [],
    }))

    expect(review).toBeDefined()
    const contract = createDeliveryContract(review!, ['skill:game-acceptance'])
    expect(contract.status).toBe('untested')
  })

  test('accepts only requirements with complete evidence and verified capabilities', () => {
    const review = parseDeliveryReview(JSON.stringify({
      status: 'passed',
      summary: 'Reviewed.',
      requiredCapabilities: ['skill:game-acceptance'],
      requirements: [{
        id: 'core-loop',
        title: 'Core player path',
        scope: 'mvp',
        status: 'runtime_verified',
        evidenceRequired: ['implementation', 'runtime'],
        evidence: [
          { kind: 'implementation', eventId: 'read-1', detail: 'Entry point inspected.' },
          { kind: 'runtime', eventId: 'run-1', detail: 'Player path assertions passed.' },
        ],
      }],
      findings: [{
        requirementId: 'core-loop',
        requirement: 'Core player path',
        status: 'passed',
        detail: 'Verified.',
        evidence: [{ kind: 'runtime', eventId: 'run-1', detail: 'Assertions passed.' }],
      }],
    }))

    const contract = createDeliveryContract(review!, ['skill:game-acceptance'])
    expect(contract.status).toBe('passed')
  })

  test('rejects malformed or duplicate requirement contracts', () => {
    expect(parseDeliveryReview(JSON.stringify({
      status: 'passed',
      summary: 'Invalid.',
      requirements: [
        { id: 'same', title: 'One', scope: 'mvp', status: 'accepted', evidenceRequired: [], evidence: [] },
        { id: 'same', title: 'Two', scope: 'mvp', status: 'accepted', evidenceRequired: [], evidence: [] },
      ],
      findings: [],
    }))).toBeUndefined()
  })

  test('preserves structured performance metrics and environment evidence', () => {
    const review = parseDeliveryReview(JSON.stringify({
      status: 'passed',
      summary: 'Measured.',
      requirements: [{
        id: 'performance', title: 'Performance baseline', scope: 'mvp', status: 'runtime_verified',
        evidenceRequired: ['runtime'],
        evidence: [{
          kind: 'runtime', eventId: 'measure-1', detail: 'Measured by adapter.',
          metrics: { frame_time_ms: 12.5, startup_ms: 850 },
          environment: { adapter: 'runtime-adapter-a', profile: 'baseline', accelerated: true },
        }],
      }],
      findings: [],
    }))

    expect(review?.requirements[0]?.evidence[0]).toEqual(expect.objectContaining({
      metrics: { frame_time_ms: 12.5, startup_ms: 850 },
      environment: { adapter: 'runtime-adapter-a', profile: 'baseline', accelerated: true },
    }))
  })

  test('builds a platform-neutral repair prompt from unresolved contract entries', () => {
    const prompt = buildDeliveryRepairPrompt({
      version: 1,
      status: 'failed',
      summary: 'Core path failed.',
      requirements: [{
        id: 'core-loop',
        title: 'Core loop',
        scope: 'mvp',
        status: 'failed',
        evidenceRequired: ['runtime'],
        evidence: [],
      }],
      requiredCapabilities: [],
      verifiedCapabilities: [],
    }, 1)

    expect(prompt).toContain('Core loop')
    expect(prompt).toContain('runtime')
    expect(prompt).toContain('project-selected platform adapter')
    expect(prompt).not.toContain('tactical-breach-fps')
  })

  test('blocks deployment until the evidence-backed review passes', () => {
    expect(createDeliveryGateFailure(null)).toMatchObject({ status: 'unreviewed' })
    expect(createDeliveryGateFailure({ status: 'failed', summary: 'Player path failed.' })).toMatchObject({
      code: 'delivery_not_accepted',
      status: 'failed',
      summary: 'Player path failed.',
    })
    expect(createDeliveryGateFailure({ status: 'passed', summary: 'Accepted.' })).toBeNull()
  })
})

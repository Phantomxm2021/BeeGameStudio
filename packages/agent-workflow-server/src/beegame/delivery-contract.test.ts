import { describe, expect, test } from 'bun:test'
import {
  createDeliveryContract,
  createDeliveryGateFailure,
  parseDeliveryReview,
  parseDeliveryValidatorReport,
} from './delivery-contract'

describe('delivery contract', () => {
  test('accepts only the expected validator identity and host-owned evidence provenance', () => {
    const report = {
      validatorId: 'beegame-acceptance-validator',
      status: 'passed',
      summary: 'Conforms.',
      requirements: [{
        id: 'core-loop',
        status: 'passed',
        evidence: [{ kind: 'implementation', source: 'src/main.ts', detail: 'Observed.' }],
      }],
      playerPaths: [{
        id: 'main-path',
        status: 'passed',
        evidence: [{ kind: 'runtime', source: 'main-path', detail: 'Observed.' }],
      }],
      findings: [],
      verifiedCapabilities: [],
    }
    expect(parseDeliveryValidatorReport(
      JSON.stringify(report),
      'beegame-acceptance-validator',
    )).toBeDefined()
    expect(parseDeliveryValidatorReport(
      JSON.stringify(report),
      'project-helper',
    )).toBeUndefined()
    expect(parseDeliveryValidatorReport(JSON.stringify({
      ...report,
      requirements: [{
        ...report.requirements[0],
        evidence: [{ kind: 'implementation', eventId: 'forged', detail: 'Claimed.' }],
      }],
    }), 'beegame-acceptance-validator')).toBeUndefined()
  })

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

  test('reports unavailable required validation capabilities as a blocker', () => {
    const review = parseDeliveryReview(JSON.stringify({
      status: 'passed',
      summary: 'Runtime behavior passed.',
      requiredCapabilities: ['skill:runtime-acceptance'],
      requirements: [{
        id: 'core-loop', title: 'Core loop', scope: 'mvp', status: 'runtime_verified',
        evidenceRequired: ['runtime'],
        evidence: [{ kind: 'runtime', eventId: 'runtime-1', source: 'main-path', detail: 'passed' }],
      }],
      findings: [],
    }))

    const contract = createDeliveryContract(review!, [])
    expect(contract.status).toBe('blocked')
    expect(contract.summary).toContain('Missing required validation capabilities')
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
          kind: 'runtime', eventId: 'measure-1', detail: 'Measured by the project toolchain.',
          metrics: { frame_time_ms: 12.5, startup_ms: 850 },
          environment: { toolchain: 'project-native', profile: 'baseline', accelerated: true },
        }],
      }],
      findings: [],
    }))

    expect(review?.requirements[0]?.evidence[0]).toEqual(expect.objectContaining({
      metrics: { frame_time_ms: 12.5, startup_ms: 850 },
      environment: { toolchain: 'project-native', profile: 'baseline', accelerated: true },
    }))
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

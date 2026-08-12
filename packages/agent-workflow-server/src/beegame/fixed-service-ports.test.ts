import { describe, expect, test } from 'bun:test'
import {
  BEEGAME_FIXED_SERVICE_PORTS,
  assertFixedServicePortConfiguration,
  assertFixedServicePortsAvailable,
} from './fixed-service-ports'

describe('fixed Bee Game Studio service ports', () => {
  test('exposes one immutable allocation and rejects every conflicting override', () => {
    expect(BEEGAME_FIXED_SERVICE_PORTS).toEqual({
      frontend: 62173,
      runtime: 62174,
      billing: 62175,
      skills: 62176,
      resources: 62177,
    })
    expect(Object.isFrozen(BEEGAME_FIXED_SERVICE_PORTS)).toBe(true)
    expect(() =>
      assertFixedServicePortConfiguration({
        argv: [],
        env: {
          VITE_PORT: '62173',
          AGENT_WORKFLOW_PORT: '62174',
          BEEGAME_BILLING_PORT: '62175',
          BEEGAME_SKILLS_PORT: '62176',
          BEEGAME_RESOURCE_PORT: '62177',
        },
      }),
    ).not.toThrow()
    expect(() =>
      assertFixedServicePortConfiguration({
        argv: ['--runtime-port', '50174'],
        env: {},
      }),
    ).toThrow(/fixed.*runtime.*62174/i)
    expect(() =>
      assertFixedServicePortConfiguration({
        argv: [],
        env: { VITE_PORT: '50173' },
      }),
    ).toThrow(/VITE_PORT.*62173/i)
  })

  test('reports the exact occupied service and owner before startup', async () => {
    await expect(
      assertFixedServicePortsAvailable({
        probe: async port => port !== BEEGAME_FIXED_SERVICE_PORTS.runtime,
        owner: async port => `pid=442 command=test-server port=${port}`,
      }),
    ).rejects.toThrow(
      'runtime fixed port 62174 is occupied: pid=442 command=test-server port=62174',
    )
  })
})

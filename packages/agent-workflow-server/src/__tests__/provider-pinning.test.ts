import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetAgentWorkflow } from '@bee-game-studio/agent-workflow'
import type { ApprovedOutboundTarget } from '@bee-game-studio/security-core'
import { createAgentWorkflowApp, type AgentWorkflowAppOptions } from '../app'

const providerUrl = 'https://provider.example.test/v1'
const privateProviderUrl = 'https://127.0.0.1/v1'

const approvedProviderTarget: ApprovedOutboundTarget = {
  url: new URL(providerUrl),
  addresses: ['93.184.216.34'],
  lookup: (_hostname, _options, callback) => callback(null, '93.184.216.34', 4),
}

describe('OpenAI-compatible provider pinning', () => {
  let testRoot = ''
  let originalFetch: typeof fetch

  beforeEach(async () => {
    resetAgentWorkflow()
    testRoot = await mkdtemp(join(tmpdir(), 'provider-pinning-'))
    originalFetch = globalThis.fetch
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    await rm(testRoot, { recursive: true, force: true })
  })

  test('uses pinned dispatchers for approved intake and attachment provider requests', async () => {
    const app = createApp(async () => approvedProviderTarget)
    await createDefaultModelConfig(app)
    const calls: Array<{
      url: string
      init: RequestInit & { dispatcher?: unknown }
    }> = []
    globalThis.fetch = (async (url, init) => {
      calls.push({
        url: String(url),
        init: init as RequestInit & { dispatcher?: unknown },
      })
      return Response.json(
        calls.length === 1 ? intakeResponse() : attachmentResponse(),
      )
    }) as typeof fetch

    const intake = await app.request('/api/beegame-intake/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea: 'A small puzzle game' }),
    })
    const attachment = await app.request(
      '/api/beegame-intake/analyze-attachments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attachments: [
            {
              type: 'file',
              mediaType: 'text/markdown',
              filename: 'design.md',
              data: Buffer.from('# Design').toString('base64'),
            },
          ],
        }),
      },
    )

    expect(intake.status).toBe(200)
    expect(attachment.status).toBe(200)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe(`${providerUrl}/chat/completions`)
      expect(call.init.redirect).toBe('error')
      expect(call.init.dispatcher).toBeDefined()
    }
  })

  test('rejects a private provider target at request time without fetching it', async () => {
    let allowProvider = true
    const app = createApp(async value =>
      allowProvider ? approvedTarget(value) : null,
    )
    await createDefaultModelConfig(app, privateProviderUrl)
    allowProvider = false
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return Response.json({})
    }) as unknown as typeof fetch

    const response = await app.request('/api/beegame-intake/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea: 'A small puzzle game' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Outbound URL is not permitted',
    })
    expect(fetchCalls).toBe(0)
  })

  function createApp(
    outboundTargetResolver: NonNullable<
      AgentWorkflowAppOptions['outboundTargetResolver']
    >,
  ) {
    return createAgentWorkflowApp({
      defaultWorkspacePath: testRoot,
      currentUser: { id: 'provider-pinning-user', role: 'owner' },
      skillsConfig: false,
      outboundTargetPolicyOptions: { allowedHosts: ['provider.example.test'] },
      outboundTargetResolver,
    })
  }
})

async function createDefaultModelConfig(
  app: ReturnType<typeof createAgentWorkflowApp>,
  baseUrl = providerUrl,
): Promise<void> {
  const response = await app.request('/api/model-configs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Pinned provider',
      provider: 'openai-compatible',
      baseUrl,
      apiKey: 'test-api-key',
      models: { balanced: 'test-model' },
      isDefault: true,
    }),
  })
  expect(response.status).toBe(200)
}

function approvedTarget(value: string): ApprovedOutboundTarget {
  return { ...approvedProviderTarget, url: new URL(value) }
}

function intakeResponse(): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            maturity: 'concrete',
            options: [
              {
                title: 'Puzzle Sprint',
                gameplay: 'Solve spatial puzzles before the timer expires.',
                recommendedPlatform: 'Web',
                recommendedEngine: 'React',
                recommendedDimension: '2D',
                recommendedGenre: 'Puzzle',
                recommendedStyle: 'Minimal',
                recommendedInputs: ['Keyboard/mouse'],
              },
              {
                title: 'Puzzle Relay',
                gameplay: 'Complete linked spatial puzzles under a shared limit.',
                recommendedPlatform: 'Web',
                recommendedEngine: 'React',
                recommendedDimension: '2D',
                recommendedGenre: 'Puzzle',
                recommendedStyle: 'Minimal',
                recommendedInputs: ['Keyboard/mouse'],
              },
              {
                title: 'Puzzle Endurance',
                gameplay: 'Solve an escalating sequence of spatial puzzles.',
                recommendedPlatform: 'Web',
                recommendedEngine: 'React',
                recommendedDimension: '2D',
                recommendedGenre: 'Puzzle',
                recommendedStyle: 'Minimal',
                recommendedInputs: ['Keyboard/mouse'],
              },
            ],
          }),
        },
      },
    ],
  }
}

function attachmentResponse(): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            analysisId: 'fixture-analysis',
            sourceType: 'gdd',
            completeness: 'complete',
            confirmedFacts: [],
            inferredDesign: [],
            missingFields: [],
            conflicts: [],
            gddDraft: '# Design',
          }),
        },
      },
    ],
  }
}

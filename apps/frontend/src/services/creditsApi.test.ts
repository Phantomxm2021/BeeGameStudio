import { beforeEach, describe, expect, it, vi } from 'vitest'

import apiClient from './apiClient'
import { getCreditSummary, getCreditBalance } from './creditsApi'

vi.mock('./apiClient', () => ({
  default: {
    get: vi.fn(),
  },
}))

describe('creditsApi', () => {
  const mockGet = apiClient.get as unknown as {
    mockResolvedValue: (value: unknown) => void
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps the unwrapped realtime usage summary for an existing project', async () => {
    mockGet.mockResolvedValue({
      eventsCount: 4,
      promptTokens: 80_000,
      completionTokens: 15_000,
      cacheReadTokens: 25_000,
      cacheCreationTokens: 5_000,
      totalTokens: 125_000,
      weightedTokens: 125_000,
      creditsMicro: 2_750_000,
    })

    await expect(getCreditSummary('project-1')).resolves.toEqual({
      entriesCount: 4,
      inputTokens: 80_000,
      cacheReadTokens: 25_000,
      cacheCreationTokens: 5_000,
      outputTokens: 15_000,
      totalTokens: 125_000,
      consumedCredits: 2.75,
      weightedTokens: 125_000,
    })
    expect(apiClient.get).toHaveBeenCalledWith('/api/usage/summary', {
      params: { projectId: 'project-1' },
    })
  })

  it('keeps background balance and summary failures out of the global task toast', async () => {
    const error = Object.assign(new Error('timeout'), { code: 'request_timeout' });
    vi.mocked(apiClient.get).mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    await expect(getCreditSummary('project-1', true)).rejects.toBe(error);
    await expect(getCreditBalance(true)).rejects.toBe(error);
    expect(apiClient.get).toHaveBeenCalledWith('/api/usage/summary', {
      params: { projectId: 'project-1' }, headers: { 'Hide-Error-Toast': 'true' },
    });
    expect(apiClient.get).toHaveBeenCalledWith('/api/usage-wallet', { headers: { 'Hide-Error-Toast': 'true' } });
  });

  it('keeps an empty project summary at zero', async () => {
    mockGet.mockResolvedValue({
      eventsCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      weightedTokens: 0,
      creditsMicro: 0,
    })

    await expect(getCreditSummary()).resolves.toEqual({
      entriesCount: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      consumedCredits: 0,
      weightedTokens: 0,
    })
    expect(apiClient.get).toHaveBeenCalledWith('/api/usage/summary', {})
  })
})

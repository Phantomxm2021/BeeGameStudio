import { describe, expect, test } from 'bun:test'
import {
  selectNativeWriteLimit,
  type WriteLimitEvidence,
} from './measure-native-document-write'

function run(
  limit: 8192 | 10240 | 12288,
  rawProcessedTokens: number,
): WriteLimitEvidence {
  return {
    limit,
    success: true,
    canonicalValid: true,
    timeToFirstToolMs: 1_000,
    maximumSilentGapMs: 30_000,
    durationMs: 60_000,
    inputTokens: rawProcessedTokens - 20_000,
    cacheReadTokens: 10_000,
    outputTokens: 10_000,
    rawProcessedTokens,
    writeCalls: 4,
    fileBytes: 40_000,
  }
}

describe('native document Write limit selection', () => {
  test('retains 8K unless every larger run passes and clears its token threshold', () => {
    const evidence = [
      ...[100_000, 101_000, 99_000].map(value => run(8192, value)),
      ...[95_000, 95_000, 95_000].map(value => run(10240, value)),
      ...[84_000, 85_000, 83_000].map(value => run(12288, value)),
    ]
    expect(selectNativeWriteLimit(evidence)).toBe(12288)
    expect(
      selectNativeWriteLimit(
        evidence.map(item =>
          item.limit === 12288 ? { ...item, rawProcessedTokens: 90_000 } : item,
        ),
      ),
    ).toBe(8192)
    expect(
      selectNativeWriteLimit(
        evidence.map((item, index) =>
          item.limit === 12288 && index === 6
            ? { ...item, maximumSilentGapMs: 120_001 }
            : item,
        ),
      ),
    ).toBe(8192)
  })
})

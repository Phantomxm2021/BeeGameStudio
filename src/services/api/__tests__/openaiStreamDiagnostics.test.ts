import { expect, test } from 'bun:test'

test('actual OpenAI query logs one safe summary, honors fetch overrides and never retries failures', () => {
  const fixture = Bun.spawnSync([process.execPath,
    new URL('./openaiStreamDiagnostics.fixture.ts', import.meta.url).pathname], {
    cwd: process.cwd(), env: process.env, stdout: 'pipe', stderr: 'pipe', timeout: 20000,
  })
  expect(fixture.exitCode, fixture.stderr.toString()).toBe(0)
  expect(fixture.stderr.toString()).not.toContain('PRIVATE')
  const results = JSON.parse(fixture.stdout.toString().trim().split('\n').at(-1)!)
  expect(results.normal).toEqual({ calls: 1, outcome: 'completed' })
  expect(results.emptyReasoning).toEqual({ calls: 1, outcome: 'completed' })
  expect(results.eof).toEqual({ calls: 1, outcome: 'failed', streamFailure: 'upstream_incomplete' })
  expect(results.invalid).toEqual({ calls: 1, outcome: 'failed', streamFailure: 'invalid_sse' })
  expect(results.http).toEqual({ calls: 1, outcome: 'failed', streamFailure: 'http' })
  expect(results.cancelled).toEqual({ calls: 1, outcome: 'cancelled' })
  for (const kind of ['lateText', 'lateTool', 'lateNonempty', 'absent', 'null']) {
    expect(results[kind]).toEqual({ calls: 2, reasoningPresent: !['absent', 'null'].includes(kind), persistedAndReturned: true })
  }
  for (const kind of ['bareCall', 'mixedBareCall', 'orphanToolFinish', 'invalidJson', 'arrayArguments', 'nullArguments',
    'missingId', 'missingName', 'missingIndex', 'changedId', 'contentFiltered', 'unknownFinish', 'contentAfterFinish']) {
    expect(results[kind]).toEqual({ calls: 1, errors: 1, outcome: 'failed', usageRetained: true })
  }
  for (const kind of ['structuredWrite', 'lateHeader', 'fencedExample', 'tildeExample', 'inlineExample', 'quotedExample', 'plainText', 'usageCorrection', 'otherXml']) {
    expect(results[kind]).toEqual({ calls: 1, errors: 0, outcome: 'completed', usageRetained: true })
  }
  expect(results.truncatedTool).toEqual({ calls: 1, errors: 1, outcome: 'completed', usageRetained: true })
  for (const kind of ['responsesInvalidJson', 'responsesArgumentMismatch', 'responsesNoCallId', 'responsesDuplicateId',
    'responsesOrphanArguments', 'responsesFiltered', 'responsesLength', 'responsesBadSse']) {
    expect(results[kind]).toEqual({ calls: 1, errors: 1, successfulReplies: 0 })
  }
  for (const kind of ['responsesNormal', 'responsesDoneArguments', 'responsesPrefilledArguments', 'responsesText']) {
    expect(results[kind]).toEqual({ calls: 1, errors: 0, successfulReplies: 1 })
  }
})

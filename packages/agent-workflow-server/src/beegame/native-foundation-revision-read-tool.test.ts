import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { createNativeFoundationRevisionReadTool } from './native-foundation-revision-read-tool'
import { createRevisionNativeAssignment } from './stage-modules/foundation-revision/private/native-assignment'
import { parseRevisionStart } from './stage-modules/foundation-revision/private/lifecycle-contract'
import initialInputs from './stage-modules/foundation-revision/private/tests/fixtures/public-initial-inputs.json'

type ReadTool = { call(input: unknown): Promise<{ data: { markdown: string } }> }

test('the public Revision native assignment retains its one-shot read bridge after legacy sessions retire', async () => {
  const { prepared } = parseRevisionStart(initialInputs.lifecycle.start)
  const documentPath = prepared.batches[0]!.documentPath
  const assignment = await createRevisionNativeAssignment({
    request: prepared.request, documentPath, attemptId: randomUUID(),
  })
  try {
    expect(assignment.scope).toBe('document')
    const env = assignment.bridgeEnvironment
    const contract = JSON.parse(env.BEEGAME_REVISION_CONTRACT!)
    const tool = createNativeFoundationRevisionReadTool({
      buildTool: definition => definition,
      workspacePath: env.BEEGAME_WORKSPACE_PATH!,
      expectedStagedPath: contract.stagedPath,
    }) as ReadTool
    await expect(tool.call({ path: 'different.md' })).rejects.toThrow()
    expect(await tool.call({})).toEqual({ data: {
      markdown: prepared.source.documents.find(document => document.path === documentPath)!.content,
    } })
    await expect(tool.call({})).rejects.toThrow('already read')
    const escaped = createNativeFoundationRevisionReadTool({
      buildTool: definition => definition,
      workspacePath: env.BEEGAME_WORKSPACE_PATH!,
      expectedStagedPath: '../outside.md',
    }) as ReadTool
    await expect(escaped.call({})).rejects.toThrow('escaped')
  } finally { await assignment.dispose() }
})

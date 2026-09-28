import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { beginProjectDelivery, PROJECT_DOCUMENTS, projectContentAuthority, projectDeliveryStatePath, refreshProjectContentContract } from './project-delivery'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { CONTENT_CHECKER_PATH, CONTENT_FORMAT_PATH } from './scene-ui-content-authoring'
import { auditBeeGameContentPackage } from './game-content-package'
import { BeeGameSessionManager, type BeeGamePromptInput } from './session-manager'
import { sendProjectConversation } from './project-conversation'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-content-handoff-'))
  const workspace = join(root, 'project')
  await mkdir(workspace)
  await beginProjectDelivery(workspace, root, 'Build a game')
  await mkdir(join(workspace, 'docs'))
  for (const name of PROJECT_DOCUMENTS) await writeFile(join(workspace, 'docs', name), '# Design\n')
  await mkdir(join(workspace, 'assets/runtime/example'), { recursive: true })
  await writeFile(join(workspace, 'assets/runtime/example/resource.json'), '{}')
  await writeBeeGameAssetManifest(workspace, assetManifestAuthoringExamples().canonical)
  return { root, workspace }
}

async function command(workspace: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, CONTENT_CHECKER_PATH, ...args], { cwd: workspace, stdout: 'pipe', stderr: 'pipe' })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect(stderr).toBe('')
  return { code, result: JSON.parse(stdout) }
}

test('design-time format is not a fake authority; standalone checker and host agree without changing game files', async () => {
  const { root, workspace } = await fixture()
  try {
    const format = JSON.parse(await readFile(join(workspace, CONTENT_FORMAT_PATH), 'utf8'))
    expect(format.index.documentRevision).toBeUndefined()
    expect(format.revisionFields).toContain('BGS-supplied')
    expect(format.runtimeConsumption.responsive).toContain('not permission to replace authored layout')
    expect(format.runtimeConsumption.checks['ui-layout'].outcome).toContain('text alone is not layout verification')
    expect(await Bun.file(join(workspace, '.beegame/delivery/content-contract.json')).exists()).toBe(false)
    const inputs = await refreshProjectContentContract(workspace)
    expect(inputs.validationCommand).toBe(`bun ${CONTENT_CHECKER_PATH}`)
    expect(format.sceneVocabulary.requiredData.camera.orthographicSize).toContain('pixelsPerUnit')
    expect(format.rules.join('\n')).toContain('requires node.assetRef')
    expect(format.rules.join('\n')).toContain('Shared gameplay tuning or other project-specific data')
    const authority = projectContentAuthority(workspace)
    expect((await command(workspace, '--authority')).result).toMatchObject({
      ok: true, documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
    })
    expect((await command(workspace)).result.issues).toEqual(auditBeeGameContentPackage(workspace, authority).issues)
    await mkdir(join(workspace, 'content/scenes'), { recursive: true })
    const index = { schema: 'beegame-content-package.v2', id: 'game', dimension: '2d',
      documentRevision: authority.documentRevision, assetManifestRevision: authority.assetManifestRevision,
      sceneModel: 'game-object-v2', entryScene: 'scene', files: ['scenes/main.json'] }
    const scene = { schema: 'beegame-content.v1', id: 'scene', kind: 'scene-2d', assetRefs: [],
      data: { settings: { coordinateSystem: { origin: 'top-left', units: 'logical-pixels', width: 960, height: 540, pixelsPerUnit: 100 } },
        nodes: [{ id: 'root', components: [] }] } }
    const sceneBytes = JSON.stringify(scene)
    await writeFile(join(workspace, 'content/scenes/main.json'), sceneBytes)
    for (const candidate of [index, { ...index, documentRevision: 'a'.repeat(64) }, { ...index, dimension: '2D' }]) {
      const indexBytes = JSON.stringify(candidate)
      await writeFile(join(workspace, 'content/index.json'), indexBytes)
      const host = auditBeeGameContentPackage(workspace, authority)
      const local = await command(workspace)
      expect(local.result.issues).toEqual(host.issues)
      expect(local.code).toBe(host.valid ? 0 : 1)
      expect(await readFile(join(workspace, 'content/index.json'), 'utf8')).toBe(indexBytes)
      expect(await readFile(join(workspace, 'content/scenes/main.json'), 'utf8')).toBe(sceneBytes)
    }
    await writeFile(join(workspace, 'docs/GDD.md'), '# Changed design\n')
    const current = (await command(workspace, '--authority')).result
    expect(current.documentRevision).toBe(projectContentAuthority(workspace).documentRevision)
    expect(current.documentRevision).not.toBe(inputs.documentRevision)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual native turns receive fresh phase, revision inputs and resource entry without reading the context file', async () => {
  const { root, workspace } = await fixture()
  const prompts: BeeGamePromptInput[] = []
  const resourceScripts: string[] = []
  const contentHelpers: boolean[] = []
  let starts = 0
  const manager = new BeeGameSessionManager({ async start(start) {
    starts++
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      resourceScripts.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'assets.mjs'), 'utf8'))
      contentHelpers.push(await Bun.file(join(workspace, '.beegame/tmp', start.sessionId, 'content-consumer.mjs')).exists())
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async (phase: string, origin: string) => {
      await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ version: 1, status: 'active', objective: 'Build a game', phase }))
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id, ownerId: 'owner',
        message: 'Continue', autoContinuation: true,
        openCapabilities: () => ({ instruction: 'Optional assets', resourceTools: { libraryBaseUrl: origin }, close: async () => {} }) })
      await manager.waitForSessionIdle(session.id)
    }
    await send('author', 'http://127.0.0.1:11111')
    const firstAuthority = projectContentAuthority(workspace)
    await send('content', 'http://127.0.0.1:22222')
    await writeFile(join(workspace, 'docs/GDD.md'), '# Revised\n')
    await send('content', 'http://127.0.0.1:33333')
    await send('implementation', 'http://127.0.0.1:44444')
    expect(starts).toBe(1)
    expect(JSON.stringify(prompts[0])).toContain('milestone: author')
    // The native Agent receives the assignment without a compulsory context-file
    // read. This runner deliberately never reads context.md.
    expect(JSON.stringify(prompts[0])).toContain('Write the eight implementable design documents')
    expect(JSON.stringify(prompts[1])).toContain('Deliver Scene/UI/VFX data')
    expect(JSON.stringify(prompts[1])).not.toContain('Do not start runtime implementation')
    expect(JSON.stringify(prompts[1])).toContain(firstAuthority.documentRevision)
    expect(JSON.stringify(prompts[1])).toContain('check-content.mjs')
    expect(JSON.stringify(prompts[2])).toContain(projectContentAuthority(workspace).documentRevision)
    expect(JSON.stringify(prompts[2])).not.toContain(firstAuthority.documentRevision)
    expect(JSON.stringify(prompts[2])).toContain('assets.mjs help')
    expect(resourceScripts[2]).toContain('33333')
    expect(resourceScripts[2]).not.toContain('22222')
    expect(contentHelpers).toEqual([false, false, false, true])
    expect(JSON.stringify(prompts[3])).toContain('content-consumer.mjs')
    expect(JSON.stringify(prompts[3])).not.toContain('Publish reads')
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'content-consumer.mjs')).exists()).toBe(false)
    expect(manager.events(session.id).filter(e => e.type === 'user.message').map(e => e.text))
      .toEqual(['Continue', 'Continue', 'Continue', 'Continue'])
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

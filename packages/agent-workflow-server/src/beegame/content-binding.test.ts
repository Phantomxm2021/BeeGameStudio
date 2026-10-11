import { expect, test, spyOn } from 'bun:test'
import * as fs from 'node:fs/promises'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { bindContent, bindCurrentContent, inspectContentBindings } from './content-binding'
import { assetManifestAuthoringExamples } from './asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from './asset-contracts'
import { uiLayoutFixture, sceneLayoutFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import { sharedContentChecker, CONTENT_BINDING_ENTRY } from './content-checker-runtime'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

test('autonomous current binding uses real bytes, not eight documents or a Task; stale hashes and design edits do not write',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-current-binding-')),file='content/ui/menu.json'
  try {
    await mkdir(join(root,'content/ui'),{recursive:true})
    const original=JSON.stringify(uiLayoutFixture())
    await writeFile(join(root,file),original);await writeFile(join(root,'unrelated.txt'),'preserved')
    const request=[{file,sha256:hash(original),nodes:[{id:'play',set:{actions:{click:'game.restart'}}}]}]
    const result=await bindCurrentContent(root,request)
    expect(result.issues).toEqual([]);expect(result.written).toHaveLength(1)
    const bound=await readFile(join(root,file),'utf8')
    expect(JSON.parse(bound).data.nodes[1].actions.click).toBe('game.restart')
    expect(JSON.parse(bound).data.nodes[1].layout).toEqual(JSON.parse(original).data.nodes[1].layout)
    expect((await bindCurrentContent(root,request)).issues.join(' ')).toContain('SHA-256')
    const invalid=await bindCurrentContent(root,[{file,sha256:hash(bound),nodes:[{id:'play',set:{style:{color:'#abcdef'}}}]}])
    expect(invalid.valid).toBe(false);expect(invalid.written).toEqual([])
    expect(await readFile(join(root,file),'utf8')).toBe(bound)
    expect(await readFile(join(root,'unrelated.txt'),'utf8')).toBe('preserved')
    for(const path of ['docs','content/index.json','assets/asset-manifest.json'])await expect(fs.access(join(root,path))).rejects.toThrow()
    const mapping=join(root,'map.json');await writeFile(mapping,JSON.stringify([{file,sha256:hash(bound),nodes:[{id:'play',set:{actions:{click:'game.start'}}}]}]))
    const module=await sharedContentChecker()
    await writeFile(join(root,'bind.mjs'),CONTENT_BINDING_ENTRY)
    const child=Bun.spawn([process.execPath,'bind.mjs','--current','map.json'],{cwd:root,env:{...process.env,BEEGAME_CONTENT_CHECKER_MODULE:module.moduleUrl},stdout:'pipe',stderr:'pipe'})
    const output=await new Response(child.stdout).text(),errors=await new Response(child.stderr).text()
    expect(await child.exited,output+errors).toBe(0);expect(JSON.parse(output).valid).toBe(true)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('binding inspection supplies reusable exact operands without geometry replay, files or index creation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-binding-inspect-'))
  try {
    await mkdir(join(root, 'content/ui/chapter-one'), { recursive: true })
    await mkdir(join(root, 'content/scenes'), { recursive: true })
    const uiFile = 'content/ui/chapter-one/menu.json', sceneFile = 'content/scenes/world.json'
    const ui = uiLayoutFixture(), scene = sceneLayoutFixture()
    ;(scene.data.nodes[1] as any).components = [{ id: 'visual', type: 'sprite-renderer', data: { size: [40, 40], color: '#123456' } }]
    const beforeUi = JSON.stringify(ui), beforeScene = JSON.stringify(scene)
    await writeFile(join(root, uiFile), beforeUi); await writeFile(join(root, sceneFile), beforeScene)
    const result = await inspectContentBindings(root, [uiFile, sceneFile, uiFile])
    expect(result.valid).toBe(true)
    expect(result.files).toHaveLength(2)
    expect(result.files[0]).toMatchObject({ file: uiFile, sha256: hash(beforeUi),
      nodes: [{ id: 'root' }, { id: 'play', actions: { click: 'start' } }] })
    expect(result.files[1]).toMatchObject({ file: sceneFile, sha256: hash(beforeScene),
      nodes: [{ id: scene.data.nodes[1]!.id, components: [{ componentId: 'visual', type: 'sprite-renderer' }] }] })
    expect(JSON.stringify(result.files)).not.toContain('layout')
    expect(JSON.stringify(result.files)).not.toContain('orthographicSize')
    expect(await readFile(join(root, uiFile), 'utf8')).toBe(beforeUi)
    expect(await readFile(join(root, sceneFile), 'utf8')).toBe(beforeScene)
    await expect(readFile(join(root, 'content/index.json'))).rejects.toThrow()
    await symlink(join(root, uiFile), join(root, 'content/ui/alias.json'))
    for (const path of ['content/ui/alias.json', 'content/ui/../../secret.json', 'docs/GDD.md', sceneFile + '/missing']) {
      const invalid = await inspectContentBindings(root, [uiFile, path])
      expect(invalid.valid).toBe(false)
      expect(invalid.files).toHaveLength(1)
      expect(invalid.issues.join(' ')).toContain(path)
    }
    // The inspected hash is accepted directly by the binding executor.
    await writeDesignDocumentsFixture(root)
    await writeBeeGameAssetManifest(root, { ...assetManifestAuthoringExamples().canonical, resources: [] })
    const applied = await bindContent(root, [{ file: uiFile, sha256: result.files[0]!.sha256,
      nodes: [{ id: 'play', set: { actions: { click: 'game.start' } } }] }])
    expect(applied.issues).toEqual([])
    expect(applied.written).toHaveLength(1)
    expect(JSON.parse(await readFile(join(root, uiFile), 'utf8')).data.nodes[1].layout).toEqual(ui.data.nodes[1]!.layout)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('current batch binding uses actual asset bytes; a changed resource stops remaining files without legacy authority or rollback',async()=>{
  const root=await fs.realpath(await mkdtemp(join(tmpdir(),'bgs-current-assets-')))
  const first='content/ui/first.json',second='content/ui/second.json',asset='assets/runtime/example/resource.json'
  const rename=fs.rename;let injected:ReturnType<typeof spyOn>|undefined
  try {
    await mkdir(join(root,'content/ui'),{recursive:true});await mkdir(join(root,'assets/runtime/example'),{recursive:true})
    await writeFile(join(root,asset),'{}')
    const manifest=assetManifestAuthoringExamples().canonical;await writeBeeGameAssetManifest(root,manifest)
    const original=JSON.stringify(uiLayoutFixture())
    await writeFile(join(root,first),original);await writeFile(join(root,second),original)
    const request=[first,second].map(file=>({file,sha256:hash(original),nodes:[{id:'play',set:{data:{image:{assetRef:manifest.resources[0]!.id}}}}]}))
    injected=spyOn(fs,'rename').mockImplementation(async(from,to)=>{
      await rename(from,to)
      if(to===join(root,first))await writeFile(join(root,asset),'{"newResource":true}')
    })
    const result=await bindCurrentContent(root,request)
    expect(result.valid).toBe(false);expect(result.written.map(item=>item.file)).toEqual([first]);expect(result.pending).toEqual([second])
    expect(result.issues.join(' ')).toContain('registry changed')
    expect(JSON.parse(await readFile(join(root,first),'utf8')).assetRefs).toContain(manifest.resources[0]!.id)
    expect(await readFile(join(root,second),'utf8')).toBe(original)
    await expect(fs.access(join(root,'docs'))).rejects.toThrow()
  }finally{injected?.mockRestore();await rm(root,{recursive:true,force:true})}
})

test('materialized binding CLI returns hashes and identities directly before any index exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-binding-inspect-cli-'))
  try {
    await mkdir(join(root, 'content/ui'), { recursive: true })
    const file = 'content/ui/menu.json', body = JSON.stringify(uiLayoutFixture())
    await writeFile(join(root, file), body)
    await materializeSceneUiFormat(root)
    const runtime = await sharedContentChecker()
    for (const paths of [[file], [file, 'content/ui/missing.json']]) {
      const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/bind-content.mjs'), '--inspect', ...paths],
        { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
      const [output, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      expect(error).toBe('')
      expect(code).toBe(paths.length === 1 ? 0 : 1)
      const result = JSON.parse(output)
      expect(result.files[0].sha256).toBe(hash(body))
      expect(result.files[0].nodes[1]).toMatchObject({ id: 'play', actions: { click: 'start' } })
      expect(await readFile(join(root, file), 'utf8')).toBe(body)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('batch binds exact nodes, keeps design and declarations, rejects every invalid batch before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-bindings-'))
  try {
    await writeDesignDocumentsFixture(root)
    const manifest = assetManifestAuthoringExamples().canonical
    await mkdir(join(root, 'assets/runtime/example'), { recursive: true })
    await writeFile(join(root, 'assets/runtime/example/resource.json'), '{}')
    await writeBeeGameAssetManifest(root, manifest)
    const file = 'content/ui/bind-test.json', ui = uiLayoutFixture()
    const original = JSON.stringify(ui)
    await writeFile(join(root, file), original)
    const request = (set: unknown, sha256 = hash(original)) => [{ file, sha256, nodes: [{ id: 'play', set }] }]
    for (const set of [{ data: { image: { assetRef: 'absent' } } }, { style: { fontSize: 200 } }, { data: { layoutCamera: { path: 'changed' } } }]) {
      const result = await bindContent(root, request(set))
      expect(result.valid).toBe(false); expect(result.written).toEqual([])
      expect(await readFile(join(root, file), 'utf8')).toBe(original)
    }
    const correct = { data: { image: { assetRef: manifest.resources[0]!.id } }, actions: { click: 'begin-play' } }
    const invalidBatch = [...request(correct), { file: 'content/ui/missing.json', sha256: 'a'.repeat(64), nodes: [{ id: 'root', set: {} }] }]
    expect((await bindContent(root, invalidBatch)).written).toEqual([])
    expect(await readFile(join(root, file), 'utf8')).toBe(original)
    const result = await bindContent(root, request(correct))
    expect(result.issues).toEqual([]); expect(result.written).toHaveLength(1)
    const updated = await readFile(join(root, file), 'utf8'), parsed = JSON.parse(updated)
    expect(parsed.data.nodes[1].layout).toEqual(ui.data.nodes[1]!.layout)
    expect(parsed.assetRefs).toContain(manifest.resources[0]!.id)
    expect((await bindContent(root, request(correct))).issues.join(' ')).toContain('SHA-256 changed')
    expect((await bindContent(root, request(correct, hash(updated)))).written[0]?.changed).toBe(false)
    const obsolete = JSON.parse(updated)
    obsolete.data.nodes[1].bindings = { visibleWhen: 'obsolete-condition', text: 'old-label' }
    obsolete.data.nodes[1].actions.hover = 'old-action'
    await writeFile(join(root, file), JSON.stringify(obsolete))
    const replace = await bindContent(root, request({ actions: { click: 'begin-play' }, bindings: { text: 'new-label' } }, hash(JSON.stringify(obsolete))))
    expect(replace.issues).toEqual([])
    const replaced = JSON.parse(await readFile(join(root, file), 'utf8'))
    expect(replaced.data.nodes[1].bindings).toEqual({ text: 'new-label' })
    expect(replaced.data.nodes[1].actions).toEqual({ click: 'begin-play' })
    const beforeClear = await readFile(join(root, file), 'utf8')
    expect((await bindContent(root, request({ bindings: {}, actions: {} }, hash(beforeClear)))).valid).toBe(true)
    expect(JSON.parse(await readFile(join(root, file), 'utf8')).data.nodes[1].bindings).toEqual({})
    expect((await bindContent(root, request({ bindings: { payload: { level: 1 } } }))).valid).toBe(false)
    await symlink(join(root, file), join(root, 'content/ui/alias.json'))
    expect((await bindContent(root, [{ ...request(correct, hash(updated))[0], file: 'content/ui/alias.json' }])).valid).toBe(false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['conflict', 'cancel'] as const)('partial commit reports %s without rolling back or overwriting another writer', async mode => {
  const root = await fs.realpath(await mkdtemp(join(tmpdir(), 'bgs-partial-bind-')))
  const controller = new AbortController()
  const rename = fs.rename
  let injected: ReturnType<typeof spyOn> | undefined
  try {
    await writeDesignDocumentsFixture(root)
    await writeBeeGameAssetManifest(root, { ...assetManifestAuthoringExamples().canonical, resources: [] })
    const original = JSON.stringify(uiLayoutFixture()), first = 'content/ui/first.json', second = 'content/ui/second.json'
    await writeFile(join(root, first), original); await writeFile(join(root, second), original)
    injected = spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to)
      if (to === join(root, first)) {
        if (mode === 'conflict') await writeFile(join(root, second), original + '\n')
        else controller.abort(Error('Synthetic cancellation'))
      }
    })
    const result = await bindContent(root, [first, second].map(file => ({ file, sha256: hash(original),
      nodes: [{ id: 'play', set: { actions: { click: 'start-new' } } }] })), controller.signal)
    expect(result.valid).toBe(false)
    expect(result.written.map(item => item.file)).toEqual([first])
    expect(result.pending).toEqual([second])
    expect(await readFile(join(root, second), 'utf8')).toBe(original + (mode === 'conflict' ? '\n' : ''))
  } finally { injected?.mockRestore(); await rm(root, { recursive: true, force: true }) }
})

import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runChecks, checkIsCurrent } from './checks'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import type { TaskSpec } from './state'

for (const mode of ['consume', 'ignore', 'wrong', 'position-only', 'size-only', 'hidden', 'omit', 'stale-copy', 'missing-screen', 'missing-viewport', 'tiny'] as const) {
  test('actual target UI source mutation: '+mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-ui-consumption-'))
    try {
      const ui = uiLayoutFixture(); ui.data.nodes[0]!.data!.referenceResolution = [1280, 720]
      ui.data.nodes[0]!.data!.targetViewports = [[1280,720]]
      if (mode === 'missing-viewport') ui.data.nodes[0]!.data!.targetViewports = [[1280,720],[720,1280]]
      if (mode === 'tiny') Object.assign(ui.data.nodes[1]!.layout,{scale:[0.01,0.01]})
      ui.data.nodes[0]!.layout.size = [1280, 720]
      await mkdir(join(root, 'content/ui'), { recursive: true }); await mkdir(join(root, 'dist/content/ui'), { recursive: true })
      const body = JSON.stringify(ui)
      await writeFile(join(root, 'content/ui/menu.json'), body)
      await writeFile(join(root, 'dist/content/ui/menu.json'), mode === 'stale-copy' ? JSON.stringify(uiLayoutFixture()) : body)
      await writeFile(join(root, 'content/index.json'), JSON.stringify({ schema: 'beegame-content-package.v2', id: 'fixture', sceneModel: 'game-object-v2', documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64),
        dimension: '2d', entryScene: 'level', files: ['ui/menu.json','scenes/level.json'], documents: [
          { id: 'menu', kind: 'ui-screen', path: 'ui/menu.json', loadPhase: 'startup' }, { id: 'level', kind: 'scene-2d', path: 'scenes/level.json', loadPhase: 'startup' },
          ...(mode === 'missing-screen' ? [{id:'pause',kind:'ui-screen',path:'ui/pause.json',loadPhase:'on-demand'}] : []),
        ] }))
      // Different target renderer, not BGS's preview or an Agent PASS driver.
      const html = '<!doctype html><style>body{margin:0}button{position:absolute;box-sizing:border-box}</style><button id="play">Play</button><script>'+
        (mode === 'omit' ? '' : 'fetch("/content/ui/menu.json").then(r=>r.json()).then(d=>{const n=d.data.nodes.find(n=>n.id==="play"), b=document.querySelector("#play"), s='+
        (['ignore','position-only'].includes(mode) ? '[200,52]' : 'n.layout.size')+',p='+(['ignore','size-only'].includes(mode) ? '[0,0]' : 'n.layout.position||[0,0]')+';'+
        'b.style.width=s[0]+"px";b.style.height=s[1]+"px";b.style.left=(640-s[0]/2+p[0]'+(mode === 'wrong' ? '*2' : '')+')+"px";b.style.top=(360-s[1]/2+p[1])+"px";'+
        (mode === 'hidden' ? 'b.style.display="none";' : '')+'})')+'</script>'
      await writeFile(join(root, 'dist/index.html'), html)
      const task: TaskSpec = { id: 'consume', kind: 'game.verify', goal: 'Verify saved UI is used', dependsOn: [], requirementIds: ['req.loop'], inputs: [],
        writablePaths: [], expectedOutputs: ['dist/index.html'], checks: ['ui-data-consumption'], runtimeArtifact: 'dist',
        uiProbes: [{ document: 'content/ui/menu.json', nodeId: 'play', selector: '#play', viewport: [1280,720] }] }
      const result = (await runChecks(root, task, [])).checks[0]!
      expect(result.status, result.observation).toBe(mode === 'consume' ? 'passed' : ['ignore','wrong','position-only','size-only'].includes(mode) ? 'failed' : 'unverified')
      expect(await Bun.file(join(root,'content/ui/menu.json')).text()).toBe(body)
      if(mode==='missing-screen')expect(result.observation).toContain('omit registered UI')
      if(mode==='missing-viewport')expect(result.observation).toContain('omit authored target viewports')
      if(mode==='tiny')expect(result.observation).toContain('below observation tolerance')
      if (mode === 'consume') {
        const actual = JSON.parse(result.observation)
        expect(actual.probes[0].changed).toHaveLength(2)
        for(const changed of actual.probes[0].changed)expect(actual.probes[0].before).not.toEqual(changed.actual)
        expect(actual.probes[0].before).toEqual(actual.probes[0].restored)
        expect(await checkIsCurrent(root, result)).toBe(true)
        await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(uiLayoutFixture(64)))
        expect(await checkIsCurrent(root, result)).toBe(false)
      }
      expect(await Bun.file(join(root, 'dist/content/ui/menu.json')).text()).toBe(mode === 'stale-copy' ? JSON.stringify(uiLayoutFixture()) : body)
    } finally { await rm(root, { recursive: true, force: true }) }
  }, 30000)
}

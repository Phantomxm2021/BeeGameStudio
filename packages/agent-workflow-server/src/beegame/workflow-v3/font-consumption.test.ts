import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkIsCurrent } from './checks'
import { runChecks } from './checker-test-driver'
import { type TaskSpec } from './state'
import { uiLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'

for (const mode of ['consume', 'combined-probes', 'explicit-member', 'inherited-size', 'responsive', 'compact-default', 'compact-default-ignore-size', 'wrong-text', 'ignore-text', 'ignore-size', 'fetch-only', 'wrong-member',
  'missing-glyph', 'rich-text', 'dynamic', 'missing-probe', 'missing-viewport', 'stale-font', 'unrelated-error', 'suppression-error', 'same-rendering', 'mixed-fonts', 'legacy-gap'] as const) {
  test('actual target DOM consumes bound text/font: '+mode, async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-v3-fonts-'))
    try {
      const manifest = assetManifestAuthoringExamples().canonical, resource = manifest.resources[0]!
      manifest.project_target!.asset_format_capabilities = ['ttf']
      const defaultFont = 'assets/runtime/example/default.ttf', memberFont = 'assets/runtime/example/member.ttf'
      const explicit = ['explicit-member','wrong-member'].includes(mode)
      resource.root_path = defaultFont; resource.file_paths = [defaultFont,memberFont];resource.asset_kind = 'font'
      await mkdir(join(root, 'assets/runtime/example'), {recursive:true})
      const file = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
      const other = process.platform === 'darwin' ? '/System/Library/Fonts/Supplemental/Times New Roman.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'
      await writeFile(join(root,defaultFont),await readFile(file));await writeFile(join(root,memberFont),await readFile(other))
      await writeBeeGameAssetManifest(root,manifest)
      const ui = uiLayoutFixture() as any
      ui.assetRefs = [resource.id]
      Object.assign(ui.data.nodes[0].data,{referenceResolution:[1280,720],targetViewports:mode==='missing-viewport'?[[1280,720],[720,1280]]:[[1280,720]]})
      ui.data.nodes[0].layout.size = [1280,720]
      const node = ui.data.nodes[1]
      node.layout.size = [500,80]; node.text = mode === 'missing-glyph' ? '\u{10ffff}' : 'Signal 19AB'
      node.style = {fontSize:28};node.data = {font:{assetRef:resource.id,...(explicit ? {member:memberFont}: {})}}
      if(mode==='inherited-size'){ui.data.nodes[0].style={fontSize:28};node.style={}}
      if(mode==='responsive')node.responsive={portrait:{style:{fontSize:23}}}
      if(mode.startsWith('compact-default'))node.responsive={compact:{style:{fontSize:23}}}
      if(mode==='dynamic')node.bindings={text:'score'}
      if(mode==='missing-probe')ui.data.nodes.push({...node,id:'extra'})
      if(mode==='combined-probes')ui.data.nodes.push({id:'close',parentId:'root',role:'button',layout:{anchor:'middle-center',position:[0,160],size:[200,52]}})
      const source = 'content/ui/menu.json', body = JSON.stringify(ui), selected = explicit ? memberFont : defaultFont
      await mkdir(join(root,'content/ui'),{recursive:true});await writeFile(join(root,source),body)
      await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
        documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:'2d',entryScene:'level',files:['ui/menu.json'],
        documents:[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]}))
      await mkdir(join(root,'dist'));await cp(join(root,'content'),join(root,'dist/content'),{recursive:true});await cp(join(root,'assets'),join(root,'dist/assets'),{recursive:true})
      if(mode==='stale-font')await writeFile(join(root,'dist',selected),'bad')
      // Actual target renderer, no BGS preview or injected PASS. The host changes
      // only requests; this game reads its own UI/font binding and applies them.
      const script = `const d=await fetch('./${source}').then(r=>r.json()), n=d.data.nodes.find(n=>n.id==='play'), b=document.querySelector('#play');
        const selected=n.data.font.member||'${defaultFont}';
        ${mode === 'wrong-member' ? "await fetch('./'+selected).then(r=>r.arrayBuffer());" : ''}
        try{const face=await new FontFace('Measured', 'url(./'+${mode === 'wrong-member' ? JSON.stringify(defaultFont) : 'selected'}+')'${mode === 'mixed-fonts' ? ",{unicodeRange:'U+0053'}" : ''}).load();document.fonts.add(face)}catch(e){${mode === 'suppression-error' ? "throw Error('Uncaught font load failure');" : ''}}
        ${mode === 'mixed-fonts' ? "document.fonts.add(await new FontFace('Alternate','url(./"+memberFont+")').load());" : ''}
        b.style.fontFamily=${['fetch-only','legacy-gap'].includes(mode) ? "'monospace'" : mode === 'same-rendering' ? JSON.stringify('Measured,'+(process.platform==='darwin'?'Arial':'DejaVu Sans')) : mode === 'mixed-fonts' ? "'Measured,Alternate,monospace'" : "'Measured,monospace'"};
        b.textContent=${mode === 'wrong-text' ? "'Wrong saved text'" : mode === 'ignore-text' ? "'Signal 19AB'" : 'n.text'};
        ${mode === 'rich-text' ? "b.innerHTML='<span>'+n.text+'</span>';" : ''}
        const size=${mode === 'ignore-size' ? '28' : mode === 'compact-default-ignore-size' ? '23' : "(innerHeight>innerWidth?n.responsive?.portrait?.style?.fontSize:undefined)??(innerWidth<=600?n.responsive?.compact?.style?.fontSize:undefined)??n.style?.fontSize??d.data.nodes[0].style.fontSize"};
        b.style.fontSize=size+'px';const p=n.layout.position||[0,0],s=n.layout.size;
        Object.assign(b.style,{width:s[0]+'px',height:s[1]+'px',left:(innerWidth/2-s[0]/2+p[0])+'px',top:(innerHeight/2-s[1]/2+p[1])+'px'});
        ${mode === 'combined-probes' ? "const c=d.data.nodes.find(n=>n.id==='close'), e=document.createElement('button');e.id='close';e.textContent='Close';Object.assign(e.style,{width:c.layout.size[0]+'px',height:c.layout.size[1]+'px',left:(innerWidth/2-c.layout.size[0]/2+c.layout.position[0])+'px',top:(innerHeight/2-c.layout.size[1]/2+c.layout.position[1])+'px'});document.body.append(e);" : ''}
        for(const node of d.data.nodes){if(node.enabled===false)document.getElementById(node.id)?.remove();}
        ${mode === 'unrelated-error' ? "console.error('Independent renderer error');" : ''}`
      await writeFile(join(root,'dist/index.html'),'<style>body{margin:0}button{position:absolute;box-sizing:border-box;border:0;padding:0;white-space:nowrap;background:white;color:black}</style><button id="play"></button><script type="module">'+script+'</script>')
      const viewport:[number,number] = mode==='responsive' ? [720,1280] : mode.startsWith('compact-default') ? [600,720] : [1280,720]
      if(mode==='responsive' || mode.startsWith('compact-default')){
        ui.data.nodes[0].data.targetViewports=[viewport]
        await writeFile(join(root,source),JSON.stringify(ui));await writeFile(join(root,'dist',source),JSON.stringify(ui))
      }
      const sourceBefore=await Bun.file(join(root,source)).text(),fontBefore=await Bun.file(join(root,selected)).arrayBuffer()
      const task:TaskSpec = {id:'font',kind:'game.verify',goal:'Observe saved DOM text/font usage',dependsOn:[],requirementIds:['req.text'],
        inputs:[],writablePaths:[],expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:mode==='combined-probes'?['font-data-consumption','ui-data-consumption']:[mode==='legacy-gap'?'ui-data-consumption':'font-data-consumption'],
        uiProbes:[{document:source,nodeId:'play',selector:'#play',viewport},...(mode==='combined-probes'?[{document:source,nodeId:'close',selector:'#close',viewport}]:[])]}
      const checks = (await runChecks(root,task,[])).checks, result = checks[0]!
      const expected = ['consume','combined-probes','explicit-member','inherited-size','responsive','compact-default','legacy-gap'].includes(mode) ? 'passed'
        : ['wrong-text','ignore-text','ignore-size','compact-default-ignore-size','unrelated-error'].includes(mode) ? 'failed' : 'unverified'
      expect(result.status,result.observation).toBe(expected)
      if(mode==='combined-probes')expect(checks[1]!.status,checks[1]!.observation).toBe('passed')
      expect(await Bun.file(join(root,source)).text()).toBe(sourceBefore)
      expect(await Bun.file(join(root,selected)).arrayBuffer()).toEqual(fontBefore)
      if(result.status==='passed' && mode!=='legacy-gap'){
        const observation=JSON.parse(result.observation).probes[0]
        expect(observation.before.fonts.every((f:any)=>f.isCustomFont&&f.glyphCount>0)).toBe(true)
        expect(observation.before.sha256).toBe(observation.restored.sha256)
        expect(observation.before.sha256).not.toBe(observation.suppressed.font.sha256)
        expect(observation.changed.map((v:any)=>v.property)).toEqual(['text','font-size'])
        expect(await checkIsCurrent(root,result)).toBe(true)
        await writeFile(join(root,selected),'changed');expect(await checkIsCurrent(root,result)).toBe(false)
      }
    }finally{await rm(root,{recursive:true,force:true})}
  },30000)
}

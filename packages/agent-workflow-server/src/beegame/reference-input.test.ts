import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { checkDesignHandoff, DESIGN_ACCEPTANCE_PATH } from './design-handoff'
import { PROJECT_DOCUMENTS } from './project-content-authority'
import { designRequirementChecksFixture, writeDesignDocumentsFixture } from './fixtures/layout-fixture'
import { inspectDesignAcceptance, readRuntimeAcceptanceReport, runtimeEvidenceIsCurrent } from './runtime-acceptance'

test.each(['none','partial','complete'] as const)('reference pictures are inputs, not an AI-source delivery gate: %s documents',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-reference-input-'))
  try {
    const documents=kind==='none'?[]:kind==='partial'?['GDD.md','ART_DIRECTION.md'] as const:PROJECT_DOCUMENTS
    await writeDesignDocumentsFixture(root,documents)
    if(kind==='complete') for(const name of ['UI_UX_SPEC.md','LEVEL_SCENE_DESIGN.md']) {
      const path=join(root,'docs',name)
      await writeFile(path,(await readFile(path,'utf8')).replace(/^.*\]\(\.\.\/content\/.*$/gm,''))
    }
    const picture='assets/visual/reference #1.PNG'
    const bytes=await sharp({create:{width:8,height:8,channels:4,background:'red'}}).png().toBuffer()
    for(const path of [picture,'evidence/screenshot.png','assets/branding/logo.png']) {
      await mkdir(dirname(join(root,path)),{recursive:true})
      await writeFile(join(root,path),bytes)
    }
    await writeFile(join(root,'assets/visual/notes.md'),'Production notes')
    await writeFile(join(root,'assets/visual/notes.html'),'<p>Production notes</p>')
    if(kind!=='none') {
      const doc=join(root,'docs/ART_DIRECTION.md')
      await writeFile(doc,await readFile(doc,'utf8')+[
        '', '[Reference](../assets/visual/reference%20%231.PNG)',
        '[Runtime screenshot](../evidence/screenshot.png)',
        '![Logo](../assets/branding/logo.png)',
        '[Notes](../assets/visual/notes.md)', '[HTML notes](../assets/visual/notes.html)', '',
      ].join('\n'))
    }
    await mkdir(join(root,'.beegame/delivery'),{recursive:true})
    await writeFile(join(root,'observed.txt'),'Synthetic observation, not proof of actual gameplay or image reading')
    await writeFile(join(root,'game.js'),'// Synthetic artifact')
    const revision=checkDesignHandoff(root,documents).revision
    const report={scope:'delivery',status:'passed',summary:'Synthetic report',environment:'Synthetic',
      evidencePaths:['observed.txt'],artifactPaths:['game.js'],verification:{
        target:'deployment',observation:'target-runtime',knownIssues:[],unverified:[],
        ...(kind==='complete'?{designRevision:revision}:{}),
        requirementChecks:designRequirementChecksFixture(root,['observed.txt']),
      }}
    await writeFile(join(root,DESIGN_ACCEPTANCE_PATH),JSON.stringify(report))
    // No generated-image prompt record, host receipt or image verifier exists.
    const accepted=(await readRuntimeAcceptanceReport(root,DESIGN_ACCEPTANCE_PATH))!
    expect(accepted.status).toBe('passed')
    expect(await inspectDesignAcceptance(root,kind==='complete')).toMatchObject({valid:true,quality:'unverified'})
    const cli=Bun.spawnSync([process.execPath,fileURLToPath(new URL('./acceptance-check-cli.ts',import.meta.url))],{cwd:root})
    expect(cli.exitCode).toBe(0)
    expect(JSON.parse(cli.stdout.toString()).valid).toBe(true)
    await writeFile(join(root,picture),await sharp({create:{width:8,height:8,channels:4,background:'blue'}}).png().toBuffer())
    expect(checkDesignHandoff(root,documents).revision).toBe(revision)
    expect(await runtimeEvidenceIsCurrent(root,[accepted])).toBe(true)
    // Ordinary retained evidence still binds its bytes if explicitly submitted.
    await writeFile(join(root,DESIGN_ACCEPTANCE_PATH),JSON.stringify({...report,evidencePaths:['observed.txt',picture]}))
    const evidenceBound=(await readRuntimeAcceptanceReport(root,DESIGN_ACCEPTANCE_PATH))!
    expect(evidenceBound.status).toBe('passed')
    await writeFile(join(root,picture),bytes)
    expect(await runtimeEvidenceIsCurrent(root,[evidenceBound])).toBe(false)
  } finally {await rm(root,{recursive:true,force:true})}
})

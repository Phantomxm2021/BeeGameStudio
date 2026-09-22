import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createRunStore } from './run-store'
import { computeWorkspaceRevision, computeResourceRevision } from './revision'
import { evaluateWorkflowDeliveryGate } from './delivery-gate'
import { readRuntimeAcceptance, runtimeAcceptancePath } from './runtime-acceptance'

test('publishing requires explicit current runtime evidence, not merely passed in run.json', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-publish-evidence-'))
  try {
    await mkdir(join(workspacePath,'.beegame/workflow/evidence'),{recursive:true})
    await writeFile(join(workspacePath,'game.js'),'initial implementation')
    await mkdir(join(workspacePath,'dist'))
    await writeFile(join(workspacePath,'dist/game.js'),'tested build')
    const report = {status:'passed',summary:'Observed gameplay in Preview',environment:'Web Preview iframe',
      verification: { target: 'deployment', knownIssues: [], unverified: [] },
      artifactPaths: ['dist/game.js'],
      evidencePaths:['.beegame/workflow/evidence/browser.txt']}
    await writeFile(join(workspacePath,report.evidencePaths[0]!), 'observed result')
    await writeFile(join(workspacePath,runtimeAcceptancePath('dispatch')),JSON.stringify(report))
    const runtimeReport = await readRuntimeAcceptance(workspacePath,'dispatch')
    const base = createTestDeliveryRun({ownerId:'owner',projectId:'project',documentRevision:'a'.repeat(64)})
    const content = 'c'.repeat(64)
    const revision = await computeWorkspaceRevision(workspacePath)
    const resource = await computeResourceRevision(workspacePath,base.revision.document)
    const acceptancePath = '.beegame/workflow/evidence/accepted.json'
    const receipt = {revision,status:'passed',runtimeVerification:'agent-reported',runtimeReports:[runtimeReport]}
    await writeFile(join(workspacePath,acceptancePath),JSON.stringify(receipt))
    const store = createRunStore(workspacePath,'owner')
    await store.save({...base,phase:'DELIVERY',status:'completed',
      revision:{...base.revision,workspace:revision,implementation:revision,resource,content},
      gameContentReceipt:{schemaVersion:'game-content-ready.v2',documentRevision:base.revision.document,
        assetManifestRevision:resource,contentRevision:content,indexPath:'content/index.json',contentIds:['scene']},
      evidence:{
        acceptance:{path:acceptancePath,kind:'acceptance',status:'passed',revision,observedAt:new Date().toISOString()},
        gameContent:{path:'content/index.json',kind:'game_content',status:'passed',revision:content,observedAt:new Date().toISOString()},
        resourcePreparation:{path:'assets/asset-manifest.json',kind:'resource_preparation',status:'passed',revision:resource,observedAt:new Date().toISOString()},
      },
    })
    const check = () => evaluateWorkflowDeliveryGate({workspacePath,ownerId:'owner'})
    expect((await check()).allowed).toBe(true)
    await writeFile(join(workspacePath,acceptancePath),JSON.stringify({revision,status:'passed',runtimeVerification:'not-assessed-by-host'}))
    expect((await check()).allowed).toBe(false)
    await writeFile(join(workspacePath,acceptancePath),JSON.stringify(receipt))
    await writeFile(join(workspacePath,report.evidencePaths[0]!), 'changed result')
    expect((await check()).allowed).toBe(false)
    await writeFile(join(workspacePath,report.evidencePaths[0]!), 'observed result')
    await writeFile(join(workspacePath,'game.js'),'changed implementation')
    expect((await check()).issues).toContain('Workspace changed after acceptance; run acceptance again.')
  } finally { await rm(workspacePath,{recursive:true,force:true}) }
})

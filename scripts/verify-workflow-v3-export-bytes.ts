import assert from 'node:assert/strict'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { loadEnvFile } from './beegame-migration-cli'
import { createRemoteWorkflowStore } from '../packages/agent-workflow-server/src/beegame/workflow-v3/store'
import { selectAgentMeasuredBuild } from '../packages/agent-workflow-server/src/beegame/workflow-v3/measured-build'
import { digest } from '../packages/agent-workflow-server/src/beegame/workflow-v3/state'
import { artifactDigest } from '../packages/agent-workflow-server/src/beegame/runtime-acceptance'

// Read-only downloaded-package audit. Never extracts, rebuilds, rewrites an
// original receipt or declares game quality from a valid archive.
const args=process.argv.slice(2)
if(args.length!==8 || args[0]!=='--env-file' || args[2]!=='--project' || args[4]!=='--archive' || args[6]!=='--measurement')
  throw Error('Usage: bun scripts/verify-workflow-v3-export-bytes.ts --env-file PATH --project ID --archive ZIP --measurement ID')
loadEnvFile(args[1]!)
const serverRequire=createRequire(new URL('../packages/agent-workflow-server/package.json',import.meta.url))
const {createTLSAwareFetch}=await import(serverRequire.resolve('@bee-game-studio/security-core'))
const serviceFetch=createTLSAwareFetch()
const url=process.env.BEEGAME_SUPABASE_URL ?? process.env.SUPABASE_URL
const serviceKey=process.env.BEEGAME_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url || !serviceKey)throw Error('Existing database configuration required')
const response=await serviceFetch(url.replace(/\/+$/,'')+'/rest/v1/beegame_projects?select=owner_id&id=eq.'+encodeURIComponent(args[3]!),
  {headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey},signal:AbortSignal.timeout(15000)})
if(!response.ok)throw Error('Read-only metadata request failed (HTTP '+response.status+')')
const source=(await response.json())[0]
if(!source)throw Error('Project metadata unavailable')
const store=createRemoteWorkflowStore({url,serviceKey,fetchImpl:(input,init)=>serviceFetch(input,{...init,signal:AbortSignal.timeout(15000)})})
const run=await store.read(args[3]!,source.owner_id)
if(!run || run.writer)throw Error('Current idle Run required; no automatic recovery or execution')
const selected=await selectAgentMeasuredBuild(run,args[7]!,false),proof=selected.build.projectBuild!
const path=await realpath(args[5]!),bytes=await readFile(path),fileStat=await stat(path)
const JSZip=createRequire(serverRequire.resolve('exceljs'))('jszip'),zip=await JSZip.loadAsync(bytes,{checkCRC32:true})
const receipt=JSON.parse(await zip.file('measurement.json').async('string'))
assert.equal(receipt.protocol,'bgs.measured-project-export.1');assert.equal(receipt.runId,run.id)
assert.equal(receipt.measurementId,args[7]);assert.equal(receipt.attemptId,selected.turn.attemptId)
assert.equal(receipt.requirementsRevision,run.requirements.revision);assert.equal(receipt.deliveryEligible,false)
assert.deepEqual(receipt.artifact,selected.artifact);assert.equal(receipt.sourceBuild.version,proof.version)
assert.equal(receipt.sourceBuild.dependencySha256,proof.dependencySha256)
const {inputs:_inputs,...publicSmoke}=selected.smoke
assert.deepEqual(receipt.check,publicSmoke)
const entries=Object.values(zip.files) as Array<{name:string;dir:boolean}>
assert.equal(entries.some(e=>e.dir),false)
const claimed=receipt.files as Array<{path:string;sha256:string}>
assert.equal(new Set(claimed.map(e=>e.path)).size,claimed.length)
assert.deepEqual(entries.map(e=>e.name).sort(),['measurement.json',...claimed.map(e=>e.path)].sort())
for(const item of claimed) {
  assert.ok(item.path.startsWith('project/') && !item.path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.beegame'||p==='node_modules'))
  assert.equal(digest(await zip.file(item.path).async('nodebuffer')),item.sha256,'Downloaded bytes differ: '+item.path)
}
for(const item of proof.files) {
  const target=resolve(run.workspacePath,item.path)
  assert.ok(target.startsWith(run.workspacePath+'/'));assert.equal(await realpath(target),target)
  assert.equal(digest(await readFile(target)),item.sha256,'Current measured source changed: '+item.path)
  assert.equal(digest(await zip.file('project/'+item.path).async('nodebuffer')),item.sha256,'Exported source differs: '+item.path)
}
for(const item of claimed.filter(e=>e.path.startsWith('project/'+selected.artifact.path+'/'))) {
  const relative=item.path.slice('project/'.length),target=resolve(run.workspacePath,relative)
  assert.ok(target.startsWith(join(run.workspacePath,selected.artifact.path)+'/'));assert.equal(await realpath(target),target)
  assert.equal(digest(await readFile(target)),item.sha256,'Exported measured output differs: '+relative)
}
assert.equal(await artifactDigest(run.workspacePath,selected.artifact.path,true),selected.artifact.sha256)
const after=await store.read(run.projectId,run.ownerId)
assert.equal(after?.version,run.version);assert.equal(after?.id,run.id);assert.equal(after?.writer,undefined)
await selectAgentMeasuredBuild(after!,args[7]!,false)
console.log(JSON.stringify({passed:true,readOnly:true,projectId:run.projectId,runId:run.id,version:run.version,measurementId:args[7],
  archive:path,archiveBytes:bytes.length,archiveSha256:digest(bytes),archiveModifiedAt:fileStat.mtime.toISOString(),entries:entries.length,
  receiptFiles:claimed.length,exactSourceFiles:proof.files.length,crcChecked:true,allReceiptFileBytesMatch:true,
  sameMeasuredSourcesAndOutput:true,modelCalls:0,sourceWrites:0,rebuilds:0,deliveryEligible:false,
  limits:['This newly downloaded archive, not the unavailable historical 1.75 download.','Source/output byte identity only; no dependency-install/rebuild or game-quality verdict.']},null,2))

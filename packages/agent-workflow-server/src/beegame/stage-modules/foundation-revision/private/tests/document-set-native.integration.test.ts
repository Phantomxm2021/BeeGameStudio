import {expect,test} from 'bun:test'
import {mkdtemp,realpath,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runRevisionOwnedAttempt} from '../owned-attempt'
import {openRevisionAttemptStore} from '../attempt-store'
import {publishRevisionCompletedCandidate} from '../completed-candidate'
import {readRevisionPublishedCandidate} from '../candidate-publication'
import {revisionDigest} from '../json-digest'
import {buildSingleReviewFixture,reviewFixtureDocuments} from './single-review-fixture'
const executable=process.env.BEEGAME_REVIEW_TEST_CLI??fileURLToPath(new URL('../../../../../../../../dist/cli-bun.js',import.meta.url))
const event=(x:any)=>'event: '+x.type+'\ndata: '+JSON.stringify(x)+'\n\n'
test('native Revision edits candidate files, publishes a host snapshot and replays without another child',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'native-revision-e2e-')))
 const source=buildSingleReviewFixture({documents:reviewFixtureDocuments(),identity:{ownerId:'owner',projectId:'project',requestId:'review'},
 subject:{kind:'initial',sourceResultId:'author',sourceDocumentRevision:'a'.repeat(64),confirmedBriefDigest:'b'.repeat(64)}})
 const original=JSON.stringify(source)
 const request={ownerId:'owner',projectId:'project',requestId:'repair',sourceResult:source,
 sourceBinding:{ownerId:'owner',projectId:'project',resultId:source.resultId,resultDigest:revisionDigest(source)}}
 const paths=source.documents.slice(0,2).map(x=>x.path)
 const summary='Supported fixture changes'
 const calls=paths.flatMap(file_path=>[{name:'Read',input:{file_path}},{name:'Edit',input:{file_path,old_string:'This complete',new_string:'This revised complete',replace_all:true}}])
 calls.push({name:'StructuredOutput',input:{summary}} as any)
 const requests:any[]=[];const abort=new AbortController()
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  if(new URL(request.url).pathname.endsWith('/count_tokens'))return Response.json({input_tokens:10})
  if(!new URL(request.url).pathname.endsWith('/messages'))return new Response('',{status:404})
  const body=await request.json() as any;requests.push(body)
  const n=requests.length,call=calls[n-1]
  if(n>8){abort.abort();return new Response('',{status:503})}
  const block=call?{type:'tool_use',id:'tool-'+n,...call}:{type:'text',text:'Done.'}
  return new Response(event({type:'message_start',message:{id:'m-'+n,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}}})+
   event({type:'content_block_start',index:0,content_block:call?{...block,input:{}}:{type:'text',text:''}})+
   event({type:'content_block_delta',index:0,delta:call?{type:'input_json_delta',partial_json:JSON.stringify(call.input)}:{type:'text_delta',text:'Done.'}})+event({type:'content_block_stop',index:0})+
   event({type:'message_delta',delta:{stop_reason:call?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:5}})+event({type:'message_stop'}),{headers:{'content-type':'text/event-stream'}})
 }})
 const timer=setTimeout(()=>abort.abort(),25000)
 try{
  const receipt=await runRevisionOwnedAttempt(root,{request,configuration:{command:[process.execPath,executable],env:{
   BEEGAME_CONFIG_DIR:join(root,'config'),BEEGAME_MODEL_TYPE:'anthropic',ANTHROPIC_API_KEY:'offline',
   ANTHROPIC_BASE_URL:'http://127.0.0.1:'+server.port,ANTHROPIC_DEFAULT_SONNET_MODEL:'claude-sonnet-4-6',
   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'}}},{signal:abort.signal})
  if(receipt.settlement.status!=='completed')console.log(JSON.stringify(receipt))
  expect(receipt.settlement.status).toBe('completed')
  const store=await openRevisionAttemptStore(root,request)
  expect((await store.read()).attempt).toBe(1)
  expect((await store.readRequest()).progress?.modelResponses).toBeGreaterThan(0)
  const publication=await publishRevisionCompletedCandidate(root,request)
  const candidate=(await readRevisionPublishedCandidate(root,publication.result))!
  expect(candidate.documents.filter(x=>x.content.includes('This revised complete'))).toHaveLength(2)
  expect(candidate).not.toHaveProperty('issueAssessments')
  expect(candidate.revisionSummary).toBe(summary)
  expect(candidate).not.toHaveProperty('repairClaims')
  expect(candidate.documents.map(x=>x.content)).toEqual(source.documents.map(x=>
   paths.includes(x.path)?x.content.replaceAll('This complete','This revised complete'):x.content))
  expect(JSON.stringify(source)).toBe(original)
  expect(JSON.stringify(requests[0].messages)).not.toContain(source.documents[0]!.content)
  expect(requests).toHaveLength(6)
  expect(requests[0].tools.find((x:any)=>x.name==='StructuredOutput').input_schema.properties).not.toHaveProperty('documents')
  expect(await runRevisionOwnedAttempt(root,{request,configuration:{command:['/no-redispatch'],env:{}}})).toEqual(receipt)
 }finally{clearTimeout(timer);server.stop(true);await rm(root,{recursive:true,force:true})}
},30000)

import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { CURRENT_CONTENT_CHECKER_ENTRY, CONTENT_BINDING_ENTRY, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from '../content-checker-runtime'
import { writeProjectAssetCommand } from '../project-asset-command'
import { openResourceLibraryAccess } from '../resource-library-access'
import type { openPreviewTestAccess } from '../preview-test-access'
import { publishProjectPreviewCapability } from '../project-preview-capability'
import type { createAgentMeasurement } from './agent-measurement'
import type { openImageGenerationAccess } from '../../image-generation/access'
import { bundleContentConsumer, contentConsumerHelp } from '../game-content-consumer-cli'

export type AgentPreviewAccess = ReturnType<typeof openPreviewTestAccess>
export type AgentImageAccess = ReturnType<typeof openImageGenerationAccess>

/** Entry points only: no stage, Task, invented authority or tool/result rewriting.
 * Native execution already supplies the shared checker/Sharp environment. */
export async function openAgentTools(input: {
  workspacePath: string
  libraryBaseUrl?: string
  getAuthToken: () => string | undefined | Promise<string | undefined>
  sessionId?: string
  openPreview?: () => AgentPreviewAccess | Promise<AgentPreviewAccess>
  measurement?: ReturnType<typeof createAgentMeasurement>
  openImage?: () => AgentImageAccess | Promise<AgentImageAccess>
}) {
  const root = await realpath(input.workspacePath)
  // Check each parent before creating a child; a project symlink must not
  // redirect host-written adapters outside the authorized workspace.
  let parent = root
  for (const name of ['.beegame', 'tmp']) {
    parent = resolve(parent, name)
    await mkdir(parent, { recursive: false, mode: 0o700 }).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    })
    if (await realpath(parent) !== parent) throw Error('BGS tool directory must not resolve through a link')
  }
  const directory = await mkdtemp(resolve(parent, 'goal-tools-'))
  const entry = (name: string) => relative(root, resolve(directory, name))
  let library: ReturnType<typeof openResourceLibraryAccess> | undefined
  let preview: AgentPreviewAccess | undefined
  let image: AgentImageAccess | undefined
  let revokePreview: (() => Promise<void>) | undefined
  let closing: Promise<void> | undefined
  let measurementServer: ReturnType<typeof Bun.serve> | undefined
  let revokeMeasurement: (() => Promise<void>) | undefined
  const close = () => closing ??= (async () => {
    // Revoke lookup first; drain actual browser/process cleanup before returning
    // the writer. Delayed old-turn revocation is identity-safe.
    try {
      try {await revokeMeasurement?.()} finally {
        measurementServer?.stop(true)
        await input.measurement?.close()
      }
    } finally {
      try { await revokePreview?.() }
      finally { try { await preview?.close() } finally { try {await image?.close()} finally {library?.close()} } }
    }
  })()
  let libraryState = 'Built-in resource library is not configured for this session.'
  try {
    if (input.measurement) {
      if(!input.sessionId)throw Error('Measurement requires the bound native session')
      const token = crypto.randomUUID()
      measurementServer = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
        if(request.headers.has('origin') || new URL(request.url).pathname!=='/'+token || request.method!=='POST')
          return new Response('Not found',{status:404})
        try {
          const body=await request.json()
          if(body && typeof body==='object' && 'handoffPaths' in body) {
            if(Object.keys(body).some(key=>!['handoffPaths','details'].includes(key)) ||
              !Array.isArray(body.handoffPaths) || !body.handoffPaths.length ||
              body.handoffPaths.some((path:unknown)=>typeof path!=='string') ||
              (body.details!==undefined && typeof body.details!=='boolean'))
              throw Error('Handoff accepts explicit handoffPaths and optional boolean details only')
            return Response.json(await input.measurement!.handoff(body.handoffPaths,body.details),{headers:{'Cache-Control':'no-store'}})
          }
          if(body && typeof body==='object' && 'inspectRequestKey' in body) {
            if(Object.keys(body).some(key=>!['inspectRequestKey','details'].includes(key)) ||
              typeof body.inspectRequestKey!=='string' || !body.inspectRequestKey.trim() ||
              (body.details!==undefined && typeof body.details!=='boolean'))
              throw Error('Inspection accepts a nonempty inspectRequestKey and optional boolean details')
            return Response.json(await input.measurement!.inspect(body.inspectRequestKey,body.details),{headers:{'Cache-Control':'no-store'}})
          }
          const record=await input.measurement!.measure(body)
          return Response.json(await input.measurement!.inspect(record.requestKey),{headers:{'Cache-Control':'no-store'}})
        } catch(error) {
          return Response.json({error:error instanceof Error?error.message:'Measurement failed; no automatic retry'},{status:409})
        }
      }})
      revokeMeasurement=await publishProjectPreviewCapability(root,input.sessionId,measurementServer.url.origin+'/'+token,'measurement')
      const help='Optional static-Web source-copy build + browser smoke. Run from this project: bun <this-entry> --request <stable-id> --artifact <public-build-folder> [--report <existing-design-or-test-report>]... . Explicitly runs saved package.json build and replaces only that build folder. Does not install dependencies or execute a model. reports/ is validation evidence, excluded from the build copy and editable sources; game/build inputs belong outside it. Selected --report files are hashed separately and edits still invalidate their receipt. Finalize selected reports before measurement; receipt IDs/hashes already live in BGS, so do not append them to measured files. Response starts with current input freshness, not game acceptance. bun <this-entry> --inspect <stable-id> [--details] rereads saved evidence and current inputs without a build, browser or model call; details returns saved observations, not another test. Repeating the original request also inspects without replay; changed inputs require an intended new request. Native/SSR runtimes, gameplay coverage, report semantics and quality are NOT certified.';
      await writeFile(resolve(directory,'measure.mjs'),[
        'import {realpath,readFile} from "node:fs/promises";',
        'const help='+JSON.stringify(help)+';',
        'const args=process.argv.slice(2); if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const inspecting=args[0]==="--inspect";if(inspecting && !(args[1]?.trim() && !args[1].startsWith("--") && (args.length===2 || args.length===3 && args[2]==="--details")))throw Error(help);const body=inspecting ? {inspectRequestKey:args[1],details:args.length===3} : {reportPaths:[]}; if(!inspecting){for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1]; if(!value || !value.trim() || value.startsWith("--"))throw Error(help); if(key==="--report")body.reportPaths.push(value); else if(key==="--request" && !body.requestKey)body.requestKey=value; else if(key==="--artifact" && !body.runtimeArtifact)body.runtimeArtifact=value; else throw Error(help)} if(!body.requestKey || !body.runtimeArtifact)throw Error(help)}',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Measurement belongs to another workspace");',
        'if(!process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE)throw Error("No active BGS measurement capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched measurement capability");',
        'const api=new URL(capability.apiUrl);if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid measurement endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),redirect:"error"});',
        'const result=await response.json();console.log(JSON.stringify(result,null,2));',
        'if(!response.ok || result.error || !result.finishedAt || !result.freshness?.current || !["build","runtime-smoke"].every(id=>result.checks?.some(c=>c.id===id && c.status==="passed")))process.exitCode=1;',
      ].join('\n'),{flag:'wx',mode:0o600})
      // Reuse the same workspace/session capability; reading evidence does not
      // start measurement or manufacture an author-written review assignment.
      await writeFile(resolve(directory,'handoff.mjs'),[
        'import {realpath,readFile} from "node:fs/promises";',
        'const help="Read-only task/evidence handoff: bun <this-entry> FILE ... [--details]. Explicit public project-relative design/source/test/report files only. Default: latest measurement/freshness first, current task/requirements and selected file hashes. --details includes current requirement text, selected text/section locations and saved check observations/history. No build, tests, model, writes or quality verdict.";',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const details=args.at(-1)==="--details";const paths=details?args.slice(0,-1):args;if(!paths.length || paths.some(p=>p.startsWith("--")))throw Error(help);',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Handoff belongs to another workspace");',
        'if(!process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE)throw Error("No active BGS turn capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched turn capability");',
        'const api=new URL(capability.apiUrl);if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid handoff endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({handoffPaths:paths,details}),redirect:"error"});',
        'const result=await response.json();console.log(JSON.stringify(result,null,2));if(!response.ok || result.error || !result.sources?.valid)process.exitCode=1;',
      ].join('\n'),{flag:'wx',mode:0o600})
    }
    if (input.libraryBaseUrl) {
      try {
        library = openResourceLibraryAccess({ baseUrl: input.libraryBaseUrl, getAuthToken: input.getAuthToken })
        libraryState = 'Resource library bridge is configured; catalog requests verify authentication/availability. Errors are not empty search results.'
      } catch { libraryState = 'Resource library bridge could not start; availability is unverified, not an empty search result.' }
    }
    if(input.openImage)image=await input.openImage()
    if (input.openPreview) {
      if (!input.sessionId) throw Error('Preview requires the bound native session')
      preview = await input.openPreview()
      revokePreview = await publishProjectPreviewCapability(root, input.sessionId, preview.baseUrl)
      // Long usage is available on demand, not repeated in every model input.
      await writeFile(resolve(directory, 'preview.mjs'),
        'if (process.argv.length !== 3 || process.argv[2] !== "--help") { console.error("Use --help for the current optional Preview API"); process.exit(1); }\nconsole.log(' +
        JSON.stringify(preview.instruction) + ');\n', { flag: 'wx', mode: 0o600 })
    }
    await writeProjectAssetCommand(resolve(directory, 'assets.mjs'), {
      ...(library ? { libraryBaseUrl: library.baseUrl } : {}),
      ...(image ? {imageEndpoint:image.endpoint} : {}),
      mediaCommand: 'bun ' + JSON.stringify(entry('media.mjs')),
    })
    for (const [name, source] of [['check-content.mjs', CURRENT_CONTENT_CHECKER_ENTRY],
      ['bind-content.mjs',CONTENT_BINDING_ENTRY],
      ['media.mjs', MEDIA_PRODUCTION_ENTRY], ['resources.mjs', RESOURCE_PRODUCTION_ENTRY]] as const)
      await writeFile(resolve(directory, name), source, { flag: 'wx', mode: 0o600 })
    // Optional existing geometry/paint implementation, not generated game code.
    // The bundle stays out of model context; the Agent chooses whether to use it.
    await writeFile(resolve(directory, 'content-consumer.mjs'), await bundleContentConsumer(), { flag: 'wx', mode: 0o600 })
    await writeFile(resolve(directory, 'consumer.mjs'),
      'if(process.argv.length!==3 || process.argv[2]!=="--help"){console.error("Use --help for the optional Web consumer API");process.exit(1)}\nconsole.log('+
      JSON.stringify(contentConsumerHelp(entry('content-consumer.mjs')))+');\n', { flag: 'wx', mode: 0o600 })
    return {
      directory: relative(root, directory),
      turnContext: [
        'Optional BGS project tools (run from the project root; use these actual entries, not legacy delivery paths):',
        ...(input.measurement ? ['Static Web measurement/export: bun '+JSON.stringify(entry('measure.mjs'))+' --help; --inspect <request-id> reads without rerunning. Finalize reports first; receipt stays in BGS. Not quality acceptance.'] : []),
        ...(input.measurement ? ['Read-only task/evidence: bun '+JSON.stringify(entry('handoff.mjs'))+' FILE ... [--details]. Current task/requirements, selected sources, saved measurement; no new work or acceptance.'] : []),
        'Assets: bun ' + JSON.stringify(entry('assets.mjs')) + ' --help (library catalog/download and local hashing). ' + libraryState,
        'Content: bun ' + JSON.stringify(entry('check-content.mjs')) + ' (default: actual package/resources); --authority reads current design/asset revision hashes; --help for format/drafts/layout/source batches; --scene-point FILE NODE W H for saved coordinates. BGS JSON only; React/Canvas does not waive promised editable data. Runtime consumption needs separate evidence. Optional Web consumer: bun '+JSON.stringify(entry('consumer.mjs'))+' --help.',
        'Batch binding (BGS JSON only): bun '+JSON.stringify(entry('bind-content.mjs'))+' --help. --inspect supplies current hashes/IDs; --current mapping.json preserves design and checks real content/asset operands without a legacy document release.',
        'Media: bun ' + JSON.stringify(entry('media.mjs')) + ' --help (image processing/atlas). Resources: bun ' + JSON.stringify(entry('resources.mjs')) + ' --help (explicit audio recipes, fonts, registration). Actual inputs and existing safety/source contracts remain required.',
        preview ? 'Browser Preview (Web only): bun ' + JSON.stringify(entry('preview.mjs')) + ' --help. Run helper scripts with node, not bun; uses BEEGAME_PREVIEW_TEST_MODULE/BEEGAME_PREVIEW_CAPABILITY_FILE. Not a build or quality verdict. Engine-native CLI/MCP stays separate.' : 'Managed browser Preview is unavailable; native tools remain available. Do not claim a managed runtime check.',
        'Tools do not choose a plan or certify quality. Legacy --authority/handoff/binding requires actual design sources, not fabricated approvals.',
        image ? 'AI images: assets.mjs cost/generate --help; billed identity and recovery apply. Keep a stable requestId; unknown outcomes are not new purchases. Opening the bridge does not charge.' : 'AI image generation is unavailable; do not report a generation as performed.',
        'Bridges expire at turn end; credentials stay in BGS. Native execution supplies shared runtime; exports alone do not.',
      ].join('\n'),
      // Retain tiny adapters as execution evidence, not game deliverables.
      // Revocation closes the bridge; do not delete Agent-created files.
      close,
    }
  } catch (error) { await close(); throw error }
}

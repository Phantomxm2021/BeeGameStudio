import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { CURRENT_CONTENT_CHECKER_ENTRY, CONTENT_BINDING_ENTRY, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from '../content-checker-runtime'
import { writeProjectAssetCommand } from '../project-asset-command'
import { openResourceLibraryAccess } from '../resource-library-access'
import type { openPreviewTestAccess } from '../preview-test-access'
import { publishProjectPreviewCapability } from '../project-preview-capability'
import type { createAgentMeasurement } from './agent-measurement'
import type { openImageGenerationAccess } from '../../image-generation/access'
import { bundleContentConsumer, contentConsumerCommand } from '../game-content-consumer-cli'
import { sharedPlaywright } from '../shared-playwright'

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
          if (body && typeof body === 'object' && 'executionInputs' in body) {
            if (Object.keys(body).length !== 1 || body.executionInputs !== true)
              throw Error('Execution input inspection accepts executionInputs:true only')
            return Response.json(await input.measurement!.executionInputs(), {headers:{'Cache-Control':'no-store'}})
          }
          if(body && typeof body==='object' && 'handoffPaths' in body) {
            if(Object.keys(body).some(key=>!['handoffPaths','details'].includes(key)) ||
              !Array.isArray(body.handoffPaths) ||
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
          return Response.json(await input.measurement!.inspect(record.id),{headers:{'Cache-Control':'no-store'}})
        } catch(error) {
          return Response.json({error:error instanceof Error?error.message:'Measurement failed; no automatic retry'},{status:409})
        }
      }})
      revokeMeasurement=await publishProjectPreviewCapability(root,input.sessionId,measurementServer.url.origin+'/'+token,'measurement')
      const help='Optional static-Web source-copy build + browser smoke: node <this-entry> --request <stable-id> --artifact <public-build-folder> [--report <existing-file>]... . Runs saved package.json build, replaces only that build folder. Does not install dependencies or execute a model. reports/ is evidence excluded from source copies; game/build inputs belong outside it. Selected reports are separately hashed; edits invalidate their receipt. Finalize them first; do not append receipt IDs/hashes to measured files. --inspect <measurement-ID-or-unique-request-key> [--details] reads any saved receipt in this Run and current freshness without build/browser/model work. Reused keys require the exact measurement ID from handoff; details reads observations, not another test. A same-turn request retry inspects without replay; changed inputs need an intended new request. Native/SSR, gameplay, report semantics and quality are NOT certified.';
      const consumptionHelp='Optional --consumption-json JSON reuses actual static-Web drivers without a Task. A valid scoped example: {"checks":["ui-data-consumption"],"uiProbes":[{"document":"content/ui/menu.json","nodeId":"play","selector":"#play","viewport":[1280,720]}]}. UI checks saved DOM geometry and visible text fit on selected nodes/states; unselected registry screens/viewports remain explicitly outside coverage. Optional UI-only coordinateRoot:"#logical-root" selects an independent unpadded DOM ancestor for a fixed logical canvas scaled/letterboxed into the window; logical dimensions come from saved root referenceResolution/layout.size. Its positive axis-aligned mapping must remain stable through perturbation/restoration. Without coordinateRoot, geometry is compared in window CSS pixels. Unsupported roots remain unverified; mapping is not proof of intended whole-frame adaptation. Optional steps:[{click:selector}] reach actual states, not a gameplay solver. pixel-data-consumption uses pixelProbes with componentId for bound static 2D images/Tilemaps; procedural Canvas graphics are unsupported. font-data-consumption uses uiProbes for explicitly bound custom-font plain DOM text; system fonts/rich text are unsupported. audio-data-consumption uses audioProbes with componentId, playSteps and stopSteps for encoded HTML audio bindings; WebAudio synthesis/concurrency/listening are unsupported. Select applicable inputs only. Probes change isolated responses, not project sources. --inspect ID [--details] records coverage and unmeasured drivers; geometry/asset causality is not complete gameplay or quality.';
      await writeFile(resolve(directory,'measure.mjs'),[
        'import {realpath,readFile} from "node:fs/promises";',
        'const help='+JSON.stringify(help+'\n'+consumptionHelp+'\n--artifact is project-relative (e.g. dist), not an absolute path. Probes accept optional deviceScaleFactor (positive number, default 1); receipts record observed browser conditions and the declared click path. Other pixel densities and unselected gameplay remain untested.')+';',
        'const args=process.argv.slice(2); if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const inspecting=args[0]==="--inspect";if(inspecting && !(args[1]?.trim() && !args[1].startsWith("--") && (args.length===2 || args.length===3 && args[2]==="--details")))throw Error(help);const body=inspecting ? {inspectRequestKey:args[1],details:args.length===3} : {reportPaths:[]}; if(!inspecting){for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1]; if(!value || !value.trim() || value.startsWith("--"))throw Error(help); if(key==="--report")body.reportPaths.push(value); else if(key==="--request" && !body.requestKey)body.requestKey=value; else if(key==="--artifact" && !body.runtimeArtifact)body.runtimeArtifact=value; else if(key==="--consumption-json" && !("consumption" in body))body.consumption=JSON.parse(value); else throw Error(help)} if(!body.requestKey || !body.runtimeArtifact)throw Error(help)}',
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
        'const help="Read-only task/evidence handoff: node <this-entry> [FILE ...] [--details]. With no files: task, source navigation and latest measurement/freshness; no source coverage. Files must be explicit public project-relative design/source/test/report paths. --details includes current requirement text, selected source text and saved observations/history. No build, tests, model, writes or quality verdict.";',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const details=args.at(-1)==="--details";const paths=details?args.slice(0,-1):args;if(paths.some(p=>p.startsWith("--")))throw Error(help);',
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
        'const args=process.argv.slice(2);\n'+
        'if(args[0]==="--inspect" && args.length===2){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {inspectPreviewTest}=await import(new URL("./preview-test-command.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));console.log(JSON.stringify(await inspectPreviewTest(args[1]),null,2));}catch(error){console.log(JSON.stringify({error:error.message,quality:"unverified"}));process.exitCode=1;}} else '+
        'if(args[0]==="--run" && args[1]){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {runPreviewTest}=await import(new URL("./preview-test-command.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const result=await runPreviewTest(args[1],args.slice(2));console.log(JSON.stringify(result,null,2));if(result.exitCode!==0)process.exitCode=1;}catch(error){console.log(JSON.stringify({status:"error",error:error.message,execution:"unconfirmed; inspect retained files before any new execution",quality:"unverified"}));process.exitCode=1;}}\n'+
        'else if(args.length===1 && args[0]==="--client")console.log('+JSON.stringify(JSON.stringify({
          runtime:'node',helperModule:new URL('../preview-test-client.mjs',import.meta.url).href,
          playwrightModule:sharedPlaywright().moduleUrl,
          environment:{helper:'BEEGAME_PREVIEW_TEST_MODULE',playwright:'BEEGAME_PLAYWRIGHT_MODULE',capability:'BEEGAME_PREVIEW_CAPABILITY_FILE'},
          runCommand:'node '+JSON.stringify(entry('preview.mjs'))+' --run <project-test.mjs> [args...]',
          scope:'Existing test tooling only; no browser, build, test or model executed. Capability still requires the active project turn.',
        })) +');\n'+
        'else if(args.length===1 && args[0]==="--help")console.log('+JSON.stringify('Optional --run <project-test.mjs> [args...] executes once with Node, retaining stdout/stderr and execution.json. --inspect <execution.json> reads the saved receipt and current input identity without executing it. Exit code is not test quality; scripts choose assertions and use the existing helper for current access.\n'+preview.instruction)+');\n'+
        'else {console.error("Use --help for the Preview API, --client for Node helper/module paths, or --run <project-test.mjs> [args...]");process.exitCode=1;}\n', { flag: 'wx', mode: 0o600 })
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
      contentConsumerCommand(root, entry('content-consumer.mjs')), { flag: 'wx', mode: 0o600 })
    return {
      directory: relative(root, directory),
      turnContext: [
        'Optional BGS project tools (project root; --help):',
        ...(input.measurement ? ['Static Web source-copy build and smoke measurement (no separate prebuild): node '+JSON.stringify(entry('measure.mjs'))+' --help; --inspect reads without rerunning.'] : []),
        ...(input.measurement ? ['Read-only task/evidence: node '+JSON.stringify(entry('handoff.mjs'))+' [FILE ...] [--details]; task facts, optional sources.'] : []),
        'Assets: bun ' + JSON.stringify(entry('assets.mjs')) + ' --help (catalog/download, local hashes). ' + libraryState,
        'Content: bun ' + JSON.stringify(entry('check-content.mjs')) + ' --help; --format projectGuide batches source navigation. --authority is identity, not design approval. Web consumer: bun '+JSON.stringify(entry('consumer.mjs'))+' --help.',
        'Batch binding (BGS JSON): bun '+JSON.stringify(entry('bind-content.mjs'))+' --help; --inspect gives saved hashes/IDs.',
        'Media: bun ' + JSON.stringify(entry('media.mjs')) + ' --help (images/atlas). Resources: bun ' + JSON.stringify(entry('resources.mjs')) + ' --help (audio, fonts, registration). Existing safety/source contracts apply.',
        preview ? 'Browser Preview (Web only): node ' + JSON.stringify(entry('preview.mjs')) + ' --help / --client / --run <test.mjs> [args...] (Node, retained output). Native CLI/MCP separate.' : 'Managed browser Preview is unavailable; native tools remain available.',
        image ? 'AI images: assets.mjs cost/generate --help; keep a stable requestId for recovery. Opening the bridge does not charge.' : 'AI image generation is unavailable.',
        'Bridges expire at turn end; credentials stay in BGS. Tool availability is not runtime consumption or quality evidence.',
      ].join('\n'),
      // Retain tiny adapters as execution evidence, not game deliverables.
      // Revocation closes the bridge; do not delete Agent-created files.
      close,
    }
  } catch (error) { await close(); throw error }
}

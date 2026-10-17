import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { ZodError } from 'zod/v4'
import { CURRENT_CONTENT_CHECKER_ENTRY, CONTENT_BINDING_ENTRY, MEDIA_PRODUCTION_ENTRY, RESOURCE_PRODUCTION_ENTRY } from '../content-checker-runtime'
import { writeProjectAssetCommand } from '../project-asset-command'
import { openResourceLibraryAccess } from '../resource-library-access'
import type { openPreviewTestAccess } from '../preview-test-access'
import { publishProjectPreviewCapability } from '../project-preview-capability'
import type { createAgentMeasurement } from './agent-measurement'
import type { openImageGenerationAccess } from '../../image-generation/access'
import { bundleContentConsumer, contentConsumerCommand, registeredRuntimeFilesSource } from '../game-content-consumer-cli'
import { sharedPlaywright } from '../shared-playwright'
import type { LayoutConstraints } from '../ui-layout-audit'
import type { ResourceCatalogPack, ResourceCatalogPage } from '@bee-game-studio/beegame-resource-core'
import { PROJECT_DOCUMENTS } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, checkDesignHandoffDraft, DESIGN_HANDOFF_INSTRUCTION,
  finalizeDesignDocuments, readDesignAcceptanceRequirements, readDesignImplementationChecklist, snapshotDesignDocuments } from '../design-handoff'
import { DESIGN_RUNTIME_REPORT_INSTRUCTION, inspectDesignAcceptance } from '../runtime-acceptance'

export type AgentPreviewAccess = ReturnType<typeof openPreviewTestAccess>
export type AgentImageAccess = ReturnType<typeof openImageGenerationAccess>

/** Same design indexes and writer lifetime; no new workflow state or copied plan. */
export function openDesignActions(root: string, requireEditableContent = false) {
  let before = snapshotDesignDocuments(root, PROJECT_DOCUMENTS)
  return async (action: string, documents: string[] = []) => {
    const selected = documents.map(name => name.startsWith('docs/') ? name.slice(5) : name)
    if (selected.some(name => !PROJECT_DOCUMENTS.includes(name as typeof PROJECT_DOCUMENTS[number])))
      throw Error('Expected an existing design document name')
    if (documents.length && action !== 'finalize' && action !== 'draft') throw Error('Document selection is supported only by finalize or draft')
    if (action === 'draft') {
      if (selected.length !== 1) throw Error('Draft inspection requires one design document')
      return checkDesignHandoffDraft(root, selected[0]!, { finalTechnical: selected[0] === 'TECHNICAL_DESIGN.md' })
    }
    if (action === 'help') return { valid: true, instruction: DESIGN_HANDOFF_INSTRUCTION,
      acceptanceInstruction: DESIGN_RUNTIME_REPORT_INSTRUCTION + ' Save .beegame/delivery/acceptance.json with scope:"delivery", status:"passed"|"failed"|"blocked", summary, environment, evidencePaths, artifactPaths and verification:{target:"deployment",observation:"target-runtime",knownIssues:[],unverified:[],designRevision,requirementChecks,contentChecks?}. Copy current designRevision and requirement source hashes from --design implementation; do not calculate or invent them. Record real differences from selected designs and missing observations honestly. --design acceptance reads this same validator; it never executes or retries tests. After reports are final, attach the report to the existing measurement with --report .beegame/delivery/acceptance.json when measuring a static Web build.',
      help: 'handoff.mjs --design baseline|implementation|acceptance reads saved design inputs and acceptance evidence. baseline validity requires all eight documents and their output/acceptance entries, but not final implementationItems; independently available inputs remain readable while it is invalid. Its CLI prints status/issues and counts by default; --design baseline --details returns full requirements and source hashes. Baseline checks index integrity, not visual design or layout geometry. First select actual visual designs and obtain corresponding resources; then author UI/Scene JSON and use CheckUiLayouts for saved UI geometry and check-content.mjs --scene-layouts for Scene checks. implementation requires the final task coverage. Use game-implementation-planning for task sections and game-plan-execution for execution/resume. Read taskSource and owner sections with native Read; inspect actual dependency outputs. Keep same-ID progress/result paths in the existing execution list, not finalized design records. This command validates declared structure, not complete implementation or runtime quality. --design finalize [DOCUMENT.md ...] updates only selected documents (default: saved documents, independently); missing unrelated documents are not prerequisites. It explicitly updates existing document/index version metadata after an authorized write; call before checking the baseline and after affected design edits, before writing verification reports. These commands do not build, execute tests or certify semantic completeness, taste or quality.' }
    if (action === 'finalize') {
      const names = PROJECT_DOCUMENTS.filter(name => selected.length ? selected.includes(name) :
        existsSync(resolve(root,'docs',name)))
      const issues: string[] = [], finalized: string[] = []
      for (const name of names) {
        const draft = checkDesignHandoffDraft(root, name).issues
        if (draft.length) { issues.push(...draft); continue }
        const result = finalizeDesignDocuments(root, [name], before)
        issues.push(...result.issues)
        if (!result.issues.length) {
          before.documents[name] = snapshotDesignDocuments(root, [name]).documents[name]
          finalized.push(name)
        }
      }
      if (!names.length) issues.push('No saved design documents to finalize')
      return { valid: !issues.length, issues, finalized }
    }
    if (action === 'baseline') {
      const { availableRequirements = [], ...check } = checkDesignHandoff(root, PROJECT_DOCUMENTS, { technicalBaseline: true, planningInputs: true })
      return { ...check, requirements: availableRequirements,
        requirementScope: 'Available source pointers, including incomplete drafts; valid:false still blocks release/implementation. Repair named inputs only.' }
    }
    if (action === 'implementation') return { valid: true, ...readDesignImplementationChecklist(root),
      requirements:readDesignAcceptanceRequirements(root) }
    if (action === 'acceptance') return inspectDesignAcceptance(root,true,requireEditableContent)
    throw Error('Unknown design action; use --design help')
  }
}

/** Entry points only: no stage, Task, invented authority or tool/result rewriting.
 * Native execution already supplies the shared checker/Sharp environment. */
export async function openAgentTools(input: {
  workspacePath: string
  constraints?: LayoutConstraints
  requireEditableContent?: boolean
  libraryBaseUrl?: string
  readInitialCatalog?: boolean
  getAuthToken: () => string | undefined | Promise<string | undefined>
  sessionId?: string
  openPreview?: () => AgentPreviewAccess | Promise<AgentPreviewAccess>
  measurement?: ReturnType<typeof createAgentMeasurement>
  openImage?: () => AgentImageAccess | Promise<AgentImageAccess>
}) {
  const root = await realpath(input.workspacePath)
  const design = openDesignActions(root, input.requireEditableContent)
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
          if (body && typeof body === 'object' && 'designAction' in body) {
            if (Object.keys(body).some(key => !['designAction','documents'].includes(key)) || typeof body.designAction !== 'string' ||
                body.documents !== undefined && (!Array.isArray(body.documents) || body.documents.some((name: unknown) => typeof name !== 'string')))
              throw Error('Design accepts designAction and optional document names')
            await input.measurement!.assertActive(body.designAction === 'finalize')
            return Response.json(await design(body.designAction, body.documents), { headers: { 'Cache-Control':'no-store' } })
          }
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
          // Keep the existing text error; expose validator facts without double parsing or echoing inputs.
          const issues=error instanceof ZodError ? error.issues.map(({path,code,message})=>({path,code,message})) : undefined
          return Response.json({error:error instanceof Error?error.message:'Measurement failed; no automatic retry',
            ...(issues?{issues}:{})},{status:409})
        }
      }})
      revokeMeasurement=await publishProjectPreviewCapability(root,input.sessionId,measurementServer.url.origin+'/'+token,'measurement')
      const help='Optional static-Web source-copy build + browser smoke: node <this-entry> --request <stable-id> --artifact <public-build-folder> [--report <existing-file>]... . Runs saved package.json build, replaces only that build folder. Does not install dependencies or execute a model. reports/ is evidence excluded from source copies; game/build inputs belong outside it. Selected reports are separately hashed; edits invalidate their receipt. Finalize them first; do not append receipt IDs/hashes to measured files. --inspect <measurement-ID-or-unique-request-key> [--details] reads any saved receipt in this Run and current freshness without build/browser/model work. Default inspection includes failed check identities and reasons; --details adds raw observations, not another test. Reused keys require the exact measurement ID from handoff. A same-turn request retry inspects without replay; changed inputs need an intended new request. Native/SSR, gameplay, report semantics and quality are NOT certified.';
      const consumptionHelp='Optional --consumption-json JSON reuses actual static-Web drivers without a Task. JSON shape example (replace selectors with actual game controls): {"checks":["ui-data-consumption"],"uiProbes":[{"document":"content/ui/menu.json","nodeId":"play","selector":"#play","viewport":[1280,720],"steps":[{"click":"#start"}]}]}. Put steps INSIDE each uiProbes item, not at the consumption JSON root. UI checks saved DOM geometry and visible text fit on selected nodes/states; unselected registry screens/viewports remain explicitly outside coverage. The saved node must already be active and non-collapsed at the selected viewport; click steps reach runtime states but cannot make an inactive saved-layout node eligible for this geometry probe. Verify dynamic-only states through an interaction test. Optional UI-only coordinateRoot:"#logical-root" selects an independent unpadded DOM ancestor for a fixed logical canvas scaled/letterboxed into the window; logical dimensions come from saved root referenceResolution/layout.size. Its positive axis-aligned mapping must remain stable through perturbation/restoration. Without coordinateRoot, geometry is compared in window CSS pixels. Unsupported roots remain unverified; mapping is not proof of intended whole-frame adaptation. Probe steps reach actual states, not a gameplay solver. scene-data-consumption uses sceneProbes with document, nodeId, selector of the actual Canvas, viewport and optional click steps; it checks whether disabling a saved 2D Scene node changes stable rendered pixels, not whether its appearance is correct. pixel-data-consumption uses pixelProbes with componentId for bound static 2D images/Tilemaps; procedural Canvas graphics are unsupported by that resource/geometry driver. font-data-consumption uses uiProbes for explicitly bound custom-font plain DOM text; system fonts/rich text are unsupported. Audio JSON example: {"checks":["audio-data-consumption"],"audioProbes":[{"document":"content/scenes/level.json","nodeId":"board","componentId":"sound","selector":"#clip","viewport":[960,540],"playSteps":[{"click":"#start"}],"stopSteps":[{"click":"#stop"}]}]}. Replace the document, saved node/component IDs, HTML audio selector, viewport and controls with actual project inputs. playSteps and stopSteps are non-empty arrays of {click:"selector"} only; wait steps are not supported. The saved audio-source component must bind an encoded assetRef and explicit data.volume (0..1) / data.loop. These probes verify encoded HTML audio bindings, not WebAudio synthesis, concurrency or listening quality. Select applicable inputs only. Probes change isolated responses, not project sources. --inspect ID [--details] records coverage and unmeasured drivers; geometry/asset causality is not complete gameplay or quality.';
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
        'const help="Task/evidence handoff: node <this-entry> [FILE ...] [--details]. With no files: task, source navigation and latest measurement/freshness; no source coverage. Files must be explicit public project-relative design/source/test/report paths. --details includes current requirement text, selected source text and saved observations/history. --design baseline prints status/issues and available input counts, including while documents are missing; --design baseline --details returns full requirements and source hashes. --design draft DOCUMENT.md exposes availableRequirements even before the technical document/index exists. --design help describes design inspection; only --design finalize [DOCUMENT.md ...] writes existing version metadata after saving a document and index; Write/Edit do not finalize it. All other actions are read-only. No build, tests, model or quality verdict.";',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const details=args.at(-1)==="--details",positional=details?args.slice(0,-1):args;const designAction=positional[0]==="--design"?positional[1]:undefined;if(positional[0]==="--design" && (!designAction || designAction==="draft" && positional.length!==3 || !["finalize","draft"].includes(designAction) && positional.length!==2 || details && designAction!=="baseline"))throw Error("Use --design help");const documents=["finalize","draft"].includes(designAction)?positional.slice(2):[];const paths=designAction?[]:positional;if(paths.some(p=>p.startsWith("--")))throw Error(help);',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Handoff belongs to another workspace");',
        'if(!process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE)throw Error("No active BGS turn capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched turn capability");',
        'const api=new URL(capability.apiUrl);if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid handoff endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(designAction?{designAction,documents}:{handoffPaths:paths,details}),redirect:"error"});',
        'const result=await response.json();const output=designAction==="baseline" && !details && typeof result.valid==="boolean" ? {scope:"design-index-integrity",valid:result.valid,issues:result.issues,revision:result.revision,documentVersions:result.documentVersions,requirementCount:result.requirements?.length??0,layoutVerified:false,runtimeVerified:false,note:result.note,details:"Use --design baseline --details for full requirements/source hashes. Geometry is not checked here; use check-content.mjs --design-layouts --draft."} : result;console.log(JSON.stringify(output,null,2));if(!response.ok || result.error || !(designAction?result.valid:result.sources?.valid))process.exitCode=1;',
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
      const keyboardHelp = '--keyboard-sample <JSON> runs one fixed production-preview desktop keyboard sample, without a project script/callback. JSON: {startSelector?,readySelector,key,holdMs,observeMs,viewport?:{width,height}}. Use actual selectors and one arrow, Space, letter or digit. holdMs 100..5000; observeMs >=100; total <=120000 ms. Click start if supplied, wait for visible ready target, key down/hold/up, then wait real host time. Retains input timestamps, silent video, stills and observation.json even on failure. No state/clock injection, automatic retry, build, installation or model call. Observed is not gameplay/input-effect/completion acceptance; touch remains untested.'
      const countdownBlurHelp = '--countdown-blur-sample <JSON> runs one fixed production-preview countdown/iframe-blur sample. JSON: {startSelector,countdownSelector,playingSelector,countdownMs,observeMs?:500,viewport?:{width,height}}. Supply actual unique CSS selectors and source-derived full countdownMs (100..30000); observeMs 100..5000. Click start, observe countdown, click a temporary host focus target, verify real blur during countdown, wait countdownMs+250 real host milliseconds, capture BEFORE restoring focus, restore iframe focus and observe. Saves focus events, DOM indicator text/visibility, silent video, stills and observation.json even on failure. No game pause hooks, synthetic events, clock/frame changes, project scripts, retries, builds, installation or model calls. Missing blur, missed countdown or interrupted focus means incomplete, never PASS. Observed means sampling completed, not pause/resume acceptance; wrong selectors/duration and hidden-tab behavior remain unverified.'
      // Long usage is available on demand, not repeated in every model input.
      await writeFile(resolve(directory, 'preview.mjs'),
        'const args=process.argv.slice(2);\n'+
        'if((args[0]==="--sprite-sample" && args.length>=6)||(args[0]==="--sprite-capture" && args.length===1)){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {resolvePreviewApi}=await import(new URL("./preview-test-client.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const api=await resolvePreviewApi();if(!(await fetch(api+"/status",{redirect:"error"})).ok)throw Error("Preview capability expired");const {createSpriteSample,captureSpriteSample}=await import(new URL("./sprite-sample.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));console.log(JSON.stringify(args[0]==="--sprite-sample"?await createSpriteSample(args[1],args[2],Number(args[3]),args.slice(4)):await captureSpriteSample(),null,2));}catch(error){console.log(JSON.stringify({status:"error",error:error.message,quality:"unverified"}));process.exitCode=1;}} else '+
        'if(args[0]==="--inspect" && args.length===2){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {inspectPreviewTest}=await import(new URL("./preview-test-command.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));console.log(JSON.stringify(await inspectPreviewTest(args[1]),null,2));}catch(error){console.log(JSON.stringify({error:error.message,quality:"unverified"}));process.exitCode=1;}} else '+
        'if(args[0]==="--run" && args[1]){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {runPreviewTest}=await import(new URL("./preview-test-command.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const result=await runPreviewTest(args[1],args.slice(2));console.log(JSON.stringify(result,null,2));if(result.exitCode!==0)process.exitCode=1;}catch(error){console.log(JSON.stringify({status:"error",error:error.message,execution:"unconfirmed; inspect retained files before any new execution",quality:"unverified"}));process.exitCode=1;}}\n'+
        'else if(args[0]==="--keyboard-sample" && args.length===2){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {captureKeyboardSample}=await import(new URL("./preview-play-capture.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const result=await captureKeyboardSample(JSON.parse(args[1]));console.log(JSON.stringify(result,null,2));if(result.status!=="observed")process.exitCode=1;}catch(error){console.log(JSON.stringify({status:"error",error:error.message,quality:"unverified"}));process.exitCode=1;}}\n'+
        'else if(args[0]==="--countdown-blur-sample" && args.length===2){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {captureCountdownBlurSample}=await import(new URL("./preview-play-capture.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const result=await captureCountdownBlurSample(JSON.parse(args[1]));console.log(JSON.stringify(result,null,2));if(result.status!=="observed")process.exitCode=1;}catch(error){console.log(JSON.stringify({status:"error",error:error.message,quality:"unverified"}));process.exitCode=1;}}\n'+
        'else if(args[0]==="--snapshot" && args.length===4){try{if(!process.env.BEEGAME_CONTENT_CHECKER_MODULE)throw Error("BGS tool runtime is unavailable");const {capturePreviewSnapshot}=await import(new URL("./preview-test-command.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE));const result=await capturePreviewSnapshot(args[1],Number(args[2]),Number(args[3]));console.log(JSON.stringify(result,null,2));if(result.status!=="observed")process.exitCode=1;}catch(error){console.log(JSON.stringify({status:"error",error:error.message,quality:"unverified"}));process.exitCode=1;}}\n'+
        'else if(args.length===1 && args[0]==="--client")console.log(JSON.stringify({...'+JSON.stringify({
          runtime:'node',
          playwrightModule:sharedPlaywright().moduleUrl,
          environment:{helper:'BEEGAME_PREVIEW_TEST_MODULE',playwright:'BEEGAME_PLAYWRIGHT_MODULE',capability:'BEEGAME_PREVIEW_CAPABILITY_FILE'},
          playCapture:'withPlayCapture({mode,viewport?,outputParent?,audio?,audioLimitMs?}, async ({page,gameFrame,mark,captureFrame,runtimeErrors}) => {...})',
          runCommand:'node '+JSON.stringify(entry('preview.mjs'))+' --run <project-test.mjs> [args...]',
          scope:'Existing test tooling only; no browser, build, test or model executed. Capability still requires the active project turn.',
        }) +',helperModule:process.env.BEEGAME_PREVIEW_TEST_MODULE || new URL("./preview-test-client.mjs",process.env.BEEGAME_CONTENT_CHECKER_MODULE).href}));\n'+
        'else if(args.length===1 && args[0]==="--help")console.log('+JSON.stringify(countdownBlurHelp+'\n'+keyboardHelp+'\nFor an explicitly requested standalone sprite sample in a NEW project: --sprite-sample <assets/sheet.png> <assets/atlas.json> <frame-ms> <frame-id> <frame-id> ... writes a dependency-free static player/build script without overwriting an app. Select equal-size prepared frames in playback order (50..500 ms, 2..32 frames). It neither generates nor repairs artwork. Use the existing measure entry with --artifact dist once, then --sprite-capture records actual production Preview and asserts frame coverage, pause and resume, retaining observations even on failure. No project test script, installations, model or automatic retries. Visual motion quality stays unverified.\nOptional --snapshot development|production <width> <height> captures the actual first-load viewport and runtime error counts into a unique .beegame/tmp/preview-snapshot-* directory, without a project test script. This is a visual diagnostic, not a pass, playtest or freshness receipt. --run <project-test.mjs> [args...] executes once with Node, retaining stdout/stderr and execution.json. --inspect <execution.json> reads the saved test receipt and current input identity without executing it. Exit code is not test quality; scripts choose assertions and use the existing helper for current access.\n'+preview.instruction)+');\n'+
        'else {console.error("Use --help, --countdown-blur-sample <JSON>, --keyboard-sample <JSON>, --snapshot <mode> <width> <height>, --client, or --run <project-test.mjs> [args...]");process.exitCode=1;}\n', { flag: 'wx', mode: 0o600 })
    }
    await writeProjectAssetCommand(resolve(directory, 'assets.mjs'), {
      ...(library ? { libraryBaseUrl: library.baseUrl } : {}),
      ...(image ? {imageEndpoint:image.endpoint} : {}),
      mediaCommand: 'bun ' + JSON.stringify(entry('media.mjs')),
    })
    const { platform, inputs, orientation, dimension } = input.constraints ?? {}
    const contentEntry = CURRENT_CONTENT_CHECKER_ENTRY.replace("{ profile: 'current' }",
      JSON.stringify({ profile: 'current', confirmed: { platform, inputs, orientation, dimension } }))
    for (const [name, source] of [['check-content.mjs', contentEntry],
      ['bind-content.mjs',CONTENT_BINDING_ENTRY],
      ['media.mjs', MEDIA_PRODUCTION_ENTRY], ['resources.mjs', RESOURCE_PRODUCTION_ENTRY]] as const)
      await writeFile(resolve(directory, name), source, { flag: 'wx', mode: 0o600 })
    // Optional existing geometry/paint implementation, not generated game code.
    // The bundle stays out of model context; the Agent chooses whether to use it.
    await writeFile(resolve(directory, 'content-consumer.mjs'), await bundleContentConsumer(), { flag: 'wx', mode: 0o600 })
    await writeFile(resolve(directory, 'registered-runtime-files.mjs'), await registeredRuntimeFilesSource(), { flag: 'wx', mode: 0o600 })
    await writeFile(resolve(directory, 'consumer.mjs'),
      contentConsumerCommand(root, entry('content-consumer.mjs')), { flag: 'wx', mode: 0o600 })
    return {
      directory: relative(root, directory),
      uiLayoutConstraints: { platform, inputs, orientation, dimension },
      // Keep the locator outside compactable message history. Capabilities
      // still expire normally; this is only the current turn's tool location.
      systemContext: 'Current BGS tools directory (relative to project root): '+JSON.stringify(relative(root, directory))+'. '+
        'Run entries with --help: bun assets.mjs, check-content.mjs, bind-content.mjs, consumer.mjs, media.mjs, resources.mjs'+
        (input.measurement ? '; node measure.mjs, handoff.mjs' : '')+(preview ? '; node preview.mjs' : '')+
        '. Prefix each filename with that directory; keep project root as cwd. Bridges expire at turn end.',
      turnContext: [
        'Optional BGS project tools (project root; --help):',
        ...(input.measurement ? ['Static Web source-copy build and smoke measurement (no separate prebuild): node '+JSON.stringify(entry('measure.mjs'))+' --help; --inspect reads without rerunning.'] : []),
        ...(input.measurement ? ['Task/evidence: node '+JSON.stringify(entry('handoff.mjs'))+' [FILE ...] [--details] reads facts/sources. --design help exposes the existing eight-document index, baseline and implementation checks; explicitly call --design finalize after saving each owner document/index for version metadata; Write/Edit do not finalize it.'] : []),
        'Assets: bun ' + JSON.stringify(entry('assets.mjs')) + ' --help (catalog/download, local hashes). ' + libraryState,
        ...(input.readInitialCatalog ? [library ? await initialCatalogContext(library.baseUrl) :
          'Initial built-in resource catalog: unavailable. ' + libraryState + ' This is not an empty catalog.'] : []),
        'UI geometry: mcp__bgs-ui-layout__CheckUiLayouts {} checks all saved UI; {detailsFor:"content/ui/hud.json"} adds coordinates. Read-only; not visual/runtime acceptance.',
        'Content structure/formats: bun ' + JSON.stringify(entry('check-content.mjs')) + ' --help; --format projectGuide batches source navigation. Web consumer: bun '+JSON.stringify(entry('consumer.mjs'))+' --help.',
        'Batch binding (BGS JSON): bun '+JSON.stringify(entry('bind-content.mjs'))+' --help; --inspect gives saved hashes/IDs.',
        'Media: bun ' + JSON.stringify(entry('media.mjs')) + ' --help (images/atlas). Resources: bun ' + JSON.stringify(entry('resources.mjs')) + ' --help (audio, fonts, registration). Existing safety/source contracts apply.',
        preview ? 'Browser Preview (Web only): node ' + JSON.stringify(entry('preview.mjs')) + ' --help / --snapshot <mode> <width> <height> / --sprite-sample / --sprite-capture / --client / --run <test.mjs> [args...] (Node, retained output). Native CLI/MCP separate.' : 'Managed browser Preview is unavailable; native tools remain available.',
        image ? 'AI image bridge is configured, not yet verified available. Use assets.mjs cost before generate; the quote is read-only. Keep a stable requestId for recovery. Opening the bridge does not charge.' : 'No AI image bridge is configured for this turn.',
        'Bridges expire at turn end; credentials stay in BGS. Tool availability is not runtime consumption or quality evidence.',
      ].join('\n'),
      // Retain tiny adapters as execution evidence, not game deliverables.
      // Revocation closes the bridge; do not delete Agent-created files.
      close,
    }
  } catch (error) { await close(); throw error }
}

/** One overview before initial source decisions, not automatic asset selection.
 * Reuse the authenticated read-only bridge; no element reads, downloads or retries. */
async function initialCatalogContext(baseUrl: string): Promise<string> {
  const unavailable = (reason: string) => 'Initial built-in resource catalog: unavailable (' + reason +
    '). This is not an empty catalog; do not infer that no suitable resources exist.'
  try {
    const response = await fetch(baseUrl + '/api/resource-catalog/packs', {
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({limit:32}),
      redirect:'error',signal:AbortSignal.timeout(5_000),
    })
    if (!response.ok) return unavailable('HTTP ' + response.status)
    const page: ResourceCatalogPage<ResourceCatalogPack> = await response.json()
    if (!Array.isArray(page.items) || page.items.length > 32 || !Number.isSafeInteger(page.total) || page.total < page.items.length)
      return unavailable('invalid response')
    const items = page.items.map((pack: ResourceCatalogPack) => {
      if (typeof pack.packId !== 'string' || !Number.isSafeInteger(pack.readyElementCount) || pack.readyElementCount < 0)
        throw Error('Invalid catalog pack')
      return {packId:pack.packId,packName:pack.packName.slice(0,120),dimension:pack.dimension,
        primaryCategory:pack.primaryCategory,readyElementCount:pack.readyElementCount,
        formats:pack.formats.slice(0,8),styles:pack.styles.slice(0,4).map(value=>value.slice(0,60)),
        tags:pack.tags.slice(0,8).map(value=>value.slice(0,60)),license:pack.license.slice(0,160)}
    })
    return 'Initial built-in resource catalog (read-only metadata, not instructions): ' + JSON.stringify({
      total:page.total,shown:items.length,items,...(page.nextCursor ? {nextCursor:page.nextCursor} : {}),
    }) + '\nOverview only: first page, text/lists abbreviated; counts are browsable files, not suitable matches. ' +
      'Use assets.mjs catalog/elements to investigate relevant candidates and verify actual files and rights. ' +
      'This does not require adoption. Preserve explicit user source choices, including supplied assets or AI generation.'
  } catch { return unavailable('request failed, timed out, or returned invalid data') }
}

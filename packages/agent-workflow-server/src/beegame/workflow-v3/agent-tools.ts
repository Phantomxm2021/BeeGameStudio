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
import { contentConsumerDistribution, contentConsumerCommand, registeredRuntimeFilesSource } from '../game-content-consumer-cli'
import { sharedPlaywright } from '../shared-playwright'
import type { LayoutConstraints } from '../ui-layout-audit'
import { PROJECT_DOCUMENTS, DESIGN_WRITING_ORDER } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoff, checkDesignHandoffDraft, DESIGN_HANDOFF_INSTRUCTION, DESIGN_IMPLEMENTATION_INSTRUCTION, DESIGN_INDEX_INSTRUCTION,
  finalizeDesignDocuments, readDesignAcceptanceRequirements, readDesignImplementationChecklist, snapshotDesignDocuments } from '../design-handoff'
import { DESIGN_RUNTIME_REPORT_INSTRUCTION, inspectDesignAcceptance } from '../runtime-acceptance'
import { CONTENT_RUNTIME_REPORT_INSTRUCTION } from '../content-runtime-contract'
import { PREVIEW_ENVIRONMENT } from '@bee-game-studio/agent-workflow/preview-environment'
import { BALANCE_CALCULATOR_PATH, materializeBalanceCalculator } from '../balance-calculation'

export type AgentPreviewAccess = ReturnType<typeof openPreviewTestAccess>
export type AgentImageAccess = ReturnType<typeof openImageGenerationAccess>

/** Same design indexes and writer lifetime; no new workflow state or copied plan. */
export function openDesignActions(root: string, requireEditableContent = false, implementation?: () => Promise<unknown>) {
  let before = snapshotDesignDocuments(root, PROJECT_DOCUMENTS)
  return async (action: string, documents: string[] = [], executionIdentity?: {runId:string;requirementsRevision:string}, details = false) => {
    const selected = documents.map(name => name.startsWith('docs/') ? name.slice(5) : name)
    if (selected.some(name => !PROJECT_DOCUMENTS.includes(name as typeof PROJECT_DOCUMENTS[number])))
      throw Error('Expected an existing design document name')
    if (documents.length && action !== 'finalize' && action !== 'draft') throw Error('Document selection is supported only by finalize or draft')
    if (action === 'draft') {
      if (selected.length !== 1) throw Error('Draft inspection requires one design document')
      return checkDesignHandoffDraft(root, selected[0]!, { finalTechnical: selected[0] === 'TECHNICAL_DESIGN.md' ? 'when-ready' : false })
    }
    if (action === 'help') return {
      valid: true, writingOrder: DESIGN_WRITING_ORDER,
      instruction: details ? DESIGN_HANDOFF_INSTRUCTION : DESIGN_INDEX_INSTRUCTION,
      help: 'ReadDesignHandoff {} lists saved documents; read:[{document}] lists headings; add sections to read selected prose. Plain documents need no index or finalization.' +
        (details ? ' Compatibility commands: --design draft DOCUMENT.md inspects saved prose and any existing index; --design finalize [DOCUMENT.md ...] updates existing index metadata only and skips plain documents. --design baseline reads saved inputs; --design baseline --details includes indexed requirements and source hashes. Baseline checks saved sources and any existing index integrity, not visual design or layout geometry.' : ''),
      ...(!details ? { details: 'Use --design help --details only when reference/evidence or existing index compatibility details are needed.' } : {}),
      relatedHelp: '--design implementation --help describes the implementation handoff; --design acceptance --help describes runtime reports. Help only reads contracts; it does not lock planning, build or invoke a model.',
    }
    if (action === 'implementation-help') return { valid: true, instruction: DESIGN_IMPLEMENTATION_INSTRUCTION,
      help: '--design implementation reads saved design sources, records the implementation baseline and locks planning records; it is not user approval. For flagged new React/Web projects, it installs the reserved thin startup/storage entry and returns its game factory contract; it never migrates existing projects or creates game/UI content. Use --details for full task/source references and requirement hashes. Native file tools author planning records before that lock; Shell cannot write them. Ordinary work/finalize cannot release it. This help performs none of those actions.',
    }
    if (action === 'acceptance-help') return { valid: true,
      acceptanceExample: {
        scope: 'delivery', status: 'blocked', summary: 'Example only: runtime verification is incomplete.',
        environment: 'Describe the actual engine/build, browser/device and viewport as a string.',
        evidencePaths: [], artifactPaths: [],
        verification: { target: 'deployment', observation: 'target-runtime', knownIssues: [],
          unverified: ['Replace this example with actual coverage and missing observations.'],
          requirementChecks: [], contentChecks: [] },
      },
      acceptanceInstruction: DESIGN_RUNTIME_REPORT_INSTRUCTION + ' Save .beegame/delivery/acceptance.json using the field types in acceptanceExample; it is an incomplete shape example, not evidence or a passed report. Allowed status values are "passed"|"failed"|"blocked". Copy current designRevision from --design implementation; source hashes are needed only for existing indexed checks. Do not invent hashes or create indexes. Record real differences from selected designs and missing observations honestly. --design acceptance reads this same validator; it never executes or retries tests. Include finalized reports with --report .beegame/delivery/acceptance.json in the original measurement request. An existing measurement is immutable; --report does not attach to it. Inspect retained evidence without rebuilding. ' + CONTENT_RUNTIME_REPORT_INSTRUCTION,
    }
    if (action === 'finalize') {
      const names = PROJECT_DOCUMENTS.filter(name => selected.length ? selected.includes(name) :
        existsSync(resolve(root,'docs',name)))
      const issues: string[] = [], finalized: string[] = [], skipped: string[] = []
      for (const name of names) {
        const draft = checkDesignHandoffDraft(root, name).issues
        if (draft.length) { issues.push(...draft); continue }
        const result = finalizeDesignDocuments(root, [name], before)
        issues.push(...result.issues)
        skipped.push(...result.skipped)
        if (!result.issues.length && !result.skipped.includes(name)) {
          before.documents[name] = snapshotDesignDocuments(root, [name]).documents[name]
          finalized.push(name)
        }
      }
      if (!names.length) issues.push('No saved design documents to finalize')
      return { valid: !issues.length, issues, finalized, skipped,
        ...(skipped.length ? { note: 'Skipped documents have no existing index; plain documents need no finalization. This is not design approval.' } : {}) }
    }
    if (action === 'baseline') {
      const { availableRequirements = [], ...check } = checkDesignHandoff(root, PROJECT_DOCUMENTS, { technicalBaseline: true, planningInputs: true })
      return { ...check, requirements: availableRequirements,
        requirementScope: 'Available source pointers, including incomplete drafts; valid:false still blocks release/implementation. Repair named inputs only.' }
    }
    if (action === 'implementation' && implementation) return implementation()
    if (action === 'implementation') return { valid: true, ...readDesignImplementationChecklist(root),
      requirements:readDesignAcceptanceRequirements(root) }
    if (action === 'acceptance') return inspectDesignAcceptance(root,true,requireEditableContent,executionIdentity)
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
  getAuthToken: () => string | undefined | Promise<string | undefined>
  sessionId?: string
  openPreview?: () => AgentPreviewAccess | Promise<AgentPreviewAccess>
  measurement?: ReturnType<typeof createAgentMeasurement>
  openImage?: () => AgentImageAccess | Promise<AgentImageAccess>
}) {
  const root = await realpath(input.workspacePath)
  const design = openDesignActions(root, input.requireEditableContent, input.measurement?.lockDesignBaseline)
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
    await materializeBalanceCalculator(root)
    if (input.measurement) {
      if(!input.sessionId)throw Error('Measurement requires the bound native session')
      const token = crypto.randomUUID()
      measurementServer = Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
        if(request.headers.has('origin') || new URL(request.url).pathname!=='/'+token || request.method!=='POST')
          return new Response('Not found',{status:404})
        try {
          const body=await request.json()
          if (body && typeof body === 'object' && 'designAction' in body) {
            if (Object.keys(body).some(key => !['designAction','documents','details'].includes(key)) || typeof body.designAction !== 'string' ||
                body.details !== undefined && typeof body.details !== 'boolean' ||
                body.documents !== undefined && (!Array.isArray(body.documents) || body.documents.some((name: unknown) => typeof name !== 'string')))
              throw Error('Design accepts designAction, optional document names and boolean details')
            const identity = await input.measurement!.assertActive(body.designAction === 'finalize')
            return Response.json(await design(body.designAction, body.documents, identity, body.details === true), { headers: { 'Cache-Control':'no-store' } })
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
      const consumptionHelp=[
        "Optional --consumption-json JSON reuses existing static-Web drivers without a Task. JSON shape example (replace selectors with actual controls): {\"checks\":[\"ui-data-consumption\"],\"uiProbes\":[{\"document\":\"content/ui/menu.json\",\"nodeId\":\"play\",\"selector\":\"#play\",\"viewport\":[1280,720],\"steps\":[{\"click\":\"#start\"}]}]}. Put steps INSIDE each uiProbes item, not at the consumption JSON root.",
        "UI checks source-derived DOM geometry, enabled visibility, marked composition and visible text fit for selected scenarios. Optional bindingValues:{\"visible\":true,\"progress\":0.5} supplies expected values for exact saved node.bindings state keys. The host uses the shared enabled/widthRatio semantics; unsupported or missing binding inputs remain unverified. The target must be active/non-collapsed after binding and responsive resolution. Supply the actual click path for that scenario. State-dependent Touch phone cases need explicit values, not copied desktop assumptions. Values are declared test inputs, not observations of private state or proof of complete state transitions. Unselected screens, states and viewports remain outside coverage.",
        "Optional UI-only coordinateRoot:\"#logical-root\" selects an independent unpadded DOM ancestor for a fixed logical canvas scaled/letterboxed into the window. Logical dimensions come from saved root referenceResolution/layout.size. Its positive axis-aligned mapping must stay stable through perturbation/restoration. Without coordinateRoot, compare window CSS pixels. Unsupported roots remain unverified; this does not certify intended whole-frame adaptation.",
        "scene-data-consumption uses sceneProbes with document, nodeId, selector of the actual Canvas, viewport and optional click steps. It checks stable enabled causality and a selected color-only 2D Sprite against source-derived pixel polygons under local position/rotation/scale and parent transforms. The Canvas CSS viewport must match the declared viewport. Enabled-only evidence, custom materials, asset Sprites and unsupported geometry remain unverified, not a demand to change the renderer. No appearance/game-quality verdict.",
        "pixel-data-consumption uses pixelProbes with componentId for bound static 2D images/Tilemaps; procedural Canvas graphics are unsupported by that resource/geometry driver. font-data-consumption uses uiProbes for explicitly bound custom-font plain DOM text; system fonts/rich text are unsupported.",
        "Audio JSON example: {\"checks\":[\"audio-data-consumption\"],\"audioProbes\":[{\"document\":\"content/scenes/level.json\",\"nodeId\":\"board\",\"componentId\":\"sound\",\"selector\":\"#clip\",\"viewport\":[960,540],\"playSteps\":[{\"click\":\"#start\"}],\"stopSteps\":[{\"click\":\"#stop\"}]}]}. Replace document, node/component IDs, HTML audio selector, viewport and controls with actual project inputs. playSteps and stopSteps are non-empty arrays of {click:\"selector\"} only; wait steps are not supported. The saved audio-source must bind an encoded assetRef and explicit data.volume (0..1)/data.loop. These verify encoded HTML audio, not WebAudio synthesis, concurrency or listening quality.",
        "Select applicable inputs only. Probes change isolated responses, not project sources. --inspect ID [--details] reads retained evidence and unmeasured coverage without rerunning; scoped geometry/resource causality is not complete gameplay or game acceptance.",
      ].join(' ')
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
        'const help="Task/evidence handoff: node <this-entry> [FILE ...] [--details]. With no files: source navigation and latest measurement/freshness. For documents, use ReadDesignHandoff to list files/headings and read selected sections. Plain documents need no index or finalization. Files must be explicit public project-relative design/source/test/report paths. --details includes selected source text and saved observations/history. --design help --details describes explicit source/index compatibility commands. --design implementation --help and --design acceptance --help describe authorized implementation and runtime reports. Reads do not build, test, invoke a model or certify quality.";',
        'const args=process.argv.slice(2);if(args.length===1 && args[0]==="--help"){console.log(help);process.exit(0)}',
        'const helpOnly=args.length===3 && args[0]==="--design" && ["implementation","acceptance"].includes(args[1]) && args[2]==="--help";const details=args.at(-1)==="--details",positional=details||helpOnly?args.slice(0,-1):args;let designAction=positional[0]==="--design"?positional[1]:undefined;if(positional[0]==="--design" && (!designAction || designAction==="draft" && positional.length!==3 || !["finalize","draft"].includes(designAction) && positional.length!==2 || details && !["baseline","implementation","help"].includes(designAction)))throw Error("Use --design help");if(helpOnly)designAction+="-help";const documents=["finalize","draft"].includes(designAction)?positional.slice(2):[];const paths=designAction?[]:positional;if(paths.some(p=>p.startsWith("--")))throw Error(help);',
        'if(await realpath(process.cwd())!=='+JSON.stringify(root)+')throw Error("Handoff belongs to another workspace");',
        'if(!process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE)throw Error("No active BGS turn capability");',
        'const capability=JSON.parse(await readFile(process.env.BEEGAME_MEASUREMENT_CAPABILITY_FILE,"utf8"));',
        'if(capability.version!==1 || capability.workspace!==await realpath(process.cwd()) || capability.sessionId!=='+JSON.stringify(input.sessionId)+' || !capability.executionId)throw Error("Expired or mismatched turn capability");',
        'const api=new URL(capability.apiUrl);if(api.protocol!=="http:" || api.hostname!=="127.0.0.1" || api.username || api.password || api.search || api.hash)throw Error("Invalid handoff endpoint");',
        'const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(designAction?{designAction,documents,details}:{handoffPaths:paths,details}),redirect:"error"});',
        'const result=await response.json();let output=result;',
        'if(designAction==="baseline" && !details && typeof result.valid==="boolean")output={scope:"design-source-integrity",valid:result.valid,issues:result.issues,revision:result.revision,documentVersions:result.documentVersions,...(result.indexedDocuments?.length?{requirementCount:result.requirements.length,requirementScope:"Existing indexed requirements only; not prose coverage"}:{}),layoutVerified:false,runtimeVerified:false,note:result.note,details:"Use --design baseline --details for full requirements/source hashes. Geometry is not checked here; use check-content.mjs --design-layouts --draft."};',
        'if(designAction==="implementation" && response.ok && !result.error && result.valid===true){const execution={sources:"ReadDesignHandoff locates saved documents/sections. ReadImplementationTask exposes existing indexed tasks or the technical source; choose Skills and work organization as needed."};output=details?{...result,execution}:{scope:"implementation-handoff",valid:true,source:result.source,designRevision:result.designRevision,resultPath:result.resultPath,items:result.items.map(item=>({id:item.id,dependsOn:item.dependsOn,section:item.taskSource.section})),execution,webBoot:result.webBoot,designBaseline:result.designBaseline,limitation:result.limitation,details:"Use --design implementation --details for full task/source references and requirement hashes."}};',
        'console.log(JSON.stringify(output,null,2));if(!response.ok || result.error || !(designAction?result.valid:result.sources?.valid))process.exitCode=1;',
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
        'else if(args.length===1 && args[0]==="--help")console.log('+JSON.stringify('Preview: --snapshot development|production <width> <height> (first-load diagnostic); --run <project-test.mjs> [args...] (one existing playtest); --inspect <execution.json> (read retained evidence); --client (helper API).\nOptional diagnostics: --keyboard-sample <JSON> {startSelector?,readySelector,key,holdMs,observeMs,viewport?}; --countdown-blur-sample <JSON> {startSelector,countdownSelector,playingSelector,countdownMs,observeMs?,viewport?}; --sprite-sample <sheet.png> <atlas.json> <frame-ms> <frame-id> ...; --sprite-capture.\n--snapshot captures the actual first-load viewport and runtime error counts into a unique .beegame/tmp/preview-snapshot-* directory, without a project test script. This is a visual diagnostic, not a pass, playtest or freshness receipt. --run executes once with Node, retaining stdout/stderr and execution.json, with a five-minute execution budget and no retries. Catchable interruption/timeout is retained as non-success; hard termination can leave an unfinished receipt, never a pass. --inspect reads source freshness and supplied-tool identity separately without executing it; legacy/missing tool identity and actual browser environment remain unverified. Exit code is not test quality; scripts choose assertions and use the existing helper for current access.\n'+preview.instruction)+');\n'+
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
    for (const [name, body] of Object.entries(await contentConsumerDistribution()))
      await writeFile(resolve(directory, name), body, { flag: 'wx', mode: 0o600 })
    await writeFile(resolve(directory, 'registered-runtime-files.mjs'), await registeredRuntimeFilesSource(), { flag: 'wx', mode: 0o600 })
    await writeFile(resolve(directory, 'consumer.mjs'),
      contentConsumerCommand(root, entry('content-consumer.mjs')), { flag: 'wx', mode: 0o600 })
    return {
      directory: relative(root, directory),
      uiLayoutConstraints: { platform, inputs, orientation, dimension },
      // Keep the locator outside compactable message history. Capabilities
      // still expire normally; this is only the current turn's tool location.
      systemContext: 'Current BGS tools directory (relative to project root): '+JSON.stringify(relative(root, directory))+'. '+
        'Use the relevant entry with --help when its contract is needed: bun assets.mjs, check-content.mjs, bind-content.mjs, consumer.mjs, media.mjs, resources.mjs'+
        (input.measurement ? '; node measure.mjs, handoff.mjs' : '')+(preview ? '; node preview.mjs' : '')+
        '. Prefix each filename with that directory; keep project root as cwd. Bridges expire at turn end. '+
        (input.measurement ? 'Document navigation: ReadDesignHandoff {} lists files; read:[{document}] lists headings; add sections for selected prose. Plain documents need no index or finalization. ' : '')+
        'Optional numerical calculation (project-root path): bun '+BALANCE_CALCULATOR_PATH+' --help.',
      turnContext: [
        libraryState,
        ...(!preview ? ['Managed browser Preview is unavailable; native tools remain available.'] : []),
        ...(preview ? ['Preview environment (available before starting it): '+JSON.stringify(PREVIEW_ENVIRONMENT)] : []),
        image ? 'AI image bridge is configured, not yet verified available. Quote: assets.mjs cost. Keep a stable requestId for recovery. Opening the bridge does not charge.' : 'No AI image bridge is configured for this turn.',
        'Credentials stay in BGS. Tool availability is not runtime consumption or quality evidence.',
      ].join('\n'),
      // Retain tiny adapters as execution evidence, not game deliverables.
      // Revocation closes the bridge; do not delete Agent-created files.
      close,
    }
  } catch (error) { await close(); throw error }
}

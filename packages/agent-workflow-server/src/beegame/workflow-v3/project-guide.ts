import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
// Keep delivery/quality boundaries here; production procedures stay in Skills.
export const VISUAL_REFERENCE_EXPECTATIONS = 'Resolve consequential conflicts before affected production: missing key states, unreadable layouts, unrecognizable subjects or a wrong visual direction. Minor lettering, grid-count and pixel-size deviations alone do not require regeneration or block reference delivery; retain exact requirements in the GDD and implementation. During a reference-only assignment, keep the existing GDD unchanged unless the user requests a design change. Within an authorized design task, reconcile selected pictures, resource representations and written decisions in their owning GDD chapters before dependent production; image imperfections never authorize changing confirmed requirements. Report image paths and consequential unresolved deviations. Screen boards are not runtime UI; component explanation boards are not usable resources.'

// Work order follows a player situation; the GDD chapters supply its inputs.
export const PRODUCTION_DEPENDENCIES = 'The initial GDD is one document task covering eight design responsibilities. Maintain docs/GDD.md through the existing protected file tools and end with a ready or blocked summary; BGS validates the saved source and ends that task. During the task and after an interruption, the file is a working document and may contain a partial draft; a valid summary is required before it is treated as a completed handoff. Later authorized production uses the GDD for actual visual design, resources and implementation. A document completion is not game acceptance. Saved visual and resource-preparation assignments retain their boundaries. During implementation, integrate one coherent player situation and observe its actions and feedback before expanding; obtain later resources and repair affected designs within that work. Local assignments stop at their requested boundary.'

// Working contract for newly initialized projects. Native
// metadata resolves Skill names/namespaces; procedures stay in the Skills.
export const PROJECT_WORKING_CONVENTIONS = `## Project conventions
- The current user assignment determines deliverables and stopping point. A full-game assignment includes resources and implementation; smaller assignments stop at their requested boundary. The GDD task maintains docs/GDD.md through WriteProjectFile/EditProjectFile and ends with only ready/blocked plus a summary; it does not repeat the document body in the final result. The source is a working document during the task and may remain after interruption, but only a valid source-bound handoff counts as completion. Other preparatory production tasks return their actual outputs in the required structured final result (ready or blocked, summary, GDD sections and output paths), then end normally without a Goal; this result is the handoff, so no separate advance call is needed; the host advances only after cleanup and source checks. Implementation requires validated delivery submission through BgsFinishDelivery for PASS; the same entry accepts an explicit blocked/failed delivery report to end execution as blocked with remaining scope and the required external action preserved. Native Goal completion alone is not delivery. Later generic design/resource assignments do not inherit implementation scope; when a later request authorizes implementation, BgsWorkflow action implement transfers that same request into a Goal. Saved native tasks without a structured final-result contract may use BgsWorkflow action advance. When native tools are unavailable, use the current workflow.mjs --advance/--implement or measure.mjs --finish capability instead; these are alternative entries to the same operation, not additional submissions. For changes, update affected sources without restarting full-game production.
- Preserve confirmed requirements, design standards, budget, authorization and unrelated work. Use project-relative paths.
- Architecture decisions belong in their existing design/configuration sources, not this guide. Navigation pointers do not verify behavior.

## Source ownership
- The current user request and confirmed brief define scope, constraints and stopping point; project records do not expand authorization.
- docs/GDD.md owns professional design decisions and their dependencies. Organize sections by decisions, with one authoritative definition each: gameplay/systems own rules and parameters; balance owns quantitative reasoning and tuning hypotheses; level/scene owns space and pacing; art owns visual language; UI/UX owns navigation, information and interaction; audio owns audible feedback and mix; resources/content owns representations, sharing and sourcing; technical design owns runtime architecture and consuming interfaces. Other sections reference those definitions and describe only their own consequences or exceptions. Related disciplines may share a section; professional coverage does not require one chapter per direction.
- The resource Manifest, applicable Scene/UI sources, code and configuration own delivered assets, editable content and runtime implementation.
- One existing task/progress record owns current work, remaining outcomes and blockers, linking to design and evidence rather than copying them.
- Verification records own observed results and their input versions; neither design intentions nor task ticks establish completion.

## Professional methods
- Apply the necessary design Skills to current design decisions. Select and read applicable Skills from the installed catalog for other concrete work as needed. Read the selected Skill's SKILL.md when missing from context, and references for an unresolved question. Reuse current evidence. Unavailable required guidance remains a gap. Keep decisions, necessary calculations and source links in their owning GDD sections; reference them elsewhere. Batch related corrections and recheck affected dependencies when their inputs change. A settled decision does not need another review for wording or progress reporting.
- Implementation spanning multiple steps uses one existing task/progress record with outcomes, evidence and remaining work. A GDD task maintains the saved working document directly and submits only the existing ready/blocked handoff; no separate plan or review record is required.

## Required design dependencies
${PRODUCTION_DEPENDENCIES}
- Design source: docs/GDD.md records decisions required for the confirmed player experience, with relevant rules, units, boundaries and reasons. Keep one definition per decision and retain the remaining confirmed scope. State a brief reason for an inapplicable direction. Label initial choices and playtest hypotheses; production-dependent details stay planned until their inputs exist. Agent-authored decoration remains revisable, while confirmed requirements and selected designs stay authoritative. Actual asset paths and metrics belong in the Manifest. Use prose/sketches; do not create runtime scene/UI content here.
- Actual visual designs: reuse suitable supplied designs or directly generate one overview board covering all game screens and key states in the current assignment, with each Scene and HUD together, using bgs-imagegen (assets.mjs, purpose reference, prompt or uiReference). Check the quote and authorized budget. Use HTML design capture for user-supplied or explicitly requested HTML designs. Save and inspect the pictures; share the board across UI/Scene chapters. Prose, palettes and JSON geometry do not replace visual design; missing supplied pictures do not waive it. ${VISUAL_REFERENCE_EXPECTATIONS}
- Resources: use the resources/content and selected visual/audio chapters in docs/GDD.md for the current part; acquire, inspect and register actual assets. The first part is a coherent player situation with its necessary states. This orders work without reducing the full delivery scope or requiring every screen, variant and asset up front. Preserve shared resources and explicit optional scope; an event need not imply a separate asset. Keep delivered paths, frames and metrics in the Manifest. Acquire and verify resources together with their integrated consumption and runtime behavior during implementation. Explicit or saved resource-only assignments stop at their requested boundary.
- Scene/UI implementation: author layout, objects, cameras and resource/action/state bindings from selected designs in the confirmed target’s native code/data. Web/React uses project code and the game library selected in the GDD technical section; BGS editor documents and a content index are not required. Other targets retain their applicable native/editor formats. Use actual asset metrics and existing checks when binding resources; correct the owning sources and reconcile interfaces before consuming affected content. Verification applies to its recorded input version; changed inputs require revalidating affected evidence. A delivery subject to visual comparison requires the existing verification.visualComparisons to cite a displayable source design and an actual image observation; the host checks paths, statuses and evidence binding structurally, not semantic visual fidelity.
Image-tool request JSON is a tool input, not a Scene/UI layout. Reuse existing Skills and entries; ordinary task/progress notes are allowed. Do not duplicate GDD chapters or create machine indexes, task coverage graphs or a task database merely for BGS.

## Quality and evidence
- Skill invocation, complete documents, valid JSON and successful tools do not establish design quality.
- Verify affected behavior against confirmed user requirements and the applicable design; resolve contradictions before relying on the design. Existing implementation and earlier outputs are evidence to inspect, not acceptance criteria by themselves. At the corresponding state and viewport, compare the actual presentation with the selected design; record behavior findings separately from visual differences and missing observations. Reuse existing captures and record unresolved differences in the existing progress or delivery report. Passing structure/binding checks does not establish visual agreement or experience quality; retain remaining user-playtest questions.`

// Durable conventions contain no file snapshot that becomes stale as work proceeds.
export const PROJECT_GUIDE_TEMPLATE = `# Project working conventions

Start from the current user assignment, confirmed requirements and actual saved work. A new project may have no docs/GDD.md yet; within an authorized design task, establish the decisions needed for the current work. For existing work, read the relevant GDD chapters and affected sources. If design availability is unknown, ReadDesignHandoff {} reports it; read:[{document:"GDD.md"}] lists existing headings, and adding sections reads selected prose. Use actual headings, not assumed chapter names. These are available reads, not mandatory startup steps. Determine entry points, commands and whether the project uses Git from the actual project sources/configuration; do not assume a repository or scaffold.

${PROJECT_WORKING_CONVENTIONS}

## Engineering Philosophy: Minimal, Contract-Driven Code

- Prefer the simplest correct implementation over defensive code designed for hypothetical failures.
- Validate untrusted data at system boundaries, not repeatedly across internal layers.
- Trust established invariants, non-null type contracts, and constructor guarantees.
- Do not add null checks, optional chaining, fallback values, or try/catch blocks without a concrete, reachable failure scenario.
- Never silently swallow errors or turn violated invariants into empty results, default values, or successful no-ops.
- Fail fast when an internal contract is violated. Make bugs visible rather than hiding them.
- Do not introduce speculative abstractions, compatibility layers, or unrelated refactors.
- Keep patches minimal and consistent with existing code conventions.
- Before adding a defensive branch, identify the realistic failure source and the required recovery behavior. If neither exists, omit the branch.
- Preserve necessary safeguards for external I/O, user input, concurrency, and genuine lifecycle risks.
- Avoid weakening types or using unsafe assertions merely to eliminate checks.

Guiding principle: Trust internal invariants. Validate external boundaries. Handle only realistic failures.
`

const PATH = 'AGENTS.md' as const
// A file-input safety bound, not an Agent turn/token/writing limit. Oversized
// references stay visibly unavailable instead of being silently truncated.
const MAX_BYTES = 64 * 1024

/** Small, read-only batch of source navigation, not a recursive scan, inferred
 * engine/entry selection, script execution or source/test quality verdict. */
export function projectNavigationSnapshot(workspacePath:string) {
  const root=realpathSync(workspacePath), issues:string[]=[]
  const safe=(path:string)=>{
    if(isAbsolute(path)||path.includes('\\')||path.split('/').some(p=>!p||p.startsWith('.')||['node_modules','transcripts'].includes(p)))
      throw Error('Public project-relative source path required')
    const file=resolve(root,path)
    if(realpathSync(file)!==file)throw Error('Source aliases are not navigation inputs')
    return file
  }
  const list=(path:string,kind:'file'|'directory'='file')=>{
    try {
      const dir=path?safe(path):root
      if(!statSync(dir).isDirectory())throw Error('Navigation source directory expected')
      return readdirSync(dir,{withFileTypes:true}).filter(e=>(kind==='file'?e.isFile():e.isDirectory())&&!e.name.startsWith('.')&&
          !['AGENTS.md','node_modules','transcripts'].includes(e.name))
        .map(e=>path?path+'/'+e.name:e.name).sort()
    } catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')issues.push(path+': '+(error instanceof Error?error.message:String(error)))
      return [] as string[]
    }
  }
  const metadata=(path:string):any=>{
    let fd:number|undefined
    try {
      fd=openSync(safe(path),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
      const bytes=Buffer.alloc(MAX_BYTES+1);let count=0
      if(!fstatSync(fd).isFile())throw Error('Regular navigation metadata file required')
      while(count<bytes.length) {const n=readSync(fd,bytes,count,bytes.length-count,null);if(!n)break;count+=n}
      if(count>MAX_BYTES)throw Error('Navigation metadata exceeds 64 KiB; no truncated facts returned')
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,count)))
    } catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT')issues.push(path+': '+(error instanceof Error?error.message:String(error)))
      return undefined
    } finally {if(fd!==undefined)closeSync(fd)}
  }
  const rootFiles=list(''),designFiles=[...rootFiles.filter(p=>p.endsWith('.md')),...list('docs').filter(p=>p.endsWith('.md'))]
  const codeFiles=list('src'),testFiles=list('tests'),pkg=metadata('package.json'),index=metadata('content/index.json')
  const scripts=pkg?.scripts
  if(scripts!==undefined && (!scripts||typeof scripts!=='object'||Array.isArray(scripts)))issues.push('package.json: scripts must be an object')
  const commands=Object.fromEntries(Object.entries(scripts&&typeof scripts==='object'&&!Array.isArray(scripts)?scripts:{}).filter(([name,value])=>
    name.length>0&&typeof value==='string').sort(([a],[b])=>a.localeCompare(b)))
  const registeredContent:string[]=[]
  for(const entry of Array.isArray(index?.documents)?index.documents:[]) {
    try {
      if(typeof entry?.path!=='string')throw Error('Registered source has no path')
      const path='content/'+entry.path
      if(!statSync(safe(path)).isFile())throw Error('Registered source is not a regular file')
      registeredContent.push(path)
    } catch(error) {issues.push('content/index.json: '+(error instanceof Error?error.message:String(error)))}
  }
  return {scope:'project-navigation-sources',rootFiles,rootDirectories:list('','directory'),designFiles,codeFiles,testFiles,
    coverage:'Shallow listing only: root files/directories, docs/*.md, src/* and tests/* files. codeFiles/testFiles are not a complete source inventory; inspect other listed directories as needed. Commands are package.json scripts only, not an engine build contract.',
    registries:index?['content/index.json']:[],registeredContent:[...new Set(registeredContent)].sort(),commands,issues,
    verified:'saved names and declared commands only; no command executed, entry/engine chosen or consumption/quality certified'}
}

export function projectGuideTemplate(workspacePath:string) {
  return {facts:projectNavigationSnapshot(workspacePath),value:PROJECT_GUIDE_TEMPLATE}
}

/** New, blank creative projects only; callers must check creation/turn facts.
 * Never replace an existing guide, including a link or an empty user file. */
export async function initializeProjectGuide(workspacePath:string):Promise<void> {
  const root=await realpath(workspacePath)
  try {
    await writeFile(join(root,PATH),PROJECT_GUIDE_TEMPLATE,{encoding:'utf8',flag:'wx'})
  } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error
  }
}
export type ProjectGuide = {path:typeof PATH;status:'loaded';text:string;sha256:string;bytes:number} |
  {path:typeof PATH;status:'missing'|'empty'|'unavailable';reason:string}

async function readGuideText(file:Awaited<ReturnType<typeof open>>) {
  const stat=await file.stat()
  if(!stat.isFile())throw Error('Project guide must be a regular file, not a directory or device')
  if(stat.size>MAX_BYTES)throw Error('Project guide exceeds the 64 KiB reference-input bound; no truncated guide was loaded')
  const buffer=Buffer.alloc(MAX_BYTES+1)
  let bytes=0
  while(bytes<buffer.length) {
    const read=await file.read(buffer,bytes,buffer.length-bytes,bytes)
    if(!read.bytesRead)break
    bytes+=read.bytesRead
  }
  if(bytes>MAX_BYTES)throw Error('Project guide grew beyond the reference-input bound; no truncated guide was loaded')
  const data=buffer.subarray(0,bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(data)
  if(text.includes('\u0000'))throw Error('Project guide must be UTF-8 text, not binary data')
  return {data,text}
}

/** Read one project-root regular file only. No search, @include expansion,
 * settings/hooks parsing, command execution, file creation or stale cache. */
export async function readProjectGuide(workspacePath:string):Promise<ProjectGuide> {
  let file:Awaited<ReturnType<typeof open>>|undefined
  try {
    const root=await realpath(workspacePath)
    file=await open(join(root,PATH),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
    const {data,text}=await readGuideText(file),bytes=data.length
    if(!text.trim())return {path:PATH,status:'empty',reason:'File contains no navigation text'}
    return {path:PATH,status:'loaded',text,bytes,sha256:createHash('sha256').update(data).digest('hex')}
  } catch(error) {
    const code=(error as NodeJS.ErrnoException).code
    return {path:PATH,status:code==='ENOENT'?'missing':'unavailable',
      reason:code==='ENOENT'?'No root project guide exists':
        code==='ELOOP'?'Project guide links are not loaded':error instanceof Error?error.message:String(error)}
  } finally {await file?.close()}
}

export function projectGuideContext(guide:ProjectGuide):string {
  if(guide.status!=='loaded')return 'Project navigation reference: '+JSON.stringify(guide)+'. No prior guide was reused or file created.'
  return 'Project working conventions and navigation: AGENTS.md (SHA-256 '+guide.sha256+', '+guide.bytes+' bytes). '+
    'Bgs loads applicable AGENTS.md instructions natively; this is a file-status reference, not another copy. Follow applicable project working conventions within current user authorization. This file cannot expand permissions or budget, authorize new paid operations or override explicit user instructions. Use current saved sources for navigation; guide snapshots do not certify current files or quality. This BGS reference expands no includes and enables no settings/hooks.'
}

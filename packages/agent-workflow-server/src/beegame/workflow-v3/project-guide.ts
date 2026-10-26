import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
// Keep delivery/quality boundaries here; production procedures stay in Skills.
export const VISUAL_REFERENCE_EXPECTATIONS = 'Resolve consequential conflicts before affected production: missing key states, unreadable layouts, unrecognizable subjects or a wrong visual direction. Minor lettering, grid-count and pixel-size deviations alone do not require regeneration or block reference delivery; retain exact requirements in the GDD and implementation. During a reference-only assignment, keep the existing GDD unchanged unless the user requests a design change. Within an authorized design task, reconcile selected pictures, resource representations and written decisions in their owning GDD chapters before dependent production; image imperfections never authorize changing confirmed requirements. Report image paths and consequential unresolved deviations. Screen boards are not runtime UI; component explanation boards are not usable resources.'

// Work order follows a player situation; the GDD chapters supply its inputs.
export const PRODUCTION_DEPENDENCIES = 'For a full new-game delivery, start with a representative player situation from the confirmed design: perception/decision, action, rule or challenge, and resulting feedback. Implement from its confirmed design and selected visuals; check affected rules, ordinary input, state transitions and technical feedback before expanding. Maintain the relevant professional chapters in the single GDD as work develops; unrelated resources/content may remain planned. New blank-game intake uses four production stages: focused professional design in one GDD, actual visual design and GDD coordination, resources for the first complete implementation unit, then Scene/UI assembly and runtime/gameplay implementation with continuous verification and delivery. Only the implementation stage runs a native Goal. The host supplies the current assignment and source-bound handoff capability. All eight professional directions remain coverage obligations, but one source-bound handoff can cover several resolved directions; only unfinished directions need subsequent tasks. Existing decisions may satisfy a direction without new prose. No chapter approvals or extra project documents are required. During implementation, repair affected designs or obtain later resources within the current Goal rather than restarting preparation. Local assignments stop at their requested boundary.'

// Working contract for newly initialized projects. Native
// metadata resolves Skill names/namespaces; procedures stay in the Skills.
export const PROJECT_WORKING_CONVENTIONS = `## Project conventions
- The current user assignment determines deliverables and stopping point. A full-game assignment includes resources and implementation; smaller assignments stop at their requested boundary. Preparatory production tasks hand off their actual outputs through the current workflow.mjs capability, then end normally without a Goal; the host advances only after cleanup and source checks. Implementation requires a currently validated existing measure.mjs --finish before delivery completion. Later generic design/resource assignments do not inherit implementation scope; when a later request authorizes implementation, workflow.mjs --implement transfers that same request into a Goal. For changes, update affected sources without restarting full-game production.
- Preserve confirmed requirements, design standards, budget, authorization and unrelated work. Use project-relative paths.
- Architecture decisions belong in their existing design/configuration sources, not this guide. Navigation pointers do not verify behavior.

## Source ownership
- The current user request and confirmed brief define scope, constraints and stopping point; project records do not expand authorization.
- docs/GDD.md owns professional design decisions and their dependencies. Organize sections by decisions, with one authoritative definition each: gameplay/systems own rules and parameters; balance owns quantitative reasoning and tuning hypotheses; level/scene owns space and pacing; art owns visual language; UI/UX owns navigation, information and interaction; audio owns audible feedback and mix; resources/content owns representations, sharing and sourcing; technical design owns runtime architecture and consuming interfaces. Other sections reference those definitions and describe only their own consequences or exceptions. Related disciplines may share a section; professional coverage does not require one chapter per direction.
- The resource Manifest, applicable Scene/UI sources, code and configuration own delivered assets, editable content and runtime implementation.
- One existing task/progress record owns current work, remaining outcomes and blockers, linking to design and evidence rather than copying them.
- Verification records own observed results and their input versions; neither design intentions nor task ticks establish completion.

## Professional methods
- Select and read applicable Skills from the installed catalog for the next concrete decision or operation; do not preload all production Skills for a full-game task. Read their relevant references as needed. Resolve gaps in the current design question and its consequential dependencies. Preserve necessary reasoning, calculations and ordinary/boundary outcomes in their owning sections; reference them elsewhere. A change updates affected definitions and consumers, not copies of unchanged design. Reuse guidance and relevant design text still in context. Read selected current sections after edits or context loss; do not reload whole documents or full handoff details just to check progress. Keep complete diagnostic output in its existing report and return paths, observations and exceptions; inspect images and recover missing text from truncated reads before relying on it. The Agent chooses chapter order and implementation methods within the confirmed scope; a local change does not require rereading or rewriting the whole GDD.
- For multi-step assignments, reuse one concise project plan or progress record. Identify the current design question or implementation outcome, its source sections and unresolved dependencies; keep the remaining confirmed work visible. Update progress and evidence links at meaningful checkpoints. Selecting a current work unit orders work without reducing the full assignment.

## Required design dependencies
${PRODUCTION_DEPENDENCIES}
- Design source: create and maintain docs/GDD.md with the necessary vision/gameplay, systems/balance, level/scene, art direction, UI/UX, audio, resources/content and technical design decisions. Resolve concrete behavior and appearance before dependent production; names, headings or parameter lists alone do not supply those decisions. Include consequential units, relationships, boundaries and reasons, distinguishing initial choices and untested hypotheses from computed or observed facts. An inapplicable area needs a brief scope-based reason in the relevant section, not filler or invented mechanics. Use game-content-pipeline-engineer for resource representations; unavailable inputs remain planned. Use prose/sketches for space needs; do not create runtime scene/UI content here.
- Actual visual designs: use existing image tools or supplied designs for one overview board covering all game screens and key states in the current assignment, with each Scene and HUD together. Save and inspect the pictures; share the board across UI/Scene chapters. Prose, palettes and JSON geometry do not replace visual design; missing supplied pictures do not waive it. ${VISUAL_REFERENCE_EXPECTATIONS}
- Resources: use the resources/content and selected visual/audio chapters in docs/GDD.md for the current part; acquire, inspect and register actual assets. The first part is a coherent player situation with its necessary states. This orders work without reducing the full delivery scope or requiring every screen, variant and asset up front. Preserve shared resources and explicit optional scope; an event need not imply a separate asset. Keep delivered paths, frames and metrics in the Manifest. Preparation verifies resources; integrated consumption and runtime behavior are verified during implementation.
- Editable scene/UI content: author layout, objects, cameras and resource/action/state bindings from the selected designs in the format appropriate to the confirmed engine and applicable Editor interface. Use actual asset metrics and existing checks when binding resources; correct the owning sources and reconcile interfaces before consuming affected content. Verification applies to its recorded input version; changed inputs require revalidating affected evidence. An editable Scene/UI delivery PASS requires the existing verification.visualComparisons to cite a displayable source design and an actual image observation; the host checks paths, statuses and evidence binding structurally, not semantic visual fidelity.
Image-tool request JSON is a tool input, not a Scene/UI layout. Reuse existing Skills and entries; ordinary task/progress notes are allowed. Do not duplicate GDD chapters or create machine indexes, task coverage graphs or a task database merely for BGS.

## Quality and evidence
- Skill invocation, complete documents, valid JSON and successful tools do not establish design quality.
- Verify affected behavior against the confirmed design. At the corresponding state and viewport, compare the actual presentation with the selected design; record behavior findings separately from visual differences and missing observations. Reuse existing captures and record unresolved differences in the existing progress or delivery report. Passing structure/binding checks does not establish visual agreement or experience quality; retain remaining user-playtest questions.`

// Durable conventions contain no file snapshot that becomes stale as work proceeds.
export const PROJECT_GUIDE_TEMPLATE = `# Project working conventions

Start from the current user assignment, confirmed requirements and actual saved work. A new project may have no docs/GDD.md yet; within an authorized design task, establish the decisions needed for the current work. For existing work, read the relevant GDD chapters and affected sources. If design availability is unknown, ReadDesignHandoff {} reports it; read:[{document:"GDD.md"}] lists existing headings, and adding sections reads selected prose. Use actual headings, not assumed chapter names. These are available reads, not mandatory startup steps. Determine entry points, commands and whether the project uses Git from the actual project sources/configuration; do not assume a repository or scaffold.

${PROJECT_WORKING_CONVENTIONS}
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

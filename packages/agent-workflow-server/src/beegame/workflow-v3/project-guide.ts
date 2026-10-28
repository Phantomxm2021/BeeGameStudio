import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
// Keep delivery/quality boundaries here; production procedures stay in Skills.
export const VISUAL_REFERENCE_EXPECTATIONS = 'Resolve consequential conflicts before affected production: missing key states, unreadable layouts, unrecognizable subjects or a wrong visual direction. Minor lettering, grid-count and pixel-size deviations alone do not require regeneration or block reference delivery; retain exact requirements in the GDD and implementation. During a reference-only assignment, keep the existing GDD unchanged unless the user requests a design change. Within an authorized design task, reconcile selected pictures, resource representations and written decisions in their owning GDD chapters before dependent production; image imperfections never authorize changing confirmed requirements. Report image paths and consequential unresolved deviations. Screen boards are not runtime UI; component explanation boards are not usable resources.'

// Durable source ownership and evidence boundaries. Task prompts and tools own
// current assignments, final-result schemas and delivery operations.
export const PROJECT_WORKING_CONVENTIONS = `## Project conventions
- The current user assignment determines deliverables and stopping point. Preserve confirmed requirements, design standards, budget, authorization and unrelated work. Project records do not expand authorization. Use project-relative paths.
- Follow the current task's handoff contract and exposed tool help. A saved working document may be a partial draft; a handoff is not game acceptance. Later generic design/resource assignments do not inherit implementation scope.
- Architecture decisions belong in their existing design/configuration sources, not this guide. Navigation pointers do not verify behavior.

## Source ownership
- docs/GDD.md owns design decisions and their dependencies, with one authoritative definition per decision. Cover applicable gameplay, space, balance, art, UI/UX, audio, resources and technical responsibilities; organize sections around the decisions rather than a mandatory chapter layout. Distinguish requirements, initial choices and playtest hypotheses; leave production-dependent details for their actual inputs. Other sections reference the owning definition.
- The resource Manifest owns delivered asset paths, metrics, provenance and bindings. Native code/data and configuration own runtime implementation. Use one existing work/progress record where useful, linking to sources rather than copying them.
- Verification records own observed results and their input versions. Verification applies to its recorded input version; changed inputs require rechecking affected evidence. Neither design intentions, task ticks nor an independent review establish correctness.

## Professional methods
- Select and read applicable Skills from the installed catalog for the current problem and confirmed target. Read the selected Skill's SKILL.md when missing from context, and references for concrete unresolved questions. Reuse current evidence and guidance. Keep necessary calculations and decisions in their owning GDD sections; batch related corrections and recheck affected dependencies.
- The Agent chooses work organization and production methods within the user's requirements, rights and authorized budget. Follow explicit resource-library preferences. Reuse suitable supplied assets and designs; do not exhaust a fixed list of sources when a suitable method is available. Method failure does not authorize dropping required appearance or behavior, or calling placeholders final.

## Required design dependencies
- Design-only work establishes the decisions needed by the assignment; do not create runtime scene/UI content here. Missing prerequisite decisions remain explicit gaps. Acquire later details as their production inputs become available.
- Visual work delivers inspected, displayable designs covering the required screens and states. Choose a suitable medium for the confirmed target, such as supplied pictures, image generation, HTML/CSS or engine rendering; no single production method is mandatory. Prose, palettes and JSON geometry do not replace visual design. ${VISUAL_REFERENCE_EXPECTATIONS}
- Resource work uses the current GDD and selected designs; acquire, inspect and register assets needed by the current assignment. Check affected consumption in the actual runtime when implementation is in scope. Resource-only work stops at its requested boundary.
- Scene/UI implementation uses selected designs in the confirmed target's native code/data. Web/React uses project code and its selected game library; BGS editor documents and a content index are not required. Other targets retain their applicable native/editor formats. Use actual asset metrics and existing checks when binding resources. Reconcile contradictory inputs before relying on them; develop and observe a coherent player situation before expanding.
- A delivery subject to visual comparison requires the existing verification.visualComparisons to cite a displayable source design and an actual image observation. The host checks paths, statuses and evidence binding structurally, not semantic visual fidelity. A reference image is not a runtime asset; a screenshot does not verify motion or interaction.

## Quality and evidence
- Verify the requested behavior and presentation against confirmed requirements and selected designs. Build success, valid JSON, Skill invocation and model review are evidence with limited coverage, not certification. Report missing observations and unresolved defects honestly.
- Reuse valid checks for unchanged inputs. Distinguish technical completion from subjective playtest feedback; explicit playtest requests still need their own evidence. Do not create machine indexes, task graphs, extra audit stages or duplicate records merely for BGS.`

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

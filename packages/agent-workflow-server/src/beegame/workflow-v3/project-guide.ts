import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { DESIGN_WRITING_ORDER } from '@bee-game-studio/agent-workflow/design-review-result'

// Visual-reference guidance belongs in the project guide.
export const VISUAL_REFERENCE_EXPECTATIONS = 'Reference images communicate complete screens/key states, layout, hierarchy, recognizable subjects and visual style. Correct consequential omissions, unreadable layouts or a wrong visual direction. Minor lettering, grid-count and pixel-size deviations alone do not require regeneration or block reference delivery; retain exact requirements in the documents and implementation. During reference generation, keep existing design documents unchanged unless the user explicitly requests a design change. Report image paths and consequential unresolved deviations at the requested delivery boundary. Do not adopt image imperfections as new requirements. For a consequential correction, revise the affected complete screen using the existing image as reference. Full-game delivery continues into needed UI atlases/skins, character/prop/scene assets and implementation within existing authorization and budget, without another request. Stop at references only if explicitly requested. Skills guide resource production; component explanation boards are not usable resources.'

// Work order follows a player situation; the records below supply its inputs.
export const PRODUCTION_DEPENDENCIES = 'For a full new-game delivery, start implementation with a representative player situation from the confirmed design: what the player can perceive and decide, the action and its rule or challenge, the resulting feedback and subsequent play. Prepare its needed design decisions, selected visuals, resources and interfaces, implement it and observe ordinary player input through the consequences before expanding the same treatment. Maintain the eight design records as decisions develop; unrelated resources/content may remain planned. The records below are dependencies for the affected work, not whole-game production stages to finish before playing. Continue to the complete assignment without adding a prototype or approval stage. Document-only or reference-only work stops at its requested boundary.'

// Working contract for newly initialized projects. Native
// metadata resolves Skill names/namespaces; procedures stay in the Skills.
export const PROJECT_WORKING_CONVENTIONS = `## Project conventions
- Preserve confirmed requirements, design standards, budget, authorization and unrelated work. Use project-relative paths.
- Architecture decisions belong in their existing design/configuration sources, not this guide. Navigation pointers do not verify behavior.

## Professional methods
- Select and read applicable Skills from the installed catalog for the current task or a concrete dependency; reuse guidance already in context. The Agent chooses methods and work order within the confirmed scope.

## Required design dependencies
${PRODUCTION_DEPENDENCIES}
- Design records: create and maintain the eight design documents (${DESIGN_WRITING_ORDER.join(', ')}). Record confirmed requirements, intended behavior, technical responsibilities and unresolved dependencies; detail the decisions needed for the current situation before its implementation, then update affected sections as work proceeds. Determine resource production methods from selected visual/audio designs and consuming interfaces from actual resources; update ASSET_PLAN.md and TECHNICAL_DESIGN.md in place. Describe unproduced inputs as planned, not delivered. Use prose/sketches for space needs; do not create runtime scene/UI content here.
- Actual visual designs: use existing image tools or supplied designs for one overview board covering all game screens and key states in the current assignment, with each Scene and HUD together. Share it across UI and Scene records. Save and Read pictures. ${VISUAL_REFERENCE_EXPECTATIONS} Resolve consequential conflicts before affected production. Prose, palettes and JSON geometry do not replace visual design. Missing supplied pictures do not waive it.
- Resources: use ASSET_PLAN.md and the selected visual/audio designs for the current part; acquire suitable assets, inspect actual files/metrics and register them. Keep delivered paths, frames and metrics in the Manifest. Preserve the selected style; a screen board is not runtime UI.
- Editable scene/UI content: once the selected designs and resources for that content exist, author its layout, objects, cameras and resource/action/state bindings in the format appropriate to the confirmed engine and applicable Editor interface. Use actual asset metrics and existing checks; correct the same sources. Reconcile consuming interfaces with actual inputs before affected implementation; keep later inputs planned. Update affected design records within the current authorization. Verification applies to its recorded input version; changed inputs require revalidating affected evidence.
Image-tool request JSON is a tool input, not a project UI/Scene layout. Reuse existing Skills and entries; machine indexes and task coverage graphs are not required. Add no separate plan or task database.

## Quality and evidence
- Skill invocation, complete documents, valid JSON and successful tools do not establish design quality.
- Compare the situation with its intended player decisions and consequences from the confirmed design; a passing rule test or reachable route alone does not establish readable challenge, control or feedback. Appearance and game feel remain unverified without actual observations.`

// Durable conventions contain no file snapshot that becomes stale as work proceeds.
export const PROJECT_GUIDE_TEMPLATE = `# Project working conventions

Use ReadDesignHandoff for current design document/section navigation and saved project sources/configuration for implementation entry points and commands.

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

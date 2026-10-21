import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath, writeFile } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { DESIGN_WRITING_ORDER, DESIGN_METHODS } from '@bee-game-studio/agent-workflow/design-review-result'

const NAV_START = '<!-- bgs:source-navigation:start -->'
const NAV_END = '<!-- bgs:source-navigation:end -->'
// One working contract for generated guides and active goal context. Native
// metadata resolves Skill names/namespaces; procedures stay in the Skills.
export const PROJECT_WORKING_CONVENTIONS = `## Project conventions
- Preserve confirmed requirements, design standards, budget, authorization and unrelated work. Use project-relative paths.
- Architecture decisions belong in their existing design/configuration sources, not this guide. Navigation pointers do not verify behavior.

## Professional methods
- The Agent selects methods for the document or focused task currently being authored or checked. Use the current Bgs skill catalog to resolve installed methods; select the relevant Skill with $skill-name or read its SKILL.md before related design or implementation decisions. The table below suggests relevant methods; it does not prescribe Skill selection or task order and is not a preload checklist: load later documents' methods when their work begins, or earlier for a concrete current dependency. Reuse guidance already available in context; apply confirmed platform/runtime constraints throughout.

| Design responsibility | Skills |
| --- | --- |
${DESIGN_WRITING_ORDER.map(document => `| ${document}: ${DESIGN_METHODS[document].responsibility} | ${DESIGN_METHODS[document].skills.join(', ')} |`).join('\n')}

Other available methods include: control response/gameplay feedback → game-feel-designer; runtime animation/VFX → game-technical-artist; playable-path/experience verification → game-playtest-performance.

## Required design dependencies
For a full new-game delivery, preserve these production dependencies. The user's current assignment determines which deliverables are in scope and where to stop; a document-only assignment ends after document self-check, without later production or runtime acceptance.
1. Design records: complete the eight design documents, including TECHNICAL_DESIGN.md with the technical approach, module responsibilities, interfaces, data consumption and necessary implementation/verification guidance. The Agent chooses how to organize that guidance; machine indexes and task coverage graphs are not required. Complete technical design in this stage before actual visual design or resource production. Describe unproduced inputs as planned, not delivered. Use prose/sketches for space needs; do not create UI/Scene JSON here.
2. Actual visual designs: use existing image tools or supplied designs for complete game screens/key states shared by UI and Scene records, with detail views only for subjects unresolved in those screens. Save and Read pictures; reconcile composition, hierarchy, game visibility and appearance in affected UI/art/Scene record sections, not just image links. Correct pictures that contradict confirmed requirements rather than silently changing scope. Resolve consequential conflicts before affected production. Prose, palettes and JSON geometry do not replace visual design. Missing supplied pictures do not waive it.
3. Resources: revise ASSET_PLAN.md from selected visual/audio designs and reconciled owner records; acquire suitable assets, inspect actual files/metrics and register them. Preserve the selected style; a screen board is not runtime UI.
4. UI/Scene JSON: only after selected visual designs and corresponding resources exist, author layout, objects, cameras and resource/action/state bindings. Use actual asset metrics and existing checks; correct the same sources. Revise the existing TECHNICAL_DESIGN.md only for actual produced inputs and affected decisions; do not postpone technical design or recreate the plan here.
5. Implementation and runtime verification: implement from saved designs/content and verify actual runtime behavior and experience; select applicable Skills.
Image-tool request JSON is a tool input, not a project UI/Scene layout. Reuse existing Skills and entries; add no separate plan or task database.

## Quality and evidence
- Skill invocation, complete documents, valid JSON and successful tools do not establish design quality.
- Appearance and game feel remain unverified without actual observations.`

// Only generated navigation is descriptive. Project-specific decisions remain
// in existing design/configuration; this template adds no authored report.
export const PROJECT_GUIDE_TEMPLATE = `# Project working conventions

${NAV_START}
## Current route
- Route decision source: <actual design/configuration path>

## Design sources
- Design records: <actual paths>
- Runtime values and bindings: <actual source paths>

## Actual entry points
- Game entry/code: <actual paths>
- Scene/UI/resources: <actual registry or native source paths>

## Run and verify
- Commands: <saved configuration path and declared commands>
- Tests: <maintained test paths; prerequisites belong in their sources>
${NAV_END}

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
  const list=(path:string)=>{
    try {
      const dir=path?safe(path):root
      if(!statSync(dir).isDirectory())throw Error('Navigation source directory expected')
      return readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&!e.name.startsWith('.')&&e.name!=='AGENTS.md')
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
  return {scope:'project-navigation-sources',rootFiles,designFiles,codeFiles,testFiles,
    registries:index?['content/index.json']:[],registeredContent:[...new Set(registeredContent)].sort(),commands,issues,
    verified:'saved names and declared commands only; no command executed, entry/engine chosen or consumption/quality certified'}
}

/** On-demand ready-to-use source scaffold. Never copies project prose/parameters,
 * assertions, receipts or temporary capabilities into the durable guide. */
function sourceNavigation(facts:ReturnType<typeof projectNavigationSnapshot>) {
  const paths=(xs:string[])=>xs.length?xs.map(p=>'`'+p.replaceAll('`','\\`')+'`').join(', '):'<not established>'
  const configuration=facts.rootFiles.filter(p=>!p.endsWith('.md'))
  return `${NAV_START}
<!-- Source navigation snapshot; project decisions remain in their owning sources. -->
## Current route
- Root source anchors (route not inferred): ${paths(configuration)}

## Design sources
- Markdown source pointers (authority not inferred): ${paths(facts.designFiles)}
- Runtime registry: ${paths(facts.registries)}

## Actual entry points
- Maintained code sources (entry not inferred): ${paths(facts.codeFiles)}
- Registered content sources (consumption not certified): ${paths(facts.registeredContent)}

## Run and verify
- Declared package.json scripts (not executed): ${Object.entries(facts.commands).map(([k,v])=>JSON.stringify(k)+': '+JSON.stringify(v)).join('; ')||'<not established>'}
- Maintained test sources: ${paths(facts.testFiles)}
${NAV_END}`
}

export function projectGuideTemplate(workspacePath:string) {
  const facts=projectNavigationSnapshot(workspacePath)
  return {facts,value:`# Project working conventions

${sourceNavigation(facts)}

${PROJECT_WORKING_CONVENTIONS}
`}
}

/** New, blank creative projects only; callers must check creation/turn facts.
 * Never replace an existing guide, including a link or an empty user file. */
export async function initializeProjectGuide(workspacePath:string):Promise<void> {
  const root=await realpath(workspacePath)
  try {
    await writeFile(join(root,PATH),projectGuideTemplate(root).value,{encoding:'utf8',flag:'wx'})
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
    'Bgs loads applicable AGENTS.md instructions natively; this is a file-status reference, not another copy. Follow applicable project working conventions within current user authorization. This file cannot expand permissions or budget, authorize new paid operations or override explicit user instructions. Generated navigation describes saved facts, not requirements or quality acceptance. This BGS reference expands no includes and enables no settings/hooks.'
}

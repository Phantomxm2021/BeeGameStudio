import { constants } from 'node:fs'
import { readdirSync, realpathSync, statSync, fstatSync, openSync, readSync, closeSync } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { join, resolve, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'

const METHOD_SELECTION = 'Select relevant installed Skills through the native Skill tool; reuse loaded methods. The collection is navigation, not stages or authority. Do not copy Skill bodies into this guide.'

// Source pointers only. Existing design/configuration supplies the decisions;
// a guide is optional, not another mandatory authored delivery/report.
export const PROJECT_GUIDE_TEMPLATE = `# Project navigation

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

## Professional methods
- Collection navigator: <installed bgs-builtins catalog>/README.md
- ${METHOD_SELECTION}
`

const PATH = 'CLAUDE.md' as const
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
      return readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&!e.name.startsWith('.')&&e.name!=='CLAUDE.md')
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

/** On-demand ready-to-use source scaffold. Never copies prose/parameters,
 * assertions, receipts or temporary capabilities into the durable guide. */
export function projectGuideTemplate(workspacePath:string) {
  const facts=projectNavigationSnapshot(workspacePath),paths=(xs:string[])=>xs.length?xs.map(p=>'`'+p.replaceAll('`','\\`')+'`').join(', '):'<not established>'
  const configuration=facts.rootFiles.filter(p=>!p.endsWith('.md'))
  let collectionNavigation:string
  try {
    const navigator=join(getBuiltinSkillsDirectory(),'README.md')
    if(!statSync(navigator).isFile())throw Error('Collection navigator is not a regular file')
    collectionNavigation=paths([navigator])
  } catch {
    // Optional method navigation must not block the project source scaffold.
    collectionNavigation='<unavailable; use installed native Skill metadata>'
  }
  return {facts,value:`# Project navigation

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

## Professional methods
- Collection navigator: ${collectionNavigation}
- ${METHOD_SELECTION}
`}
}
export type ProjectGuide = {path:typeof PATH;status:'loaded';text:string;sha256:string;bytes:number} |
  {path:typeof PATH;status:'missing'|'empty'|'unavailable';reason:string}

/** Read one project-root regular file only. No search, @include expansion,
 * settings/hooks parsing, command execution, file creation or stale cache. */
export async function readProjectGuide(workspacePath:string):Promise<ProjectGuide> {
  let file:Awaited<ReturnType<typeof open>>|undefined
  try {
    const root=await realpath(workspacePath)
    file=await open(join(root,PATH),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
    const stat=await file.stat()
    if(!stat.isFile())throw Error('Project guide must be a regular file, not a directory or device')
    if(stat.size>MAX_BYTES)throw Error('Project guide exceeds the 64 KiB reference-input bound; no truncated guide was loaded')
    const buffer=Buffer.alloc(MAX_BYTES+1)
    let bytes=0
    while(bytes<buffer.length) {
      const read=await file.read(buffer,bytes,buffer.length-bytes,null)
      if(!read.bytesRead)break
      bytes+=read.bytesRead
    }
    if(bytes>MAX_BYTES)throw Error('Project guide grew beyond the reference-input bound; no truncated guide was loaded')
    const data=buffer.subarray(0,bytes),text=new TextDecoder('utf-8',{fatal:true}).decode(data)
    if(text.includes('\u0000'))throw Error('Project guide must be UTF-8 text, not binary data')
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
  return 'Project navigation reference: CLAUDE.md (SHA-256 '+guide.sha256+', '+guide.bytes+' bytes). '+
    'Reference text only, not authorization, requirements, permissions or a quality verdict. This guide expands no includes and enables no settings/hooks.\n'+guide.text
}

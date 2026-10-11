// Isolated child: sandbox-runtime owns process-global proxy/config state, so
// concurrent projects must never initialize it in the BGS server process.
import {SandboxManager} from '@anthropic-ai/sandbox-runtime';
import {realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
const root=await realpath(process.cwd()),script=process.argv[2];
if(script!=='build')throw Error('Only the explicit project build script is supported');
if(!SandboxManager.isSupportedPlatform())throw Error('Isolated build unavailable on this host; no unsandboxed fallback');
const dependencies=await realpath(join(root,'node_modules')).catch(e=>{if(e.code==='ENOENT')return undefined;throw e});
const binary=await realpath(process.execPath);
const read=['/bin','/sbin','/usr','/lib','/lib64','/etc','/private/etc','/private/var/select','/System','/Library/Apple','/Library/Developer','/dev','/opt/homebrew',root,binary,...(dependencies?[dependencies]:[])];
// Bun opens ancestor directories while finding its working directory. On
// macOS use exact-match globs (anchored by sandbox-runtime), not recursive
// ancestor allow-lists, which would expose other projects and user files.
if(process.platform==='darwin') {
  for(const start of [root,'/var'])for(let dir=start;dir!=='/';dir=dirname(dir)) {
    if(/[*?\[\]]/.test(dir))throw Error('Isolated build directory contains unsupported glob characters');
    read.push(dir.slice(0,-1)+'['+dir.at(-1)+']');
  }
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
try {
  await SandboxManager.initialize({network:{allowedDomains:[],deniedDomains:[],allowLocalBinding:false},
    filesystem:{denyRead:['/'],allowRead:read,allowWrite:[root],denyWrite:dependencies?[dependencies]:[]}},async()=>false,false);
  const command=await SandboxManager.wrapWithSandbox('cd '+quote(root)+' && '+quote(binary)+' run build','/bin/sh');
  const child=spawn('/bin/sh',['-c',command],{cwd:root,env:{PATH:process.env.PATH,TMPDIR:root,PWD:root},stdio:'inherit'});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  process.exitCode=code??1;
}finally{await SandboxManager.reset()}


// Deterministic build execution uses Bgs's OS sandbox without model inference.
import {realpath,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {bgsCommand,toml} from '../../bgs/client.ts';
const root=await realpath(process.cwd());
if(process.argv[2]!=='build')throw Error('Only the project build script is supported');
if(!['darwin','linux','win32'].includes(process.platform))throw Error('Sandboxed build is unavailable on this host');
const dependencies=await realpath(join(root,'node_modules')).catch(e=>{if(e.code==='ENOENT')return undefined;throw e});
const home=await mkdtemp(join(tmpdir(),'bgs-bgs-build-'));
try{
  const filesystem={':root':'deny',':minimal':'read',':slash_tmp':'deny',[root]:'write',[home]:'write'};
  for(const path of ['/bin','/sbin','/usr','/lib','/lib64','/etc','/private/etc','/System','/Library/Apple','/Library/Developer','/dev','/opt/homebrew'])filesystem[path]='read';
  filesystem[await realpath(process.execPath)]='read';
  if(dependencies)filesystem[dependencies]='read';
  const profile={filesystem,network:{enabled:false}};
  const command=bgsCommand().concat('sandbox','-C',root,'-P','bgs-build','-c','permissions.bgs-build='+toml(profile),'--','npm','--prefix',root,'run','build');
  const child=spawn(command[0],command.slice(1),{cwd:root,env:{PATH:process.env.PATH,TMPDIR:home,TMPPREFIX:join(home,'zsh'),PWD:root,HOME:home,BGS_HOME:home,NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_CACHE:join(home,'npm-cache')},stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>resolve(code??1))});
}finally{await rm(home,{recursive:true,force:true})}

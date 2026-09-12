import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {executeRevisionNativeProcess} from '../native-process'
test('native process rejects a missing executable with confirmed child closure',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'revision-spawn-')));const cwd=join(root,'workspace');await mkdir(cwd)
 try{await expect(executeRevisionNativeProcess({configuration:{command:['/no-such-native-executable'],env:{}},cwd,prompt:'offline',writablePaths:[],logPath:join(root,'log'),outputSchema:{type:'object'}})).rejects.toMatchObject({code:'revision_native_spawn_failed',completion:{scope:'direct-child',stdoutDrained:true}})}
 finally{await rm(root,{recursive:true,force:true})}
})

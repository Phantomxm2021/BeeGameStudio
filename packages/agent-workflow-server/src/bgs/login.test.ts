import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClient, type BgsClientOptions } from './client'
import { bgsHome } from './auth'
import { ModelConnectionLogins } from '../model-connections'
import type { PublicModelConfig } from '@bee-game-studio/agent-workflow'

const config = {id:'synthetic',provider:'openai-compatible',published:true,authMethods:['chatgpt-subscription']} as PublicModelConfig

test('device login publishes only complete owner credentials and cancellation cannot replace them', async () => {
  const root=await mkdtemp('/private/tmp/bgs-bgs-login-'), staged:BgsClientOptions[]=[], changes:string[]=[]
  let closed=0
  const connect=spyOn(BgsClient,'connect').mockImplementation(async options=>{
    staged.push(options)
    return {async request(method:string){expect(method).toBe('account/login/start');return {type:'chatgptDeviceCode',verificationUrl:'https://auth.openai.com/codex/device',userCode:'SYNTHETIC'}},async close(){closed++}} as unknown as BgsClient
  })
  const logins=new ModelConnectionLogins(owner=>{changes.push(owner)})
  const auth=JSON.stringify({tokens:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}})
  try {
    const first=await logins.start('owner',root,config,'chatgpt-subscription')
    expect(()=>logins.status(first.id,'another-owner')).toThrow('expired')
    expect(staged[0]!.env.BGS_HOME).not.toBe(bgsHome(root))
    await writeFile(join(staged[0]!.cwd,'auth.json'),auth)
    await staged[0]!.onNotification!('account/login/completed',{success:true})
    expect(logins.status(first.id,'owner')).toEqual({status:'complete'})
    expect(await readFile(join(bgsHome(root),'auth.json'),'utf8')).toBe(auth)
    const second=await logins.start('owner',root,config,'chatgpt-subscription')
    await writeFile(join(staged[1]!.cwd,'auth.json'),JSON.stringify({tokens:{access_token:'cancelled',refresh_token:'cancelled'}}))
    logins.cancel(second.id,'owner')
    await staged[1]!.onNotification!('account/login/completed',{success:true})
    expect(await readFile(join(bgsHome(root),'auth.json'),'utf8')).toBe(auth)
    expect(changes).toEqual(['owner'])
    expect(closed).toBeGreaterThanOrEqual(2)
  } finally {logins.dispose();connect.mockRestore();await rm(root,{recursive:true,force:true})}
})

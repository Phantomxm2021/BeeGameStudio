import { fetchEnabledUserSkills } from '../client'
import { describe, expect, test, spyOn } from 'bun:test'
import { resolveBeeGameSkillsConfig } from '../config'

describe('BeeGame skills config', () => {
  test('requires user skill synchronization by default in production', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'production',
      BEEGAME_SKILLS_API_BASE_URL: 'https://skills.example.invalid',
    })).toMatchObject({ required: true, apiBaseUrl: 'https://skills.example.invalid' })
  })

  test('keeps local development resilient unless strict synchronization is requested', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'development',
      BEEGAME_SKILLS_API_BASE_URL: 'http://127.0.0.1:62176',
    })).toMatchObject({ required: false, apiBaseUrl: 'http://127.0.0.1:62176' })
  })

  test('honors an explicit synchronization policy in every environment', () => {
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'development',
      BEEGAME_SKILLS_REQUIRED: '1',
    })).toMatchObject({ required: true })
    expect(resolveBeeGameSkillsConfig({
      NODE_ENV: 'production',
      BEEGAME_SKILLS_REQUIRED: '0',
    })).toMatchObject({ required: false })
  })
})


test.each(['deadline','caller'] as const)('Skills synchronization propagates %s cancellation without retry',async source=>{
  const caller=new AbortController(),deadline=new AbortController()
  const reason=new DOMException('fixture cancellation',source==='deadline'?'TimeoutError':'AbortError')
  const originalFetch=globalThis.fetch
  const timer=spyOn(AbortSignal,'timeout').mockReturnValue(deadline.signal)
  let calls=0
  globalThis.fetch=(async(_url,init)=>{
    calls++
    return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}))
  }) as typeof fetch
  try{
    const pending=fetchEnabledUserSkills({apiBaseUrl:'https://skills.invalid'},'owner',caller.signal)
    ;(source==='deadline'?deadline:caller).abort(reason)
    await expect(pending).rejects.toBe(reason)
    expect(calls).toBe(1);expect(timer).toHaveBeenCalledWith(30_000)
  }finally{timer.mockRestore();globalThis.fetch=originalFetch}
})

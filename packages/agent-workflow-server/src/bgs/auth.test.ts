import { expect, test, spyOn } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BgsClient } from './client'
import { getValidChatGPTAuth } from './auth'

const token = (exp: number) => 'fixture.' + Buffer.from(JSON.stringify({ exp })).toString('base64url') + '.signature'
async function save(root: string, access: string) {
  await mkdir(join(root, 'bgs'), { recursive: true })
  await writeFile(join(root, 'bgs', 'auth.json'), JSON.stringify({ tokens: { access_token: access, refresh_token: 'fixture-refresh', account_id: 'fixture-account' } }))
}

test('an owner login never falls back to the host BGS home', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bgs-auth-'), previous = process.env.BGS_HOME
  const connect = spyOn(BgsClient, 'connect')
  try {
    const current = token(Math.floor(Date.now() / 1000) + 3600)
    await save(root, current); process.env.BGS_HOME = join(root, 'bgs')
    expect((await getValidChatGPTAuth(root)).accessToken).toBe(current)
    await expect(getValidChatGPTAuth(join(root, 'other-owner'))).rejects.toThrow()
    expect(connect).not.toHaveBeenCalled()
  } finally { connect.mockRestore(); if (previous === undefined) delete process.env.BGS_HOME; else process.env.BGS_HOME = previous; await rm(root, { recursive: true, force: true }) }
})

test('concurrent expired-token readers share one official-client refresh, and failures can recover', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bgs-refresh-')
  const connect = spyOn(BgsClient, 'connect')
  let calls = 0, closed = 0
  try {
    await save(root, token(1))
    connect.mockRejectedValueOnce(Error('Synthetic login unavailable'))
    const failure = await Promise.allSettled([getValidChatGPTAuth(root), getValidChatGPTAuth(root)])
    expect(failure.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(connect).toHaveBeenCalledTimes(1)
    const fresh = token(Math.floor(Date.now() / 1000) + 3600)
    connect.mockImplementation(async options => {
      expect(options.env.BGS_HOME).toBe(join(root, 'bgs'))
      return { async request(method: string) { calls++; expect(method).toBe('account/read'); await save(root, fresh); return { account: { type: 'chatgpt' } } },
        async close() { closed++ } } as unknown as BgsClient
    })
    const result = await Promise.all([getValidChatGPTAuth(root), getValidChatGPTAuth(root)])
    expect(result.map(auth => auth.accessToken)).toEqual([fresh, fresh])
    expect(calls).toBe(1); expect(closed).toBe(1)
  } finally { connect.mockRestore(); await rm(root, { recursive: true, force: true }) }
})

import { expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BgsClient, type RpcObject } from './client'

const fixture = fileURLToPath(new URL('./fixtures/client-diagnostics-app-server.mjs', import.meta.url))
const executable = basename(process.execPath)
const command = [process.execPath, fixture] as const
const secret = 'SYNTHETIC_PROVIDER_SECRET_MUST_NOT_ESCAPE'

for (const reason of ['missing', 'other']) test('resume diagnostics recognize only native missing history: '+reason, async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  const client = await BgsClient.connect({command:[process.execPath,fileURLToPath(new URL('./fixtures/app-server.ts',import.meta.url))],
    cwd:root,env:{...env('ok'),BGS_FIXTURE_RESUME_ERROR:reason}})
  try {
    let failure: unknown
    try { await client.request('thread/resume',{threadId:'019a0000-0000-7000-8000-000000000099'}) }
    catch (error) { failure=error }
    expect(info(failure).code).toBe(reason==='missing'?'native-history-missing':undefined)
    expect((failure as Error).message).toBe('BGS thread/resume rejected (code -32600)')
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_OTHER_ERROR')
  } finally { await client.close(); await rm(root,{recursive:true,force:true}) }
})

test('notification drain includes queued terminal events even when the RPC reply has arrived', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-drain-')
  let release!: () => void
  const gate = new Promise<void>(resolve => {release=resolve}), seen:string[]=[]
  const client = await BgsClient.connect({command:[process.execPath,fileURLToPath(new URL('./fixtures/app-server.ts',import.meta.url))],
    cwd:root,env:env('ok'),onNotification:async(method)=>{if(method==='first')await gate;seen.push(method)}})
  try {
    await client.request('fixture/events',{events:[{method:'first',params:{}},{method:'terminal',params:{}}]})
    let drained=false
    const drain=client.drainNotifications().then(()=>{drained=true})
    await Promise.resolve()
    expect(drained).toBe(false); expect(seen).toEqual([])
    release();await drain
    expect(seen).toEqual(['first','terminal'])
  } finally {release();await client.close();await rm(root,{recursive:true,force:true})}
})

test('search completion preserves literal Unicode line separators across stdout chunks', async () => {
  // Reduced from the search completion of three-miss-apple-catch, 2026-11-09.
  const excerpt = 'Define an \u2028\nObstacle Region'
  const structuredContent = {results:[{excerpts:[excerpt]}]}
  const params = {item:{type:'mcpToolCall',tool:'web_search',result:{
    structuredContent,content:[{type:'text',text:JSON.stringify(structuredContent)}],
  }}}
  const next = {text:'下一条\u2029通知'}
  const bytes = Buffer.from(JSON.stringify({method:'item/completed',params})+'\r\n'+JSON.stringify({method:'next',params:next})+'\n')
  const cut = bytes.indexOf(Buffer.from('\u2028'))+1
  const seen: unknown[] = []
  const client = await BgsClient.connect({command,cwd:'/private/tmp',env:env('ok'),
    onNotification:(method,value)=>{seen.push([method,value])}})
  try {
    await client.request('fixture/replay-stdout',{chunks:[bytes.subarray(0,cut),bytes.subarray(cut)].map(b=>b.toString('base64'))})
    await client.drainNotifications()
    expect(seen).toEqual([['item/completed',params],['next',next]])
  } finally {await client.close()}
})

for (const frame of ['{bad json}\n','[]\n','\n','{"method":"unfinished-at-eof"}']) {
  test('rejects malformed or unterminated stdout frame '+JSON.stringify(frame), async () => {
    const seen: string[] = []
    const client = await BgsClient.connect({command,cwd:'/private/tmp',env:env('ok'),
      onNotification:method=>{seen.push(method)}})
    try {
      const end = !frame.endsWith('\n')
      const output = end ? frame : frame+'{"method":"after-invalid"}\n'
      const request = client.request('fixture/replay-stdout',{chunks:[Buffer.from(output).toString('base64')],end})
      await expect(request).rejects.toMatchObject({bgsErrorInfo:{phase:'protocol'}})
      expect(seen).toEqual([])
    } finally {await client.close()}
  })
}

function env(mode: string): Record<string, string> {
  return { PATH: process.env.PATH || '', HOME: process.env.HOME || '/tmp', BGS_HOME: '/private/tmp/bgs-client-diagnostics-home',
    BGS_CLIENT_DIAGNOSTICS_MODE: mode }
}

function info(error: unknown): Record<string, any> {
  const value = (error as any)?.bgsErrorInfo
  expect(value).toBeDefined()
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain(secret)
  expect(serialized).not.toContain(fixture)
  expect(serialized).not.toContain('--listen')
  return value
}

test('spawn diagnostics distinguish a missing cwd from the executable without exposing paths or argv', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  const missing = join(root, 'missing-cwd')
  let observed: Error | undefined, succeeded = false
  try {
    let error: unknown
    try { await BgsClient.connect({ command, cwd: missing, env: env('ok'), onExit: caught => { observed = caught } }); succeeded = true }
    catch (caught) { error = caught; observed ||= caught as Error }
    expect(succeeded).toBe(false)
    const diagnostic = info(error)
    expect(diagnostic).toMatchObject({ phase: 'spawn', code: 'ENOENT', executable,
      cwd: { kind: 'missing' } })
    expect(observed).toBe(error as Error)
    expect((error as Error).message).not.toContain(missing)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('spawn diagnostics classify a cwd that exists but is not a directory', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  const file = join(root, 'cwd-file')
  await writeFile(file, 'not a directory')
  try {
    let error: unknown
    try { await BgsClient.connect({ command, cwd: file, env: env('ok') }) }
    catch (caught) { error = caught }
    const diagnostic = info(error)
    expect(['ENOTDIR', 'ENOENT']).toContain(diagnostic.code)
    expect(diagnostic).toMatchObject({ phase: 'spawn', executable, cwd: { kind: 'not-directory' } })
    expect((error as Error).message).not.toContain(file)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('spawn diagnostics identify a missing executable separately from a valid cwd', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  const missingExecutable = join(root, 'missing-bgs-executable')
  try {
    let error: unknown
    try { await BgsClient.connect({ command: [missingExecutable, fixture], cwd: root, env: env('ok') }) }
    catch (caught) { error = caught }
    const diagnostic = info(error)
    expect(diagnostic).toMatchObject({ phase: 'spawn', code: 'ENOENT', executable: basename(missingExecutable),
      cwd: { kind: 'directory' } })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('spawn diagnostics preserve EACCES instead of inferring ENOENT', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  const deniedExecutable = join(root, 'denied-bgs-executable')
  await writeFile(deniedExecutable, '#!/bin/sh\nexit 0\n')
  await chmod(deniedExecutable, 0o600)
  try {
    let error: unknown, succeeded = false
    try { await BgsClient.connect({ command: [deniedExecutable], cwd: root, env: env('ok') }); succeeded = true }
    catch (caught) { error = caught }
    expect(succeeded).toBe(false)
    const diagnostic = info(error)
    expect(diagnostic).toMatchObject({ phase: 'spawn', code: 'EACCES', executable: basename(deniedExecutable),
      cwd: { kind: 'directory' } })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('process exit diagnostics retain exit code and keep stderr/provider text private', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  let observed: Error | undefined
  let client: BgsClient | undefined
  try {
    client = await BgsClient.connect({ command, cwd: root, env: env('exit'), onExit: error => { observed = error } })
    await client.closed
    const diagnostic = info(observed)
    expect(diagnostic).toMatchObject({ phase: 'exit', executable, cwd: { kind: 'directory' }, exitCode: 23, signal: null })
    expect(observed?.message).not.toContain(secret)
  } finally {
    await client?.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

if (process.platform !== 'win32') test('process signal diagnostics retain signal without exposing stderr', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  let observed: Error | undefined
  let client: BgsClient | undefined
  try {
    client = await BgsClient.connect({ command, cwd: root, env: env('signal'), onExit: error => { observed = error } })
    await client.closed
    const diagnostic = info(observed)
    expect(diagnostic).toMatchObject({ phase: 'exit', executable, cwd: { kind: 'directory' }, exitCode: null, signal: 'SIGTERM' })
    expect(observed?.message).not.toContain(secret)
  } finally {
    await client?.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('request timeout diagnostics retain method and timeout without provider text', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-diagnostic-')
  let client: BgsClient | undefined
  try {
    client = await BgsClient.connect({ command, cwd: root, env: env('timeout') })
    let error: unknown
    try { await client.request('diagnostic/slow', {}, 25) }
    catch (caught) { error = caught }
    const diagnostic = info(error)
    expect(diagnostic).toMatchObject({ phase: 'request', method: 'diagnostic/slow', timeoutMs: 25 })
    expect((error as Error).message).toContain('diagnostic/slow')
    expect((error as Error).message).not.toContain(secret)
  } finally {
    await client?.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('requestNative keeps stable app-server calls typed while fixture methods stay generic', async () => {
  const root = await mkdtemp('/private/tmp/bgs-client-native-')
  let client: BgsClient | undefined
  try {
    client = await BgsClient.connect({ command, cwd: root, env: env('ok') })
    const result = await client.requestNative('skills/list', { cwds: [root], forceReload: true })
    expect(JSON.stringify(result)).toBe('{}')
    const generic = await client.request<RpcObject>('diagnostic/slow', {}, 25)
    expect(JSON.stringify(generic)).toBe('{}')
  } finally {
    await client?.close().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// All scripts, capabilities and receipts belong to temporary synthetic fixtures.
let root: string, moduleUrl: string, environment: Record<string, string>, slowIdentity: boolean
const running = new Set<ReturnType<typeof Bun.spawn>>()

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-test-receipt-')))
  const bundle = join(root, 'host-helper'), client = join(root, 'host-client')
  await mkdir(bundle); await mkdir(client)
  for (const name of ['preview-test-command.mjs', 'preview-test-client.mjs', 'preview-play-capture.mjs'])
    await copyFile(new URL('./' + name, import.meta.url), join(bundle, name))
  for (const name of ['package.json', 'browsers.json', 'index.mjs']) await writeFile(join(client, name), '{}')
  moduleUrl = pathToFileURL(join(bundle, 'preview-test-command.mjs')).href
  slowIdentity = false
  const common = { version: 1, workspace: root, executionId: 'execution', sessionId: 'session' }
  const preview = join(root, 'preview-capability.json'), measurement = join(root, 'measurement-capability.json')
  await writeFile(preview, JSON.stringify({ ...common, apiUrl: 'http://127.0.0.1:1' }))
  await writeFile(measurement, JSON.stringify({ ...common, apiUrl: 'http://127.0.0.1:1/identity' }))
  environment = { PATH: process.env.PATH!, BEEGAME_PREVIEW_CAPABILITY_FILE: preview,
    BEEGAME_MEASUREMENT_CAPABILITY_FILE: measurement,
    BEEGAME_PLAYWRIGHT_MODULE: pathToFileURL(join(client, 'index.mjs')).href }
})

afterEach(async () => {
  for (const child of running) { child.kill('SIGKILL'); await child.exited }
  running.clear()
  await rm(root, { recursive: true, force: true })
})

function launch(expression: string) {
  const child = Bun.spawn([Bun.which('node')!, '--input-type=module', '-e',
    `// HTTP transport is stubbed; real Node processes/files/signals are used.
     globalThis.fetch=async(url,options={})=>{
       options.signal?.throwIfAborted();
       if(new URL(url).pathname==='/status')return Response.json({preview:{status:'idle'}});
       if(${slowIdentity})await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
       return Response.json({runId:'run',attemptId:'attempt',requirementsRevision:'requirements',
         files:[{path:'test.mjs',sha256:'synthetic'}],dependencySha256:'dependencies'});
     };
     const {runPreviewTest,inspectPreviewTest}=await import(${JSON.stringify(moduleUrl)});
     const result=await (${expression}); console.log(JSON.stringify(result));
     if(result.status==='timed-out'||result.status==='interrupted'||result.exitCode!==0)process.exitCode=1;`],
  { cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe' })
  running.add(child)
  return child
}

async function complete(child: ReturnType<typeof launch>) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ])
  running.delete(child)
  expect(stdout, stderr).not.toBe('')
  return { code, result: JSON.parse(stdout) }
}

async function ready(path: string) {
  for (let i = 0; i < 200; i++) {
    try { return await readFile(join(root, path), 'utf8') } catch { await Bun.sleep(10) }
  }
  throw Error('Synthetic child did not become ready')
}

test('source freshness, supplied tooling identity and legacy unknowns stay separate without rerunning', async () => {
  await writeFile(join(root, 'test.mjs'), `import {appendFile} from 'node:fs/promises';
    await appendFile('calls.txt','once\\n'); console.log('retained output');`)
  const first = await complete(launch("runPreviewTest('test.mjs')"))
  expect(first.code).toBe(0)
  expect(first.result).toMatchObject({ status: 'exited', exitCode: 0, inputIdentity: 'unchanged-at-boundaries', quality: 'unverified' })
  const inspect = () => complete(launch(`inspectPreviewTest(${JSON.stringify(first.result.reportPath)})`))
  expect((await inspect()).result).toMatchObject({ freshness: { status: 'unchanged-at-boundaries' },
    toolingFreshness: { status: 'unchanged-at-boundaries' } })
  await writeFile(join(root, 'host-helper/preview-test-client.mjs'),
    await readFile(join(root, 'host-helper/preview-test-client.mjs'), 'utf8') + '\n// changed host helper\n')
  expect((await inspect()).result).toMatchObject({ freshness: { status: 'unchanged-at-boundaries' },
    toolingFreshness: { status: 'changed' } })
  const receiptPath = join(root, first.result.reportPath)
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  expect(receipt.after.tooling).toMatchObject({ status: 'observed', node: expect.any(String) })
  delete receipt.before.tooling; delete receipt.after.tooling
  await writeFile(receiptPath, JSON.stringify(receipt))
  expect((await inspect()).result).toMatchObject({ exitCode: 0, quality: 'unverified',
    freshness: { status: 'unchanged-at-boundaries' }, toolingFreshness: { status: 'unverified' } })
  expect(await readFile(join(root, 'calls.txt'), 'utf8')).toBe('once\n')
})

test('client identity changes and unavailable identities are not silently treated as unchanged', async () => {
  await writeFile(join(root, 'test.mjs'), '')
  const first = await complete(launch("runPreviewTest('test.mjs')"))
  const inspect = () => complete(launch(`inspectPreviewTest(${JSON.stringify(first.result.reportPath)})`))
  await writeFile(join(root, 'host-client/browsers.json'), '{"revision":2}')
  expect((await inspect()).result.toolingFreshness.status).toBe('changed')
  await rm(join(root, 'host-client/index.mjs'))
  expect((await inspect()).result.toolingFreshness.status).toBe('unverified')
})

test('ordinary exit codes and complete output remain facts, not quality verdicts or retry requests', async () => {
  await writeFile(join(root, 'test.mjs'), `import {appendFileSync} from 'node:fs';
    appendFileSync('calls.txt','x');console.log('x'.repeat(80000));console.error('failure details');
    process.exitCode=Number(process.argv[2]);`)
  for (const exitCode of [0, 7]) {
    const { code, result } = await complete(launch(`runPreviewTest('test.mjs',[${JSON.stringify(String(exitCode))}])`))
    expect(code).toBe(exitCode ? 1 : 0)
    expect(result).toMatchObject({ status: 'exited', exitCode, quality: 'unverified' })
    expect(result).not.toHaveProperty('passed')
    expect((await readFile(join(root, result.stdoutPath), 'utf8')).length).toBeGreaterThan(80000)
    expect(await readFile(join(root, result.stderrPath), 'utf8')).toContain('failure details')
  }
  expect(await readFile(join(root, 'calls.txt'), 'utf8')).toBe('xx')
})

test('launch failure and an unfinished legacy receipt cannot become success', async () => {
  await writeFile(join(root, 'test.mjs'), '')
  const { code, result } = await complete(launch("(process.execPath='/nonexistent-bgs-test-node',runPreviewTest('test.mjs'))"))
  expect(code).toBe(1)
  expect(result).toMatchObject({ status: 'launch-failed', exitCode: null, quality: 'unverified' })
  const receiptPath = join(root, result.reportPath)
  const unfinished = JSON.parse(await readFile(receiptPath, 'utf8'))
  unfinished.status = 'started'
  delete unfinished.exitCode; delete unfinished.finishedAt; delete unfinished.after
  await writeFile(receiptPath, JSON.stringify(unfinished))
  const inspected = await complete(launch(`inspectPreviewTest(${JSON.stringify(result.reportPath)})`))
  expect(inspected.result).toMatchObject({ status: 'started', quality: 'unverified', freshness: { status: 'unverified' } })
})

test('Node adapter executes the runtime it recorded, independently of PATH lookup', async () => {
  environment.PATH = '/nonexistent-bgs-test-bin'
  await writeFile(join(root, 'test.mjs'), 'console.log(process.versions.node)')
  const { code, result } = await complete(launch("runPreviewTest('test.mjs')"))
  expect(code).toBe(0)
  const receipt = JSON.parse(await readFile(join(root, result.reportPath), 'utf8'))
  expect((await readFile(join(root, result.stdoutPath), 'utf8')).trim()).toBe(receipt.after.tooling.node)
})

test('deadline stops a hanging test and descendants and retains a non-success receipt', async () => {
  await writeFile(join(root, 'test.mjs'), `import {spawn} from 'node:child_process';
    import {writeFileSync} from 'node:fs';
    const sub=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync('heartbeat.txt','x'),20)")}],{stdio:'ignore'});
    writeFileSync('descendant.pid',String(sub.pid)); setInterval(()=>{},1000);`)
  let descendant: number | undefined
  try {
    const child = launch("runPreviewTest('test.mjs',[],{timeoutMs:500})")
    descendant = Number(await ready('descendant.pid'))
    await ready('heartbeat.txt')
    const { code, result } = await complete(child)
    expect(code).toBe(1)
    expect(result).toMatchObject({ status: 'timed-out', exitCode: null, quality: 'unverified' })
    const receipt = JSON.parse(await readFile(join(root, result.reportPath), 'utf8'))
    expect(receipt.finishedAt).toBeString()
    expect(receipt.after.status).toBe('unverified')
    const heartbeat = await readFile(join(root, 'heartbeat.txt'), 'utf8')
    await Bun.sleep(100)
    expect(await readFile(join(root, 'heartbeat.txt'), 'utf8')).toBe(heartbeat)
  } finally {
    if (descendant) { try { process.kill(descendant, 'SIGKILL') } catch {} }
  }
}, 10000)

test.each(['SIGTERM', 'SIGINT'] as const)('catchable %s cancellation retains interrupted rather than success', async signal => {
  await writeFile(join(root, 'test.mjs'), `import {writeFileSync} from 'node:fs';
    process.on('SIGTERM',()=>{});writeFileSync('ready.txt','ready');setInterval(()=>{},1000);`)
  const child = launch("runPreviewTest('test.mjs')")
  await ready('ready.txt')
  child.kill(signal)
  const { code, result } = await complete(child)
  expect(code).toBe(1)
  expect(result).toMatchObject({ status: 'interrupted', cancelSignal: signal, signal: 'SIGKILL', exitCode: null, quality: 'unverified' })
  expect(JSON.parse(await readFile(join(root, result.reportPath), 'utf8')).finishedAt).toBeString()
}, 10000)

test('deadline also bounds source inspection and does not launch a test after expiry', async () => {
  slowIdentity = true
  await writeFile(join(root, 'test.mjs'), "import {writeFileSync} from 'node:fs';writeFileSync('should-not-run','bad');")
  const { code, result } = await complete(launch("runPreviewTest('test.mjs',[],{timeoutMs:100})"))
  expect(code).toBe(1)
  expect(result.status).toBe('timed-out')
  expect(result.finishedAt).toBeString()
  await expect(readFile(join(root, 'should-not-run'))).rejects.toThrow()
})


test.skipIf(process.platform === 'win32')('normal script exit cannot leave owned background writers behind a successful receipt', async () => {
  const background = `const fs=require('node:fs');process.on('SIGTERM',()=>{});
    fs.writeFileSync('background-ready.txt','ready');setInterval(()=>fs.appendFileSync('background-writes.txt','x'),20);
    setTimeout(()=>process.exit(0),5000);`;
  await writeFile(join(root,'test.mjs'), `import {spawn} from 'node:child_process';import {writeFileSync,existsSync} from 'node:fs';
    const sub=spawn(process.execPath,['-e',${JSON.stringify(background)}],{stdio:'ignore'});sub.unref();
    writeFileSync('background.pid',String(sub.pid));
    while(!existsSync('background-ready.txt'))await new Promise(resolve=>setTimeout(resolve,10));
    process.exit(0);`)
  let pid: number | undefined
  try {
    const child=launch("runPreviewTest('test.mjs')")
    pid=Number(await ready('background.pid'))
    const {code,result}=await complete(child)
    expect(code).toBe(1)
    expect(result).toMatchObject({status:'interrupted',exitCode:null,quality:'unverified'})
    expect(result.error).toContain('background')
    const before=await readFile(join(root,'background-writes.txt'),'utf8').catch(()=> '')
    await Bun.sleep(100)
    expect(await readFile(join(root,'background-writes.txt'),'utf8').catch(()=> '')).toBe(before)
  } finally {if(pid)try{process.kill(pid,'SIGKILL')}catch{}}
},10000)

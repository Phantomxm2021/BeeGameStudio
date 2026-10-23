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
    if (exitCode) {
      expect(result.failureOutput.stderr).toEqual({text:'failure details\n',truncated:false})
      expect(result.failureOutput.stdout.truncated).toBe(true)
      expect(result.failureOutput.stdout.text.length).toBeLessThanOrEqual(2048)
      const inspected = await complete(launch(`inspectPreviewTest(${JSON.stringify(result.reportPath)})`))
      expect(inspected.result.failureOutput).toEqual(result.failureOutput)
    } else expect(result).not.toHaveProperty('failureOutput')
  }
  expect(await readFile(join(root, 'calls.txt'), 'utf8')).toBe('xx')
})

test('failure excerpts retain bounded UTF-8 log ends and redact credentials without rewriting full logs', async () => {
  await writeFile(join(root, 'test.mjs'), `
    console.log('AssertionError: expected 2, received 3\\n'+'场景🎮'.repeat(10000)+'\\nstdout end');
    console.error('Error: original failure\\napi_key=fixture-secret\\nBearer fixture-bearer\\n'+'堆栈🎮'.repeat(10000)+'\\nstderr end');
    process.exitCode=7;`)
  const {result} = await complete(launch("runPreviewTest('test.mjs')"))
  expect(result).toMatchObject({status:'exited',exitCode:7,quality:'unverified'})
  for (const [stream, beginning] of [['stdout','AssertionError: expected 2, received 3'],['stderr','Error: original failure']]) {
    const excerpt=result.failureOutput[stream!]
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text).toStartWith(beginning!)
    expect(excerpt.text).toContain(stream+' end')
    expect(excerpt.text).not.toContain('\uFFFD')
    expect(excerpt.text.length).toBeLessThanOrEqual(2048)
  }
  expect(JSON.stringify(result.failureOutput)).not.toContain('fixture-secret')
  expect(JSON.stringify(result.failureOutput)).not.toContain('fixture-bearer')
  expect(await readFile(join(root,result.stderrPath),'utf8')).toContain('api_key=fixture-secret')
})

test('unavailable or replaced output cannot hide the failure or inline an unrelated file', async () => {
  await writeFile(join(root,'decoy.txt'),'UNRELATED_FILE_MUST_NOT_BE_INLINED')
  await writeFile(join(root,'test.mjs'), `import {readdirSync,unlinkSync,symlinkSync} from 'node:fs';
    const dir='.beegame/tmp/'+readdirSync('.beegame/tmp').find(name=>name.startsWith('preview-test-'));
    unlinkSync(dir+'/stdout.txt');unlinkSync(dir+'/stderr.txt');
    symlinkSync(process.cwd()+'/decoy.txt',dir+'/stderr.txt');process.exitCode=9;`)
  const {result}=await complete(launch("runPreviewTest('test.mjs')"))
  expect(result).toMatchObject({status:'exited',exitCode:9,
    failureOutput:{stdout:{unavailable:true},stderr:{unavailable:true}}})
  expect(JSON.stringify(result)).not.toContain('UNRELATED_FILE_MUST_NOT_BE_INLINED')
})

test('sampled credential prefixes are redacted before partial tail lines are omitted', async () => {
  await writeFile(join(root, 'test.mjs'), `
    console.log('Bearer HEAD_SECRET_'+'s'.repeat(4000)+'_TAIL_SECRET');
    console.error('Error: original failure\\r\\nAuthorization: Bearer HEAD_SECRET_'+
      's'.repeat(4000)+'_TAIL_SECRET\\r\\nError: final details');
    process.exitCode=7;`)
  const {result} = await complete(launch("runPreviewTest('test.mjs')"))
  expect(result).toMatchObject({status:'exited',exitCode:7,quality:'unverified'})
  for (const stream of ['stdout', 'stderr']) {
    const excerpt = result.failureOutput[stream]
    expect(excerpt.truncated).toBe(true)
    expect(excerpt.text).toContain('[...truncated...]')
    expect(excerpt.text).not.toContain('HEAD_SECRET')
    expect(excerpt.text).not.toContain('TAIL_SECRET')
    const full = await readFile(join(root, result[stream+'Path']), 'utf8')
    expect(full).toContain('HEAD_SECRET')
    expect(full).toContain('TAIL_SECRET')
  }
  expect(result.failureOutput.stdout.text).toStartWith('[credential redacted]')
  expect(result.failureOutput.stderr.text).toStartWith('Error: original failure\r\n')
  expect(result.failureOutput.stderr.text).toEndWith('Error: final details\n')
})

test('tail cuts at LF/CRLF line starts retain complete errors and multiline credential labels for redaction', async () => {
  const part = Math.floor((2048 - '\n[...truncated...]\n'.length) / 2)
  for (const newline of ['\n', '\r\n']) {
    const prefix = 'Error: first'+newline+'x'.repeat(3000)+newline
    const error = 'Error: COMPLETE_TAIL_ERROR'+newline
    const label = 'password="'+newline+'SYNTHETIC_SECRET_LINE'+newline
    const ending = newline+'"'+newline+'Error: final'+newline
    const stdout = prefix+error+'z'.repeat(part-Buffer.byteLength(error))
    const stderr = prefix+label+'s'.repeat(part-Buffer.byteLength(label+ending))+ending
    await writeFile(join(root,'test.mjs'), `process.stdout.write(${JSON.stringify(stdout)});
      process.stderr.write(${JSON.stringify(stderr)});process.exitCode=7;`)
    const {result} = await complete(launch("runPreviewTest('test.mjs')"))
    expect(result).toMatchObject({status:'exited',exitCode:7})
    expect(result.failureOutput.stdout.text).toContain('Error: COMPLETE_TAIL_ERROR')
    expect(result.failureOutput.stderr.text).toContain('[credential redacted]')
    expect(result.failureOutput.stderr.text).not.toContain('SYNTHETIC_SECRET_LINE')
    expect(result.failureOutput.stderr.text).toEndWith('Error: final'+newline)
    expect(await readFile(join(root,result.stderrPath),'utf8')).toBe(stderr)
  }
})

test('long ordinary error prefixes survive while quoted credentials cut mid-value or after an escape are redacted', async () => {
  const part = Math.floor((2048 - '\n[...truncated...]\n'.length) / 2)
  const start = 'Error: original\npassword="first\\"line\nSYNTHETIC_SECRET_HEAD\n'
  for (const cut of ['s', '\\']) {
    const stdout = 'Error: LONG_ERROR '+ 'x'.repeat(4000)
    const stderr = start+'s'.repeat(part-Buffer.byteLength(start)-1)+cut+
      's'.repeat(4000)+'"\nError: final\n'
    await writeFile(join(root,'test.mjs'), `process.stdout.write(${JSON.stringify(stdout)});
      process.stderr.write(${JSON.stringify(stderr)});process.exitCode=7;`)
    const {result} = await complete(launch("runPreviewTest('test.mjs')"))
    expect(result.failureOutput.stdout.text).toStartWith('Error: LONG_ERROR ')
    expect(result.failureOutput.stdout.truncated).toBe(true)
    expect(result.failureOutput.stderr.text).toStartWith('Error: original\n[credential redacted]')
    expect(result.failureOutput.stderr.text).not.toContain('SYNTHETIC_SECRET_HEAD')
    expect(result.failureOutput.stderr.text).toEndWith('Error: final\n')
    expect(await readFile(join(root,result.stderrPath),'utf8')).toBe(stderr)
  }
})

test('excerpt read/close failures preserve the original exit and finalized receipt without retries', async () => {
  await writeFile(join(root, 'test.mjs'), `import {appendFileSync} from 'node:fs';
    appendFileSync('calls.txt','x');
    console.log('original stdout\\n'+'x'.repeat(4000)+'\\nstdout end');
    console.error('original failure\\n'+'x'.repeat(4000)+'\\nstderr end');
    process.exitCode=7;`)
  for (const failRead of [false, true]) {
    // Fault only the optional read handles, after closing the real descriptor.
    // This exercises the actual adapter finalization and persisted receipt.
    const {code, result} = await complete(launch(`(async()=>{
      const fs=(await import('node:fs/promises')).default, originalOpen=fs.open;
      let bytesRequested=0, closed=0;
      fs.open=async(...args)=>{
        const file=await originalOpen(...args);
        if(typeof args[1]==='number'){
          const read=file.read.bind(file), close=file.close.bind(file);
          file.read=async(...args)=>{
            bytesRequested+=args[2];
            if(${failRead})throw Error('synthetic read failure');
            return read(...args);
          };
          file.close=async()=>{await close();closed++;throw Error('synthetic close failure');};
        }
        return file;
      };
      (await import('node:module')).syncBuiltinESMExports();
      return {...await runPreviewTest('test.mjs'),bytesRequested,closed};
    })()`))
    expect(code).toBe(1)
    expect(result).toMatchObject({status:'exited',exitCode:7,quality:'unverified',closed:2})
    expect(result.bytesRequested).toBeGreaterThan(0)
    expect(result.bytesRequested).toBeLessThanOrEqual(4096)
    if (failRead) expect(result.failureOutput).toEqual({stdout:{unavailable:true},stderr:{unavailable:true}})
    else {
      expect(result.failureOutput.stdout.text).toContain('original stdout')
      expect(result.failureOutput.stderr.text).toContain('original failure')
    }
    const saved = JSON.parse(await readFile(join(root, result.reportPath), 'utf8'))
    expect(saved).toMatchObject({status:'exited',exitCode:7,failureOutput:result.failureOutput})
    expect(saved.finishedAt).toBeString()
  }
  expect(await readFile(join(root, 'calls.txt'), 'utf8')).toBe('xx')
})

test('credential matches use original text when Bearer and escaped quoted values overlap', async () => {
  const stdout = 'Error: first\npassword="Bearer abc\\"SYNTHETIC_DOUBLE_SECRET"\nError: last\n'
  const stderr = "Error: first\npassword='Bearer abc\\'SYNTHETIC_SINGLE_SECRET'\n"+
    'Authorization: Bearer SYNTHETIC_HEADER_SECRET\nError: last\n'
  await writeFile(join(root,'test.mjs'), `process.stdout.write(${JSON.stringify(stdout)});
    process.stderr.write(${JSON.stringify(stderr)});process.exitCode=7;`)
  const {result} = await complete(launch("runPreviewTest('test.mjs')"))
  expect(result).toMatchObject({status:'exited',exitCode:7})
  for (const stream of ['stdout','stderr']) {
    const excerpt = result.failureOutput[stream]
    expect(excerpt.truncated).toBe(false)
    expect(excerpt.text).not.toContain('SYNTHETIC_')
    expect(excerpt.text).toStartWith('Error: first\n')
    expect(excerpt.text).toEndWith('Error: last\n')
  }
  expect(await readFile(join(root,result.stdoutPath),'utf8')).toBe(stdout)
  expect(await readFile(join(root,result.stderrPath),'utf8')).toBe(stderr)
})

test('partial tail omission uses original lines even when a credential replacement removes newlines', async () => {
  const part = Math.floor((2048 - '\n[...truncated...]\n'.length) / 2)
  for (const newline of ['\n','\r\n']) {
    const tail = 'fragment password="SYNTHETIC_FIRST_SECRET'+newline+
      'SYNTHETIC_SECOND_SECRET"; Error: COMPLETE_LATER_LINE'+newline
    const stderr = 'Error: first\n'+'x'.repeat(3000)+tail+'z'.repeat(part-Buffer.byteLength(tail))
    await writeFile(join(root,'test.mjs'), `process.stderr.write(${JSON.stringify(stderr)});process.exitCode=7;`)
    const {result} = await complete(launch("runPreviewTest('test.mjs')"))
    expect(result).toMatchObject({status:'exited',exitCode:7})
    expect(result.failureOutput.stderr.truncated).toBe(true)
    expect(result.failureOutput.stderr.text).toContain('; Error: COMPLETE_LATER_LINE'+newline)
    expect(result.failureOutput.stderr.text).not.toContain('SYNTHETIC_')
    expect(result.failureOutput.stderr.text).not.toContain('fragment')
    expect(await readFile(join(root,result.stderrPath),'utf8')).toBe(stderr)
  }
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

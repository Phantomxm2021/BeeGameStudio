import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { BALANCE_CALCULATOR_PATH, materializeBalanceCalculator, readCalculationInputs } from './balance-calculation'
import { checkDesignHandoff } from './design-handoff'
import { sceneLayoutFixture, writeDesignDocumentFixture } from './fixtures/layout-fixture'

// A tiny legal-action model, not a prefilled game answer or a runtime simulator.
const model = `export async function calculate({readJson}) {
  const p = await readJson('parameters.json');
  let stock = p.stock; const states = [stock];
  for (const amount of p.actions) {
    if (amount <= stock) stock -= amount;
    states.push(stock);
  }
  return {
    tables: [{title:'Capacity', columns:['units','seconds'], rows:[[p.stock, p.stock / p.rate]]}],
    checks: [{name:'Legal spending', passed:stock >= 0 && states[2] === states[1],
      details:JSON.stringify(states)}],
    limitations:['A sampled action sequence; not all strategies or runtime behavior.']
  };
}`

async function fixture(run: (workspace: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-balance-calculation-'))
  try {
    await materializeBalanceCalculator(workspace)
    await writeFile(join(workspace, 'model.mjs'), model)
    await writeFile(join(workspace, 'parameters.json'), JSON.stringify({ stock: 12, rate: 3, actions: [5, 20, 2] }))
    await run(workspace)
  } finally { await rm(workspace, { recursive: true, force: true }) }
}

async function command(workspace: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, BALANCE_CALCULATOR_PATH, ...args], {
    cwd: workspace, stdout: 'pipe', stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()])
  return { code, stdout, stderr }
}

test('calculator deployment retains executable identity without masking source changes', () => fixture(async workspace => {
  const helper = join(workspace, BALANCE_CALCULATOR_PATH)
  // Emulate a different deployed build; the real synthetic calculation uses it.
  const previous = (await readFile(helper, 'utf8')) + '\n// synthetic previous build\n'
  await writeFile(helper, previous)
  expect((await command(workspace, 'model.mjs', 'docs/calc/result.md')).code).toBe(0)
  const saved = await readFile(join(workspace, 'docs/calc/result.md'), 'utf8')
  await materializeBalanceCalculator(workspace)
  const digest = createHash('sha256').update(previous).digest('hex')
  expect(await readFile(join(workspace, '.beegame/delivery/calculators', digest + '.mjs'), 'utf8')).toBe(previous)
  expect((await command(workspace, '--check-result', 'docs/calc/result.md')).code).toBe(0)
  expect(await readFile(join(workspace, 'docs/calc/result.md'), 'utf8')).toBe(saved)
  await writeFile(join(workspace, 'parameters.json'), '{"stock":17,"rate":3,"actions":[5,20,2]}')
  expect((await command(workspace, '--check-result', 'docs/calc/result.md')).stdout).toContain('Input changed: parameters.json')
  await writeFile(join(workspace, '.beegame/delivery/calculators', digest + '.mjs'), 'tampered')
  expect((await command(workspace, '--check-result', 'docs/calc/result.md')).stdout).toContain('retained version is unavailable')
}))

test('dependency reading accepts stale inputs but rejects altered results and unsafe paths', async () => {
  await fixture(async workspace => {
    const output = 'docs/calc/result.md'
    expect((await command(workspace, 'model.mjs', output)).code).toBe(0)
    const saved = await readFile(join(workspace, output), 'utf8')
    expect(readCalculationInputs(workspace, output)).toEqual(['model.mjs', 'parameters.json'])
    await writeFile(join(workspace, 'parameters.json'), '{"stock":99}')
    expect(readCalculationInputs(workspace, output)).toEqual(['model.mjs', 'parameters.json'])
    await writeFile(join(workspace, output), 'changed\n' + saved)
    expect(() => readCalculationInputs(workspace, output)).toThrow('Calculation output changed')
    for (const path of ['../outside.json', '/tmp/outside.json', 'docs/../parameters.json']) {
      const changed = saved.replace(/bgs-calculation-v1:([A-Za-z0-9+/=]+)/, (_, data) => {
        const record = JSON.parse(Buffer.from(data, 'base64').toString('utf8'))
        record.sources[0][0] = path
        return 'bgs-calculation-v1:' + Buffer.from(JSON.stringify(record)).toString('base64')
      })
      await writeFile(join(workspace, output), changed)
      expect(() => readCalculationInputs(workspace, output)).toThrow('Invalid retained input path')
    }
    await writeFile(join(workspace, output), saved)
    await symlink(join(workspace, 'parameters.json'), join(workspace, 'linked-result.md'))
    expect(() => readCalculationInputs(workspace, 'linked-result.md')).toThrow('non-symlink')
  })
})

test('Scene calculation consumes discovered saved sources; freshness and host handoff never rerun the model', async () => {
  await fixture(async workspace => {
    await writeDesignDocumentFixture(workspace, 'LEVEL_SCENE_DESIGN.md')
    await mkdir(join(workspace, 'docs/calc'), { recursive: true })
    await mkdir(join(workspace, 'content/scenes/with spaces'), { recursive: true })
    const extra = { ...sceneLayoutFixture(), id: 'extra' }
    await writeFile(join(workspace, 'content/scenes/with spaces/extra level.json'), JSON.stringify(extra))
    const sceneModel = `import {appendFile} from 'node:fs/promises';
      export async function calculate({scenes,readText}) {
        await appendFile('executions.txt','run\\n'); await readText('rules.txt');
        return {tables:[{title:'Actual scenes',columns:['path','nodes'],rows:scenes.map(s=>[s.path,s.document.data.nodes.length])}],
          checks:[{name:'Actual input count',passed:scenes.length===2,details:'Two saved fixtures'}],limitations:['Synthetic boundary, not game rules']};
      }`
    await writeFile(join(workspace, 'model.mjs'), sceneModel)
    await writeFile(join(workspace, 'rules.txt'), 'fixture rule')
    const output = 'docs/calc/scene.md'
    const docPath = join(workspace, 'docs/LEVEL_SCENE_DESIGN.md')
    await writeFile(docPath, await readFile(docPath, 'utf8') + '\n[Calculation](calc/scene.md)\n')
    expect((await command(workspace, 'model.mjs', output, '--scenes')).code).toBe(0)
    const result = await readFile(join(workspace, output), 'utf8')
    expect(result).toContain('content/scenes/with spaces/extra level.json')
    expect((await command(workspace, '--check-result', output)).code).toBe(0)
    expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).valid).toBe(true)
    expect(await readFile(join(workspace, 'executions.txt'), 'utf8')).toBe('run\n')

    for (const [path, replacement, message] of [
      ['rules.txt', 'changed rule', 'Input changed: rules.txt'],
      ['model.mjs', sceneModel + '\n//changed', 'Input changed: model.mjs'],
      ['content/scenes/with spaces/extra level.json', JSON.stringify({ ...extra, id: 'changed' }), 'Input changed: content/scenes'],
      [output, result.replace('Actual scenes', 'Changed scenes'), 'Calculation output changed'],
    ]) {
      const file = join(workspace, path!), original = await readFile(file, 'utf8')
      await writeFile(file, replacement!)
      const check = await command(workspace, '--check-result', output)
      expect(check.code).toBe(1)
      expect(check.stdout).toContain(message!)
      expect(checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md']).issues.join(' ')).toContain(message!)
      await writeFile(file, original)
    }
    await writeFile(join(workspace, 'content/scenes/new.json'), JSON.stringify({ ...extra, id: 'new' }))
    expect((await command(workspace, '--check-result', output)).stdout).toContain('membership changed')
    expect(await readFile(join(workspace, 'executions.txt'), 'utf8')).toBe('run\n')
  })
})

test('missing calculation records are unverified, not semantic failures or permission to execute', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'legacy.md'), '# Old calculation')
    const check = await command(workspace, '--check-result', 'legacy.md')
    expect(check.code).toBe(1)
    expect(check.stdout).toContain('freshness is unverified')
    expect(check.stdout).toContain('No model executed')
  })
})

test('Scene models and freshness share design inputs; bindings do not invalidate, geometry and exact reads do', async () => {
  await fixture(async workspace => {
    await writeDesignDocumentFixture(workspace, 'LEVEL_SCENE_DESIGN.md')
    const path = 'content/scenes/level.json', file = join(workspace, path)
    const scene = sceneLayoutFixture() as any
    scene.data.nodes[1].components = [{ id: 'art', type: 'sprite-renderer', data: { size: [24, 24], color: '#123456' } }]
    await writeFile(file, JSON.stringify(scene))
    const formula = `export async function calculate({scenes,readJson}) {
      const doc = (await readJson('${path}'));
      if ('assetRefs' in doc || doc.data.nodes[1].components[0].assetRef) throw Error('Binding leaked into design input');
      return {tables:[{title:'Nodes',columns:['count'],rows:[[doc.data.nodes.length]]}],
        checks:[{name:'Same view',passed:JSON.stringify(doc)===JSON.stringify(scenes[0].document),details:'Tracked reader and discovered Scene agree'}],limitations:['Fixture, not gameplay proof']}; }`
    await writeFile(join(workspace, 'model.mjs'), formula)
    const output = 'docs/calc/result.md'
    expect((await command(workspace, 'model.mjs', output, '--scenes')).code).toBe(0)
    const saved = await readFile(join(workspace, output), 'utf8')
    expect(saved).toContain('scene-design-v1')
    expect(readCalculationInputs(workspace, output)).toContain(path)
    const owner = join(workspace, 'docs/LEVEL_SCENE_DESIGN.md')
    await writeFile(owner, await readFile(owner, 'utf8') + '\n[Calculation](calc/result.md)\n')
    const baseline = checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md'])
    expect(baseline.issues).toEqual([])
    scene.assetRefs = ['atlas']; scene.data.nodes[1].components[0].assetRef = 'atlas'
    Object.assign(scene.data.nodes[1].components[0].data, { member: 'assets/atlas.png', frame: 'tile' })
    await writeFile(file, JSON.stringify(scene, null, 2))
    expect((await command(workspace, '--check-result', output)).code).toBe(0)
    const bound = checkDesignHandoff(workspace, ['LEVEL_SCENE_DESIGN.md'])
    expect(bound.issues).toEqual([])
    expect(bound.snapshots).toEqual(baseline.snapshots)
    expect(bound.evidenceHashes).toEqual(baseline.evidenceHashes)
    expect((await command(workspace, 'model.mjs', output, '--scenes')).code).toBe(0)
    expect(await readFile(join(workspace, output), 'utf8')).toBe(saved)
    for (const change of [
      (d: any) => { d.data.nodes[1].components[0].data.size[0] = 25 },
      (d: any) => { d.data.nodes[1].data = { behaviors: [{ id: 'rule', kind: 'different-rule', config: {} }] } },
      (d: any) => { d.data.nodes.push({ id: 'extra-decoration', components: [] }) },
    ]) {
      const changed = structuredClone(scene); change(changed)
      await writeFile(file, JSON.stringify(changed))
      expect((await command(workspace, '--check-result', output)).stdout).toContain('Input changed: ' + path)
    }
    await writeFile(file, JSON.stringify(scene))
    // Exact-byte users retain their stricter contract; legacy evidence is not
    // silently upgraded to a weaker identity.
    await writeFile(join(workspace, 'model.mjs'), `export async function calculate({readText}) {
      const source = await readText('${path}');
      return {tables:[{title:'Bytes',columns:['count'],rows:[[source.length]]}],checks:[],limitations:['Exact-byte fixture']}; }`)
    expect((await command(workspace, 'model.mjs', output)).code).toBe(0)
    scene.data.nodes[1].components[0].assetRef = 'different-atlas'
    await writeFile(file, JSON.stringify(scene))
    expect((await command(workspace, '--check-result', output)).stdout).toContain('Input changed: ' + path)
  })
})

test('published tool computes tables, simulates legal actions and regenerates from changed source bytes', async () => {
  await fixture(async workspace => {
    expect((await command(workspace, '--help')).stdout).toContain('calculate({readJson, readText})')
    const run = await command(workspace, 'model.mjs', 'docs/calculated.md')
    expect(run.code).toBe(0)
    expect(run.stderr).toBe('')
    expect(JSON.parse(run.stdout)).toEqual({ output: 'docs/calculated.md', checks: 1, sources: 2,
      independentVerification: { status: 'not-run' } })
    const original = await readFile(join(workspace, 'docs/calculated.md'), 'utf8')
    expect(original).toContain('| 12 | 4 |')
    expect(original).toContain('[12,7,7,5]')
    expect(original).toContain('parameters.json')
    expect(original).toContain('Model-reported checks are not independent verification')
    await writeFile(join(workspace, 'parameters.json'), JSON.stringify({ stock: 18, rate: 3, actions: [5, 20, 2] }))
    expect((await command(workspace, 'model.mjs', 'docs/calculated.md')).code).toBe(0)
    const revised = await readFile(join(workspace, 'docs/calculated.md'), 'utf8')
    expect(revised).toContain('| 18 | 6 |')
    expect(revised).toContain('[18,13,13,11]')
    expect(revised).not.toBe(original)
    expect(await readFile(join(workspace, 'model.mjs'), 'utf8')).toBe(model)
  })
})

test.each(['- Version: v1.0\n', '- 版本：v1.0\r\n'])('design calculation identity excludes host version metadata (%s)', async versionLine => {
  await fixture(async workspace => {
    await mkdir(join(workspace, 'docs'))
    const source = '# Balance\n' + versionLine + '## Rules\nRate: 3\n'
    const body = source.replace(versionLine, '')
    await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), source)
    const formula = `export async function calculate({readText}) {
      const body = await readText('docs/BALANCE_DESIGN.md');
      if (body.includes('Version:') || body.includes('版本：')) throw Error('Host metadata leaked into calculation inputs');
      return {tables:[{title:'Rate',columns:['units'],rows:[[Number(body.match(/Rate: (\\d+)/)[1])]]}],checks:[],limitations:['Synthetic source identity fixture']};
    }`
    await writeFile(join(workspace, 'model.mjs'), formula)
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    expect(original).toContain(createHash('sha256').update(body).digest('hex'))
    expect(original).toContain('design-body-without-version')
    expect(original).toContain(createHash('sha256').update(formula).digest('hex'))
    expect(await readFile(join(workspace, 'docs/BALANCE_DESIGN.md'), 'utf8')).toBe(source)

    await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), source.replace('v1.0', 'v1.1'))
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)

    await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), source.replace('Rate: 3', 'Rate: 4'))
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    const changedSource = await readFile(join(workspace, 'calculated.md'), 'utf8')
    expect(changedSource).not.toBe(original)
    expect(changedSource).toContain('| 4 |')
    await writeFile(join(workspace, 'model.mjs'), formula + '\n// Changed model source\n')
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).not.toBe(changedSource)
  })
})

test('ambiguous version lines and non-design sources retain their exact source bytes', async () => {
  await fixture(async workspace => {
    await mkdir(join(workspace, 'docs'))
    const bytes = '# Source\n- Version: v1.0\n- Version: v2.0\nRate: 3\n'
    await writeFile(join(workspace, 'docs/BALANCE_DESIGN.md'), bytes)
    await writeFile(join(workspace, 'source.md'), bytes)
    await writeFile(join(workspace, 'model.mjs'), model.replace("const p = await readJson('parameters.json');",
      "const p = await readJson('parameters.json'); await readText('docs/BALANCE_DESIGN.md'); await readText('source.md');")
      .replace('calculate({readJson})', 'calculate({readJson,readText})'))
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    const result = await readFile(join(workspace, 'calculated.md'), 'utf8')
    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(result).toContain('| docs/BALANCE_DESIGN.md | ' + digest + ' | exact-bytes |')
    expect(result).toContain('| source.md | ' + digest + ' | exact-bytes |')
  })
})

const constrainedModel = `export async function calculate({readJson}) {
  const p = await readJson('parameters.json');
  const actual = Math.min(p.request, p.stock), after = p.stock - actual;
  const cost = p.request * p.price; // Intentional request-versus-execution defect.
  return {tables:[{title:'Cost',columns:['cost'],rows:[[cost]]}],
    observations:[{before:p.stock,requested:p.request,actual,after,cost}],
    checks:[{name:'Stock nonnegative',passed:after>=0,details:String(after)}],
    limitations:['One observed allocation, not a universal policy proof.']};
}`
const constrainedVerifier = `export async function verify({tables,observations,readJson}) {
  const p = await readJson('parameters.json');
  const event = observations[0];
  const spent = event.before - event.after;
  const expectedCost = spent * p.price;
  return {checks:[{name:'Cost follows actual constrained execution',
    passed:event.before===p.stock && event.requested===p.request && event.after>=0 &&
      spent===Math.min(p.stock,p.request) && event.actual===spent && event.cost===expectedCost && tables[0].rows[0][0]===expectedCost,
    details:JSON.stringify({requested:event.requested,actual:spent,expectedCost,reportedCost:event.cost})}],
    limitations:['Checks this allocation and its consequence only.']};
}`

test('independent verification rejects requested results after constraint saturation and preserves prior output', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'model.mjs'), constrainedModel)
    await writeFile(join(workspace, 'verify.mjs'), constrainedVerifier)
    await writeFile(join(workspace, 'parameters.json'), JSON.stringify({ stock: 5, request: 3, price: 4 }))
    expect((await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')).code).toBe(0)
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    expect(original).toContain('verify.mjs')
    expect(original).toContain('"requested": 3')
    expect(original).toContain('Cost follows actual constrained execution')
    await writeFile(join(workspace, 'parameters.json'), JSON.stringify({ stock: 5, request: 12, price: 4 }))
    const failed = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain('Independent verification failed')
    expect(failed.stderr).toContain('"actual":5,"expectedCost":20,"reportedCost":48')
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
    // Fix only this platform-test fixture, never an authored game/model.
    await writeFile(join(workspace, 'model.mjs'), constrainedModel.replace('p.request * p.price', 'actual * p.price'))
    const fixed = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
    expect(fixed.code).toBe(0)
    expect(JSON.parse(fixed.stdout).independentVerification).toEqual({ status: 'passed', checks: 1 })
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toContain('| 20 |')
  })
})

test('verification rejects empty evidence checks, aliases of the model and invalid observations', async () => {
  await fixture(async workspace => {
    await command(workspace, 'model.mjs', 'calculated.md')
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    await symlink(join(workspace, 'model.mjs'), join(workspace, 'alias.mjs'))
    expect((await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'alias.mjs')).stderr).toContain('separate module')
    for (const verifier of [
      'export async function verify(){return {checks:[],limitations:[]}}',
      'export async function verify(){return {checks:[{name:"test",passed:true,details:"x"}]}}',
      'export async function verify(){return null}',
      'export async function calculate(){}',
    ]) {
      await writeFile(join(workspace, 'verify.mjs'), verifier)
      expect((await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')).code).toBe(1)
      expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
    }
    await writeFile(join(workspace, 'verify.mjs'), constrainedVerifier)
    for (const observation of ['[Infinity]', '[undefined]', 'new Date()', '(()=>{const a=[];a.push(a);return a})()']) {
      await writeFile(join(workspace, 'model.mjs'), model.replace('return {', `return {observations:${observation},`))
      expect((await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')).stderr).toContain('finite JSON')
      expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
    }
  })
})

test('verifier gets isolated observations and tables, but no model self-check flags', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'model.mjs'), model.replace('return {', 'return {observations:[{actual:7}],'))
    await writeFile(join(workspace, 'verify.mjs'), `export async function verify(input) {
      if ('checks' in input) throw Error('Self-check flags leaked');
      input.tables[0].rows[0][0]=999;input.observations[0].actual=999;
      await input.readText('reference.md');
      return {checks:[{name:'Isolation boundary',passed:true,details:'Synthetic test only'}],limitations:[]};
    }`)
    await writeFile(join(workspace, 'reference.md'), 'independent source')
    const run = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
    expect(run.code).toBe(0)
    const output = await readFile(join(workspace, 'calculated.md'), 'utf8')
    expect(output).toContain('| 12 | 4 |')
    expect(output).toContain('"actual": 7')
    expect(output).toContain('reference.md')
  })
})

test('read-only frozen native model still self-passes, but independent contact evidence rejects its first bounce', async () => {
  const frozen = new URL('../../../../docs/verification/layout-2026-10-01/design-tools-retest/after-review/', import.meta.url)
  const modelUrl = new URL('docs/balance_model.mjs', frozen), sceneUrl = new URL('content/scenes/breakout_level.json', frozen)
  const bytes = await readFile(modelUrl, 'utf8'), sceneBytes = await readFile(sceneUrl, 'utf8')
  const audit = JSON.parse(await readFile(new URL('../balance-independent-audit.json', frozen), 'utf8'))
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  expect(hash(bytes)).toBe(audit.sourceHashes.model)
  expect(hash(sceneBytes)).toBe(audit.sourceHashes.scene)
  // Execute only the original calculation's read-only body; no output command
  // runs in its project. The independent audit is evidence, not a repaired model.
  const original = await import(modelUrl.href)
  const result = await original.calculate({ readJson: async (path: string) =>
    JSON.parse(await readFile(new URL(path, frozen), 'utf8')) })
  expect(result.checks.every((check: { passed: boolean }) => check.passed)).toBe(true)
  const scene = JSON.parse(sceneBytes)
  const halfWidth = scene.data.nodes.find((node: { id: string }) => node.id === 'paddle')
    .components.find((component: { type: string }) => component.type === 'box-collider-2d').data.size[0] / 2
  const maxAngle = Number(bytes.match(/\bmaxBounceAngleDeg:\s*([\d.]+)/)?.[1])
  expect(Number.isFinite(maxAngle)).toBe(true)
  await fixture(async workspace => {
    // These are isolated system-test evidence inputs, not edited/copy-repaired
    // Scene or game scripts. Reference sources remain byte-for-byte unchanged.
    await writeFile(join(workspace, 'native-result.json'), JSON.stringify(result))
    await writeFile(join(workspace, 'contact-evidence.json'), JSON.stringify({
      contactX: audit.returnContact.xAt, paddleCenter: audit.returnContact.paddleCenter,
      halfWidth, maxAngle, sourceHashes: audit.sourceHashes,
    }))
    await writeFile(join(workspace, 'model.mjs'), `export async function calculate({readJson}) { return readJson('native-result.json') }`)
    await writeFile(join(workspace, 'verify.mjs'), `export async function verify({tables,readJson}) {
      const e=await readJson('contact-evidence.json');
      const expected=((e.contactX-e.paddleCenter)/e.halfWidth)*e.maxAngle;
      const events=tables.find(table=>table.title.startsWith('表6 '));
      const first=events.rows.find(row=>String(row[1]).startsWith('挡板反弹'));
      if(!first)throw Error('No claimed first paddle contact');
      const observed=first[6];
      return {checks:[{name:'First bounce follows actual contact',passed:Math.abs(observed-expected)<0.01,
        details:JSON.stringify({claimed:observed,expected})}],
        limitations:['One previously independently audited contact only; not all later collisions. Source constants extracted from authored configuration.']};
    }`)
    const unverified = await command(workspace, 'model.mjs', 'calculated.md')
    expect(unverified.code).toBe(0)
    expect(JSON.parse(unverified.stdout).independentVerification.status).toBe('not-run')
    const prior = await readFile(join(workspace, 'calculated.md'), 'utf8')
    const rejected = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
    expect(rejected.code).toBe(1)
    expect(rejected.stderr).toContain('Independent verification failed')
    expect(rejected.stderr).toContain('"claimed":-57,"expected":46.539')
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(prior)
  })
  expect(await readFile(modelUrl, 'utf8')).toBe(bytes)
  expect(await readFile(sceneUrl, 'utf8')).toBe(sceneBytes)
})

test('CLI reports every failed check without rerunning calculations or replacing prior output', async () => {
  await fixture(async workspace => {
    expect((await command(workspace, 'model.mjs', 'calculated.md')).code).toBe(0)
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    const checks = [
      { name: 'Stock boundary', passed: false, details: 'Observed -2; minimum 0' },
      { name: 'Passing check', passed: true, details: 'Do not include in failure output' },
      { name: '行动约束', passed: false, details: '实际 7 次；上限 5 次' },
    ]
    const countedModel = `import {appendFile} from 'node:fs/promises';\n` + model.replace(
      "const p = await readJson('parameters.json');",
      "await appendFile('calls.txt', 'calculate\\n'); const p = await readJson('parameters.json');",
    )
    for (const independent of [false, true]) {
      await writeFile(join(workspace, 'calls.txt'), '')
      await writeFile(join(workspace, 'model.mjs'), independent ? countedModel : countedModel.replace(
        "checks: [{name:'Legal spending', passed:stock >= 0 && states[2] === states[1],\n      details:JSON.stringify(states)}]",
        'checks: ' + JSON.stringify(checks),
      ))
      await writeFile(join(workspace, 'verify.mjs'), `import {appendFile} from 'node:fs/promises';
        export async function verify() {
          await appendFile('calls.txt', 'verify\\n');
          return {checks:${JSON.stringify(checks)},limitations:[]};
        }`)
      const result = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
      const label = independent ? 'Independent verification' : 'Scenario check'
      expect(result.code).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr.trim()).toBe([
        `${label} failed: Stock boundary: Observed -2; minimum 0`,
        `${label} failed: 行动约束: 实际 7 次；上限 5 次`,
      ].join('\n'))
      expect(await readFile(join(workspace, 'calls.txt'), 'utf8')).toBe(independent ? 'calculate\nverify\n' : 'calculate\n')
      expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
    }
  })
})

test('failed scenarios, non-finite arithmetic and malformed tables cannot overwrite valid results', async () => {
  await fixture(async workspace => {
    await command(workspace, 'model.mjs', 'calculated.md')
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    for (const [script, error] of [
      [model.replace('stock >= 0', 'stock < 0'), 'Scenario check failed'],
      [model.replace('p.stock / p.rate', 'Infinity'), 'Invalid table'],
      [model.replace("['units','seconds']", "['units']"), 'Invalid table'],
    ]) {
      await writeFile(join(workspace, 'model.mjs'), script!)
      const result = await command(workspace, 'model.mjs', 'calculated.md')
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(error!)
      expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
    }
  })
})

test('sources changing during computation fail without leaving a new calculation', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'model.mjs'), model.replace('let stock = p.stock;',
      "await Bun.write('parameters.json', '{}'); let stock = p.stock;"))
    const result = await command(workspace, 'model.mjs', 'calculated.md')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Source changed during calculation')
    expect(await Bun.file(join(workspace, 'calculated.md')).exists()).toBe(false)
  })
  await fixture(async workspace => {
    await command(workspace, 'model.mjs', 'calculated.md')
    const original = await readFile(join(workspace, 'calculated.md'), 'utf8')
    await writeFile(join(workspace, 'verify.mjs'), `export async function verify({readJson}) {
      await readJson('parameters.json');await Bun.write('parameters.json','{}');
      return {checks:[{name:'Fixture',passed:true,details:'Not valid after mutation'}],limitations:[]};
    }`)
    const result = await command(workspace, 'model.mjs', 'calculated.md', '--verify', 'verify.mjs')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Source changed during calculation')
    expect(await readFile(join(workspace, 'calculated.md'), 'utf8')).toBe(original)
  })
})

test('calculation output cannot replace input or escape through symlinks and traversal', async () => {
  await fixture(async workspace => {
    await writeFile(join(workspace, 'source.md'), 'original source')
    await writeFile(join(workspace, 'model.mjs'), model.replace("const p = await readJson('parameters.json');",
      "await arguments[0].readText('source.md'); const p = await readJson('parameters.json');"))
    expect((await command(workspace, 'model.mjs', 'source.md')).stderr).toContain('overwrite an input')
    expect(await readFile(join(workspace, 'source.md'), 'utf8')).toBe('original source')
    expect((await command(workspace, 'model.mjs', '../calculated.md')).code).toBe(1)
    const outside = await mkdtemp(join(tmpdir(), 'bgs-balance-outside-'))
    try {
      await symlink(outside, join(workspace, 'outside'))
      const result = await command(workspace, 'model.mjs', 'outside/nested/result.md')
      expect(result.stderr).toContain('escapes the workspace')
      expect(await Bun.file(join(outside, 'nested/result.md')).exists()).toBe(false)
      await symlink(join(workspace, 'source.md'), join(workspace, 'alias.md'))
      expect((await command(workspace, 'model.mjs', 'alias.md')).stderr).toContain('must not be a symlink')
    } finally { await rm(outside, { recursive: true, force: true }) }
  })
})

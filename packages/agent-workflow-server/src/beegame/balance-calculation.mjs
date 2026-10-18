import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseBeeGameContentDocument, sceneDesignSource } from './game-content-schema.ts'

const help = `Usage: bun .beegame/delivery/calculate-balance.mjs model.mjs output.md [--scenes] [--verify verifier.mjs]
       bun .beegame/delivery/calculate-balance.mjs --check-result output.md
Run from the project root. This executes project-authored code with the native tool's
permissions, not inside the BGS server or a sandbox supplied by this helper.

The model exports async calculate({readJson, readText}). Readers accept workspace-relative
paths. For the eight docs/<DESIGN_NAME>.md sources, readText returns and hashes the
body without its unique valid host-maintained Version line. readJson of content/scenes
and --scenes supply design-only Scene data: registered asset declarations and known
resource locator slots are omitted from BOTH the model input and freshness hash.
Geometry, nodes, behaviors, component parameters and unknown design fields remain.
Use readText when exact source bytes (including bindings) are required; do not mix
exact and design-only views of the same file in one calculation. Other sources use
exact bytes. The appendix states each hash's scope. Host version changes therefore
do not change a calculation's inputs; substantive source changes still do.
Use this helper only for a concrete consequential numerical or feasibility question.
Initial tuning choices do not require a model, simulation or appendix. Read current
design definitions or small source-traced inputs and record extraction assumptions.
Formal Content files are not a prerequisite; this helper is not runtime implementation.
Return {tables:[{title, columns:string[], rows:(string|number|boolean)[][]}],
checks:[{name, passed:boolean, details:string}], limitations:string[], observations?:JSON}.
Tables are generated values. State units, counting meanings, ratio bases and limits.
Static formulas or bounds do not require simulated actions. Only when claiming an
executed scenario, show relevant initial states, requests, actual constrained actions
and resulting states in observations or tables. Preserve that scope in prose.

Joint Review inspects an existing calculation against its source definitions and
actual results. No second verifier or simulator is a document requirement.
The optional --verify entry is for separately authorized code execution, not
bounded read-only Inspect/Verify. A separate module exports
async verify({tables, observations, readJson, readText}) and returns
{checks:[{name, passed:boolean, details:string}], limitations:string[]} with at least
one check. The verifier receives data snapshots, not the model's passed flags or
functions. Reconstruct expected results from source rules and actual executed
states, not requested actions or the model's derived intermediates. Record the
relevant initial/contact states, requests, constrained actions and outcomes in
observations, or explicitly identify adequate evidence already in the tables.
Do not import the model's outcome/transition functions as an independent reference.
A separate file
or all-true checks cannot automatically prove these semantic properties.
Observations use the project's own finite JSON data; no universal event schema.
The appendix records them and independent check results. Without a verifier it
explicitly says independent verification was not run; model checks are self-checks.

The helper rejects non-finite numbers, malformed tables, failed checks, changed
inputs and output/input collisions. It generates one Markdown calculation appendix
with scoped source hashes and check outcomes. Reference results actually used by
the design and rerun only after substantive model/source changes. Use readText/readJson
for dependencies, including imported model files, whose bytes must appear in the record.
For Scene feasibility use --scenes: the helper discovers every saved content/scenes/*.json
recursively and supplies scenes:[{path,document}] to calculate(). Use these actual documents,
not a second hand-maintained level table. Read rule sources and imported dependencies with
readText/readJson, include nonempty checks that distinguish the applicable rule boundaries.
This records actual inputs, not proof that a model correctly consumed them.
--check-result is read-only and never executes the model. It checks retained output,
helper/model/read dependencies and, for --scenes, current Scene membership. Fresh means
only these recorded bytes are current, not correct rules or complete dependency coverage.
Read fresh results instead of solving again; stale/unrecorded inputs require recalculation.
Unrecorded imports, a passing script and a valid table do not prove the model,
assumptions, visual quality, runtime behavior or game feel correct.`

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const designDocument = /^docs\/(?:GDD|TECHNICAL_DESIGN|ART_DIRECTION|AUDIO_DESIGN|LEVEL_SCENE_DESIGN|BALANCE_DESIGN|UI_UX_SPEC|ASSET_PLAN)\.md$/
function calculationSource(path, bytes, scope) {
  if (scope === 'scene-design-v1') {
    if (!/^content\/scenes\/.+\.json$/.test(path)) throw Error('Invalid Scene design source: ' + path)
    const doc = parseBeeGameContentDocument(JSON.parse(bytes.toString('utf8')))
    if (doc.kind !== 'scene-2d' && doc.kind !== 'scene-3d') throw Error('Expected a Scene design source: ' + path)
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value
    return { body: JSON.stringify(stable(sceneDesignSource(doc))), scope }
  }
  if (!designDocument.test(path)) return { body: bytes, scope: 'exact-bytes' }
  const body = bytes.toString('utf8')
  const version = /^[ \t]*-[ \t]*(?:Version|版本)[ \t]*[:：][ \t]*v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?)[ \t]*(?:\r?\n|$)/gim
  // Ambiguous metadata is retained rather than silently hiding source content.
  return [...body.matchAll(version)].length > 1 ? { body: bytes, scope: 'exact-bytes' }
    : { body: body.replace(version, ''), scope: 'design-body-without-version' }
}
const inside = (root, path) => {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const cell = value => String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
  .replace(/</g, '&lt;').replace(/\r?\n/g, '<br>')
const text = value => typeof value === 'string' && value.trim().length > 0

function scenePaths(root) {
  const paths = []
  const visit = directory => {
    const absolute = resolve(root, directory)
    if (realpathSync(absolute) !== absolute) throw Error('Scene directory must not be a symlink: ' + directory)
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const path = directory + '/' + entry.name
      if (entry.isSymbolicLink()) throw Error('Scene source must not be a symlink: ' + path)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.endsWith('.json')) paths.push(path)
    }
  }
  visit('content/scenes')
  if (!paths.length) throw Error('No actual saved Scene JSON in content/scenes')
  return paths.sort()
}

/** Freshness of this existing appendix only; no code execution or semantic PASS. */
export function checkCalculationResult(workspace, outputPath, helperPath = fileURLToPath(import.meta.url)) {
  const issues = []
  try {
    const root = realpathSync(workspace)
    const output = realpathSync(resolve(root, outputPath))
    if (isAbsolute(outputPath) || !inside(root, output)) throw Error('Result must be inside the workspace')
    const body = readFileSync(output, 'utf8')
    const match = /\n<!-- bgs-calculation-v1:([A-Za-z0-9+/=]+) -->\n?$/.exec(body)
    if (!match) throw Error('No retained input record; freshness is unverified')
    const record = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
    if (hash(body.slice(0, match.index)) !== record.outputDigest) issues.push('Calculation output changed')
    if (!/^[a-f0-9]{64}$/.test(record.helperDigest)) throw Error('Invalid retained calculator identity')
    if (hash(readFileSync(helperPath)) !== record.helperDigest) {
      // Tool deployment is not a design edit. Check the exact retained executable
      // without running project code or weakening any recorded input comparison.
      const archived = resolve(root, '.beegame/delivery/calculators', record.helperDigest + '.mjs')
      try {
        if (realpathSync(archived) !== archived || hash(readFileSync(archived)) !== record.helperDigest)
          throw Error('Retained calculator bytes changed')
      } catch { issues.push('Calculation helper changed and its retained version is unavailable') }
    }
    if (!Array.isArray(record.sources) || !record.sources.length) throw Error('Input record has no sources')
    for (const [path, source] of record.sources) {
      if (typeof path !== 'string' || isAbsolute(path) || !inside(root, resolve(root, path))) throw Error('Invalid retained input path')
      const actual = realpathSync(resolve(root, path))
      if (!inside(root, actual)) throw Error('Retained input escapes workspace: ' + path)
      try {
        const current = calculationSource(path, readFileSync(actual), source.scope)
        if (current.scope !== source.scope || hash(current.body) !== source.digest) issues.push('Input changed: ' + path)
      } catch (error) { issues.push('Input unavailable or invalid: ' + path + ': ' + (error instanceof Error ? error.message : String(error))) }
    }
    if (record.scenes && JSON.stringify(scenePaths(root)) !== JSON.stringify(record.scenes))
      issues.push('Saved Scene membership changed')
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)) }
  return { valid: !issues.length, scope: 'calculation-input-freshness', output: outputPath, issues,
    unverified: ['Rule correctness, actual source consumption and unrecorded dependencies remain unverified. No model executed.'] }
}

function renderChecks(checks, label, requireChecks = false) {
  if (!Array.isArray(checks) || requireChecks && !checks.length) throw new Error(`${label} requires nonempty checks`)
  for (const check of checks) {
    if (!check || !text(check.name) || typeof check.passed !== 'boolean' || !text(check.details))
      throw new Error('Each check requires a name, boolean passed and observed details')
  }
  const failures = checks.filter(check => !check.passed)
  if (failures.length) throw new Error(failures.map(check => `${label} failed: ${check.name}: ${check.details}`).join('\n'))
  return checks.map(check => `- ${cell(check.name)}: passed — ${cell(check.details)}`)
}

/** Reject values that JSON would silently drop/coerce, rather than fabricating an observation. */
function observationSnapshot(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (!value || typeof value !== 'object' || ancestors.has(value) ||
      !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new Error('Observations must be finite JSON data without cycles')
  ancestors.add(value)
  const copy = Array.isArray(value)
    ? Array.from(value, item => observationSnapshot(item, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, observationSnapshot(item, ancestors)]))
  ancestors.delete(value)
  return copy
}

function render(result, sources, independent) {
  if (!result || !Array.isArray(result.tables) || result.tables.length === 0 ||
      !Array.isArray(result.checks) || !Array.isArray(result.limitations) ||
      !result.limitations.every(text)) throw new Error('Expected tables, checks and limitations from calculate()')
  const lines = ['# Calculated balance values', '',
    'Generated by the numerical helper. Design assumptions and scenario coverage still require review.', '']
  for (const table of result.tables) {
    if (!text(table.title) || !Array.isArray(table.columns) || !table.columns.length ||
        !table.columns.every(text) || !Array.isArray(table.rows) || !table.rows.length ||
        !table.rows.every(row => Array.isArray(row) && row.length === table.columns.length && row.every(value =>
          typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))))
      throw new Error('Invalid table: require a title, columns and finite scalar cells with matching row widths')
    lines.push(`## ${cell(table.title)}`, '', `| ${table.columns.map(cell).join(' | ')} |`,
      `| ${table.columns.map(() => '---').join(' | ')} |`,
      ...table.rows.map(row => `| ${row.map(cell).join(' | ')} |`), '')
  }
  lines.push('## Scenario checks (model self-checks)', '', ...renderChecks(result.checks, 'Scenario check'))
  if (!result.checks.length) lines.push('No scenario checks supplied; simulation remains unverified.')
  lines.push('', '## Independent verification', '')
  if (independent) {
    if (!Array.isArray(independent.limitations) || !independent.limitations.every(text))
      throw new Error('Independent verification requires stated limitations')
    lines.push(...renderChecks(independent.checks, 'Independent verification', true), '',
      'Passing checks cover only the supplied evidence; verifier independence and rule coverage still require Review.',
      ...(independent.limitations.length ? independent.limitations.map(limit => `- ${cell(limit)}`)
        : ['No verifier limits supplied; this does not establish universal correctness.']))
  } else lines.push('Not run. Model-reported checks are not independent verification or proof of legal outcomes.')
  if (result.observations !== undefined) lines.push('', '## Observed transitions', '', '```json',
    JSON.stringify(observationSnapshot(result.observations), null, 2), '```')
  lines.push('', '## Limits', '', ...(result.limitations.length ? result.limitations.map(limit => `- ${cell(limit)}`)
    : ['No limits supplied; this does not establish universal correctness.']), '', '## Source identity', '',
    'Hash scope: design-body-without-version excludes the unique host-maintained Version line; exact-bytes includes every byte. Design readers return the same body used for its hash.', '',
    '| Workspace path | SHA-256 | Hash scope |', '| --- | --- | --- |',
    ...[...sources].sort(([a], [b]) => a.localeCompare(b)).map(([path, source]) => `| ${cell(path)} | ${source.digest} | ${source.scope} |`), '')
  return lines.join('\n')
}

/** Only native Agent tools invoke this function; the host never executes project models. */
export async function calculateBalance(workspace, modelPath, outputPath, verifierPath, includeScenes = false) {
  const root = await realpath(workspace)
  const sources = new Map()
  const readSource = async (path, scope) => {
    if (typeof path !== 'string' || isAbsolute(path) || !inside(root, resolve(root, path)))
      throw new Error('Calculation sources must be workspace-relative files')
    const absolute = await realpath(resolve(root, path))
    if (!inside(root, absolute)) throw new Error('Calculation source escapes the workspace')
    const bytes = await readFile(absolute)
    const name = relative(root, absolute).split(sep).join('/')
    const source = calculationSource(name, bytes, scope)
    const digest = hash(source.body)
    if (sources.has(name) && sources.get(name).scope !== source.scope) throw new Error(`Cannot mix exact and design-only Scene input views: ${name}`)
    if (sources.has(name) && sources.get(name).digest !== digest) throw new Error(`Source changed during calculation: ${name}`)
    sources.set(name, { digest, scope: source.scope })
    return source.body.toString('utf8')
  }
  const readText = path => readSource(path)
  const readJson = async path => JSON.parse(await readSource(path,
    /^content\/scenes\/.+\.json$/.test(path) ? 'scene-design-v1' : undefined))
  await readText(modelPath)
  if (verifierPath !== undefined) {
    await readText(verifierPath)
    if (await realpath(resolve(root, verifierPath)) === await realpath(resolve(root, modelPath)))
      throw new Error('Independent verifier must be a separate module from the model')
  }
  if (typeof outputPath !== 'string' || isAbsolute(outputPath) || !inside(root, resolve(root, outputPath)) || !outputPath.endsWith('.md'))
    throw new Error('Output must be a workspace-relative Markdown file')
  const output = resolve(root, outputPath)
  // Check existing ancestors before mkdir so a symlink cannot create directories outside the workspace.
  let ancestor = dirname(output)
  while (true) {
    try { ancestor = await realpath(ancestor); break }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = dirname(ancestor) }
  }
  if (ancestor !== root && !inside(root, ancestor)) throw new Error('Calculation output escapes the workspace')
  const module = await import(`${pathToFileURL(await realpath(resolve(root, modelPath))).href}?run=${randomUUID()}`)
  if (typeof module.calculate !== 'function') throw new Error('Model must export calculate({readJson, readText})')
  const paths = includeScenes ? await scenePaths(root) : undefined
  const scenes = paths ? await Promise.all(paths.map(async path => {
    const document = await readJson(path)
    if (!['scene-2d', 'scene-3d'].includes(document.kind) || !Array.isArray(document.data?.nodes))
      throw Error(path + ': expected an actual Scene document; run --check-drafts for full structure diagnostics')
    return { path, document }
  })) : undefined
  const result = await module.calculate({ readText, readJson, ...(scenes ? { scenes } : {}) })
  if (includeScenes) renderChecks(result?.checks, 'Scene rule boundary check', true)
  // Validate the model before auditing; the independent module sees only cloned
  // data, so it cannot mutate or approve the calculation's own passed flags.
  render(result, sources)
  const observations = result.observations === undefined ? undefined : observationSnapshot(result.observations)
  let independent
  if (verifierPath !== undefined) {
    const verifier = await import(`${pathToFileURL(await realpath(resolve(root, verifierPath))).href}?run=${randomUUID()}`)
    if (typeof verifier.verify !== 'function') throw new Error('Verifier must export verify({tables, observations, readJson, readText})')
    independent = await verifier.verify({ tables: structuredClone(result.tables), observations,
      readText, readJson })
    if (!independent) throw new Error('Independent verification must return checks and limitations')
  }
  let markdown = render(result, sources, independent)
  await mkdir(dirname(output), { recursive: true })
  const parent = await realpath(dirname(output))
  if (parent !== root && !inside(root, parent)) throw new Error('Calculation output escapes the workspace')
  let existingOutput
  try { existingOutput = await realpath(output) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existingOutput && existingOutput !== output) throw new Error('Calculation output must not be a symlink')
  if (sources.has(relative(root, output).split(sep).join('/'))) throw new Error('Calculation output would overwrite an input')
  for (const [path, source] of sources) {
    if (hash(calculationSource(path, await readFile(resolve(root, path)), source.scope).body) !== source.digest)
      throw new Error(`Source changed during calculation: ${path}`)
  }
  if (paths && JSON.stringify(await scenePaths(root)) !== JSON.stringify(paths)) throw Error('Saved Scene membership changed during calculation')
  const record = { helperDigest: hash(await readFile(fileURLToPath(import.meta.url))),
    outputDigest: hash(markdown), sources: [...sources], ...(paths ? { scenes: paths } : {}) }
  markdown += '\n<!-- bgs-calculation-v1:' + Buffer.from(JSON.stringify(record)).toString('base64') + ' -->\n'
  const temporary = `${output}.${randomUUID()}.tmp`
  try { await writeFile(temporary, markdown, 'utf8'); await rename(temporary, output) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return { output: outputPath, checks: result.checks.length, sources: sources.size,
    independentVerification: independent ? { status: 'passed', checks: independent.checks.length } : { status: 'not-run' } }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') console.log(help)
  else {
    try {
      if (args[0] === '--check-result' && args.length === 2) {
        const result = await checkCalculationResult(process.cwd(), args[1])
        console.log(JSON.stringify(result)); process.exitCode = result.valid ? 0 : 1
      } else {
        const [model, output, ...options] = args
        let scenes = false, verifier
        for (let i = 0; i < options.length; i++) {
          if (options[i] === '--scenes' && !scenes) scenes = true
          else if (options[i] === '--verify' && !verifier && text(options[i + 1]) && !options[i + 1].startsWith('--')) verifier = options[++i]
          else throw Error(help)
        }
        if (!text(model) || !text(output) || model.startsWith('--') || output.startsWith('--')) throw Error(help)
        console.log(JSON.stringify(await calculateBalance(process.cwd(), model, output, verifier, scenes)))
      }
    }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
  }
}
if (import.meta.main) void main()

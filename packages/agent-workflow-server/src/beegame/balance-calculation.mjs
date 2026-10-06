import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const help = `Usage: bun .beegame/delivery/calculate-balance.mjs model.mjs output.md [--verify verifier.mjs]
Run from the project root. This executes project-authored code with the native tool's
permissions, not inside the BGS server or a sandbox supplied by this helper.

The model exports async calculate({readJson, readText}). Readers accept workspace-relative
paths. For the eight docs/<DESIGN_NAME>.md sources, readText returns and hashes the
body without its unique valid host-maintained Version line; all other sources use
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
Unrecorded imports, a passing script and a valid table do not prove the model,
assumptions, visual quality, runtime behavior or game feel correct.`

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const designDocument = /^docs\/(?:GDD|TECHNICAL_DESIGN|ART_DIRECTION|AUDIO_DESIGN|LEVEL_SCENE_DESIGN|BALANCE_DESIGN|UI_UX_SPEC|ASSET_PLAN)\.md$/
function calculationSource(path, bytes) {
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

function renderChecks(checks, label, requireChecks = false) {
  if (!Array.isArray(checks) || requireChecks && !checks.length) throw new Error(`${label} requires nonempty checks`)
  return checks.map(check => {
    if (!check || !text(check.name) || typeof check.passed !== 'boolean' || !text(check.details))
      throw new Error('Each check requires a name, boolean passed and observed details')
    if (!check.passed) throw new Error(`${label} failed: ${check.name}: ${check.details}`)
    return `- ${cell(check.name)}: passed — ${cell(check.details)}`
  })
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
export async function calculateBalance(workspace, modelPath, outputPath, verifierPath) {
  const root = await realpath(workspace)
  const sources = new Map()
  const readText = async path => {
    if (typeof path !== 'string' || isAbsolute(path) || !inside(root, resolve(root, path)))
      throw new Error('Calculation sources must be workspace-relative files')
    const absolute = await realpath(resolve(root, path))
    if (!inside(root, absolute)) throw new Error('Calculation source escapes the workspace')
    const bytes = await readFile(absolute)
    const name = relative(root, absolute).split(sep).join('/')
    const source = calculationSource(name, bytes)
    const digest = hash(source.body)
    if (sources.has(name) && sources.get(name).digest !== digest) throw new Error(`Source changed during calculation: ${name}`)
    sources.set(name, { digest, scope: source.scope })
    return source.body.toString('utf8')
  }
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
  const result = await module.calculate({ readText, readJson: async path => JSON.parse(await readText(path)) })
  // Validate the model before auditing; the independent module sees only cloned
  // data, so it cannot mutate or approve the calculation's own passed flags.
  render(result, sources)
  const observations = result.observations === undefined ? undefined : observationSnapshot(result.observations)
  let independent
  if (verifierPath !== undefined) {
    const verifier = await import(`${pathToFileURL(await realpath(resolve(root, verifierPath))).href}?run=${randomUUID()}`)
    if (typeof verifier.verify !== 'function') throw new Error('Verifier must export verify({tables, observations, readJson, readText})')
    independent = await verifier.verify({ tables: structuredClone(result.tables), observations,
      readText, readJson: async path => JSON.parse(await readText(path)) })
    if (!independent) throw new Error('Independent verification must return checks and limitations')
  }
  const markdown = render(result, sources, independent)
  await mkdir(dirname(output), { recursive: true })
  const parent = await realpath(dirname(output))
  if (parent !== root && !inside(root, parent)) throw new Error('Calculation output escapes the workspace')
  let existingOutput
  try { existingOutput = await realpath(output) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existingOutput && existingOutput !== output) throw new Error('Calculation output must not be a symlink')
  if (sources.has(relative(root, output).split(sep).join('/'))) throw new Error('Calculation output would overwrite an input')
  for (const [path, source] of sources) {
    if (hash(calculationSource(path, await readFile(resolve(root, path))).body) !== source.digest)
      throw new Error(`Source changed during calculation: ${path}`)
  }
  const temporary = `${output}.${randomUUID()}.tmp`
  try { await writeFile(temporary, markdown, 'utf8'); await rename(temporary, output) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
  return { output: outputPath, checks: result.checks.length, sources: sources.size,
    independentVerification: independent ? { status: 'passed', checks: independent.checks.length } : { status: 'not-run' } }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') console.log(help)
  else if (args.length !== 2 && !(args.length === 4 && args[2] === '--verify' && text(args[3]))) { console.error(help); process.exitCode = 1 }
  else {
    try { console.log(JSON.stringify(await calculateBalance(process.cwd(), args[0], args[1], args[3]))) }
    catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 }
  }
}

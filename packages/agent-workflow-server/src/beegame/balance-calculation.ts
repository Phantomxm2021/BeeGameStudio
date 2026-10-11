import { mkdir, writeFile, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, isAbsolute, relative, resolve, sep } from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'

const inside = (root: string, path: string) => {
  const rel = relative(root, path)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Read retained dependencies without executing the model or requiring fresh inputs. */
export function readCalculationInputs(workspace: string, outputPath: string): string[] {
  const root = realpathSync(workspace), target = resolve(root, outputPath)
  if (isAbsolute(outputPath) || !inside(root, target) || realpathSync(target) !== target)
    throw Error('Result must be a non-symlink file inside the workspace')
  const body = readFileSync(target, 'utf8')
  const match = /\n<!-- bgs-calculation-v1:([A-Za-z0-9+/=]+) -->\n?$/.exec(body)
  if (!match) throw Error('No retained input record; freshness is unverified')
  const record = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
  if (createHash('sha256').update(body.slice(0, match.index)).digest('hex') !== record.outputDigest) throw Error('Calculation output changed')
  if (!Array.isArray(record.sources) || !record.sources.length) throw Error('Input record has no sources')
  return record.sources.map((entry: unknown) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw Error('Invalid retained input path')
    const [path, source] = entry, target = resolve(root, path)
    if (!source || !/^[a-f0-9]{64}$/.test(source.digest) ||
        !['exact-bytes', 'design-body-without-version', 'scene-design-v1'].includes(source.scope)) throw Error('Invalid retained input identity')
    if (isAbsolute(path) || !inside(root, target) || relative(root, target).split(sep).join('/') !== path)
      throw Error('Invalid retained input path')
    // Missing inputs still identify an affected dependency; never authorize a symlink.
    try { if (realpathSync(target) !== target) throw Error('Retained input must not be a symlink: ' + path) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return path
  })
}

export const BALANCE_CALCULATOR_PATH = '.beegame/delivery/calculate-balance.mjs'
export const SCENE_CALCULATION_INSTRUCTION = `Only for a consequential rule/feasibility question, use the existing helper: bun ${BALANCE_CALCULATOR_PATH} docs/calc/MODEL.mjs docs/calc/APPENDIX.md --scenes. It discovers saved Scene JSON and supplies calculate({scenes,readText,readJson}) with scenes:[{path,document}]. These are design-only Scene inputs: resource declarations and known locator slots are omitted from both inputs and hashes; geometry, nodes and rules are retained. Consume those documents, not a second level table. Read rule definitions and imported dependencies through the tracked readers; return tables, nonempty boundary checks and limitations (see --help). Before reusing a retained appendix, run bun ${BALANCE_CALCULATOR_PATH} --check-result docs/calc/APPENDIX.md; this only reads saved inputs, never runs the solver. Reuse fresh results, rerun affected calculations after substantive source changes. Freshness is not rule correctness or proof the model used every input. Do not create a solver just to finish the document.`
export const BALANCE_CALCULATION_INSTRUCTION = `Choose initial parameters, units, formulas and assumptions in the design. A calculation appendix or scenario model is not required merely to complete BALANCE_DESIGN.md. For a concrete consequential numerical question, use the smallest relevant calculation: bun ${BALANCE_CALCULATOR_PATH} docs/calc/MODEL.mjs docs/calc/APPENDIX.md. The helper's --help supplies input/result shapes. Trace cited inputs to current source definitions and preserve units, counting meanings, ratio bases and limitations. Calculations using a design document hash its source body without the host-maintained Version line. Scene readJson and --scenes consume and hash design-only data, excluding resource declarations and known binding slots; readText of Scene and other sources retain exact bytes. Old exact-byte records retain their original contract; do not relabel their hashes. If claiming an executed scenario, show relevant initial states, requested actions, constrained execution and resulting states; do not label a count, static bound or desired input as an observed outcome.
One joint independent Review inspects existing consequential calculations against their sources. No second verifier or simulator is required. Rerun only affected calculations after their substantive inputs change. Helper success does not establish semantic quality, fun or runtime correctness; those require the actual produced game. BGS never executes project-authored models inside its server.`

export const BALANCE_REVIEW_INSTRUCTION = (revise = false) => `Inspect existing calculations only where relevant to a consequential claim or recorded finding: read the formula, actual saved result, source definitions and stated limitations. Model self-check flags are not independent proof. Do not demand a calculation appendix or simulator for ordinary initial tuning choices.
${revise ? 'Correct only exact retained calculation files authorized in the assignment and regenerate affected results with bun ' + BALANCE_CALCULATOR_PATH + ' MODEL_PATH OUTPUT_PATH (retain --scenes for Scene calculations) under native execution permissions. Group substantive source corrections first, then rerun affected calculations; the host maintains document versions and handoff hashes. Design-source calculation identity excludes the host-maintained Version line. Do not add a verifier or simulator.' : 'Inspect/Verify remain read-only: do not execute project-authored code or regenerate appendices.'}
For a linked helper appendix, bun ${BALANCE_CALCULATOR_PATH} --check-result OUTPUT_PATH checks recorded input freshness without executing the model. A current record is not evidence of correct rules; unrecorded legacy results remain unverified, not automatically invalid prose.
If a necessary claim cannot be established from permitted evidence, report the gap and responsible owner. BGS never executes project-authored models in its server.`


/** Publish only platform tooling. Execution and authored outputs remain native Agent work. */
let calculatorSource: Promise<string> | undefined
export async function materializeBalanceCalculator(workspacePath: string): Promise<void> {
  // Bundle the shared Scene projection rather than publishing server imports or
  // keeping a second, drifting definition of what Content is allowed to bind.
  calculatorSource ??= (async () => {
    const child = Bun.spawn([process.execPath, 'build', fileURLToPath(new URL('./balance-calculation.mjs', import.meta.url)),
      '--target=bun', '--production'], { stdout: 'pipe', stderr: 'pipe' })
    const [code, source, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    if (code !== 0 || !source) throw Error('Cannot prepare balance calculator: ' + error)
    return source
  })().catch(error => { calculatorSource = undefined; throw error })
  const root = await realpath(workspacePath)
  const target = join(root, BALANCE_CALCULATOR_PATH)
  await mkdir(dirname(target), { recursive: true })
  if (await realpath(dirname(target)) !== dirname(target)) throw Error('Calculator directory must not be a symlink')
  const archive = join(dirname(target), 'calculators')
  await mkdir(archive, { recursive: true })
  if (await realpath(archive) !== archive) throw Error('Calculator archive must not be a symlink')
  const retain = async (bytes: Buffer) => {
    const path = join(archive, createHash('sha256').update(bytes).digest('hex') + '.mjs')
    try { await writeFile(path, bytes, { flag: 'wx' }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (await realpath(path) !== path || !(await readFile(path)).equals(bytes))
        throw Error('Retained calculator version changed: ' + path)
    }
  }
  const source = Buffer.from(await calculatorSource)
  try {
    if (await realpath(target) !== target) throw Error('Calculator must not be a symlink')
    const previous = await readFile(target)
    await retain(previous)
    if (previous.equals(source)) return
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  await retain(source)
  const temporary = target + '.' + randomUUID() + '.tmp'
  try { await writeFile(temporary, source, { flag: 'wx' }); await rename(temporary, target) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

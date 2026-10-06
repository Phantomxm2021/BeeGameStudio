import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const BALANCE_CALCULATOR_PATH = '.beegame/delivery/calculate-balance.mjs'
export const BALANCE_CALCULATION_INSTRUCTION = `Choose initial parameters, units, formulas and assumptions in the design. A calculation appendix or scenario model is not required merely to complete BALANCE_DESIGN.md. For a concrete consequential numerical question, use the smallest relevant calculation: bun ${BALANCE_CALCULATOR_PATH} docs/calc/MODEL.mjs docs/calc/APPENDIX.md. The helper's --help supplies input/result shapes. Trace cited inputs to current source definitions and preserve units, counting meanings, ratio bases and limitations. Calculations using a design document hash its source body without the host-maintained Version line; other sources bind exact bytes. If claiming an executed scenario, show relevant initial states, requested actions, constrained execution and resulting states; do not label a count, static bound or desired input as an observed outcome.
One joint independent Review inspects existing consequential calculations against their sources. No second verifier or simulator is required. Rerun only affected calculations after their substantive inputs change. Helper success does not establish semantic quality, fun or runtime correctness; those require the actual produced game. BGS never executes project-authored models inside its server.`

export const BALANCE_REVIEW_INSTRUCTION = (revise = false) => `Inspect existing calculations only where relevant to a consequential claim or recorded finding: read the formula, actual saved result, source definitions and stated limitations. Model self-check flags are not independent proof. Do not demand a calculation appendix or simulator for ordinary initial tuning choices.
${revise ? 'Correct only exact retained calculation files authorized in the assignment and regenerate affected results with bun ' + BALANCE_CALCULATOR_PATH + ' MODEL_PATH OUTPUT_PATH under native execution permissions. Group substantive source corrections first, then rerun affected calculations; the host maintains document versions and handoff hashes. Design-source calculation identity excludes the host-maintained Version line. Do not add a verifier or simulator.' : 'Inspect/Verify remain read-only: do not execute project-authored code or regenerate appendices. Read bun ' + BALANCE_CALCULATOR_PATH + ' --help only for a specific interface question.'}
If a necessary claim cannot be established from permitted evidence, report the gap and responsible owner. BGS never executes project-authored models in its server.`


/** Publish only platform tooling. Execution and authored outputs remain native Agent work. */
export async function materializeBalanceCalculator(workspacePath: string): Promise<void> {
  const target = join(workspacePath, BALANCE_CALCULATOR_PATH)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, await readFile(new URL('./balance-calculation.mjs', import.meta.url)), 'utf8')
}

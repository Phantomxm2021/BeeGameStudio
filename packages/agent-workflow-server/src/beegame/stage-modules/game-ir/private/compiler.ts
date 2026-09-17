import { resolve } from 'node:path'
import type { FoundationIrInput } from '../input'
import { parseGameIrCompileRequest, type GameIrReadyReceipt } from './core/contracts'
import { canonicalGameIrJson, digestGameIrValue, type GameIrCandidate } from './core/model'
import type { GameIrCompilationIdentity } from './core/protocol'
import { foundationReadyReceiptFromInput } from './core/source-input'
import { admitDirectGameIrDraft, renderDirectGameIrAuthority, renderDirectGameIrInputFiles,
  renderDirectGameIrRepairAuthority, type DirectGameIrAuthority } from './direct-authority'
import { commitDirectGameIrPublication, validateDirectGameIrPublication } from './direct-publication'
import { durableWrite, readFile } from './files'

type ExecuteKind = 'compile'
export type GameIrExecute = (input: { kind: ExecuteKind; prompt: string; outputFormat: 'json';
  readOnlyFiles?: Readonly<Record<string, string>>; signal?: AbortSignal }) => Promise<string>
export type GameIrCompilerEvent = Readonly<{ step: 'direct'; domain: 'all'; mode: 'compile' | 'publication';
  elapsed: number; status: 'started' | 'completed' | 'diagnostic' | 'cancelled' }>
export type GameIrCompilerDiagnostic = Readonly<{ schemaVersion: 'game-ir-compiler-diagnostic.v1'; recoverable: boolean;
  step: 'direct'; domain: 'all'; mode: 'compile'; reason: string; outputDigest?: string }>
export type GameIrCompileInput = Readonly<{ workspacePath: string; identity: GameIrCompilationIdentity;
  foundationInput: FoundationIrInput; execute: GameIrExecute; signal?: AbortSignal; onEvent?: (event: GameIrCompilerEvent) => void }>
export type GameIrCompileResult = Readonly<
  | { status: 'ready'; closure: { candidate: GameIrCandidate }; readyReceipt: GameIrReadyReceipt; authority: DirectGameIrAuthority }
  | { status: 'needs_action'; diagnostic: GameIrCompilerDiagnostic }
>
type State = Readonly<{ schemaVersion: 'game-ir-direct-compiler-state.v2'; identity: GameIrCompilationIdentity;
  failure?: { diagnostic: string; draft: string };
  ready?: { receipt: GameIrReadyReceipt; authority: DirectGameIrAuthority } }>

function pathOf(input: Pick<GameIrCompileInput, 'workspacePath' | 'identity'>): string {
  return resolve(input.workspacePath, '.beegame', '.game-ir-private', 'direct-compiler-v2', `${digestGameIrValue(input.identity)}.json`)
}
function requestFor(input: GameIrCompileInput) {
  const foundation = foundationReadyReceiptFromInput(input.foundationInput)
  if (input.identity.taskId.length === 0 || input.identity.publicationId.length === 0 ||
      input.identity.foundationRevision !== foundation.foundationRevision ||
      input.identity.foundationReadyReceiptDigest !== foundation.receiptDigest ||
      input.identity.confirmedBriefDigest !== foundation.confirmedBriefDigest)
    throw new Error('Game IR compilation identity is detached from accepted Foundation input')
  return parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v2', taskId: input.identity.taskId,
    publicationId: input.identity.publicationId, gameIrSchemaVersion: 'game-ir.v2', foundation })
}
async function load(input: Pick<GameIrCompileInput, 'workspacePath' | 'identity'>): Promise<State> {
  try {
    const state = JSON.parse(await readFile(pathOf(input), 'utf8')) as State
    if (state.schemaVersion !== 'game-ir-direct-compiler-state.v2' ||
        canonicalGameIrJson(state.identity) !== canonicalGameIrJson(input.identity)) throw new Error('direct compiler state is invalid')
    return state
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return { schemaVersion: 'game-ir-direct-compiler-state.v2', identity: input.identity }
  }
}
const save = (input: GameIrCompileInput, state: State) => durableWrite(pathOf(input), `${canonicalGameIrJson(state)}\n`)
function diagnostic(reason: string, output?: string): GameIrCompileResult {
  return { status: 'needs_action', diagnostic: { schemaVersion: 'game-ir-compiler-diagnostic.v1', recoverable: true,
    step: 'direct', domain: 'all', mode: 'compile', reason,
    ...(output === undefined ? {} : { outputDigest: digestGameIrValue(output) }) } }
}

/** One direct CLI generation followed by deterministic host validation. */
export async function compileGameIr(input: GameIrCompileInput): Promise<GameIrCompileResult> {
  const started = performance.now(), request = requestFor(input)
  let state = await load(input)
  if (state.ready) {
    const published = await validateDirectGameIrPublication({ workspacePath: input.workspacePath,
      publicationId: input.identity.publicationId, ...state.ready.authority })
    return { status: 'ready', closure: { candidate: published.candidate }, readyReceipt: published.ready,
      authority: state.ready.authority }
  }
  if (input.signal?.aborted) { input.onEvent?.({ step: 'direct', domain: 'all', mode: 'compile',
    elapsed: performance.now() - started, status: 'cancelled' }); throw Object.assign(new Error('Game IR compilation was cancelled'), { name: 'AbortError' }) }
  input.onEvent?.({ step: 'direct', domain: 'all', mode: 'compile', elapsed: performance.now() - started, status: 'started' })
  const priorFailure = state.failure
  const prompt = priorFailure
    ? renderDirectGameIrRepairAuthority({ diagnostic: priorFailure.diagnostic })
    : renderDirectGameIrAuthority({ request })
  const readOnlyFiles = {
    ...renderDirectGameIrInputFiles(),
    ...(priorFailure ? {
      'previous-output.txt': priorFailure.draft,
      'validation-error.txt': `${priorFailure.diagnostic}\n`,
    } : {}),
  }
  const output = await input.execute({ kind: 'compile', prompt, readOnlyFiles, outputFormat: 'json', ...(input.signal ? { signal: input.signal } : {}) })
  let candidate: GameIrCandidate
  try {
    if (input.signal?.aborted) throw Object.assign(new Error('Game IR compilation was cancelled'), { name: 'AbortError' })
    candidate = admitDirectGameIrDraft({ draft: JSON.parse(output), request })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    const reason = error instanceof Error ? error.message : String(error)
    state = { schemaVersion: 'game-ir-direct-compiler-state.v2', identity: input.identity,
      failure: { diagnostic: reason, draft: output } }
    await save(input, state)
    input.onEvent?.({ step: 'direct', domain: 'all', mode: 'compile', elapsed: performance.now() - started, status: 'diagnostic' })
    return diagnostic(reason, output)
  }

  const authority: DirectGameIrAuthority = { request, candidate }
  input.onEvent?.({ step: 'direct', domain: 'all', mode: 'publication', elapsed: performance.now() - started, status: 'started' })
  const receipt = await commitDirectGameIrPublication({ workspacePath: input.workspacePath,
    publicationId: input.identity.publicationId, ...authority })
  state = { schemaVersion: 'game-ir-direct-compiler-state.v2', identity: input.identity,
    ready: { receipt, authority } }
  await save(input, state)
  input.onEvent?.({ step: 'direct', domain: 'all', mode: 'publication', elapsed: performance.now() - started, status: 'completed' })
  return { status: 'ready', closure: { candidate }, readyReceipt: receipt, authority }
}

export async function loadGameIrCompilerAuthority(input: Pick<GameIrCompileInput, 'workspacePath' | 'identity'>): Promise<DirectGameIrAuthority> {
  const state = await load(input)
  if (!state.ready) throw new Error('Game IR direct compiler authority is unavailable')
  return state.ready.authority
}

/** Publish an explicitly supplied correction without running a model or changing source documents. */
export async function publishGameIrCorrection(input: GameIrCompileInput, draft: unknown): Promise<GameIrReadyReceipt> {
  const request = requestFor(input)
  const candidate = admitDirectGameIrDraft({ draft, request })
  const authority = { request, candidate }
  const receipt = await commitDirectGameIrPublication({ workspacePath: input.workspacePath,
    publicationId: input.identity.publicationId, ...authority })
  await save(input, { schemaVersion: 'game-ir-direct-compiler-state.v2', identity: input.identity,
    ready: { receipt, authority } })
  return receipt
}

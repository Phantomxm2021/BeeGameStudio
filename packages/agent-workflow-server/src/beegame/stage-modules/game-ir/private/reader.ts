import type { FoundationIrInput } from '../input'
import type { GameIrReadyReceipt } from './core/contracts'
import { canonicalGameIrJson, type GameIrCandidate } from './core/model'
import { foundationReadyReceiptFromInput } from './core/source-input'
import type { DirectGameIrAuthority } from './direct-authority'
import { validateDirectGameIrPublication } from './direct-publication'

export type GameIrPublishedView = Readonly<{ input: FoundationIrInput; ready: GameIrReadyReceipt; candidate: GameIrCandidate }>

/** Public reads always revalidate the immutable direct publication and its accepted Foundation binding. */
export async function readPublishedGameIr(input: { workspacePath: string; foundationInput: FoundationIrInput;
  ready: GameIrReadyReceipt; authority: DirectGameIrAuthority }): Promise<GameIrPublishedView> {
  const foundation = foundationReadyReceiptFromInput(input.foundationInput)
  if (canonicalGameIrJson(input.authority.request.foundation) !== canonicalGameIrJson(foundation))
    throw new Error('Published IR source does not match the accepted Foundation result')
  const published = await validateDirectGameIrPublication({ workspacePath: input.workspacePath,
    publicationId: input.ready.publicationId, ...input.authority })
  if (canonicalGameIrJson(published.ready) !== canonicalGameIrJson(input.ready))
    throw new Error('Published IR receipt does not match committed artifacts')
  return Object.freeze({ input: input.foundationInput, ready: published.ready, candidate: published.candidate })
}

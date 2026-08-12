export type ProviderTerminalEvent =
  | Readonly<{ type: 'message_start' }>
  | Readonly<{
      type: 'content_block_start'
      index: number
      contentType: string
    }>
  | Readonly<{ type: 'input_json_delta'; index: number; bytes: number }>
  | Readonly<{ type: 'content_block_stop'; index: number }>
  | Readonly<{ type: 'message_delta'; stopReason: string | null }>
  | Readonly<{ type: 'message_stop' }>

export type ProviderStreamEvidence = Readonly<{
  requestId: string
  sawMessageStart: boolean
  sawMessageStop: boolean
  stopReason: string | null
  openToolJsonBlockIndexes: readonly number[]
  eventCount: number
  inputJsonBytes: number
}>

export class ProviderStreamIncompleteError extends Error {
  readonly retryable = true

  constructor(readonly evidence: ProviderStreamEvidence) {
    super(
      `Provider response ended without a terminal message: ${evidence.requestId}`,
    )
    this.name = 'ProviderStreamIncompleteError'
  }
}

export function createProviderStreamTerminality(input: {
  requestId: string
}): {
  observe(event: ProviderTerminalEvent): void
  completeBody(): ProviderStreamEvidence
} {
  let sawMessageStart = false
  let sawMessageStop = false
  let stopReason: string | null = null
  let eventCount = 0
  let inputJsonBytes = 0
  const openToolJsonBlockIndexes = new Set<number>()

  const evidence = (): ProviderStreamEvidence =>
    Object.freeze({
      requestId: input.requestId,
      sawMessageStart,
      sawMessageStop,
      stopReason,
      openToolJsonBlockIndexes: Object.freeze(
        [...openToolJsonBlockIndexes].sort((left, right) => left - right),
      ),
      eventCount,
      inputJsonBytes,
    })

  return {
    observe(event): void {
      eventCount += 1
      switch (event.type) {
        case 'message_start':
          sawMessageStart = true
          return
        case 'content_block_start':
          if (event.contentType === 'tool_use')
            openToolJsonBlockIndexes.add(event.index)
          return
        case 'input_json_delta':
          inputJsonBytes += event.bytes
          return
        case 'content_block_stop':
          openToolJsonBlockIndexes.delete(event.index)
          return
        case 'message_delta':
          stopReason = event.stopReason
          return
        case 'message_stop':
          sawMessageStop = true
          return
      }
    },
    completeBody(): ProviderStreamEvidence {
      const finalEvidence = evidence()
      if (
        !finalEvidence.sawMessageStart ||
        !finalEvidence.sawMessageStop ||
        !finalEvidence.stopReason ||
        finalEvidence.openToolJsonBlockIndexes.length > 0
      )
        throw new ProviderStreamIncompleteError(finalEvidence)
      return finalEvidence
    },
  }
}

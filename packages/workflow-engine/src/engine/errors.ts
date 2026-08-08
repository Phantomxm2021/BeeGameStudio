/** Engine-level expected errors (script errors, caps, nesting). */
export class WorkflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowError'
  }
}

/** Journal corruption or I/O is a terminal persistence error, never an empty resume. */
export class WorkflowJournalError extends WorkflowError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'WorkflowJournalError'
    if (options?.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
  }
}

/** workflow was aborted (killed). */
export class WorkflowAbortedError extends Error {
  constructor() {
    super('workflow has been aborted')
    this.name = 'WorkflowAbortedError'
  }
}

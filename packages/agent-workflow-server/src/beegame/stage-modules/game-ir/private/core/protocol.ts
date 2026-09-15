export type GameIrCompilationIdentity = Readonly<{
  runId: string; taskId: string; publicationId: string; confirmedBriefDigest: string
  foundationRevision: string; foundationReadyReceiptDigest: string
}>

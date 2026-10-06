import { designReviewResultSchema, type DesignReviewReceiptContext } from './design-review-result'

/** The existing Author-2 writing owners; this is dispatch, not a quality gate. */
export const NATIVE_DIRECTION_AUTHORS = [
  { document: 'TECHNICAL_DESIGN.md', agentType: 'bgs-technical-baseline',
    skills: ['gameplay-programmer'] },
  { document: 'ART_DIRECTION.md', agentType: 'bgs-art-direction',
    skills: ['game-art-director-expert', 'game-feel-designer'] },
  { document: 'AUDIO_DESIGN.md', agentType: 'bgs-audio-design',
    skills: ['game-audio-designer'] },
] as const

// Reuse native assignments for the existing writing roles. Coupled batches are
// ordered by their real dependency, not a new review or coordinator stage.
export const NATIVE_WRITING_AUTHOR_BATCHES = {
  1: NATIVE_DIRECTION_AUTHORS,
  2: [
    { document: 'LEVEL_SCENE_DESIGN.md', agentType: 'bgs-level-design', skills: ['game-level-designer-expert'] },
    { document: 'BALANCE_DESIGN.md', agentType: 'bgs-balance-design', skills: ['game-balance-designer-expert'] },
  ],
  3: [{ document: 'UI_UX_SPEC.md', agentType: 'bgs-ui-design', skills: ['game-ui-ux-designer'] }],
  4: [
    { document: 'ASSET_PLAN.md', agentType: 'bgs-asset-plan', skills: ['game-content-pipeline-engineer'] },
    { document: 'TECHNICAL_DESIGN.md', agentType: 'bgs-technical-completion', skills: ['gameplay-programmer'] },
  ],
} as const

export type NativeWritingBatch = keyof typeof NATIVE_WRITING_AUTHOR_BATCHES
export type NativeDirectionDocument = typeof NATIVE_WRITING_AUTHOR_BATCHES[NativeWritingBatch][number]['document']

export function nativeWritingAuthors(batch: NativeWritingBatch = 1) {
  return NATIVE_WRITING_AUTHOR_BATCHES[batch]
}

export function isNativeWritingAuthor(agentType: string) {
  return Object.values(NATIVE_WRITING_AUTHOR_BATCHES).some(authors => authors.some(author => author.agentType === agentType))
}

/** Trusted per-turn BGS metadata. Not inferred from a document or user prose. */
export type NativeProjectTurnInput = {
  restartContext: boolean
  reviewDocuments?: string[]
  reviewContextPath?: string
  reviewStep?: 'inspect' | 'revise' | 'verify'
  reviewResultPath?: string
  reviewWorkspace?: string
  reviewWritableDocuments?: string[]
  reviewWritableFiles?: string[]
  reviewReceiptContext?: DesignReviewReceiptContext
}

export function parseNativeProjectTurn(value: unknown): NativeProjectTurnInput | undefined {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid BGS project turn')
  const input = value as Record<string, unknown>
  if (typeof input.restartContext !== 'boolean' || input.reviewDocuments !== undefined &&
      (!Array.isArray(input.reviewDocuments) || input.reviewDocuments.length === 0 ||
       input.reviewDocuments.some(name => typeof name !== 'string' || !/^[A-Z][A-Z_]+\.md$/.test(name)) ||
       new Set(input.reviewDocuments).size !== input.reviewDocuments.length) ||
      (input.reviewContextPath !== undefined &&
       (!input.reviewDocuments || typeof input.reviewContextPath !== 'string' || !input.reviewContextPath.trim())))
    throw new Error('Invalid BGS project turn')
  if (input.reviewStep !== undefined && (!input.reviewDocuments || !['inspect', 'revise', 'verify'].includes(String(input.reviewStep)) ||
      typeof input.reviewResultPath !== 'string' || !input.reviewResultPath.trim() || typeof input.reviewWorkspace !== 'string' || !input.reviewWorkspace.trim() ||
      !Array.isArray(input.reviewWritableDocuments) || input.reviewWritableDocuments.some(name => typeof name !== 'string' || !/^[A-Z][A-Z_]+\.md$/.test(name))))
    throw new Error('Invalid BGS bounded review input')
  if (input.reviewWritableFiles !== undefined && (!Array.isArray(input.reviewWritableFiles) ||
      input.reviewWritableFiles.some(path => typeof path !== 'string' || path.split('/').includes('..') ||
        !/^(?:content\/ui\/[A-Za-z0-9_./-]+\.json|docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js|json|md)|docs\/visual\/(?:ART_DIRECTION|UI_UX_SPEC)\/[A-Za-z0-9_./-]+\.(?:html|svg|png|jpg|jpeg|webp)|\.beegame\/design-handoffs\/[A-Z][A-Z_]+\.json)$/.test(path))))
    throw new Error('Invalid BGS revision file scope')
  if (input.reviewStep !== undefined) {
    const context = input.reviewReceiptContext as DesignReviewReceiptContext | undefined
    if (!context || context.step !== input.reviewStep ||
        !designReviewResultSchema.safeParse({ step: context.step, findings: context.findings, resolved: [] }).success ||
        !context.sourceHeadings || typeof context.sourceHeadings !== 'object' || Array.isArray(context.sourceHeadings) ||
        Object.entries(context.sourceHeadings).some(([name, headings]) => !/^[A-Z][A-Z_]+\.md$/.test(name) ||
          !Array.isArray(headings) || headings.some(heading => typeof heading !== 'string')))
      throw new Error('Invalid BGS review receipt context')
  }
  if (input.reviewStep === undefined && [input.reviewResultPath, input.reviewWorkspace, input.reviewWritableDocuments, input.reviewWritableFiles, input.reviewReceiptContext].some(value => value !== undefined))
    throw new Error('Invalid BGS bounded review input')
  return input as NativeProjectTurnInput
}

/** Private native stdin metadata supplied by BGS, never inferred from user prose. */
export type NativeDirectionAuthorInput = {
  batch?: NativeWritingBatch
  contextPath: string
  contextPaths?: Partial<Record<NativeDirectionDocument, string>>
  responsibilities: Partial<Record<NativeDirectionDocument, string>>
}

export function parseNativeDirectionAuthors(value: unknown): NativeDirectionAuthorInput | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid BGS direction-author input')
  const input = value as Record<string, unknown>
  if (typeof input.contextPath !== 'string' || !input.contextPath.trim() ||
      !input.responsibilities || typeof input.responsibilities !== 'object' ||
      Array.isArray(input.responsibilities))
    throw new Error('Invalid BGS direction-author context')
  if (input.batch !== undefined && ![1, 2, 3, 4].includes(input.batch as number))
    throw new Error('Invalid BGS writing batch')
  const authors = nativeWritingAuthors((input.batch ?? 1) as NativeWritingBatch)
  const assigned = new Set<string>(authors.map(author => author.document))
  const responsibilities = input.responsibilities as Record<string, unknown>
  if (Object.keys(responsibilities).some(name => !assigned.has(name)))
    throw new Error('Unassigned BGS author responsibility')
  for (const { document } of authors) {
    if (typeof responsibilities[document] !== 'string' || !responsibilities[document].trim())
      throw new Error('Missing BGS author responsibility: ' + document)
  }
  if (input.contextPaths !== undefined) {
    if (!input.contextPaths || typeof input.contextPaths !== 'object' || Array.isArray(input.contextPaths))
      throw new Error('Invalid BGS scoped author contexts')
    if (Object.keys(input.contextPaths).some(name => !assigned.has(name))) throw new Error('Unassigned BGS author context')
    for (const { document } of authors) {
      const path = (input.contextPaths as Record<string, unknown>)[document]
      if (typeof path !== 'string' || !path.trim()) throw new Error('Missing BGS scoped author context: ' + document)
    }
  }
  return input as NativeDirectionAuthorInput
}

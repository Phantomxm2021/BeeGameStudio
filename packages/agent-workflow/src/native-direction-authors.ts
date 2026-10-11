import { PROJECT_DOCUMENTS, designReviewResultSchema, designUserDecisionSchema, type DesignReviewReceiptContext } from './design-review-result'
import { productionDesignBaselineSchema, type ProductionDesignBaseline } from './production-check-input'

/** Native plugins namespace their commands. BGS selects its explicit catalog;
 * unqualified names remain accepted for already-created task fixtures. */
export function bgsBuiltinSkillName(name: string, available: readonly string[]): string {
  const qualified = 'bgs-builtins:' + name
  return available.includes(qualified) ? qualified : name
}

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

export function nativeWritingAuthorDocument(agentType: string) {
  return Object.values(NATIVE_WRITING_AUTHOR_BATCHES).flat().find(author => author.agentType === agentType)?.document
}

export function nativeWritingAuthorBatch(agentType: string): number | undefined {
  const entry = Object.entries(NATIVE_WRITING_AUTHOR_BATCHES).find(([, authors]) => authors.some(author => author.agentType === agentType))
  return entry ? Number(entry[0]) : undefined
}

/** Trusted per-turn BGS metadata. Not inferred from a document or user prose. */
export type NativeProjectTurnInput = {
  production?: { phase: 'resources' | 'content'; contextPath: string; inputRevision: string
    resourceContextPaths?: Partial<Record<'visual' | 'audio', string>> }
  /** Exact current-turn handoff, supplied by the host rather than copied from prose. */
  milestoneResult?: { phase: 'author' | 'resources' | 'content' | 'implementation'; path: string
    objective?: string
    /** Existing host baseline, not model-authored completion evidence. */
    designBaseline?: ProductionDesignBaseline }
  /** Only the initial GDD is authored in the main native turn. */
  authorDocument?: 'GDD.md'
  /** Legacy metadata is accepted but never controls native history or caches. */
  restartContext?: boolean
  reviewDocuments?: string[]
  reviewReadScope?: Record<string, string[] | null>
  reviewContextPath?: string
  reviewStep?: 'inspect' | 'revise' | 'verify'
  reviewResultPath?: string
  reviewWorkspace?: string
  reviewSettings?: { orientation?: unknown; dimension?: unknown }
  reviewWritableDocuments?: string[]
  reviewWritableFiles?: string[]
  reviewRevision?: string
  reviewUserDecisions?: import('./design-review-result').DesignUserDecision[]
  reviewReceiptContext?: DesignReviewReceiptContext
}

export function parseNativeProjectTurn(value: unknown): NativeProjectTurnInput | undefined {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid BGS project turn')
  const input = value as Record<string, unknown>
  if (input.milestoneResult !== undefined) {
    const receipt = input.milestoneResult as Record<string, unknown>
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) ||
        !['author', 'resources', 'content', 'implementation'].includes(String(receipt.phase)) ||
        typeof receipt.path !== 'string' || !receipt.path.startsWith('/') ||
        receipt.path.split('/').includes('..') || !/\/\.beegame\/tmp\/[^/]+\/milestone-[A-Za-z0-9-]+\.txt$/.test(receipt.path) ||
        Object.keys(receipt).some(key => !['phase', 'path', 'designBaseline', 'objective'].includes(key)) ||
        receipt.objective !== undefined && typeof receipt.objective !== 'string' || input.reviewDocuments !== undefined ||
        input.authorDocument !== undefined && receipt.phase !== 'author' ||
        input.production !== undefined && (input.production as Record<string, unknown>)?.phase !== receipt.phase)
      throw new Error('Invalid BGS milestone result input')
    if (receipt.designBaseline !== undefined) {
      const baseline = receipt.designBaseline as NonNullable<NonNullable<NativeProjectTurnInput['milestoneResult']>['designBaseline']>
      if (receipt.phase === 'author' || !productionDesignBaselineSchema.safeParse(baseline).success)
        throw new Error('Invalid BGS milestone design baseline')
    }
  }
  if (input.production !== undefined) {
    const p = input.production as Record<string, unknown>
    if (!p || typeof p !== 'object' || Array.isArray(p) || (p.phase !== 'resources' && p.phase !== 'content') ||
        typeof p.contextPath !== 'string' || !p.contextPath.trim() || typeof p.inputRevision !== 'string' ||
        !/^[a-f0-9]{64}$/.test(p.inputRevision) || input.authorDocument || input.reviewDocuments)
      throw new Error('Invalid BGS production task')
    if (p.resourceContextPaths !== undefined &&
        (p.phase !== 'resources' || !p.resourceContextPaths || typeof p.resourceContextPaths !== 'object' ||
          Array.isArray(p.resourceContextPaths) || Object.entries(p.resourceContextPaths).some(([group, path]) =>
            !['visual', 'audio'].includes(group) || typeof path !== 'string' || !path.trim())))
      throw new Error('Invalid BGS resource group context')
  }
  if (input.reviewSettings !== undefined && (!input.reviewDocuments || !input.reviewSettings || typeof input.reviewSettings !== 'object' || Array.isArray(input.reviewSettings)))
    throw new Error('Invalid BGS review settings')
  if (input.authorDocument !== undefined && (input.authorDocument !== 'GDD.md' || input.reviewDocuments !== undefined))
    throw new Error('Invalid BGS author document')
  if (input.restartContext !== undefined && typeof input.restartContext !== 'boolean' || input.reviewDocuments !== undefined &&
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
  if (input.reviewReadScope !== undefined) {
    const scope = input.reviewReadScope
    if (!input.reviewStep || !scope || typeof scope !== 'object' || Array.isArray(scope) ||
        Object.entries(scope).some(([name, sections]) => !PROJECT_DOCUMENTS.some(document => document === name) ||
          sections !== null && (!Array.isArray(sections) || sections.some(section => typeof section !== 'string' || !section.trim()))))
      throw new Error('Invalid BGS review read scope')
  }
  if (input.reviewWritableFiles !== undefined) {
    if (!Array.isArray(input.reviewWritableFiles)) throw new Error('Invalid BGS revision file scope')
    for (const path of input.reviewWritableFiles) {
      // Both owner-linked Scene and UI sources are authorized by the host.
      // This accepts exact JSON files, not a directory grant or package index.
      if (typeof path !== 'string' || path.split('/').includes('..') ||
          !/^(?:content\/(?:ui|scenes)\/[A-Za-z0-9_./-]+\.json|docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js|json|md)|docs\/visual\/(?:ART_DIRECTION|UI_UX_SPEC)\/[A-Za-z0-9_./-]+\.(?:html|svg|png|jpg|jpeg|webp)|\.beegame\/design-handoffs\/[A-Z][A-Z_]+\.json)$/.test(path))
        throw new Error(`Invalid BGS revision file scope: ${JSON.stringify(path)}`)
    }
  }
  if (input.reviewStep !== undefined) {
    const context = input.reviewReceiptContext as DesignReviewReceiptContext | undefined
    if (!context || context.step !== input.reviewStep ||
        context.combined !== undefined && typeof context.combined !== 'boolean' ||
        context.affectedChange !== undefined && typeof context.affectedChange !== 'boolean' ||
        context.nextConsumers !== undefined && (!Array.isArray(context.nextConsumers) || !context.nextConsumers.length ||
          context.nextConsumers.some(name => ![...PROJECT_DOCUMENTS, 'resources', 'content', 'implementation', 'acceptance'].includes(name))) ||
        !designReviewResultSchema.safeParse({ step: context.step, findings: context.findings, resolved: [] }).success ||
        !context.sourceHeadings || typeof context.sourceHeadings !== 'object' || Array.isArray(context.sourceHeadings) ||
        Object.entries(context.sourceHeadings).some(([name, headings]) => !/^[A-Z][A-Z_]+\.md$/.test(name) ||
          !Array.isArray(headings) || headings.some(heading => typeof heading !== 'string')))
      throw new Error('Invalid BGS review receipt context')
    if (input.reviewRevision !== undefined && (typeof input.reviewRevision !== 'string' || !input.reviewRevision.trim()) ||
        input.reviewUserDecisions !== undefined && (!Array.isArray(input.reviewUserDecisions) ||
          input.reviewUserDecisions.some(value => !designUserDecisionSchema.safeParse(value).success || value.revision !== input.reviewRevision ||
            !context.findings.some(f => f.id === value.id && f.action === 'decide'))))
      throw new Error('Invalid BGS review user decisions')
  }
  if (input.reviewStep === undefined && [input.reviewResultPath, input.reviewWorkspace, input.reviewWritableDocuments, input.reviewWritableFiles, input.reviewReceiptContext, input.reviewRevision, input.reviewUserDecisions].some(value => value !== undefined))
    throw new Error('Invalid BGS bounded review input')
  return input as NativeProjectTurnInput
}

/** Host workflow assignment; never inferred from user prose. */
export type NativeDirectionAuthorInput = {
  batch?: NativeWritingBatch
  /** Stable original inputs, excluding this batch's own mutable outputs. */
  inputRevision?: string
  contextPath: string
  contextPaths?: Partial<Record<NativeDirectionDocument, string>>
  responsibilities: Partial<Record<NativeDirectionDocument, string>>
}

export function parseNativeDirectionAuthors(value: unknown): NativeDirectionAuthorInput | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid BGS direction-author input')
  const input = value as Record<string, unknown>
  if (input.inputRevision !== undefined && (typeof input.inputRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.inputRevision)))
    throw new Error('Invalid BGS author input revision')
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

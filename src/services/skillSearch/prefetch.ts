import type { Attachment } from '../../utils/attachments.js'
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { DiscoverySignal } from './signals.js'
import { isSkillSearchEnabled } from './featureCheck.js'
import {
  getSkillIndex,
  searchSkills,
  type SearchResult,
  type SkillIndexEntry,
} from './localSearch.js'
import { logForDebugging } from '../../utils/debug.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'

/**
 * Discovery dedup uses context.discoveredSkillNames, which belongs to the
 * current session. Gap-signal dedup remains process-local and bounded.
 *
 * FIFO eviction by insertion order — once the cap is hit, the oldest
 * entries roll off and may be re-recorded, which is the correct degraded
 * behaviour: at worst we re-emit a duplicate gap signal,
 * never silently drop a real one.
 */
const SESSION_TRACKING_MAX = 1000
const SESSION_TRACKING_TRIM_TO = 750
const recordedGapSignals = new Set<string>()

function addBoundedSessionEntry(set: Set<string>, value: string): void {
  set.add(value)
  if (set.size > SESSION_TRACKING_MAX) {
    const toDrop = set.size - SESSION_TRACKING_TRIM_TO
    const iter = set.values()
    for (let i = 0; i < toDrop; i++) {
      const next = iter.next()
      if (next.done) break
      set.delete(next.value)
    }
  }
}

const AUTO_LOAD_MIN_SCORE = Number(
  process.env.SKILL_SEARCH_AUTOLOAD_MIN_SCORE ?? '0.30',
)
const AUTO_LOAD_LIMIT = Number(process.env.SKILL_SEARCH_AUTOLOAD_LIMIT ?? '2')
const AUTO_LOAD_MAX_CHARS = Number(
  process.env.SKILL_SEARCH_AUTOLOAD_MAX_CHARS ?? '12000',
)

export function extractQueryFromMessages(
  input: string | null,
  messages: Message[],
): string {
  const parts: string[] = []

  if (input) parts.push(input)

  // Within a long turn, the agent's latest visible progress is more specific
  // than the original user request. Tool results and thinking are not intent.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>
    if (msg.type !== 'user' && (input || msg.type !== 'assistant')) continue
    const content =
      msg.type === 'assistant'
        ? (msg.message as Record<string, unknown> | undefined)?.content
        : msg.content
    if (typeof content === 'string') {
      if (content.trim()) {
        parts.push(content.slice(0, 500))
        break
      }
    }
    if (Array.isArray(content)) {
      const textBlocks: string[] = []
      for (const block of content) {
        const entry = block as Record<string, unknown>
        // Never search tool output, tool arguments, or private thinking.
        if (entry.type && entry.type !== 'text') continue
        if (typeof entry.text === 'string' && entry.text.trim())
          textBlocks.push(entry.text.slice(0, 500))
      }
      if (textBlocks.length > 0) {
        parts.push(textBlocks.join(' ').slice(0, 1000))
        break
      }
    }
  }

  return parts.join(' ')
}

function buildDiscoveryAttachment(
  skills: SkillDiscoveryResult[],
  signal: DiscoverySignal,
  gap?: SkillDiscoveryGap,
  catalogFallback = false,
): Attachment {
  return {
    type: 'skill_discovery',
    skills,
    signal,
    source: 'native',
    gap,
    catalogFallback,
  } as Attachment
}

function selectSkillDiscovery(
  query: string,
  index: SkillIndexEntry[],
): { results: SearchResult[]; catalogFallback: boolean } {
  const direct = searchSkills(query, index)
  // A relevant recommendation need not be confident enough to auto-load.
  // The agent remains free to invoke it or ignore it.
  if (index.length > 0 && direct.length === 0) {
    return { results: [], catalogFallback: true }
  }
  return { results: direct, catalogFallback: false }
}

const CATALOG_MAX_CHARS = 8_000
const CATALOG_MAX_DESCRIPTION_CHARS = 160

function catalogCandidates(index: SkillIndexEntry[]): SkillDiscoveryResult[] {
  const namesLength = index.reduce((length, skill) => length + skill.name.length + 4, 0)
  const descriptionLength = Math.max(0, Math.min(
    CATALOG_MAX_DESCRIPTION_CHARS,
    Math.floor((CATALOG_MAX_CHARS - namesLength) / index.length),
  ))
  return index.map(skill => ({
    name: skill.name,
    description: skill.description.replace(/\s+/g, ' ').slice(0, descriptionLength),
  }))
}

function catalogKey(index: SkillIndexEntry[]): string {
  return `\u0000skill-catalog:${index.map(skill => skill.name).join('\u001f')}`
}

type SkillDiscoveryResult = {
  name: string
  description: string
  shortId?: string
  score?: number
  autoLoaded?: boolean
  content?: string
  path?: string
}

type SkillDiscoveryGap = {
  key: string
  status: 'pending' | 'draft' | 'active'
  draftName?: string
  draftPath?: string
  activeName?: string
  activePath?: string
}

async function enrichResultsForAutoLoad(
  results: SearchResult[],
  context: ToolUseContext,
): Promise<SkillDiscoveryResult[]> {
  let loadedCount = 0
  const enriched: SkillDiscoveryResult[] = []

  for (const result of results) {
    const base: SkillDiscoveryResult = {
      name: result.name,
      description: result.description,
      score: result.score,
    }

    if (loadedCount >= AUTO_LOAD_LIMIT || result.score < AUTO_LOAD_MIN_SCORE) {
      enriched.push(base)
      continue
    }

    const loaded = await loadSkillContent(result)
    if (!loaded) {
      enriched.push(base)
      continue
    }

    loadedCount++
    await markAutoLoadedSkill(result.name, loaded.path, loaded.content, context)
    enriched.push({
      ...base,
      autoLoaded: true,
      content: loaded.content,
      path: loaded.path,
    })
  }

  return enriched
}

async function loadSkillContent(
  result: SearchResult,
): Promise<{ path: string; content: string } | null> {
  if (!result.skillRoot) return null

  const candidates = [
    join(result.skillRoot, 'SKILL.md'),
    join(result.skillRoot, 'skill.md'),
  ]

  for (const path of candidates) {
    try {
      const raw = await readFile(path, 'utf8')
      return {
        path,
        content: parseFrontmatter(raw).content.slice(0, AUTO_LOAD_MAX_CHARS),
      }
    } catch {
      // Try next candidate.
    }
  }
  return null
}

async function markAutoLoadedSkill(
  name: string,
  path: string,
  content: string,
  context: ToolUseContext,
): Promise<void> {
  try {
    const { addInvokedSkill } = await import('../../bootstrap/state.js')
    addInvokedSkill(name, path, content, context.agentId ?? null)
  } catch {
    // Best effort only.
  }
}

async function maybeRecordSkillGap(
  queryText: string,
  results: SearchResult[],
  context: ToolUseContext,
  trigger: DiscoverySignal['trigger'],
): Promise<SkillDiscoveryGap | undefined> {
  if (trigger !== 'user_input') return undefined
  if (!queryText.trim()) return undefined

  const gapSignalKey = `${trigger}:${queryText.trim().toLowerCase()}`
  if (recordedGapSignals.has(gapSignalKey)) return undefined
  addBoundedSessionEntry(recordedGapSignals, gapSignalKey)

  try {
    const [{ isSkillLearningEnabled }, { recordSkillGap }] = await Promise.all([
      import('../skillLearning/featureCheck.js'),
      import('../skillLearning/skillGapStore.js'),
    ])
    if (!isSkillLearningEnabled()) return undefined
    const gap = await recordSkillGap({
      prompt: queryText,
      cwd:
        ((context as Record<string, unknown>).cwd as string) ?? process.cwd(),
      sessionId:
        ((context as Record<string, unknown>).sessionId as string) ??
        'unknown-session',
      recommendations: results,
    })
    const status = gap.status
    if (status !== 'pending' && status !== 'draft' && status !== 'active') {
      return undefined
    }
    return {
      key: gap.key,
      status,
      draftName: gap.draft?.name,
      draftPath: gap.draft?.skillPath,
      activeName: gap.active?.name,
      activePath: gap.active?.skillPath,
    }
  } catch (error) {
    logForDebugging(`[skill-search] skill gap learning error: ${error}`)
    return undefined
  }
}

export async function startSkillDiscoveryPrefetch(
  input: string | null,
  messages: Message[],
  toolUseContext: ToolUseContext,
): Promise<Attachment[]> {
  if (!isSkillSearchEnabled()) return []

  const startedAt = Date.now()
  const queryText = extractQueryFromMessages(input, messages)
  if (!queryText.trim()) return []

  try {
    const cwd =
      ((toolUseContext as Record<string, unknown>).cwd as string) ??
      process.cwd()
    const index = await getSkillIndex(cwd)
    const { results, catalogFallback } = selectSkillDiscovery(queryText, index)

    if (catalogFallback) {
      const key = catalogKey(index)
      if (toolUseContext.discoveredSkillNames?.has(key)) return []
      toolUseContext.discoveredSkillNames?.add(key)
      const signal: DiscoverySignal = {
        trigger: 'assistant_turn',
        queryText: queryText.slice(0, 200),
        startedAt,
        durationMs: Date.now() - startedAt,
        indexSize: index.length,
        method: 'catalog',
      }
      return [buildDiscoveryAttachment(catalogCandidates(index), signal, undefined, true)]
    }

    const newResults = results.filter(r => !toolUseContext.discoveredSkillNames?.has(r.name))
    if (newResults.length === 0) return []

    for (const r of newResults)
      toolUseContext.discoveredSkillNames?.add(r.name)

    const signal: DiscoverySignal = {
      trigger: 'assistant_turn',
      queryText: queryText.slice(0, 200),
      startedAt,
      durationMs: Date.now() - startedAt,
      indexSize: index.length,
      method: 'tfidf',
    }

    logForDebugging(
      `[skill-search] prefetch found ${newResults.length} skills in ${signal.durationMs}ms`,
    )

    return [
      buildDiscoveryAttachment(
        await enrichResultsForAutoLoad(newResults, toolUseContext),
        signal,
      ),
    ]
  } catch (error) {
    logForDebugging(`[skill-search] prefetch error: ${error}`)
    return []
  }
}

export async function getTurnZeroSkillDiscovery(
  input: string,
  _messages: Message[],
  context: ToolUseContext,
): Promise<Attachment | null> {
  if (!isSkillSearchEnabled()) return null
  if (!input.trim()) return null

  const startedAt = Date.now()

  try {
    const cwd =
      ((context as Record<string, unknown>).cwd as string) ?? process.cwd()
    const index = await getSkillIndex(cwd)
    const { results, catalogFallback } = selectSkillDiscovery(input, index)
    const key = catalogFallback ? catalogKey(index) : undefined
    if (key && context.discoveredSkillNames?.has(key)) return null
    const enriched = catalogFallback
      ? catalogCandidates(index)
      : await enrichResultsForAutoLoad(results, context)
    const gap = catalogFallback || enriched.some(result => result.autoLoaded)
      ? undefined
      : await maybeRecordSkillGap(input, results, context, 'user_input')

    if (enriched.length === 0 && !gap) return null

    if (key) context.discoveredSkillNames?.add(key)
    else for (const r of results) context.discoveredSkillNames?.add(r.name)

    const signal: DiscoverySignal = {
      trigger: 'user_input',
      queryText: input.slice(0, 200),
      startedAt,
      durationMs: Date.now() - startedAt,
      indexSize: index.length,
      method: catalogFallback ? 'catalog' : 'tfidf',
    }

    logForDebugging(
      `[skill-search] turn-zero surfaced ${enriched.length} skills in ${signal.durationMs}ms`,
    )

    return buildDiscoveryAttachment(enriched, signal, gap, catalogFallback)
  } catch (error) {
    logForDebugging(`[skill-search] turn-zero error: ${error}`)
    return null
  }
}

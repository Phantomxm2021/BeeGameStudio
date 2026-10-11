import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { constants } from 'node:fs'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { parseDesignCalculationCommand } from '@bee-game-studio/agent-workflow/design-calculation-command'
import { validateDesignReviewReceipt, requiredDesignUserDecisions, designReviewQuestionIds, designReviewQuestionFindings, designReviewResultSchema } from '@bee-game-studio/agent-workflow/design-review-result'
import { checkDesignHandoffDraft, designReviewSourceHeadings } from './design-handoff'
import { checkDesignDocumentReferences } from './design-document-references'
import type { DashboardPermissionRequest, DashboardPermissionDecision } from './session-manager'
import { isDeepStrictEqual } from 'node:util'
type Broker = (request: DashboardPermissionRequest) => Promise<DashboardPermissionDecision>
type Policy = (request: DashboardPermissionRequest) => Promise<DashboardPermissionDecision | undefined>
export type ReviewPolicyState = { findings: NonNullable<NativeProjectTurnInput['reviewReceiptContext']>['findings']; decisions: string[] }

/** Business authorization evaluated by BGS before standard stdio permissions.
 * It cannot bypass the native OS sandbox or replace native tool executors. */
export async function designReviewReference(skillRoot: string | undefined, documents: readonly string[]) {
  if (!skillRoot) throw new Error('Required BGS review Skill has no reference directory')
  const path = join(skillRoot, 'references/document-checks.md')
  const body = await readFile(path, 'utf8')
  const sections = body.split(/(?=^## )/m)
  const selected = [...new Set(documents)].map(name => {
    const section = sections.find(section => section.startsWith('## ' + name + '\n'))
    if (!section?.trim()) throw new Error('Required BGS review method section is unavailable: ' + name)
    return section.trim()
  })
  return `Loaded game-design-check methods from ${path} (not ownership or a quality verdict):\n\n` + selected.join('\n\n')
}

// Write creates parent directories for an exactly authorized missing layout output.
// Resolve existing ancestors first; a missing folder must not hide a symlink.
async function canonicalWriteTarget(path: string): Promise<string> {
  try { return join(await realpath(dirname(path)), basename(path)) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try {
      if ((await lstat(dirname(path))).isSymbolicLink()) throw new Error('Dangling parent symlink')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return join(await canonicalWriteTarget(dirname(path)), basename(path))
  }
}

export function reviewToolPolicy(turn: NativeProjectTurnInput, original: Broker, saved?: ReviewPolicyState, changed: (state: ReviewPolicyState) => Promise<void> = async () => {}): Policy {
  const initial = turn.reviewReceiptContext?.findings ?? []
  if (saved && (!designReviewResultSchema.safeParse({ step: turn.reviewStep, findings: saved.findings, resolved: [] }).success ||
      initial.some(old => !saved.findings.some(f => isDeepStrictEqual(f, old))) || !Array.isArray(saved.decisions) ||
      saved.decisions.some(id => typeof id !== 'string' || !saved.findings.some(f => f.id === id && f.action === 'decide'))))
    throw Error('Invalid saved Review authorization state')
  const decisions = new Set([...(saved?.decisions ?? []), ...(turn.reviewUserDecisions ?? []).filter(d => d.revision === turn.reviewRevision).map(d => d.id)])
  let findings = saved?.findings ?? initial
  const unanswered = () => requiredDesignUserDecisions(findings, turn.reviewReceiptContext?.nextConsumers).filter(f => !decisions.has(f.id))
  const bounded: Policy = async request => {
    const tool = { name: request.toolName }, input = request.input
    const deny = (message = 'Outside the current bounded BGS design review step.') => Promise.resolve({ behavior: 'deny' as const, message,
      source: 'policy' as const })
    if (tool.name === 'AskUserQuestion') {
      if (turn.reviewStep !== 'revise' || !turn.reviewRevision || input.answers !== undefined)
        return deny('Only revision may ask a version-bound design question; model-supplied answers are not user direction.')
      try {
        if (!turn.reviewReceiptContext) return deny('Design question requires its source context.')
        const proposalPath = turn.reviewResultPath! + '.decision-findings.json'
        let added: unknown = []
        try {
          const file = await open(proposalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
          try {
            const info = await file.stat()
            if (!info.isFile() || info.size > 1024 * 1024) throw Error('Invalid decision proposal file')
            added = JSON.parse(await file.readFile('utf8'))
          } finally { await file.close() }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
        const additions = designReviewResultSchema.shape.findings.parse(added)
        for (const finding of additions) {
          const old = findings.find(f => f.id === finding.id)
          if (old && !isDeepStrictEqual(old, finding)) return deny('A decision proposal cannot redefine a recorded finding.')
        }
        const headers = new Set((input.questions as Array<{ header: string }> ?? []).map(q => q.header))
        const enriched = { ...input, metadata: { ...(input.metadata as Record<string, unknown> ?? {}),
          designFindings: additions.filter(f => !findings.some(old => old.id === f.id) && headers.has(f.id)) } }
        const proposed = designReviewQuestionFindings(enriched, { ...turn.reviewReceiptContext, findings,
          ...(turn.reviewReceiptContext.combined && turn.reviewStep === 'revise'
            ? { sourceHeadings: designReviewSourceHeadings(turn.reviewWorkspace!, Object.keys(turn.reviewReceiptContext.sourceHeadings)) } : {}),
        })
        const ids = designReviewQuestionIds(input, proposed)
        if (ids.some(id => decisions.has(id))) return deny('This finding already has a retained user answer; use it without asking again.')
        const questionInput: Record<string, unknown> = { ...enriched, metadata: { ...(enriched.metadata as Record<string, unknown>),
          designFindings: proposed.filter(f => !initial.some(old => old.id === f.id) && headers.has(f.id)),
          source: 'bgs-design-review:' + turn.reviewRevision } }
        findings = proposed
        await changed({ findings, decisions: [...decisions] })
                // Even permissive configurations/hooks must use the interactive broker.
        const result = await original({ ...request, input: questionInput, message: 'Answer the required design decision.' })
        if (result.behavior !== 'allow') return result
        if (result.source !== 'user')
          return deny('Design questions require the interactive user response, not a rule, hook or automatic approval.')
        const answered = result.updatedInput
        const answers = answered?.answers
        if (!answered || JSON.stringify(answered.questions) !== JSON.stringify(questionInput.questions) ||
            JSON.stringify(answered.metadata) !== JSON.stringify(questionInput.metadata) || !answers || typeof answers !== 'object' || Array.isArray(answers))
          return deny('No validated user answer was returned for this design question.')
        const questions = questionInput.questions as Array<{ question: string }>
        const entries = Object.entries(answers)
        if (entries.length !== questions.length || entries.some(([key, value]) =>
          !questions.some(q => q.question === key) || typeof value !== 'string' || !value.trim()))
          return deny('Answer every design question; empty/default permission approval is not a decision.')
        findings = proposed
        ids.forEach(id => decisions.add(id))
        await changed({ findings, decisions: [...decisions] })
        const { designFindings: _hostOnly, ...metadata } = answered.metadata as Record<string, unknown>
        return { ...result, updatedInput: { ...answered, metadata } }
      } catch (error) { return deny(error instanceof Error ? error.message : 'Invalid design question.') }
    } else if (['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'].includes(tool.name)) {
      // Existing permissions still adjudicate source access/network requests.
    } else if (tool.name === 'Bash') {
      if (!await allowedReviewCommand(String(input.command ?? ''), turn))
        return deny('BGS review permits read-only checker commands, the supplied static Art/UI sample capture command and, in revise only, the numerical helper with exact authorized model/output paths, from this project root. Run: bun .beegame/delivery/check-content.mjs --help, or use the supplied static-sample signature and current Preview URL. Remove echo, pipes, redirects, scripts and other shell commands. This is a command-scope rejection, not a tool outage.')
      if (turn.reviewStep === 'revise' && unanswered().length && /calculate-balance\.mjs (?!\-\-(?:help|check-result)\b)/.test(String(input.command)))
        return deny('Obtain the required user answers before changing revision sources or evidence.')
    } else if (['Write', 'Edit'].includes(tool.name)) {
      if (!turn.reviewWorkspace || !turn.reviewResultPath || typeof input.file_path !== 'string') return deny()
      const path = resolve(turn.reviewWorkspace, input.file_path)
      try {
        const target = await canonicalWriteTarget(path)
        const root = await realpath(turn.reviewWorkspace)
        const part = relative(root, target)
        if (part === '..' || part.startsWith('../') || isAbsolute(part)) return deny()
        const receipt = join(await realpath(dirname(turn.reviewResultPath)), basename(turn.reviewResultPath))
        const allowed = [receipt, ...(turn.reviewStep === 'revise' ? [receipt + '.decision-findings.json'] : []), ...(turn.reviewStep === 'revise'
          ? [...(turn.reviewWritableDocuments ?? []).map(name => join(root, 'docs', name)), ...(turn.reviewWritableFiles ?? []).map(file => resolve(root, file))] : [])]
        if (!allowed.includes(target)) {
          // A mistyped receipt name is a rejected target, not invalid JSON or
          // evidence that the saved corrections must be undone.
          if (dirname(target) === dirname(receipt)) return deny(
            'Review receipt path mismatch. Expected Write.file_path: ' + JSON.stringify(receipt) +
            '; received workspace-relative path: ' + JSON.stringify(part) +
            '. Copy the exact expected path and resubmit the same receipt with Write. ' +
            'No file was written or receipt content validated. Do not undo document corrections, probe directories or rerun unchanged checks.')
          return deny()
        }
        try { if (await realpath(path) !== target) return deny() } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return deny()
          try { if ((await lstat(path)).isSymbolicLink()) return deny() }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return deny() }
        }
        if (target === receipt) {
          if (tool.name !== 'Write' || typeof input.content !== 'string' || !turn.reviewReceiptContext)
            return deny('Submit the entire Review receipt with Write, using first line complete or blocked followed by the review JSON. Partial receipt edits are not supported.')
          // Joint review can legitimately rename a heading before it records a
          // newly found/repaired issue. Validate its resulting saved location,
          // exactly as the host does; recorded old findings remain immutable.
          const issues = validateDesignReviewReceipt(input.content, { ...turn.reviewReceiptContext, findings,
            ...(turn.reviewReceiptContext.combined && turn.reviewStep === 'revise'
              ? { sourceHeadings: designReviewSourceHeadings(root, Object.keys(turn.reviewReceiptContext.sourceHeadings)) } : {}),
          })
          if (issues.length) return deny('Review receipt not saved:\n' + issues.join('\n') +
            '\nCorrect the listed receipt fields and resubmit with Write in this same step. Do not rerun unchanged checks. Tool failures belong in the normal reply, not fabricated design-document findings; resolved contains only recorded finding IDs.')
          const [status, ...json] = input.content.trim().split(/\r?\n/)
          const pending = requiredDesignUserDecisions(designReviewResultSchema.parse(JSON.parse(json.join('\n'))).findings, turn.reviewReceiptContext?.nextConsumers).filter(f => !decisions.has(f.id))
          if (turn.reviewStep === 'revise' && status === 'complete' && pending.length)
            return deny('Revision cannot complete without actual user answers for: ' + pending.map(f => f.id).join(', '))
          if (turn.reviewStep === 'revise' && status === 'complete') {
            // Reuse the read-only draft validators at the existing receipt
            // boundary. Host versions/hashes are finalized only after this step;
            // neither a model claim nor legacy speculation bypasses saved shape.
            try {
              const diagnostics = [...new Set(turn.reviewWritableDocuments ?? [])].flatMap(name => [
                ...checkDesignHandoffDraft(root, name, { finalTechnical: name === 'TECHNICAL_DESIGN.md' }).issues,
                ...checkDesignDocumentReferences(root, undefined, name).issues,
              ])
              if (turn.reviewWritableDocuments?.some(name => name === 'UI_UX_SPEC.md' || name === 'LEVEL_SCENE_DESIGN.md')) {
                // Layout initializes WASM asynchronously; keep it out of the
                // native tool registry's synchronous require dependency graph.
                const { checkReviewDesignLayouts } = await import('./design-layout-check')
                diagnostics.push(...checkReviewDesignLayouts(root, turn.reviewSettings).issues)
              }
              if (diagnostics.length) return deny('Revision receipt not saved: saved draft checks failed:\n' + diagnostics.join('\n') +
                '\nCorrect these saved sources within the authorized scope and resubmit in this same revision step. Use the supplied index contract; an absent version is not legacy compatibility. Do not repeat unchanged semantic review, undo valid corrections or invent findings for format errors. If required evidence or authority is unavailable, submit blocked with the actual limitation.')
            } catch (error) {
              return deny('Revision receipt not saved: saved draft checks could not complete: ' +
                (error instanceof Error ? error.message : String(error)) + '. Report the actual limitation; do not claim complete.')
            }
          }
        } else if (target !== receipt + '.decision-findings.json' && unanswered().length) {
          return deny('Obtain the required user answers before changing revision sources: ' + unanswered().map(f => f.id).join(', '))
        }
      } catch { return deny() }
    } else return deny()
    return ['Write', 'Edit', 'Bash'].includes(tool.name) ? { behavior: 'allow', source: 'policy' } : undefined
  }
  return bounded
}

// Recognize only a harmless cwd prefix; this is not a general shell parser.
async function allowedReviewCommand(command: string, turn: NativeProjectTurnInput) {
  const workspace = turn.reviewWorkspace
  if (!workspace) return false
  const prefix = /^cd (?:'([^']+)'|"([^"$`\\]+)"|([A-Za-z0-9_./-]+)) && (.+)$/.exec(command)
  if (prefix) {
    const path = prefix[1] ?? prefix[2] ?? prefix[3]!
    try { if (await realpath(resolve(workspace, path)) !== await realpath(workspace)) return false }
    catch { return false }
    command = prefix[4]!
  }
  if (/^bun \.beegame\/delivery\/(?:check-content\.mjs(?: [A-Za-z0-9_./~-]+)*|calculate-balance\.mjs --help)$/.test(command)) return true
  const freshness = /^bun \.beegame\/delivery\/calculate-balance\.mjs --check-result (docs\/calc\/[A-Za-z0-9_./-]+\.md)$/.exec(command)
  if (freshness) return !freshness[1]!.split('/').includes('..')
  const sample = /^node \.beegame\/delivery\/inspect-design\.mjs --visual-sample (docs\/visual\/(ART_DIRECTION|UI_UX_SPEC)\/[A-Za-z0-9_./-]+\.(?:html|svg)) ([1-9][0-9]*) ([1-9][0-9]*)(?: --preview-api http:\/\/127\.0\.0\.1:[0-9]+\/[a-f0-9]{64})?$/.exec(command)
  if (sample) {
    if (sample[1]!.split('/').includes('..') || Number(sample[3]) > 16384 || Number(sample[4]) > 16384) return false
    const assigned = turn.reviewStep === 'inspect' ? turn.reviewDocuments : Object.keys(turn.reviewReceiptContext?.sourceHeadings ?? {})
    return Boolean(assigned?.includes(sample[2] + '.md'))
  }
  if (turn.reviewStep !== 'revise') return false
  const calculation = parseDesignCalculationCommand(command)
  if (!calculation) return false
  let canonicalWorkspace: string
  try { canonicalWorkspace = await realpath(workspace) } catch { return false }
  for (const path of [calculation.model, calculation.output]) {
    if (!path || !(turn.reviewWritableFiles ?? []).includes(path)) return false
    try { if (await realpath(resolve(canonicalWorkspace, path)) !== resolve(canonicalWorkspace, path)) return false }
    catch { return false }
  }
  return true
}



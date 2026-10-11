import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { NativeProjectTurnInput } from '@bee-game-studio/agent-workflow/native-direction-authors'
import type { DashboardSDKMessage } from './session-manager'
import { designDocumentSections, designSectionHashes } from './design-document-sections'

const normalize = (text: string) => text.replace(/^\uFEFF/, '').replace(/\r(?=\n|$)/g, '').trimEnd()
const hash = (text: string) => createHash('sha256').update(normalize(text)).digest('hex')
type Range = { start: number; end: number; hash: string }
export type ReviewReadState = {
  initial: Record<string, Record<string, string> | undefined>
  files: Record<string, { full?: string; ranges: Range[] }>
}

/** Observe actual public SDK reads, not inherited native cache entries, Write
 * calls, model claims or SDK side-data that was never exposed to the model. */
export class ReviewSourceExposure {
  private calls = new Map<string, { name: string; input: Record<string, unknown> }>()
  constructor(private root: string, private turn: NativeProjectTurnInput, readonly state: ReviewReadState) {}

  static async create(root: string, turn: NativeProjectTurnInput, saved?: ReviewReadState) {
    const instance = new ReviewSourceExposure(root, turn, saved ?? { initial: {}, files: {} })
    if (!saved) for (const name of instance.documents()) {
      instance.state.initial[name] = await instance.source(name).then(designSectionHashes).catch(() => undefined)
    }
    return instance
  }
  private documents() { return [...new Set([...(this.turn.reviewDocuments ?? []), ...Object.keys(this.turn.reviewReadScope ?? {})])] }
  private async source(name: string) {
    const path = resolve(this.root, 'docs', name)
    if (await realpath(path) !== path) throw Error('Review source must use its exact saved file')
    return readFile(path, 'utf8')
  }
  async observe(message: DashboardSDKMessage) {
    const content = (message.message as any)?.content
    if (!Array.isArray(content) || message.parent_tool_use_id != null) return
    if (message.type === 'assistant') {
      for (const block of content) if (block.type === 'tool_use' && ['Read', 'Edit'].includes(block.name))
        this.calls.set(block.id, { name: block.name, input: block.input })
      return
    }
    if (message.type !== 'user') return
    for (const block of content) {
      if (block.type !== 'tool_result') continue
      const call = this.calls.get(block.tool_use_id)
      this.calls.delete(block.tool_use_id)
      if (!call || block.is_error) continue
      const data = message.tool_use_result as any
      const path = data?.file?.filePath ?? data?.filePath
      if (typeof path !== 'string' || typeof call.input.file_path !== 'string') continue
      // macOS exposes /var and /private/var aliases for the same workspace.
      // Match the observed tool and saved source by actual path, not spelling;
      // source() still rejects a symlinked document itself.
      const [actual, requested] = await Promise.all([path, call.input.file_path].map(value =>
        realpath(resolve(this.root, value)).catch(() => undefined)))
      if (!actual || actual !== requested) continue
      const name = this.documents().find(name => actual === resolve(this.root, 'docs', name))
      if (!name) continue
      const current = await this.source(name).catch(() => undefined)
      if (current === undefined) continue
      const row = this.state.files[name] ??= { ranges: [] }
      if (call.name === 'Edit') {
        const original = data.originalFile, old = data.oldString, next = data.newString
        // Only a successfully executed, model-requested exact edit can carry
        // forward previously complete inspection. Whole-file replacement can't.
        if (!data.userModified && typeof original === 'string' && typeof old === 'string' && old &&
            typeof next === 'string' && old === call.input.old_string && next === call.input.new_string &&
            hash(original) === row.full && hash(old) !== hash(original)) {
          const reconstructed = data.replaceAll ? original.split(old).join(next) : original.replace(old, next)
          if (reconstructed === current) row.full = hash(current)
        }
        continue
      }
      if (data?.type !== 'text' || typeof data.file?.content !== 'string') continue
      const start = data.file.startLine === 0 ? 1 : data.file.startLine
      const count = data.file.numLines
      if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(count) || count < 1) continue
      const lines = current.replace(/^\uFEFF/, '').replace(/\r(?=\n|$)/g, '').split('\n')
      const end = start + count - 1
      if (end > lines.length || hash(lines.slice(start - 1, end).join('\n')) !== hash(data.file.content)) continue
      const visible = typeof block.content === 'string' ? block.content : Array.isArray(block.content)
        ? block.content.filter((v: any) => v.type === 'text').map((v: any) => v.text).join('\n') : ''
      const exposed = new Map<number, string>()
      for (const line of visible.split('\n')) {
        const match = /^\s*(\d+)[→\t](.*)$/.exec(line)
        if (match) exposed.set(Number(match[1]), match[2]!)
      }
      if (lines.slice(start - 1, end).some((line, i) => exposed.get(start + i) !== line)) continue
      row.ranges = [...row.ranges.filter(range => range.start !== start || range.end !== end),
        { start, end, hash: hash(lines.slice(start - 1, end).join('\n')) }]
      if (start === 1 && end === lines.length) row.full = hash(current)
    }
  }
  async check() {
    const missing: string[] = [], versions: Array<[string, string]> = []
    for (const name of this.documents()) {
      try {
        const content = await this.source(name), version = hash(content)
        versions.push([name, version])
        const row = this.state.files[name]
        if (row?.full === version) continue
        const sections = designDocumentSections(content), initial = this.state.initial[name]
        const requested = this.turn.reviewReadScope?.[name]
        let fullReason = requested == null ? 'complete saved source' :
          !initial || Object.keys(initial).join('\n') !== sections.map(section => section.heading).join('\n')
            ? 'source headings unavailable, removed or reordered; remaining resulting-file lines' : undefined
        const selected = new Set(requested ?? [])
        if (!fullReason && initial) for (const section of sections)
          if (initial[section.heading] !== section.hash) selected.add(section.heading)
        if (!fullReason) for (const heading of selected) if (sections.filter(section => section.heading === heading).length !== 1) {
          fullReason = 'missing/ambiguous source heading: ' + heading + '; remaining resulting-file lines'; break
        }
        const lines = content.replace(/^\uFEFF/, '').replace(/\r(?=\n|$)/g, '').split('\n')
        const ranges = (row?.ranges ?? []).filter(range => range.start > 0 && range.end >= range.start &&
          range.end <= lines.length && hash(lines.slice(range.start - 1, range.end).join('\n')) === range.hash)
          .sort((a, b) => a.start - b.start)
        const targets = fullReason ? [{ start: 1, end: lines.length, heading: fullReason }]
          : sections.filter(section => selected.has(section.heading)).sort((a, b) => a.start - b.start)
        const required: Array<{ start: number; end: number; heading: string }> = []
        for (const target of targets) {
          const last = required.at(-1)
          if (last && target.start <= last.end) last.end = Math.max(last.end, target.end)
          else required.push({ ...target })
        }
        for (const section of required) {
          let next = section.start
          for (const range of ranges) {
            if (range.end < next || range.start > section.end) continue
            if (range.start > next) missing.push('docs/' + name + ':' + next + '-' + Math.min(range.start - 1, section.end) + ' (' + section.heading + ')')
            next = Math.max(next, range.end + 1)
            if (next > section.end) break
          }
          if (next <= section.end) missing.push('docs/' + name + ':' + next + '-' + section.end + ' (' + section.heading + ')')
        }
      } catch { versions.push([name, 'unavailable']); missing.push('docs/' + name) }
    }
    return { missing, revision: createHash('sha256').update(JSON.stringify(versions)).digest('hex') }
  }
}


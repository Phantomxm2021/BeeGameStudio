import { createHash } from 'node:crypto'
import {
  FOUNDATION_FACT_CATALOG,
  foundationFactDefinition,
  isFoundationFactKey,
  type FoundationFactDefinition,
  type FoundationFactKey,
} from './foundation-fact-definitions'
import {
  createFoundationFactStore,
  digestFactStore,
  type FactValue,
  type FoundationFact,
} from './foundation-fact-store'
import type {
  FoundationSectionIndex,
  SectionRef,
} from './foundation-section-index'
import type { FoundationDocumentPath } from './types'

type DocumentInput = ReadonlyMap<string, string> | Record<string, string>

export type FoundationFactEvidence = {
  documentPath: FoundationDocumentPath
  sectionId: string
  startLine: number
  endLine: number
  digest: string
}

export type FoundationFactReceipt = {
  key: FoundationFactKey
  status: 'present' | 'absent' | 'uncertain'
  value?: FactValue
  evidence?: FoundationFactEvidence
  reason?: string
}

export type NormalizedFoundationExtraction = {
  facts: FoundationFact[]
  receipts: FoundationFactReceipt[]
  unresolvedKeys: FoundationFactKey[]
  normalizedFactDigest: string
}

export type FoundationFactPacketSection = SectionRef & { text: string }

export type FoundationFactPacket = {
  revision: string
  keys: FoundationFactKey[]
  sections: FoundationFactPacketSection[]
  bytesUtf8: number
  packetDigest: string
}

type ResultInput = FoundationFactReceipt & {
  status: 'present' | 'absent' | 'uncertain'
}

function mapDocuments(input: DocumentInput): Map<string, string> {
  return input instanceof Map ? new Map(input) : new Map(Object.entries(input))
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function sectionText(markdown: string, section: SectionRef): string {
  const lines = markdown.split('\n')
  if (
    section.startLine < 1 ||
    section.endLine < section.startLine ||
    section.endLine > lines.length + 1
  )
    throw new Error(
      `section line bounds are invalid: ${section.documentPath}#${section.sectionId}`,
    )
  return lines.slice(section.startLine - 1, section.endLine).join('\n')
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function aliasesFor(key: FoundationFactKey): string[] {
  const [domain, ...rest] = key.split('.')
  const snake = rest.join('_')
  const spaced = rest.join(' ')
  const camel = rest
    .map((part, index) =>
      index === 0 ? part : part[0]!.toUpperCase() + part.slice(1),
    )
    .join('')
  return [
    key,
    `${domain}_${snake}`,
    `${domain}.${snake}`,
    `${rest.join('.')}`,
    snake,
    spaced,
    camel,
  ]
}

function valueFromText(
  raw: string,
  definition: FoundationFactDefinition,
): FactValue | undefined {
  let value = raw
    .trim()
    .replace(/\s*\|\s*$/, '')
    .replace(/\s+<!--.*-->\s*$/, '')
    .trim()
  if (!value) return undefined
  if (
    (value.startsWith('`') && value.endsWith('`')) ||
    (value.startsWith('"') && value.endsWith('"'))
  )
    value = value.slice(1, -1).trim()
  if (definition.valueType === 'number') {
    const number = Number(value.replace(/[, ]/g, ''))
    return Number.isFinite(number) ? number : undefined
  }
  if (definition.valueType === 'boolean') {
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
  }
  if (definition.valueType === 'string') return value
  if (definition.valueType === 'number[]') {
    const values = splitList(value).map(item =>
      Number(item.replace(/[, ]/g, '')),
    )
    return values.length && values.every(Number.isFinite) ? values : undefined
  }
  const values = splitList(value)
  return values.length ? values : undefined
}

function splitList(value: string): string[] {
  const unwrapped =
    value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
  if (!unwrapped.trim()) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed))
      return parsed.map(item => String(item).trim()).filter(Boolean)
  } catch {
    // Markdown lists are intentionally parsed below.
  }
  return unwrapped
    .split(/[,;\n]/)
    .map(item =>
      item
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^['"]|['"]$/g, ''),
    )
    .filter(Boolean)
}

function findCandidate(
  text: string,
  key: FoundationFactKey,
  definition: FoundationFactDefinition,
  section: SectionRef,
): { value: FactValue; evidence: FoundationFactEvidence } | undefined {
  const lines = text.split('\n')
  const aliases = aliasesFor(key).sort(
    (left, right) => right.length - left.length,
  )
  for (const [offset, line] of lines.entries()) {
    const absoluteLine = section.startLine + offset
    const cells = line
      .split('|')
      .map(cell => cell.trim())
      .filter(Boolean)
    const tableMatch =
      cells.length >= 2 &&
      aliases.some(
        alias =>
          cells[0] === alias || cells[0]!.toLowerCase() === alias.toLowerCase(),
      )
    const raw = tableMatch
      ? cells[1]
      : aliases
          .map(
            alias =>
              new RegExp(`${escaped(alias)}\\s*(?::|=|→)\\s*(.+)$`, 'i').exec(
                line,
              )?.[1],
          )
          .find(Boolean)
    if (!raw) continue
    const value = valueFromText(raw, definition)
    if (value === undefined) continue
    const sourceBytes = Buffer.from(line, 'utf8')
    return {
      value,
      evidence: {
        documentPath: section.documentPath,
        sectionId: section.sectionId,
        startLine: absoluteLine,
        endLine: absoluteLine,
        digest: sha256(sourceBytes),
      },
    }
  }
  return undefined
}

function validateValue(
  value: unknown,
  definition: FoundationFactDefinition,
): value is FactValue {
  if (definition.valueType === 'string') {
    return (
      typeof value === 'string' &&
      value.length > 0 &&
      (!definition.valueSpec.enum || definition.valueSpec.enum.includes(value))
    )
  }
  if (definition.valueType === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      Number.isInteger(value) &&
      value >= (definition.valueSpec.min ?? -Infinity) &&
      value <= (definition.valueSpec.max ?? Infinity)
    )
  }
  if (definition.valueType === 'boolean') return typeof value === 'boolean'
  if (
    !Array.isArray(value) ||
    value.length < (definition.valueSpec.minItems ?? 0) ||
    value.length > (definition.valueSpec.maxItems ?? Infinity)
  )
    return false
  if (definition.valueType === 'number[]')
    return value.every(
      item => typeof item === 'number' && Number.isFinite(item),
    )
  return value.every(
    item =>
      typeof item === 'string' &&
      item.trim().length > 0 &&
      (!definition.valueSpec.itemPattern ||
        new RegExp(definition.valueSpec.itemPattern).test(item)),
  )
}

function sectionFor(
  sectionIndex: readonly SectionRef[],
  definition: FoundationFactDefinition,
): SectionRef {
  const section = sectionIndex.find(
    item =>
      item.documentPath === definition.owner.documentPath &&
      item.sectionId === definition.owner.sectionId,
  )
  if (!section)
    throw new Error(`catalog owner section is missing: ${definition.key}`)
  return section
}

function extractFactsForDefinitions(input: {
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
  definitions: readonly FoundationFactDefinition[]
}): NormalizedFoundationExtraction {
  const documents = mapDocuments(input.documents)
  const facts: FoundationFact[] = []
  const receipts: FoundationFactReceipt[] = []
  const unresolvedKeys: FoundationFactKey[] = []
  for (const definition of input.definitions) {
    const section = sectionFor(input.sectionIndex, definition)
    const markdown = documents.get(section.documentPath)
    if (markdown === undefined)
      throw new Error(`foundation document is missing: ${section.documentPath}`)
    const text = sectionText(markdown, section)
    const candidate = findCandidate(text, definition.key, definition, section)
    if (!candidate) {
      unresolvedKeys.push(definition.key)
      receipts.push({
        key: definition.key,
        status: 'uncertain',
        reason: 'mechanical extraction did not resolve the key',
        evidence: {
          documentPath: section.documentPath,
          sectionId: section.sectionId,
          startLine: section.startLine,
          endLine: section.endLine,
          digest: sha256(Buffer.from(text, 'utf8')),
        },
      })
      continue
    }
    if (!validateValue(candidate.value, definition))
      throw new Error(
        `mechanically extracted value is invalid: ${definition.key}`,
      )
    const fact: FoundationFact = {
      key: definition.key,
      value: candidate.value,
      source: section,
      evidence: candidate.evidence,
    }
    facts.push(fact)
    receipts.push({
      key: definition.key,
      status: 'present',
      value: candidate.value,
      evidence: candidate.evidence,
    })
  }
  const store = createFoundationFactStore(facts)
  return {
    facts: store,
    receipts,
    unresolvedKeys,
    normalizedFactDigest: digestFactStore(store),
  }
}

export function extractNormalizedFoundationFacts(input: {
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
}): NormalizedFoundationExtraction {
  return extractFactsForDefinitions({
    ...input,
    definitions: FOUNDATION_FACT_CATALOG,
  })
}

/**
 * Rebuilds only the service-selected catalog keys from their immutable owner
 * sections. The selected key list is the complete read scope; unrelated
 * document bodies are never looked up.
 */
export function extractSelectedFoundationFacts(input: {
  keys: readonly FoundationFactKey[]
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
}): NormalizedFoundationExtraction {
  if (!Array.isArray(input.keys))
    throw new Error('selected foundation fact keys must be an array')
  if (new Set(input.keys).size !== input.keys.length)
    throw new Error('duplicate selected foundation fact key')
  const keys = input.keys.map(key => {
    if (!isFoundationFactKey(key))
      throw new Error(`unknown selected foundation fact key: ${String(key)}`)
    return key
  })
  const definitions = keys
    .map(key => foundationFactDefinition(key)!)
    .sort((left, right) => left.key.localeCompare(right.key))
  return extractFactsForDefinitions({
    documents: input.documents,
    sectionIndex: input.sectionIndex,
    definitions,
  })
}

function canonicalFactIdentity(fact: FoundationFact): string {
  return JSON.stringify({
    key: fact.key,
    value: fact.value,
    evidence: {
      documentPath: fact.evidence.documentPath,
      sectionId: fact.evidence.sectionId,
      startLine: fact.evidence.startLine,
      endLine: fact.evidence.endLine,
      digest: fact.evidence.digest,
    },
  })
}

function canonicalFactReceiptIdentity(
  value: Pick<FoundationFactReceipt, 'key' | 'value' | 'evidence'>,
): string {
  return JSON.stringify({
    key: value.key,
    value: value.value,
    evidence: value.evidence
      ? {
          documentPath: value.evidence.documentPath,
          sectionId: value.evidence.sectionId,
          startLine: value.evidence.startLine,
          endLine: value.evidence.endLine,
          digest: value.evidence.digest,
        }
      : undefined,
  })
}

function validWorkerReceiptEvidence(
  value: unknown,
  key: FoundationFactKey,
): value is FoundationFactEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const evidence = value as Record<string, unknown>
  const definition = foundationFactDefinition(key)
  return (
    Boolean(definition) &&
    Object.keys(evidence).sort().join('|') ===
      'digest|documentPath|endLine|sectionId|startLine' &&
    evidence.documentPath === definition!.owner.documentPath &&
    evidence.sectionId === definition!.owner.sectionId &&
    Number.isInteger(evidence.startLine) &&
    (evidence.startLine as number) > 0 &&
    Number.isInteger(evidence.endLine) &&
    (evidence.endLine as number) >= (evidence.startLine as number) &&
    typeof evidence.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(evidence.digest)
  )
}

/**
 * Combines local extraction with admitted worker receipts into one
 * closed-catalog Fact Store. The store contains present values only; worker
 * absent/uncertain receipts are nevertheless authoritative coverage.
 */
export function mergeFoundationFactResults(input: {
  mechanicalFacts: readonly FoundationFact[]
  workerFacts: readonly FoundationFact[]
  workerReceipts: readonly FoundationFactReceipt[]
}): FoundationFact[] {
  const mechanical = createFoundationFactStore(input.mechanicalFacts)
  const worker = createFoundationFactStore(input.workerFacts)
  const mechanicalKeys = new Set(mechanical.map(fact => fact.key))
  const workerByKey = new Map(worker.map(fact => [fact.key, fact]))
  const receipts = input.workerReceipts
  const receiptByKey = new Map<string, FoundationFactReceipt>()
  for (const receipt of receipts) {
    if (!isFoundationFactKey(receipt.key))
      throw new Error(`unknown foundation fact receipt key: ${String(receipt.key)}`)
    if (receiptByKey.has(receipt.key))
      throw new Error(`duplicate foundation fact receipt: ${receipt.key}`)
    if (mechanicalKeys.has(receipt.key))
      throw new Error(`worker receipt overlaps mechanical fact: ${receipt.key}`)
    const allowedFields = receipt.status === 'present'
      ? ['key', 'status', 'value', 'evidence']
      : receipt.status === 'absent'
        ? ['key', 'status']
        : receipt.status === 'uncertain'
          ? ['key', 'status', 'reason', 'evidence']
          : []
    if (Object.keys(receipt).some(field => !allowedFields.includes(field)))
      throw new Error(`foundation fact receipt has unexpected fields: ${receipt.key}`)
    receiptByKey.set(receipt.key, receipt)
    const fact = workerByKey.get(receipt.key)
    if (receipt.status === 'present') {
      if (
        !('value' in receipt) ||
        receipt.value === undefined ||
        !validWorkerReceiptEvidence(receipt.evidence, receipt.key)
      )
        throw new Error(`present worker receipt is incomplete: ${receipt.key}`)
      if (!fact)
        throw new Error(`present worker receipt has no worker fact: ${receipt.key}`)
      if (canonicalFactReceiptIdentity(receipt) !== canonicalFactIdentity(fact))
        throw new Error(`worker fact does not match receipt: ${receipt.key}`)
    } else if (receipt.status === 'absent') {
      if ('value' in receipt || receipt.evidence !== undefined || receipt.reason !== undefined)
        throw new Error(`absent worker receipt has unexpected fields: ${receipt.key}`)
      if (fact)
        throw new Error(`absent worker receipt has a worker fact: ${receipt.key}`)
    } else if (receipt.status === 'uncertain') {
      if (
        'value' in receipt ||
        !receipt.reason?.trim() ||
        !validWorkerReceiptEvidence(receipt.evidence, receipt.key)
      )
        throw new Error(`uncertain worker receipt is incomplete: ${receipt.key}`)
      if (fact)
        throw new Error(`uncertain worker receipt has a worker fact: ${receipt.key}`)
    } else {
      throw new Error(`invalid worker receipt status: ${receipt.key}`)
    }
  }
  for (const fact of worker) {
    if (!receiptByKey.has(fact.key))
      throw new Error(`worker fact has no receipt: ${fact.key}`)
  }
  const missing = FOUNDATION_FACT_CATALOG
    .map(definition => definition.key)
    .filter(key => !mechanicalKeys.has(key) && !receiptByKey.has(key))
  if (missing.length)
    throw new Error(`foundation fact catalog coverage is incomplete: ${missing.join(', ')}`)
  return createFoundationFactStore([...mechanical, ...worker])
}

function canonicalPacketIdentity(
  value: Omit<FoundationFactPacket, 'packetDigest' | 'bytesUtf8'>,
): string {
  return JSON.stringify({
    revision: value.revision,
    keys: [...value.keys].sort(),
    sections: [...value.sections].sort((left, right) =>
      left.documentPath.localeCompare(right.documentPath) ||
      left.sectionId.localeCompare(right.sectionId),
    ),
  })
}

export function buildFoundationFactPackets(input: {
  revision: string
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
  unresolvedKeys: readonly string[]
}): FoundationFactPacket[] {
  const documents = mapDocuments(input.documents)
  if (new Set(input.unresolvedKeys).size !== input.unresolvedKeys.length)
    throw new Error('duplicate unresolved foundation fact key')
  const requestedKeys = input.unresolvedKeys.map(key => {
    if (!isFoundationFactKey(key))
      throw new Error(`unknown foundation fact key: ${key}`)
    return key
  })
  const mechanicalKeys = requestedKeys.filter(
    key => foundationFactDefinition(key)!.resolution === 'mechanical',
  )
  if (mechanicalKeys.length > 0)
    throw new Error(
      `mechanical-only foundation fact cannot enter a model packet: ${mechanicalKeys.join(', ')}`,
    )
  const byDocument = new Map<string, Map<string, { section: FoundationFactPacketSection; keys: FoundationFactKey[] }>>()
  for (const key of [...requestedKeys].sort()) {
    const definition = foundationFactDefinition(key)!
    const section = sectionFor(input.sectionIndex, definition)
    const markdown = documents.get(section.documentPath)
    if (markdown === undefined)
      throw new Error(`foundation document is missing: ${section.documentPath}`)
    const documentSections = byDocument.get(definition.owner.documentPath) ?? new Map()
    const sectionKey = `${section.documentPath}\0${section.sectionId}`
    const current = documentSections.get(sectionKey) ?? {
      section: { ...section, text: sectionText(markdown, section) },
      keys: [],
    }
    current.keys.push(key)
    documentSections.set(sectionKey, current)
    byDocument.set(definition.owner.documentPath, documentSections)
  }
  const packets: FoundationFactPacket[] = []
  for (const [, documentSections] of [...byDocument.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const sections = [...documentSections.values()].sort((left, right) => left.section.sectionId.localeCompare(right.section.sectionId))
    const identity = {
      revision: input.revision,
      keys: sections.flatMap(entry => entry.keys).sort(),
      sections: sections.map(entry => entry.section),
    }
    const bytesUtf8 = Buffer.byteLength(canonicalPacketIdentity(identity), 'utf8')
    packets.push({ ...identity, bytesUtf8, packetDigest: sha256(canonicalPacketIdentity(identity)) })
  }
  return packets
}

function evidenceForSection(
  evidence: FoundationFactEvidence,
  section: SectionRef,
  markdown: string,
): void {
  if (
    evidence.documentPath !== section.documentPath ||
    evidence.sectionId !== section.sectionId ||
    evidence.startLine < section.startLine ||
    evidence.endLine < evidence.startLine ||
    evidence.endLine > section.endLine
  )
    throw new Error(
      'foundation fact evidence is outside its assigned SectionRef',
    )
  const lines = markdown.split('\n')
  const bytes = Buffer.from(
    lines.slice(evidence.startLine - 1, evidence.endLine).join('\n'),
    'utf8',
  )
  if (sha256(bytes) !== evidence.digest)
    throw new Error('foundation fact evidence digest is invalid')
}

function validatePacket(
  packet: FoundationFactPacket,
  documents: Map<string, string>,
  sectionIndex: readonly SectionRef[],
): void {
  if (
    !packet ||
    typeof packet !== 'object' ||
    !packet.revision ||
    !Array.isArray(packet.keys) ||
    !Array.isArray(packet.sections)
  )
    throw new Error('foundation fact packet structure is invalid')
  if (new Set(packet.keys).size !== packet.keys.length)
    throw new Error('foundation fact packet has duplicate keys')
  if (
    new Set(
      packet.sections.map(
        section => `${section.documentPath}\0${section.sectionId}`,
      ),
    ).size !== packet.sections.length
  )
    throw new Error('foundation fact packet has duplicate sections')
  const indexed = new Map(
    sectionIndex.map(section => [
      `${section.documentPath}\0${section.sectionId}`,
      section,
    ]),
  )
  for (const section of packet.sections) {
    const expected = indexed.get(
      `${section.documentPath}\0${section.sectionId}`,
    )
    if (
      !expected ||
      expected.heading !== section.heading ||
      expected.startLine !== section.startLine ||
      expected.endLine !== section.endLine ||
      expected.digest !== section.digest
    )
      throw new Error(
        'foundation fact packet section is not the indexed SectionRef',
      )
    const markdown = documents.get(section.documentPath)
    if (
      markdown === undefined ||
      section.text !== sectionText(markdown, expected)
    )
      throw new Error('foundation fact packet section bytes are not exact')
  }
  for (const key of packet.keys) {
    if (!isFoundationFactKey(key))
      throw new Error(`unknown foundation fact packet key: ${key}`)
    const definition = foundationFactDefinition(key)!
    if (definition.resolution !== 'model_if_unresolved')
      throw new Error(`mechanical-only key cannot enter a model packet: ${key}`)
    if (
      !packet.sections.some(
        section =>
          section.documentPath === definition.owner.documentPath &&
          section.sectionId === definition.owner.sectionId,
      )
    )
      throw new Error(`foundation fact packet key is mis-scoped: ${key}`)
  }
  const bytesUtf8 = Buffer.byteLength(canonicalPacketIdentity(packet), 'utf8')
  if (packet.bytesUtf8 !== bytesUtf8)
    throw new Error('foundation fact packet byte evidence is invalid')
  const identity = {
    revision: packet.revision,
    keys: [...packet.keys].sort(),
    sections: packet.sections,
  }
  if (packet.packetDigest !== foundationFactPacketDigest(identity))
    throw new Error('foundation fact packet digest is invalid')
}

export function validateFoundationFactResults(input: {
  packet: FoundationFactPacket
  expectedRevision: string
  documents: DocumentInput
  sectionIndex: readonly SectionRef[]
  results: readonly ResultInput[]
}): {
  facts: FoundationFact[]
  receipts: FoundationFactReceipt[]
  normalizedFactDigest: string
} {
  const documents = mapDocuments(input.documents)
  if (!input.expectedRevision.trim())
    throw new Error('expected foundation fact revision is required')
  if (input.packet.revision !== input.expectedRevision)
    throw new Error('foundation fact packet revision is stale')
  validatePacket(input.packet, documents, input.sectionIndex)
  const assigned = new Set(input.packet.keys)
  const seen = new Set<string>()
  if (input.results.length !== input.packet.keys.length)
    throw new Error(
      'foundation fact results must account for every assigned key exactly once',
    )
  const receipts: FoundationFactReceipt[] = []
  const facts: FoundationFact[] = []
  for (const result of input.results) {
    if (!isFoundationFactKey(result.key) || !assigned.has(result.key))
      throw new Error(
        `foundation fact result is unknown or not assigned: ${result.key}`,
      )
    if (seen.has(result.key))
      throw new Error(`duplicate foundation fact result: ${result.key}`)
    seen.add(result.key)
    const definition = foundationFactDefinition(result.key)!
    const section = sectionFor(input.sectionIndex, definition)
    const markdown = documents.get(section.documentPath)
    if (markdown === undefined)
      throw new Error(`foundation document is missing: ${section.documentPath}`)
    if (result.status === 'present') {
      if (result.reason !== undefined)
        throw new Error(
          `present foundation fact must not include reason: ${result.key}`,
        )
      if (
        !('value' in result) ||
        result.value === undefined ||
        !result.evidence ||
        !validateValue(result.value, definition)
      )
        throw new Error(
          `foundation fact result value is invalid: ${result.key}`,
        )
      evidenceForSection(result.evidence, section, markdown)
      const whole = sectionText(markdown, section).trim()
      if (typeof result.value === 'string' && result.value.trim() === whole)
        throw new Error(
          `foundation fact result contains an entire section body: ${result.key}`,
        )
      const fact: FoundationFact = {
        key: result.key,
        value: result.value,
        source: section,
        evidence: result.evidence,
      }
      facts.push(fact)
      receipts.push({ ...result })
    } else if (result.status === 'uncertain') {
      if (!result.reason?.trim() || !result.evidence)
        throw new Error(
          `uncertain foundation fact requires reason and evidence: ${result.key}`,
        )
      evidenceForSection(result.evidence, section, markdown)
      receipts.push({ ...result })
    } else if (result.status === 'absent') {
      if (
        'value' in result ||
        result.evidence !== undefined ||
        result.reason !== undefined
      )
        throw new Error(
          `absent foundation fact must not include value, evidence, or reason: ${result.key}`,
        )
      receipts.push({ key: result.key, status: 'absent' })
    } else
      throw new Error(`invalid foundation fact result status: ${result.key}`)
  }
  for (const key of input.packet.keys)
    if (!seen.has(key))
      throw new Error(`missing foundation fact result: ${key}`)
  const store = createFoundationFactStore(facts)
  return {
    facts: store,
    receipts,
    normalizedFactDigest: digestFactStore(store),
  }
}

export function foundationFactPacketDigest(
  packet: Omit<FoundationFactPacket, 'packetDigest' | 'bytesUtf8'>,
): string {
  return sha256(canonicalPacketIdentity(packet))
}

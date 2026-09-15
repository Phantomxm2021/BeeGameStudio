import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../../../foundation-documents'
import { foundationPublicDigest } from '../../../foundation-public-result'
import type { FoundationIrInput } from '../input'
import { GAME_IR_CANONICAL_MODULE_IDS, parseGameIrCompileRequest } from './core/contracts'
import { buildGameIrProjectionContract } from './core/projection-contract'
import { foundationReadyReceiptFromInput, gameIrSourceSections } from './core/source-input'
import { admitDirectGameIrDraft, renderDirectGameIrAuthority, renderDirectGameIrInputFiles } from './direct-authority'
import { commitDirectGameIrPublication, validateDirectGameIrPublication } from './direct-publication'

const sha = (value: string): string => createHash('sha256').update(value).digest('hex')

function sourceFixture(): FoundationIrInput {
  const content = '# Fixture\n\nCaptured source.\n', digest = sha(content)
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, content, digest,
    byteLength: Buffer.byteLength(content), sections: [{ ordinal: 0, kind: 'heading' as const,
      headingLevel: 1, headingText: 'Fixture', startByte: 0, endByte: Buffer.byteLength(content), digest }] }))
  const documentSetDigest = foundationPublicDigest(documents.map(document => [document.path, document.digest]))
  return { protocolVersion: 1, ownerId: 'owner', projectId: 'project', foundationResultId: sha('result'),
    foundationResultDigest: sha('result-digest'), publishedDocumentRevision: documentSetDigest, documentSetDigest,
    confirmedBriefDigest: sha('brief'), confirmedRequirementsDigest: sha('brief'), documents,
    sourceIndexDigest: foundationPublicDigest(documents.map(document => ({ path: document.path, digest: document.digest,
      byteLength: document.byteLength, sections: document.sections }))) }
}

function sample(schema: Record<string, any>, root: Record<string, any> = schema): unknown {
  if (schema.$ref) return sample(root.$defs[schema.$ref.split('/').at(-1)], root)
  if ('const' in schema) return schema.const
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf) return sample(schema.anyOf[0], root)
  if (schema.oneOf) return sample(schema.oneOf[0], root)
  if (schema.type === 'object' || schema.properties) return Object.fromEntries(
    (schema.required ?? []).map((key: string) => [key, sample(schema.properties[key], root)]))
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items, root))
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 1
  if (schema.type === 'boolean') return true
  return 'x'
}

test('admits and atomically publishes a complete six-domain CLI draft', async () => {
  const source = sourceFixture(), foundation = foundationReadyReceiptFromInput(source)
  const request = parseGameIrCompileRequest({ schemaVersion: 'game-ir-compile-request.v1', taskId: 'task',
    publicationId: 'publication', gameIrSchemaVersion: 'game-ir.v1', foundation })
  const sections = gameIrSourceSections(source), sourcePointer = {
    documentPath: sections[0]!.documentPath, sectionId: sections[0]!.sectionId,
  }
  const idForKind = new Map<string, string>()
  for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS)
    for (const [index, node] of buildGameIrProjectionContract(moduleId).nodes.entries())
      idForKind.set(node.kind, `${moduleId}.${index}`)
  const modules = GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => ({ moduleId,
    nodes: buildGameIrProjectionContract(moduleId).nodes.map(node => ({
      id: idForKind.get(node.kind)!, kind: node.kind,
      value: Object.fromEntries([...node.value.required, ...node.value.optional].map(field =>
        [field, sample(node.value.fields[field] as Record<string, any>)])),
      references: node.referencePolicy?.kind === 'exact-single-index-reference'
        ? [{ targetId: idForKind.get(node.referencePolicy.targetKinds[0]!)!, targetType: node.referencePolicy.targetKinds[0]! }] : [],
      edges: node.relationships.flatMap(relationship =>
        ['exactly-one', 'at-least-one'].includes(relationship.cardinality)
          ? [{ type: relationship.role, targetId: idForKind.get(relationship.targetKinds[0]!)!, targetType: relationship.targetKinds[0]! }] : []),
      source: sourcePointer,
    })),
  }))
  const formula = modules.flatMap(module => module.nodes).find(node => node.kind === 'balance.formula')!
  formula.value = {
    label: 'distance divided by speed',
    expression: { kind: 'binary', operator: 'divide',
      left: { kind: 'binary', operator: 'subtract',
        left: { kind: 'literal', value: 500, unitReferenceIndex: 1 },
        right: { kind: 'literal', value: 360, unitReferenceIndex: 2 } },
      right: { kind: 'reference', referenceIndex: 3 } },
    outputUnitReferenceIndex: 0,
  }
  ;(formula as any).references = [
    { targetId: idForKind.get('balance.unit')!, targetType: 'balance.unit' },
    { targetId: 'pixel-unit', targetType: 'balance.unit' },
    { targetId: 'pixel-unit', targetType: 'balance.unit' },
    { targetId: idForKind.get('balance.parameter')!, targetType: 'balance.parameter' },
  ]
  const balance = modules.find(module => module.moduleId === 'balance')!
  balance.nodes.push({ ...balance.nodes.find(node => node.kind === 'balance.unit')!, id: 'pixel-unit' })
  const candidate = admitDirectGameIrDraft({ draft: { schemaVersion: 'game-ir-direct-draft.v1', modules }, request, sections })
  expect(candidate.modules.map(module => module.moduleId)).toEqual([...GAME_IR_CANONICAL_MODULE_IDS].sort())
  expect(candidate.modules.every(module => module.nodes.length > 0)).toBe(true)
  const admittedFormula = candidate.modules.flatMap(module => module.nodes).find(node => node.id === formula.id)!
  expect(admittedFormula.references).toEqual([
    { targetId: idForKind.get('balance.parameter')!, targetType: 'balance.parameter' },
    { targetId: idForKind.get('balance.unit')!, targetType: 'balance.unit' },
    { targetId: 'pixel-unit', targetType: 'balance.unit' },
  ])
  expect(admittedFormula.value).toEqual({
    label: 'distance divided by speed',
    expression: { kind: 'binary', operator: 'divide',
      left: { kind: 'binary', operator: 'subtract',
        left: { kind: 'literal', value: 500, unitReferenceIndex: 2 },
        right: { kind: 'literal', value: 360, unitReferenceIndex: 2 } },
      right: { kind: 'reference', referenceIndex: 0 } },
    outputUnitReferenceIndex: 1,
  })
  const workspacePath = await mkdtemp('/private/tmp/direct-ir-publication-')
  try {
    const authority = { workspacePath, publicationId: request.publicationId, request, sections, candidate }
    const ready = await commitDirectGameIrPublication(authority)
    const restored = await validateDirectGameIrPublication(authority)
    expect(restored.ready).toEqual(ready)
    expect(restored.candidate).toEqual(candidate)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
  const prompt = renderDirectGameIrAuthority({ request, sections })
  expect(prompt).not.toMatch(/do not delegate|subagents|separate review|one pass|one allowed correction/i)
  expect(prompt).not.toContain('complete six-domain Game IR')
  expect(prompt).toContain('smallest six-domain Game IR execution projection')
  expect(prompt).toContain('Keep supporting prose and unconsumed detail in the source documents')
  expect(prompt).toContain('do not split every sentence, scalar, UI string or example into a separate node')
  expect(prompt).not.toContain('sourceEvidence')
  expect(prompt).toContain('acquisition-profile.acceptanceCriteria')
  expect(prompt).toContain('Every reference is exactly `{ "targetId": "...", "targetType": "..." }`.')
  expect(prompt).toContain('Every edge is exactly `{ "type": "<relationship role>", "targetId": "...", "targetType": "..." }`.')
  expect(prompt.length).toBeLessThan(2_000)
  const inputFiles = renderDirectGameIrInputFiles({ sections })
  expect(JSON.parse(inputFiles['source-sections.json']!)).toHaveLength(sections.length)
  const serializedContracts = JSON.parse(inputFiles['node-contracts.json']!)
  expect(Object.keys(serializedContracts)).toEqual([...GAME_IR_CANONICAL_MODULE_IDS])
  const uiAction = serializedContracts.presentation.nodes.find((node: { kind: string }) => node.kind === 'presentation.ui-action')
  const invokes = uiAction.relationships.find((relationship: { role: string }) => relationship.role === 'invokes')
  expect(invokes.cardinality).toBe('exactly-one')
  expect(invokes).not.toHaveProperty('required')
  expect(invokes).not.toHaveProperty('singleton')
  const acquisitionProfile = serializedContracts['resource-realization'].nodes.find(
    (node: { kind: string }) => node.kind === 'resource-realization.acquisition-profile',
  )
  expect(acquisitionProfile.value.optional).toContain('acceptanceCriteria')
  expect(acquisitionProfile.value.fields.acceptanceCriteria.description).toContain(
    'cross-asset coherence',
  )
})

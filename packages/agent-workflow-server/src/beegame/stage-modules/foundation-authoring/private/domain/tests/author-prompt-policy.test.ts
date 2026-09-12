import { expect, test } from 'bun:test'
import { buildFoundationAuthorPrompt as buildWorkerPrompt } from '../foundation-authoring-prompt'
import { getGameDocumentContract } from '../game-document-contracts'
import { buildSystemDeliveryContract } from '../system-delivery-contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { foundationAuthoringDocumentContract, FOUNDATION_AUTHORING_INSTRUCTION } from '../foundation-authoring-contract'
function countOccurrences(value: string, needle: string) { return value.split(needle).length - 1 }

test('all documents and drafting modes request raw Markdown even with legacy v2 metadata', () => {
  for (const authoringMode of ['initial', 'parallel-draft'] as const) {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const before = JSON.stringify(getGameDocumentContract(path))
      const prompt = buildWorkerPrompt({
        runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
        workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision', allowedPaths: [path],
        contract: { documentSet: 'foundation', authoringMode, foundationDocumentPath: path,
          authorBodyVersion: 'foundation-author-body.v2', confirmedBriefDigest: 'a'.repeat(64) },
      })
      const contexts = prompt.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
      expect(contexts).toHaveLength(1)
      const context = contexts[0]
      expect(context.authorBodyVersion).toBeUndefined()
      expect(prompt).toContain('raw Markdown')
      expect(prompt).toContain('Return Markdown')
      expect(prompt).not.toContain('structured JSON')
      expect(prompt).not.toContain('sections[id].body')
      expect(prompt).not.toContain('The dedicated Reviewer owns format, content and quality audit.')
      const view = context.completeDocumentContract
      const canonical = foundationAuthoringDocumentContract(path)
      expect(view.mechanicalMarkdownProtocol.sections.map(({ heading: _heading, ...section }: any) => section)).toEqual(canonical.sections)
      expect(view.mechanicalMarkdownProtocol.productionMaterials.entries.map(({ heading: _heading, serializationRule: _rule, ...material }: any) => material)).toEqual(canonical.productionMaterials)
      expect(view.documentAuthorityRule).toBe(canonical.documentAuthorityRule)
      expect(view.outputPolicy).toEqual(canonical.outputPolicy)
      expect(view.mergeReferenceRule).toBe(canonical.mergeReferenceRule)
      expect(JSON.stringify(getGameDocumentContract(path))).toBe(before)
    }
  }
})

test('declares a closed H2 heading protocol for initial and parallel foundation authors', () => {
    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      const prompt = buildWorkerPrompt({
        runId: 'run',
        ownerId: 'owner',
        projectId: 'project',
        workspacePath: '/workspace',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        revision: 'revision',
        allowedPaths: ['docs/UI_UX_SPEC.md'],
        contract: {
          confirmedBriefDigest: 'a'.repeat(64),
      documentSet: 'foundation',
          authoringMode,
          foundationDocumentPath: 'docs/UI_UX_SPEC.md',
          completeDocumentContract: getGameDocumentContract(
            'docs/UI_UX_SPEC.md',
          ),
        },
      })
      const contract = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!) as {
        completeDocumentContract: {
          mechanicalMarkdownProtocol: {
            closedHeadingSet: string[]
            additionalH2: string
            supportingContent: string
          }
        }
      }
      const expectedH2s = [
        '## Executive Summary',
        ...getGameDocumentContract('docs/UI_UX_SPEC.md').sections.map(
          section => `## ${section.title}`,
        ),
        '## Production Materials',
      ]

      expect(contract.completeDocumentContract.mechanicalMarkdownProtocol).toMatchObject({
        closedHeadingSet: expectedH2s,
        additionalH2: 'forbidden',
        supportingContent: 'must be nested under one of the closed H2 headings',
      })
    }
  })

test('derives one Markdown-table serialization rule for the evidence register', () => {
    const prompt = buildWorkerPrompt({
      runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
      workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
      allowedPaths: ['docs/ASSET_PLAN.md'],
      contract: {
        confirmedBriefDigest: 'a'.repeat(64),
      documentSet: 'foundation', authoringMode: 'initial', foundationDocumentPath: 'docs/ASSET_PLAN.md',
        completeDocumentContract: getGameDocumentContract('docs/ASSET_PLAN.md'),
      },
    })
    const serialized = JSON.parse(
      prompt.split('\n').find(line => line.startsWith('{'))!,
    ) as {
      completeDocumentContract: {
        mechanicalMarkdownProtocol: {
          productionMaterials: {
            entries: Array<{ materialId: string; format: string; serialization: string; serializationRule?: string }>
          }
        }
      }
    }
    const licenseRegister = serialized.completeDocumentContract.mechanicalMarkdownProtocol.productionMaterials.entries
      .find(material => material.materialId === 'license-register')

    expect(licenseRegister).toMatchObject({
      format: 'evidence_register',
      serialization: 'markdown_table',
    })
    expect(licenseRegister?.serializationRule).toContain('Markdown table only')
    expect(licenseRegister?.serializationRule).toContain('header row')
    expect(licenseRegister?.serializationRule).toContain('separator row')
    expect(licenseRegister?.serializationRule).toContain('do not use a fenced code block')
    expect(licenseRegister?.serializationRule).toContain('key-value list')
  })

test('keeps author configuration isolated while preserving Markdown output identities', () => {
    for (const authoringMode of ['initial', 'parallel-draft'] as const) {
      for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
        const sharedBefore = JSON.stringify(getGameDocumentContract(path))
        const prompt = buildWorkerPrompt({
          runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/workspace',
          workerType: 'document-author', phase: 'DOCUMENT_DRAFTING', revision: 'revision',
          allowedPaths: [path],
          contract: { confirmedBriefDigest: 'a'.repeat(64),
      documentSet: 'foundation', authoringMode, foundationDocumentPath: path,
            completeDocumentContract: getGameDocumentContract(path),
            systemDeliveryContract: buildSystemDeliveryContract(), availableUpstreamPaths: [],
            confirmedBriefContext: 'DUPLICATE_BRIEF_SENTINEL' },
        })
        const contract = JSON.parse(prompt.split('\n').find(line => line.startsWith('{'))!)
        const view = contract.completeDocumentContract
        expect(view.documentAuthorityRule).toBe(foundationAuthoringDocumentContract(path).documentAuthorityRule)
        expect(view.mechanicalMarkdownProtocol.closedHeadingSet).toEqual([
          '## Executive Summary', ...getGameDocumentContract(path).sections.map(s => `## ${s.title}`),
          '## Production Materials',
        ])
        expect(view.mechanicalMarkdownProtocol.productionMaterials.entries.map((m: any) => [m.materialId, m.serialization]))
          .toEqual(getGameDocumentContract(path).productionMaterials.map(m => [m.materialId, m.serialization]))
        expect(countOccurrences(prompt, FOUNDATION_AUTHORING_INSTRUCTION)).toBe(1)
        expect(countOccurrences(prompt, view.documentAuthorityRule)).toBe(1)
        expect(countOccurrences(prompt, view.mergeReferenceRule)).toBe(1)
        expect(prompt).toContain('one complete raw Markdown')
        expect(prompt).not.toContain('Reviewer owns format, content and quality audit')
        expect(prompt).not.toContain('Do not call tools')
        expect(prompt).not.toContain('DUPLICATE_BRIEF_SENTINEL')
        expect(prompt).not.toContain('availableUpstreamPaths')
        expect(prompt).not.toContain('Workspace root:')
        expect(prompt).not.toContain('max_tokens')
        expect(prompt).not.toContain('roundDeadlineAt')
        expect(contract.systemDeliveryContract).toBeUndefined()
        expect(contract.authoringDeliveryContract !== undefined).toBe(path === 'docs/TECHNICAL_DESIGN.md' || path === 'docs/ASSET_PLAN.md')
        expect(JSON.stringify(getGameDocumentContract(path))).toBe(sharedBefore)
      }
    }
  })

test('keeps Balance calculations auditable without reproducing upstream schedules', () => {
    const contract = foundationAuthoringDocumentContract('docs/BALANCE_DESIGN.md')
    const shared = getGameDocumentContract('docs/BALANCE_DESIGN.md')
    expect(contract.documentAuthorityRule).toContain('not upstream geometry or wave schedules')
    expect(contract.sections.map(section => section.sectionId)).toEqual(shared.sections.map(section => section.sectionId))
    expect(contract.sections.find(s => s.sectionId === 'tuning_validation')!.purpose).toContain('auditable chain from inputs through calculated or observed results to acceptance')
    expect(contract.sections.find(s => s.sectionId === 'tuning_validation')!.purpose).toContain('do not copy owner numeric inputs')
    expect(FOUNDATION_AUTHORING_INSTRUCTION).not.toContain('Before returning')
    expect(JSON.stringify(contract)).not.toContain('BALANCE_SECTIONS')
  })

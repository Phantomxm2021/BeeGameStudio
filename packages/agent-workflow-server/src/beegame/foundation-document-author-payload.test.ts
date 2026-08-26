import { describe, expect, test } from 'bun:test'
import {
  assembleFoundationDocumentMarkdown,
  buildFoundationDocumentAuthorStructuredOutputJsonSchema,
  foundationDocumentAuthorPayloadSchema,
} from './foundation-document-author-payload'
import { assertFoundationStructuredOutputWithinInfrastructureBoundary } from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'

const path = 'docs/GDD.md' as const

function validPayload() {
  const contract = getGameDocumentContract(path)
  return {
    title: 'A production-ready game design',
    executiveSummary: 'The complete authority index for this game.',
    sections: Object.fromEntries(contract.sections.map(section => [
      section.sectionId,
      `Owned decisions for ${section.sectionId} are concrete and implementation-ready.`,
    ])),
    materials: Object.fromEntries(contract.productionMaterials.map(material => [
      material.materialId,
      
      material.format === 'markdown_table'
          ? '| Field | Value |\n| --- | --- |\n| Owner | Design |'
          : material.format === 'mermaid'
            ? '```mermaid\ngraph TD\n  A --> B\n```'
            : material.format === 'evidence_register'
              ? '| Evidence | State |\n| --- | --- |\n| Ref | Pending |'
              : '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>',
    ])),
  }
}

describe('foundation document author payload', () => {
  test('assembles a strict block payload into the only canonical Markdown frame', () => {
    const payload = validPayload()
    const markdown = assembleFoundationDocumentMarkdown(path, payload)

    expect(markdown).toContain('# A production-ready game design')
    expect(markdown).toContain('<!-- beegame-section:vision -->\n## Vision and Product Promise')
    expect(markdown).toContain('<!-- beegame-material:core-loop-diagram -->\n### Core Loop Diagram')
    expect(markdown).not.toContain('---\ndocument_id:')
  })

  test('rejects missing, duplicate, extra and empty block bodies', () => {
    const payload = validPayload()
    expect(() =>
      foundationDocumentAuthorPayloadSchema(path).parse({
        ...payload,
        sections: Object.fromEntries(
          Object.entries(payload.sections).slice(1),
        ),
      }),
    ).toThrow(/section/i)
    expect(() =>
      foundationDocumentAuthorPayloadSchema(path).parse({
        ...payload,
        materials: { ...payload.materials, duplicate: 'body' },
      }),
    ).toThrow(/material/i)
    expect(() =>
      foundationDocumentAuthorPayloadSchema(path).parse({
        ...payload,
        sections: { ...payload.sections, 'not-in-contract': 'body' },
      }),
    ).toThrow(/section/i)
    expect(() =>
      foundationDocumentAuthorPayloadSchema(path).parse({
        ...payload,
        executiveSummary: ' ',
      }),
    ).toThrow()
    expect(() =>
      foundationDocumentAuthorPayloadSchema(path).parse({
        ...payload,
        title: '# mechanical heading',
      }),
    ).toThrow(/title/i)
  })

  test('builds a closed schema with no mechanical title or marker fields', () => {
    const schema = buildFoundationDocumentAuthorStructuredOutputJsonSchema(
      getGameDocumentContract(path),
    )
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties).toHaveProperty('title')
    expect(schema.properties).toHaveProperty('sections')
    expect(schema.properties).toHaveProperty('materials')
    expect(JSON.stringify(schema)).not.toContain('frontmatter')
    expect(JSON.stringify(schema)).not.toContain('marker')
    const properties = schema.properties as Record<string, Record<string, unknown>>
    expect(properties.title?.pattern).toContain('\\S')
    expect(properties.executiveSummary?.pattern).toBe('\\S')
  })

  test('rejects author-injected mechanical headings anywhere in the payload', () => {
    const payload = validPayload()
    expect(() =>
      assembleFoundationDocumentMarkdown(path, {
        ...payload,
        executiveSummary: 'Authority index.\n\n## Injected section',
      }),
    ).toThrow(/mechanical headings/)
    expect(() =>
      assembleFoundationDocumentMarkdown(path, {
        ...payload,
        materials: {
          ...payload.materials,
          'core-loop-diagram': '```mermaid\ngraph TD\n A --> B\n```\n\n# Injected title',
        },
      }),
    ).toThrow(/mechanical headings/)
  })

  test('keeps only the infrastructure payload boundary, not a business-size cap', () => {
    expect(() =>
      assertFoundationStructuredOutputWithinInfrastructureBoundary({
        body: 'x'.repeat(2 * 1024 * 1024 + 1),
      }),
    ).toThrow(/infrastructure boundary/)
    expect(() =>
      assertFoundationStructuredOutputWithinInfrastructureBoundary({
        body: 'x'.repeat(50_000),
      }),
    ).not.toThrow()
  })
})

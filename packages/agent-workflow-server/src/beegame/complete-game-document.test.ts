import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import {
  normalizeCompleteGameDocumentProtocol,
  validateCompleteGameDocumentMarkdown,
} from './complete-game-document'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'

function replaceMaterialBody(
  markdown: string,
  materialId: string,
  body: string,
): string {
  const marker = `<!-- beegame-material:${materialId} -->`
  const start = markdown.indexOf(marker)
  const bodyStart = markdown.indexOf('\n\n', start) + 2
  const bodyEnd = markdown.indexOf('\n<!-- beegame-', bodyStart)
  if (start < 0 || bodyStart < 2 || bodyEnd < 0)
    throw new Error(`test material fixture is missing: ${materialId}`)
  return `${markdown.slice(0, bodyStart)}${body}\n${markdown.slice(bodyEnd + 1)}`
}

describe('native complete game document validation', () => {
  test('injects service-owned protocol markers into marker-free canonical Markdown', () => {
    const path = 'docs/ASSET_PLAN.md'
    const canonical = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replace(/<!-- beegame-audit-appendix -->[^]*$/, '')
    const markerFree = canonical.replace(
      /^<!-- beegame-(?:executive-summary|section:[^>]+|production-materials|material:[^>]+) -->\n/gm,
      '',
    )

    expect(normalizeCompleteGameDocumentProtocol(path, markerFree)).toBe(
      canonical.trimEnd() + '\n',
    )
  })

  test('normalizes existing protocol markers idempotently', () => {
    const path = 'docs/GDD.md'
    const canonical = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replace(/<!-- beegame-audit-appendix -->[^]*$/, '')

    const once = normalizeCompleteGameDocumentProtocol(path, canonical)
    expect(normalizeCompleteGameDocumentProtocol(path, once)).toBe(once)
  })

  test('rejects missing, duplicate, reordered, and fenced canonical headings before marker injection', () => {
    const path = 'docs/GDD.md'
    const markerFree = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    )
      .replace(/<!-- beegame-audit-appendix -->[^]*$/, '')
      .replace(
        /^<!-- beegame-(?:executive-summary|section:[^>]+|production-materials|material:[^>]+) -->\n/gm,
        '',
      )
    const first = '## Vision and Product Promise'
    const second = '## Player Experience and Design Pillars'

    expect(() =>
      normalizeCompleteGameDocumentProtocol(path, markerFree.replace(first, '')),
    ).toThrow(/heading|structure|section/i)
    expect(() =>
      normalizeCompleteGameDocumentProtocol(
        path,
        markerFree.replace(first, `${first}\n${first}`),
      ),
    ).toThrow(/heading|structure|section/i)
    expect(() =>
      normalizeCompleteGameDocumentProtocol(
        path,
        markerFree.replace(first, '__FIRST__').replace(second, first).replace('__FIRST__', second),
      ),
    ).toThrow(/order|structure|section/i)
    expect(() =>
      normalizeCompleteGameDocumentProtocol(
        path,
        markerFree.replace(first, `\`\`\`text\n${first}\n\`\`\``),
      ),
    ).toThrow(/heading|structure|section/i)
  })

  test('accepts every complete canonical Markdown document written on disk', () => {
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      const markdown = renderTestCompleteGameDocument(
        path,
        completeTestSubmission(path),
      )
      expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
    }
  })

  test('rejects non-canonical Foundation references in prose and code fences', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() => validateCompleteGameDocumentMarkdown(path, `${markdown}\nSee docs/UIUX_DESIGN.md.`)).toThrow(/canonical|document reference/i)
    expect(() => validateCompleteGameDocumentMarkdown(path, markdown.replace('```mermaid', '```mermaid\n%% docs/UIUX_DESIGN.md'))).toThrow(/canonical|document reference/i)
  })

  test('accepts canonical Foundation references and non-document asset paths', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const referenced = markdown.replace('Concrete production authority', 'See docs/BALANCE_DESIGN.md and assets/example.png.\n\nConcrete production authority')
    expect(validateCompleteGameDocumentMarkdown(path, referenced)).toBe(referenced)
  })

  test('rejects copied Balance literals, ranges, formulas, and non-reference inline code', () => {
    const path = 'docs/BALANCE_DESIGN.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const rejected = [
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| boundary | [0,1] |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| rate | 0.1 |'],
      ['economy-flow-diagram', 'Reference-only flow.\n\n```mermaid\ngraph TD\nA[clamp(V_P_FLOOR,V_P_CEIL)]\n```'],
      ['economy-flow-diagram', 'Reference-only flow.\n\n```mermaid\ngraph TD\nA[clamp(1,5)]\n```'],
      ['economy-flow-diagram', 'Reference-only flow.\n\n```mermaid\ngraph TD\nA[clamp (V_P_FLOOR,V_P_CEIL)]\n```'],
      ['economy-flow-diagram', 'Reference-only flow.\n\n```mermaid\ngraph TD\nA[0–3]\n```'],
      ['tuning-validation-matrix', '| Field | Value |\n| --- | --- |\n| bound | ≤1 |'],
      ['tuning-validation-matrix', '| Field | Value |\n| --- | --- |\n| expression | `x + y` |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| expression | `V-DSL-*` |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| expression | V_INPUT + V_BONUS |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| expression | V_MIN ≤ V_MAX |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| expression | P_GEN_KW_PER_L + P_BONUS |'],
      ['formula-boundary-table', '| Field | Value |\n| --- | --- |\n| expression | K_GEN_LEVEL <= CAP_GEN_KW |'],
    ] as const

    for (const [materialId, body] of rejected) {
      expect(() =>
        validateCompleteGameDocumentMarkdown(
          path,
          replaceMaterialBody(markdown, materialId, body),
        ),
      ).toThrow(/Balance reference-only material/i)
    }
  })

  test('accepts prose and stable owner references in Balance reference-only materials', () => {
    const path = 'docs/BALANCE_DESIGN.md'
    const submission = completeTestSubmission(path)
    const withOwnerReferences = {
      ...submission,
      sections: submission.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              body: `${section.body}\n\nOwner IDs: \`P_GEN_KW_PER_L\`, \`K_GEN_LEVEL\`, \`CAP_GEN_KW\`, \`B1\`, \`T6\`, \`A3\`, \`B-02\`, and \`SS-05\`.`,
            }
          : section,
      ),
    }
    let markdown = renderTestCompleteGameDocument(path, withOwnerReferences)
    markdown = replaceMaterialBody(
      markdown,
      'formula-boundary-table',
      'Reference-only prose indexes `formula-boundary-table`, `docs/GDD.md`, `## Authoritative Formulas`, `## Entity and Ability Parameters`, `P_GEN_KW_PER_L`, `K_GEN_LEVEL`, `CAP_GEN_KW`, `B1`, `T6`, `A3`, `B-02`, `SS-05`, `V_P_FLOOR`, `V_HAZ_*`, `F01`, `F03A`, `SC_01`, and `AC_01` owners.\n\n| Reference | Owner |\n| --- | --- |\n| variable | `V_P_FLOOR` |\n| formula | `F03A` |',
    )
    markdown = replaceMaterialBody(
      markdown,
      'economy-flow-diagram',
      'Reference-only flow indexes variable groups, formula, scenario, and acceptance owners.\n\n```mermaid\ngraph TD\nV_FLT_* --> F01\nSC_01 --> AC_01\n```',
    )
    markdown = replaceMaterialBody(
      markdown,
      'tuning-validation-matrix',
      'Reference-only prose indexes `INV_ICON`, `CONV_UNIT`, `EC_INCOME`, `EX_STRESS`, `RK_ABORT`, `PF_START`, and `RV_RETRY`.\n\n| Reference | Owner |\n| --- | --- |\n| scenario | `SC_01` |\n| acceptance | `AC_01` |',
    )

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
  })

  test('rejects undeclared symbolic IDs', () => {
    const path = 'docs/BALANCE_DESIGN.md'
    const markdown = replaceMaterialBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'formula-boundary-table',
      '| Field | Value |\n| --- | --- |\n| expression | `P_UNDECLARED_*` |',
    )

    expect(() => validateCompleteGameDocumentMarkdown(path, markdown)).toThrow(
      /Balance reference-only material/i,
    )
  })

  test('accepts a complete document above the compact authoring target', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md'
    const submission = completeTestSubmission(path)
    const oversized = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: `Concrete production authority ${'x'.repeat(50_000)}`,
    })

    expect(validateCompleteGameDocumentMarkdown(path, oversized)).toBe(
      oversized,
    )
  })

  test('accepts normal Markdown blank lines between canonical markers and headings', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replaceAll(/(<!-- beegame-(?:executive-summary|section:[^>]+|production-materials|material:[^>]+|audit-appendix) -->)\n/g, '$1\n\n')

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(
      markdown.trimEnd() + '\n',
    )
  })

  test('rejects missing, duplicate, and out-of-order canonical sections', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const firstMarker = markdown.match(/<!-- beegame-section:[^>]+ -->/)?.[0]
    expect(firstMarker).toBeTruthy()
    expect(() =>
      validateCompleteGameDocumentMarkdown(path, markdown.replace(firstMarker!, '')),
    ).toThrow(/sections|structure/i)
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace(firstMarker!, `${firstMarker}\n${firstMarker}`),
      ),
    ).toThrow(/sections|structure/i)
  })

  test('rejects missing or malformed production materials', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace('```mermaid', '```text'),
      ),
    ).toThrow(/format|mermaid/i)
    const artPath = 'docs/ART_DIRECTION.md'
    const artMarkdown = renderTestCompleteGameDocument(
      artPath,
      completeTestSubmission(artPath),
    )
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        artPath,
        artMarkdown.replace(/<svg[^]*?<\/svg>/, 'external.svg'),
      ),
    ).toThrow(/format|svg/i)
  })

  test('requires actionable acceptance criteria', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() =>
      validateCompleteGameDocumentMarkdown(
        path,
        markdown.replace(/### Acceptance Criteria[^]*$/, '### Acceptance Criteria\n'),
      ),
    ).toThrow(/acceptance criteria/i)
  })

  test('scopes repeated authored headings to their owning section', () => {
    const path = 'docs/GDD.md'
    const submission = completeTestSubmission(path)
    const repeatedAcrossSections = renderTestCompleteGameDocument(path, {
      ...submission,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body:
          index < 2
            ? `${section.body}\n\n### Acceptance Criteria\n\n- Observable section outcome ${index + 1}.`
            : section.body,
      })),
    })
    const repeatedInsideSection = renderTestCompleteGameDocument(path, {
      ...submission,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body:
          index === 0
            ? `${section.body}\n\n### Acceptance Criteria\n\n- First observable outcome.\n\n### Acceptance Criteria\n\n- Duplicate heading in one section.`
            : section.body,
      })),
    })

    expect(
      validateCompleteGameDocumentMarkdown(path, repeatedAcrossSections),
    ).toBe(repeatedAcrossSections)
    expect(() =>
      validateCompleteGameDocumentMarkdown(path, repeatedInsideSection),
    ).toThrow(/heading is duplicated/i)
  })

  test('accepts a human document with the mechanical audit externalized', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(
      path,
      completeTestSubmission(path),
    ).replace(/\n<!-- beegame-audit-appendix -->[^]*$/, '\n')

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(
      `${markdown.trimEnd()}\n`,
    )
  })

  test('rejects empty-template prose and repeated substantive content', () => {
    const path = 'docs/GDD.md'
    const submission = completeTestSubmission(path)
    const empty = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: 'No known section-specific risks.',
    })
    expect(() => validateCompleteGameDocumentMarkdown(path, empty)).toThrow(/template/i)

    const repeated = 'A concrete production paragraph '.repeat(9)
    const duplicated = renderTestCompleteGameDocument(path, {
      ...submission,
      executiveSummary: repeated,
      sections: submission.sections.map((section, index) => ({
        ...section,
        body: index < 2 ? repeated : section.body,
      })),
    })
    expect(() => validateCompleteGameDocumentMarkdown(path, duplicated)).toThrow(/repeats/i)
  })
})

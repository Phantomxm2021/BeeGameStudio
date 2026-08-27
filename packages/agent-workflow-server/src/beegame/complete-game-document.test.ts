import { describe, expect, test } from 'bun:test'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import {
  assertMaterialFormat,
  assertCompleteGameDocumentCrossDocumentReferences,
  collectCompleteGameDocumentAuthorityReferences,
  collectCompleteGameDocumentAuthoritySymbols,
  isCompleteGameDocumentMarkdownStructure,
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

function replaceSectionBody(
  markdown: string,
  sectionId: string,
  body: string,
): string {
  const marker = `<!-- beegame-section:${sectionId} -->`
  const start = markdown.indexOf(marker)
  const bodyStart = markdown.indexOf('\n\n', start) + 2
  const bodyEnd = markdown.indexOf('\n<!-- beegame-', bodyStart)
  if (start < 0 || bodyStart < 2 || bodyEnd < 0)
    throw new Error(`test section fixture is missing: ${sectionId}`)
  return `${markdown.slice(0, bodyStart)}${body}\n${markdown.slice(bodyEnd + 1)}`
}

describe('native complete game document validation', () => {
  test('accepts separate rectangular tables with different schemas in one material', () => {
    const body = [
      '| Event | Cue | Bus |',
      '| --- | --- | --- |',
      '| alert | siren | critical |',
      '',
      'Exception rules:',
      '',
      '| Condition | Behavior |',
      '| --- | --- |',
      '| muted | visual-only |',
    ].join('\n')

    expect(() =>
      assertMaterialFormat('markdown_table', body, 'event-cue-matrix'),
    ).not.toThrow()
  })

  test('treats complete headings and closed fences as transport closure without running material admission', () => {
    const path = 'docs/AUDIO_DESIGN.md'
    const canonical = replaceMaterialBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'event-cue-matrix',
      [
        '| Event | Cue | Bus |',
        '| --- | --- | --- |',
        '| alert | siren | critical |',
        '',
        '| Condition | Behavior |',
        '| --- | --- |',
        '| muted | visual-only |',
      ].join('\n'),
    )
      .replace(/<!-- beegame-audit-appendix -->[^]*$/, '')
      .replace(
        /^<!-- beegame-(?:executive-summary|section:[^>]+|production-materials|material:[^>]+) -->\n/gm,
        '',
      )

    expect(isCompleteGameDocumentMarkdownStructure(path, canonical)).toBe(true)
  })

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

  test('rejects truncated Foundation path references without a Markdown extension', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() => validateCompleteGameDocumentMarkdown(path, `${markdown}\nSee docs/GGD.`)).toThrow(/canonical|document reference/i)
    expect(() => validateCompleteGameDocumentMarkdown(path, `${markdown}\nSee docs/GDD.`)).toThrow(/canonical|document reference/i)
  })

  test('accepts canonical Foundation references and non-document asset paths', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const referenced = markdown.replace('Concrete production authority', 'See docs/BALANCE_DESIGN.md and assets/example.png.\n\nConcrete production authority')
    expect(validateCompleteGameDocumentMarkdown(path, referenced)).toBe(referenced)
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

  test('accepts Balance numeric literals in its sole variable-parameter owner material', () => {
    const path = 'docs/BALANCE_DESIGN.md'
    const markdown = replaceMaterialBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'variable-parameter-table',
      '| ID | Unit | Value | Range |\n| --- | --- | --- | --- |\n| `var.fuel` | FU | 12 | 0–20 |',
    )

    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
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
        artMarkdown.replace('| Field | Value |', 'not a visual evidence table'),
      ),
    ).toThrow(/format/i)
  })

  test('rejects unclosed fences and inline code with material and line diagnostics', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const malformed = replaceMaterialBody(
      markdown,
      'core-loop-diagram',
      '```mermaid\ngraph TD\nA --> B',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, malformed)).toThrow(
      /core-loop-diagram.*line/i,
    )

    const inline = replaceMaterialBody(
      markdown,
      'core-loop-diagram',
      'A broken `inline code span',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, inline)).toThrow(
      /core-loop-diagram.*line/i,
    )
  })

  test('rejects concatenated material markers and deleted material markers deterministically', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const first = '<!-- beegame-material:core-loop-diagram -->'
    const second = '<!-- beegame-material:game-state-flow -->'
    expect(() => validateCompleteGameDocumentMarkdown(
      path,
      markdown.replace(first, `${first}${second}`),
    )).toThrow(/material.*marker.*line/i)
    expect(() => validateCompleteGameDocumentMarkdown(
      path,
      markdown.replace(first, '<!-- beegame-material:scene-transition-diagram -->'),
    )).toThrow(/scene-transition-diagram.*marker/i)
  })

  test('rejects uneven Markdown table pipes with the owning material line', () => {
    const path = 'docs/ART_DIRECTION.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const malformed = replaceMaterialBody(
      markdown,
      'visual-language-board',
      '| Field | Value |\n| --- | --- |\n| authority | complete | stray |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, malformed)).toThrow(
      /visual-language-board.*line/i,
    )
  })

  test('rejects a malformed Mermaid fence with the owning material line', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const malformed = replaceMaterialBody(
      markdown,
      'core-loop-diagram',
      '```mermaid\ngraph TD\nA --> B\n~~~',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, malformed)).toThrow(
      /core-loop-diagram.*line|mermaid.*line/i,
    )
  })

  test('pairs inline backtick runs exactly across lines and respects escaped delimiters', () => {
    const path = 'docs/GDD.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const valid = replaceSectionBody(
      markdown,
      'vision',
      'Valid ``code ` inner\nspan`` continues across the line.',
    )
    expect(validateCompleteGameDocumentMarkdown(path, valid)).toBe(valid)

    const escaped = replaceSectionBody(
      markdown,
      'vision',
      'An escaped \\` delimiter is prose, not a code span.',
    )
    expect(validateCompleteGameDocumentMarkdown(path, escaped)).toBe(escaped)

    const unclosed = replaceSectionBody(
      markdown,
      'vision',
      'The unclosed ``broken `span remains open.',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, unclosed)).toThrow(
      /vision.*line/i,
    )
  })

  test('accepts prose ending with a pipe outside an actual Markdown table', () => {
    const path = 'docs/GDD.md'
    const markdown = replaceSectionBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'vision',
      'Alternative path |',
    )
    expect(validateCompleteGameDocumentMarkdown(path, markdown)).toBe(markdown)
  })

  test('rejects production tables whose rows do not match the header width', () => {
    const path = 'docs/ART_DIRECTION.md'
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const malformed = replaceMaterialBody(
      markdown,
      'visual-language-board',
      '| Field | Value |\n| --- | --- |\n| authority | complete | stray |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, malformed)).toThrow(/table|column|format/i)
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

  test('rejects undefined owner-local keys and aliases in explicit references', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md'
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const declared = replaceMaterialBody(
      base,
      'pacing-beat-table',
      '| ID | Beat |\n| --- | --- |\n| `BEAT-01` | opening |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(
      path,
      replaceSectionBody(declared, 'pacing_beats', 'Owner reference: `BEAT-99` from the owner table.'),
    )).toThrow(/owner-local|undefined|owner key/i)
    expect(() => validateCompleteGameDocumentMarkdown(
      path,
      replaceSectionBody(declared, 'pacing_beats', 'Owner reference: `beat-01` from the owner table.'),
    )).toThrow(/alias|byte-for-byte|owner-local/i)
  })

  test('requires exactly one canonical token in every reference-column cell', () => {
    const path = 'docs/ART_DIRECTION.md'
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const proseReference = replaceMaterialBody(
      base,
      'visual-language-board',
      '| Field | Owner Ref |\n| --- | --- |\n| palette | see upstream |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, proseReference)).toThrow(
      /canonical.*reference|reference.*token|owner-scoped ID/i,
    )

    const multipleReferences = replaceMaterialBody(
      base,
      'visual-language-board',
      '| Field | Owner Ref |\n| --- | --- |\n| palette | state.a, state.b |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, multipleReferences)).toThrow(
      /canonical.*reference|reference.*token|owner-scoped ID/i,
    )
  })

  test('rejects semantic ID aliases and placeholder/CJK IDs', () => {
    const technical = 'docs/TECHNICAL_DESIGN.md'
    const technicalBase = renderTestCompleteGameDocument(
      technical,
      completeTestSubmission(technical),
    )
    expect(() => validateCompleteGameDocumentMarkdown(
      technical,
      replaceSectionBody(
        technicalBase,
        'input_interaction',
        'Owner reference: `action.attack` and `ACTION_ATTACK`.',
      ),
    )).toThrow(/alias|semantic ID|canonical/i)
    expect(() => validateCompleteGameDocumentMarkdown(
      technical,
      replaceSectionBody(technicalBase, 'input_interaction', 'Owner reference: `ACTION_ATTACK`.'),
    )).toThrow(/alias|semantic ID|canonical/i)
    expect(validateCompleteGameDocumentMarkdown(
      technical,
      replaceSectionBody(technicalBase, 'input_interaction', 'Owner reference: `action.jump`，用于跳跃.'),
    )).toBe(replaceSectionBody(technicalBase, 'input_interaction', 'Owner reference: `action.jump`，用于跳跃.'))

    const level = 'docs/LEVEL_SCENE_DESIGN.md'
    const levelBase = renderTestCompleteGameDocument(level, completeTestSubmission(level))
    expect(() => validateCompleteGameDocumentMarkdown(
      level,
      replaceMaterialBody(
        levelBase,
        'pacing-beat-table',
        '| ID | Beat |\n| --- | --- |\n| `占位` | opening |',
      ),
    )).toThrow(/ID|placeholder|CJK|owner/i)
    expect(() => validateCompleteGameDocumentMarkdown(
      technical,
      replaceSectionBody(technicalBase, 'input_interaction', 'Owner reference: `placeholder`.'),
    )).toThrow(/ID|placeholder|owner/i)
  })

  test('rejects copied Balance bounds only outside the numeric owner material', () => {
    const path = 'docs/BALANCE_DESIGN.md'
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    for (const literal of ['[0,1]', '0.1', 'clamp(V_P_FLOOR,V_P_CEIL)', 'clamp(1,5)', '0–3', '≤1']) {
      const owner = replaceMaterialBody(
        base,
        'variable-parameter-table',
        `| ID | Unit | Value | Range |\n| --- | --- | --- | --- |\n| \`var.fuel\` | FU | ${literal} | ${literal} |`,
      )
      expect(() => validateCompleteGameDocumentMarkdown(
        path,
        replaceSectionBody(owner, 'formulas', `Owner reference: \`var.fuel\` = ${literal}.`),
      ), literal).toThrow(/Balance|copied|owner|numeric|formula/i)
    }
    const owner = replaceMaterialBody(
      base,
      'variable-parameter-table',
      '| ID | Unit | Value | Range |\n| --- | --- | --- | --- |\n| `var.fuel` | FU | 0.1 | [0,1] |',
    )
    expect(validateCompleteGameDocumentMarkdown(path, owner)).toBe(owner)
    const copiedTable = replaceSectionBody(
      owner,
      'formulas',
      '| Reference ID | Value |\n| --- | --- |\n| `var.fuel` | 0.1 |',
    )
    expect(() => validateCompleteGameDocumentMarkdown(path, copiedTable)).toThrow(/Balance|copied|owner|numeric|formula/i)
  })

  test('accepts owner-scoped numeric literals and explicit formula/acceptance IDs', () => {
    const level = 'docs/LEVEL_SCENE_DESIGN.md'
    const levelMarkdown = replaceSectionBody(
      renderTestCompleteGameDocument(level, completeTestSubmission(level)),
      'world_structure',
      'Coordinates (0, 0) and a 16:9 responsive viewport are canonical here.',
    )
    expect(validateCompleteGameDocumentMarkdown(level, levelMarkdown)).toBe(levelMarkdown)

    const audio = 'docs/AUDIO_DESIGN.md'
    const audioMarkdown = replaceMaterialBody(
      renderTestCompleteGameDocument(audio, completeTestSubmission(audio)),
      'loudness-delivery-table',
      '| ID | Loudness | Acceptance |\n| --- | --- | --- |\n| `LU-01` | -14 LUFS | `acceptance.audio.loudness` |',
    )
    expect(validateCompleteGameDocumentMarkdown(audio, audioMarkdown)).toBe(audioMarkdown)
  })

  test('requires explicit semantic declarations for Mermaid dotted labels and references', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const undeclaredLabel = replaceMaterialBody(
      base,
      'world-structure-diagram',
      '```mermaid\ngraph TD\n  COMMS[node.comms] --> PWR[route.choice]\n```',
    )
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(path, undeclaredLabel, {
      targetPath: path,
      sources: [],
      symbols: [],
    })).toThrow(/undefined cross-document semantic ID/i)

    const declared = replaceMaterialBody(
      base,
      'world-structure-diagram',
      'Declaration: node.comms, route.choice\n```mermaid\ngraph TD\n  COMMS[node.comms] --> PWR[route.choice]\n```',
    )
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(path, declared, {
      targetPath: path,
      sources: [],
      symbols: [],
    })).not.toThrow()

    const bogusUpstreamReference = replaceMaterialBody(
      base,
      'world-structure-diagram',
      '```mermaid\ngraph TD\n  COMMS[state.missing] --> PWR[Power]\n```',
    )
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(path, bogusUpstreamReference, {
      targetPath: path,
      sources: [],
      symbols: [],
    })).toThrow(/undefined cross-document semantic ID.*state\.missing/i)

    const summaryReference = base.replace(
      'This complete production document establishes actionable authority for the implementation team.',
      'Reference: state.missing.',
    )
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(path, summaryReference, {
      targetPath: path,
      sources: [],
      symbols: [],
    })).toThrow(/undefined cross-document semantic ID.*state\.missing/i)
  })

  test('accepts canonical semantic IDs with hyphen and underscore segments without partial matches', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const exact = replaceMaterialBody(
      base,
      'world-structure-diagram',
      'Declaration: action.assign-crew, param.gen.fuel_consumption, material.game-state-flow, material.variable-parameter-table\n```mermaid\ngraph TD\n  ACTION[action.assign-crew] --> FLOW[material.game-state-flow]\n```',
    )

    expect(() => validateCompleteGameDocumentMarkdown(path, exact)).not.toThrow()
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(path, exact, {
      targetPath: path,
      sources: [],
      symbols: [],
    })).not.toThrow()
  })

  test('rejects an invalid semantic token in an exact declaration column instead of ignoring it', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const markdown = replaceMaterialBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'pacing-beat-table',
      '| ID | Beat |\n| --- | --- |\n| `action.assign/crew` | opening |',
    )

    expect(() => validateCompleteGameDocumentMarkdown(path, markdown)).toThrow(
      /canonical|semantic ID|owner-scoped ID/i,
    )
  })

  test('does not partially classify malformed Mermaid semantic tokens', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const malformed = replaceMaterialBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'world-structure-diagram',
      '```mermaid\ngraph TD\n  ACTION[action.assign/crew] --> PWR[Power]\n```',
    )

    expect(collectCompleteGameDocumentAuthorityReferences(path, malformed)).not.toContain(
      'action.assign',
    )
  })

  test('rejects repeated semantic declarations within one owner block', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const markdown = replaceSectionBody(
      renderTestCompleteGameDocument(path, completeTestSubmission(path)),
      'world_structure',
      'Declaration: state.flow\nDeclaration: state.flow',
    )

    expect(() => validateCompleteGameDocumentMarkdown(path, markdown)).toThrow(
      /semantic ID is declared more than once/i,
    )
  })

  test('treats Asset sibling inventory keys as references, not declarations', () => {
    const path = 'docs/ASSET_PLAN.md' as const
    const base = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    const inventory = replaceMaterialBody(
      base,
      'asset-inventory-table',
      '| ID | Requirement |\n| --- | --- |\n| `asset.hero` | player character |',
    )
    const sibling = replaceMaterialBody(
      inventory,
      'responsibility-matrix',
      '| Inventory ID | Creator |\n| --- | --- |\n| `asset.hero` | Art |',
    )
    expect(collectCompleteGameDocumentAuthoritySymbols(path, sibling)).toEqual([
      { id: 'asset.hero', documentPath: path, sectionId: 'material.asset-inventory-table' },
    ])
    expect(validateCompleteGameDocumentMarkdown(path, sibling)).toBe(sibling)
  })

  test('does not classify unavailable or unresolved prose as freshness state', () => {
    const path = 'docs/LEVEL_SCENE_DESIGN.md' as const
    const markdown = renderTestCompleteGameDocument(path, completeTestSubmission(path))
    expect(() => assertCompleteGameDocumentCrossDocumentReferences(
      path,
      markdown.replace(
        'Production-ready World and Scene Structure authority',
        'The word unavailable is narrative prose; unresolved is also narrative prose.',
      ),
      {
        targetPath: path,
        sources: [{ path: 'docs/GDD.md', sections: [] }],
        symbols: [],
      },
    )).not.toThrow()
  })

})

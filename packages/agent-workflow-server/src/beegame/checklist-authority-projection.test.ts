import { createHash } from 'node:crypto'
import { expect, test } from 'bun:test'
import {
  buildChecklistAuthorityProjection,
  type ChecklistAuthority,
} from './checklist-authority-projection'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './foundation-documents'

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function authority(
  overrides: Partial<ChecklistAuthority> = {},
): ChecklistAuthority {
  const documents = CANONICAL_FOUNDATION_DOCUMENTS.map((path, index) => {
    const content = [
      `# ${['游戏愿景', '場景設計', '数值平衡', '技术架构', '视觉方向', '用户界面', '音频设计', '资产计划'][index]}`,
      `自然语言正文 ${index + 1}，不依赖旧标记。`,
    ].join('\n')
    return { path, content, digest: sha256(content) }
  })
  const documentSetDigest = sha256(
    JSON.stringify(documents.map(document => [document.path, document.digest])),
  )
  return {
    foundationRevision: documentSetDigest,
    documentSetDigest,
    documents,
    irResultId: 'ir-publication-1',
    irModules: [
      {
        moduleId: 'implementation-verification',
        nodes: [
          {
            id: 'acceptance-collect-coin',
            kind: 'implementation-verification.acceptance-scenario',
            value: {
              label: '集めた硬貨が表示される',
              precondition: '玩家进入关卡',
              action: '收集一枚硬貨',
              expectedOutcome: '分数增加一枚硬貨',
            },
            bindings: {
              source: {
                documentPath: 'docs/GDD.md',
                sectionId: '玩法概述',
                sourcePointer: '/value/action',
              },
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

test('projects complete accepted documents and verified scenarios without legacy markers', () => {
  const input = authority()
  const projection = buildChecklistAuthorityProjection({
    checklistAuthority: input,
    approvedDocumentRevision: input.foundationRevision,
  })

  expect(projection).toContain(
    'Approved foundation revision: ' + input.foundationRevision,
  )
  expect(projection).toContain('Verified IR result: ir-publication-1')
  expect(projection).toContain('# 游戏愿景')
  expect(projection).toContain('# 場景設計')
  expect(projection).toContain('acceptance-collect-coin')
  expect(projection).toContain('source excerpt references')
  expect(projection).not.toContain('beegame-section:')
  expect(projection).not.toContain('beegame-material:')
})

test('rejects altered document bytes, document-set digest, or approved revision', () => {
  const input = authority()
  const changedDocuments = input.documents.map(document =>
    document.path === 'docs/GDD.md'
      ? { ...document, content: document.content + '\n篡改' }
      : document,
  )
  expect(() =>
    buildChecklistAuthorityProjection({
      checklistAuthority: { ...input, documents: changedDocuments },
      approvedDocumentRevision: input.foundationRevision,
    }),
  ).toThrow('document digest mismatch')
  expect(() =>
    buildChecklistAuthorityProjection({
      checklistAuthority: { ...input, documentSetDigest: '0'.repeat(64) },
      approvedDocumentRevision: input.foundationRevision,
    }),
  ).toThrow('document set digest mismatch')
  expect(() =>
    buildChecklistAuthorityProjection({
      checklistAuthority: input,
      approvedDocumentRevision: '0'.repeat(64),
    }),
  ).toThrow('does not match approved document revision')
})

test('does not require a fixed number of IR scenarios', () => {
  const input = authority({
    irModules: [{ moduleId: 'implementation-verification', nodes: [] }],
  })
  expect(
    buildChecklistAuthorityProjection({
      checklistAuthority: input,
      approvedDocumentRevision: input.foundationRevision,
    }),
  ).not.toContain('VERIFIED ACCEPTANCE SCENARIO')
})

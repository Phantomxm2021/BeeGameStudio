import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { designSourceLocations } from './design-source-reading'
import { runGameContentCommand } from './game-content-validation-cli'

test('source directory includes unindexed headings; batch reader returns exact current clauses only', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-section-read-'))
  try {
    mkdirSync(join(root, 'docs'))
    const body = '# GDD\nIntro\n## Input\nKeyboard.\n### Recovery\nRelease keys.\n## Unrelated\nUnrelated details.\n'
    writeFileSync(join(root, 'docs/GDD.md'), body)
    const locations = designSourceLocations(root, ['GDD.md'])
    const location = locations[0]!
    if (!('sections' in location)) throw Error('Fixture source unavailable')
    expect(location.sections.map(s => s.heading)).toEqual(['GDD', 'Input', 'Recovery', 'Unrelated'])
    expect(JSON.stringify(locations)).not.toContain('Keyboard.')
    const result: any = runGameContentCommand(root, ['--read-design', JSON.stringify([{ document: 'GDD.md', sections: ['Input', 'Recovery'] }])])
    expect(result.sources[0].reads).toHaveLength(1)
    expect(result.sources[0].reads[0].text).toBe('## Input\nKeyboard.\n### Recovery\nRelease keys.')
    expect(JSON.stringify(result)).not.toContain('Unrelated details')
    writeFileSync(join(root, 'docs/GDD.md'), body.replace('Keyboard.', 'Gamepad.'))
    expect(JSON.stringify(runGameContentCommand(root, ['--read-design', JSON.stringify([{ document: 'GDD.md', sections: ['Input'] }])]))).toContain('Gamepad.')
    for (const document of ['../GDD.md', 'OTHER.md']) expect(() => runGameContentCommand(root, ['--read-design', JSON.stringify([{ document, sections: ['Input'] }])])).toThrow()
    expect(() => runGameContentCommand(root, ['--read-design', JSON.stringify([{ document: 'GDD.md', sections: ['Absent'] }])])).toThrow('missing/ambiguous')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('explicit Review source batch retains unselected promises, exact bytes and missing evidence without scanning history', () => {
  const root = mkdtempSync(join(tmpdir(), 'bgs-review-snapshot-'))
  try {
    mkdirSync(join(root, 'docs')); mkdirSync(join(root, 'tests')); mkdirSync(join(root, 'transcripts'))
    const design = '# Sound\n## Limits\nAt most three voices; measured level <= 0.25.\n## Evidence\nOnly silence tested.\n'
    writeFileSync(join(root, 'docs/AUDIO_DESIGN.md'), design)
    writeFileSync(join(root, 'tests/probe.mjs'), '// AUTHOR TEST PASSED: silence only\n')
    writeFileSync(join(root, 'transcripts/private.jsonl'), 'PRIVATE_HISTORY_NOT_A_SOURCE')
    const files = ['docs/AUDIO_DESIGN.md', 'tests/probe.mjs']
    const result: any = runGameContentCommand(root, ['--review-sources', ...files, '--details'])
    expect(result.valid).toBe(true); expect(result.semanticCoverage).toBe('not-certified')
    expect(result.sources).toHaveLength(2); expect(result.sources[0].text).toBe(design)
    expect(result.sources[0].sha256).toBe(createHash('sha256').update(design).digest('hex'))
    expect(JSON.stringify(result)).not.toContain('PRIVATE_HISTORY_NOT_A_SOURCE')
    const small: any = runGameContentCommand(root, ['--review-sources', ...files])
    expect(small.sources[0].sections.map((s:any)=>s.heading)).toEqual(['Sound','Limits','Evidence'])
    expect(small.sources[0].text).toBeUndefined()
    const missing: any = runGameContentCommand(root, ['--review-sources', ...files, 'reports/missing.json'])
    expect(missing.valid).toBe(false); expect(missing.sources[0].sha256).toBe(result.sources[0].sha256)
    expect(missing.sources[2].unavailable).toBeTruthy()
    symlinkSync(join(root, 'docs'), join(root, 'linked'))
    for (const path of ['../outside', '/tmp/outside', 'linked/AUDIO_DESIGN.md', 'transcripts/private.jsonl', 'docs/../docs/AUDIO_DESIGN.md']) {
      expect((runGameContentCommand(root, ['--review-sources', path]) as any).valid).toBe(false)
    }
    expect(readFileSync(join(root, 'docs/AUDIO_DESIGN.md'), 'utf8')).toBe(design)
    expect(() => runGameContentCommand(root, ['--review-sources'])).toThrow('Usage')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

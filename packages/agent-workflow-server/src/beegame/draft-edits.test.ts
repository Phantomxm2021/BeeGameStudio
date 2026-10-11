import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, linkSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyDraftEdits } from './draft-edits'
import { materializeSceneUiFormat } from './scene-ui-content-authoring'
import { sharedContentChecker } from './content-checker-runtime'

async function fixture(run: (root: string) => unknown) {
  const root = mkdtempSync(join(tmpdir(), 'bgs-draft-edits-'))
  try {
    mkdirSync(join(root, 'docs'))
    mkdirSync(join(root, 'content/ui'), { recursive: true })
    writeFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), '# Technical\r\nUnchanged rule.\r\n## Integration\r\nPending.\r\n')
    writeFileSync(join(root, 'content/ui/menu.json'), '{"size":[100,20],"text":"Play"}\n')
    await run(root)
  } finally { chmodSync(join(root, 'content/ui'), 0o755); rmSync(root, { recursive: true, force: true }) }
}
const edit = (file: string, old: string, next: string) => ({ file, replacements: [{ old, new: next }] })

test('grouped exact edits preserve unchanged bytes and append integration without replaying the baseline', () => fixture(root => {
  const result = applyDraftEdits(root, [
    { file: 'docs/TECHNICAL_DESIGN.md', replacements: [
      { old: 'Pending.', new: 'Connected.' },
      { old: 'Connected.\r\n', new: 'Connected.\r\n## Tasks\r\nUse $& literally.\r\n' },
    ] }, edit('content/ui/menu.json', '[100,20]', '[100,44]'),
  ])
  expect(result).toMatchObject({ valid: true, written: ['docs/TECHNICAL_DESIGN.md', 'content/ui/menu.json'], pending: [], issues: [] })
  expect(readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), 'utf8')).toBe('# Technical\r\nUnchanged rule.\r\n## Integration\r\nConnected.\r\n## Tasks\r\nUse $& literally.\r\n')
  expect(readFileSync(join(root, 'content/ui/menu.json'), 'utf8')).toBe('{"size":[100,44],"text":"Play"}\n')
}))

test.each(['missing', 'ambiguous', 'json', 'duplicate', 'empty-old', 'unknown-field', 'utf8'] as const)('preflight %s failure leaves all files untouched', mode => fixture(root => {
  const file = 'content/ui/menu.json'
  if (mode === 'ambiguous') writeFileSync(join(root, file), '{"a":"Play","b":"Play"}')
  if (mode === 'utf8') writeFileSync(join(root, file), Buffer.from([0xff, 0xfe]))
  const before = readFileSync(join(root, file)), tech = readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'))
  const bad: any = edit(file, mode === 'missing' ? 'absent' : 'Play', mode === 'json' ? '"' : 'Start')
  if (mode === 'empty-old') bad.replacements[0].old = ''
  if (mode === 'unknown-field') bad.unknown = true
  const request = [edit('docs/TECHNICAL_DESIGN.md', 'Pending.', 'Connected.'), bad]
  if (mode === 'duplicate') request.push(bad)
  expect(applyDraftEdits(root, request)).toMatchObject({ valid: false, written: [] })
  expect(readFileSync(join(root, file))).toEqual(before)
  expect(readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'))).toEqual(tech)
}))

test('all replacements are explicit and permissions, BOM and whitespace are preserved', () => fixture(root => {
  const path = join(root, 'docs/TECHNICAL_DESIGN.md')
  writeFileSync(path, '\uFEFFOne. One.\n'); chmodSync(path, 0o640)
  expect(applyDraftEdits(root, [{ file: 'docs/TECHNICAL_DESIGN.md', replacements: [{ old: 'One.', new: 'Two.', all: true }] }]).valid).toBe(true)
  expect(readFileSync(path, 'utf8')).toBe('\uFEFFTwo. Two.\n')
  expect(statSync(path).mode & 0o777).toBe(0o640)
}))

test.each(['../outside.json', 'docs/../docs/TECHNICAL_DESIGN.md', 'content/ui/../../outside.json',
  'docs/OTHER.md', '.beegame/delivery/check-content.mjs', '/tmp/other.json', 'content//ui/menu.json', 'content\\ui\\menu.json'])
('editing does not widen path scope: %s', path => fixture(root => {
  expect(applyDraftEdits(root, [edit(path, 'Play', 'Start')])).toMatchObject({ valid: false, written: [] })
}))

test.each(['symlink', 'parent-symlink', 'hardlink'] as const)('alias rejection preserves the target: %s', mode => fixture(root => {
  const source = join(root, 'content/ui/menu.json')
  let file = 'content/ui/alias.json'
  if (mode === 'symlink') symlinkSync(source, join(root, file))
  else if (mode === 'hardlink') linkSync(source, join(root, file))
  else { symlinkSync(join(root, 'content/ui'), join(root, 'content/ui/alias')); file = 'content/ui/alias/menu.json' }
  expect(applyDraftEdits(root, [edit(file, 'Play', 'Start')])).toMatchObject({ valid: false, written: [] })
  expect(readFileSync(source, 'utf8')).toContain('Play')
}))

test.skipIf(process.getuid?.() === 0)('commit failure reports already written and pending files without repeating completed edits', () => fixture(root => {
  chmodSync(join(root, 'content/ui'), 0o555)
  const result = applyDraftEdits(root, [edit('docs/TECHNICAL_DESIGN.md', 'Pending.', 'Connected.'), edit('content/ui/menu.json', 'Play', 'Start')])
  expect(result).toMatchObject({ valid: false, written: ['docs/TECHNICAL_DESIGN.md'], pending: ['content/ui/menu.json'] })
  expect(readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), 'utf8')).toContain('Connected.')
  expect(readFileSync(join(root, 'content/ui/menu.json'), 'utf8')).toContain('Play')
}))

test('materialized helper uses the shared runtime; a bad request exits failed without editing', () => fixture(async root => {
  await materializeSceneUiFormat(root)
  const runtime = await sharedContentChecker()
  writeFileSync(join(root, 'request.json'), JSON.stringify([edit('docs/TECHNICAL_DESIGN.md', 'Pending.', 'Connected.')]))
  for (const success of [true, false]) {
    const child = Bun.spawn([process.execPath, join(root, '.beegame/delivery/edit-drafts.mjs'), 'request.json'],
      { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
    const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(success ? 0 : 1)
    expect(JSON.parse(out).valid).toBe(success)
  }
}))

test('inline CLI applies multiple exact edits without a request file, preserving literal shell-sensitive text', () => fixture(async root => {
  await materializeSceneUiFormat(root)
  const runtime = await sharedContentChecker()
  const request = [edit('docs/TECHNICAL_DESIGN.md', 'Pending.', 'Connected: $& `literal` "quotes".'),
    edit('content/ui/menu.json', 'Play', 'Start')]
  const child = Bun.spawn([process.execPath, '.beegame/delivery/edit-drafts.mjs', '--json', JSON.stringify(request)],
    { cwd: root, env: { ...process.env, BEEGAME_CONTENT_CHECKER_MODULE: runtime.moduleUrl }, stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  expect(JSON.parse(out).written).toHaveLength(2)
  expect(readFileSync(join(root, 'docs/TECHNICAL_DESIGN.md'), 'utf8')).toContain('Connected: $& `literal` "quotes".')
}))

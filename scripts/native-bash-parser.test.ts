import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_BUILD_FEATURES, getMacroDefines } from './defines'
import { getParserModule } from '../src/utils/bash/bashParser'
import { parseForSecurityFromAst } from '../src/utils/bash/ast'

const scriptCommand = [
  "cat > probe.ts <<'EOF'",
  "console.log(`result=${JSON.stringify({ title: '游戏' })}`);",
  'EOF',
  'bun run probe.ts',
].join('\n')

const analyze = (command: string) => {
  const root = getParserModule()!.parse(command, Infinity)
  expect(root).not.toBeNull()
  return parseForSecurityFromAst(command, root!)
}

describe('native Bash parser shipped capability', () => {
  test('default build retains the parser and accepts literal TypeScript heredocs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bgs-parser-build-'))
    try {
      const build = await Bun.build({
        entrypoints: [resolve(import.meta.dir, '../src/utils/bash/parser.ts')],
        outdir: root, target: 'bun', features: [...DEFAULT_BUILD_FEATURES],
        define: getMacroDefines(),
      })
      expect(build.success).toBe(true)
      const parser = await import(build.outputs.find(output => output.kind === 'entry-point')!.path)
      const ast = await parser.parseCommandRaw(scriptCommand)
      expect(ast).not.toBeNull()
      expect(typeof ast).not.toBe('symbol')
      expect(parseForSecurityFromAst(scriptCommand, ast).kind).toBe('simple')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('ignores shell-like characters only in a validated quoted heredoc body', () => {
    const result = analyze(scriptCommand)
    expect(result.kind).toBe('simple')
    if (result.kind === 'simple') expect(result.commands.map(command => command.argv[0])).toEqual(['cat', 'bun'])
  })

  test('handles Unicode before the body without masking the following command', () => {
    const result = analyze('echo 中文\n' + scriptCommand + '\nrm important.txt')
    expect(result.kind).toBe('simple')
    if (result.kind === 'simple') expect(result.commands.at(-1)?.argv).toEqual(['rm', 'important.txt'])
  })

  test.each([
    "cat <<EOF\n`touch /tmp/unsafe`\nEOF",
    "cat <<'EOF' | eval dangerous\nliteral\nEOF",
    "cat <<'EOF'\nliteral\nEOF\necho {a,'b'}",
    "cat <<'EOF'\nliteral\nEOF\necho ~[dynamic]",
    "cat <<'EOF'\nliteral\nEOF\necho\u00a0bad",
  ])('still rejects executable or ambiguous shell syntax: %s', command => {
    expect(analyze(command).kind).toBe('too-complex')
  })
})

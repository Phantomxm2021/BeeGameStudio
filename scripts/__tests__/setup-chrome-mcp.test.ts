import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Put the script outside the repository dependency tree. An active setup path
// fails at module resolution, before running any Chrome registration command.
test('standalone setup accepts the BGS skip flag and gives explicit BGS values precedence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bgs-chrome-setup-test-'))
  const script = join(directory, 'setup.mjs')
  try {
    writeFileSync(script, readFileSync(resolve(import.meta.dir, '../setup-chrome-mcp.mjs')))
    for (const [flags, skipped] of [
      [{ BGS_SKIP_CHROME_MCP_SETUP: '1' }, true],
      [{ CLAUDE_CODE_SKIP_CHROME_MCP_SETUP: '1' }, true],
      [{ BGS_SKIP_CHROME_MCP_SETUP: '0', CLAUDE_CODE_SKIP_CHROME_MCP_SETUP: '1' }, false],
      [{ BGS_SKIP_CHROME_MCP_SETUP: '', CLAUDE_CODE_SKIP_CHROME_MCP_SETUP: '1' }, false],
    ] as const) {
      const result = Bun.spawnSync([process.execPath, script, 'doctor'], {
        cwd: directory,
        env: { PATH: process.env.PATH ?? '', ...flags },
        stdout: 'pipe', stderr: 'pipe',
      })
      expect(result.exitCode === 0).toBe(skipped)
      if (!skipped) expect(result.stderr.toString()).toContain('@claude-code-best/mcp-chrome-bridge')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

import { expect, test } from 'bun:test'
import { quote } from 'shell-quote'
import { encodeSandboxShellCommand, quoteSandboxCommandForEval } from '../sandboxCommand'

for (const command of [
  `python3 - <<'PY'
assert 1 != 2
print('bang! 引号 " and dollar $ stay literal')
PY`,
  "printf '%s\\n' '! != single' | /usr/bin/wc -l",
  "value='retained!'; eval 'printf %s \"$value\"'",
  "printf '%s' 'before!'; exit 7",
]) test('sandbox transport preserves command semantics: ' + command.slice(0, 35), async () => {
  async function run(value: string) {
    const child = Bun.spawn(['/bin/sh', '-c', value], { stdout: 'pipe', stderr: 'pipe' })
    const [out, error, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { out, error, exit }
  }
  const direct = await run(command)
  expect(direct.exit).toBe(command.includes('exit 7') ? 7 : 0)
  const wrapped = await run('/bin/sh -c ' + quote([encodeSandboxShellCommand(command)]))
  const assembled = await run('/bin/sh -c ' + quote([encodeSandboxShellCommand('eval ' +
    quoteSandboxCommandForEval(command, !command.includes('<<')))]))
  expect(wrapped).toEqual(direct)
  expect(assembled).toEqual(direct)
  expect(encodeSandboxShellCommand(command)).not.toContain('!')
})

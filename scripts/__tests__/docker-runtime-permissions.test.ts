import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

describe('Docker runtime permissions', () => {
  test('runtime entrypoint repairs mounted project directory permissions before dropping privileges', () => {
    const dockerfile = readRepoFile('docker/Dockerfile.runtime')
    const entrypoint = readRepoFile('docker/runtime-entrypoint.sh')

    expect(dockerfile).toContain('su-exec')
    expect(dockerfile).not.toContain('\nUSER bun\n')
    expect(entrypoint).toContain('runtime_user="${BEEGAME_RUNTIME_USER:-bun}"')
    expect(entrypoint).toContain('runtime_group="${BEEGAME_RUNTIME_GROUP:-bun}"')
    expect(entrypoint).toContain('chown -R "$runtime_user:$runtime_group"')
    expect(entrypoint).toContain('${AGENT_WORKFLOW_WORKSPACE_PATH:-${BEEGAME_WORKSPACE_ROOT:-/srv/beegame/projects}}')
    expect(entrypoint).toContain('exec su-exec "$runtime_user:$runtime_group" "$@"')
  })
})

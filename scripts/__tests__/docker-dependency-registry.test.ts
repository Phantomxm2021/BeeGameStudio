import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

describe('Docker dependency registry', () => {
  test('keeps Bun lockfile tarballs on the npm registry for reproducible Docker builds', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('registry.npmmirror.com')
    expect(lockfile).toContain('registry.npmjs.org')
  })

  test('pins Docker Bun installs to the npm registry with conservative network concurrency', () => {
    const frontendDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.frontend'), 'utf8')
    const runtimeDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.runtime'), 'utf8')
    const expectedInstall = 'bun install --frozen-lockfile --registry=https://registry.npmjs.org/ --network-concurrency=8 --no-progress'

    expect(frontendDockerfile).toContain(expectedInstall)
    expect(runtimeDockerfile).toContain(expectedInstall)
  })
})

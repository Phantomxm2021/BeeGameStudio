import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

describe('Docker dependency registry', () => {
  test('keeps Bun lockfile tarballs away from unstable mirror registries', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('registry.npmmirror.com')
  })

  test('keeps frontend Docker builds independent from the root Bun workspace install', () => {
    const frontendDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.frontend'), 'utf8')

    expect(frontendDockerfile).toContain('COPY apps/frontend/package.json apps/frontend/package-lock.json ./')
    expect(frontendDockerfile).toContain('npm ci --workspaces=false --no-audit --no-fund')
    expect(frontendDockerfile).not.toContain('bun install --frozen-lockfile')
    expect(frontendDockerfile).not.toContain('COPY packages ./packages')
  })

  test('pins runtime Docker Bun install to the npm registry with conservative network concurrency', () => {
    const runtimeDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.runtime'), 'utf8')
    const expectedInstall = 'bun install --frozen-lockfile --registry=https://registry.npmjs.org/ --network-concurrency=8 --no-progress'

    expect(runtimeDockerfile).toContain(expectedInstall)
  })

  test("keeps runtime source copies after dependency install for Docker cache reuse", () => {
    const runtimeDockerfile = readFileSync(join(repoRoot, "docker/Dockerfile.runtime"), "utf8")
    const installIndex = runtimeDockerfile.indexOf("RUN bun install --frozen-lockfile")

    expect(installIndex).toBeGreaterThan(-1)
    expect(runtimeDockerfile.indexOf("COPY packages ./packages")).toBeGreaterThan(installIndex)
    expect(runtimeDockerfile.indexOf("COPY src ./src")).toBeGreaterThan(installIndex)
    expect(runtimeDockerfile.indexOf("COPY packages/agent-workflow-server/package.json ./packages/agent-workflow-server/package.json")).toBeLessThan(installIndex)
  })
})

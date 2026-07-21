import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

describe('Docker dependency registry', () => {
  test('keeps Bun lockfile tarballs away from legacy taobao mirror registries', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('registry.npm.taobao.org')
  })

  test('keeps frontend Docker builds independent from the root Bun workspace install', () => {
    const frontendDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.frontend'), 'utf8')

    expect(frontendDockerfile).toContain('COPY apps/frontend/package.json apps/frontend/package-lock.json ./')
    expect(frontendDockerfile).toContain('npm ci --workspaces=false --no-audit --no-fund')
    expect(frontendDockerfile).not.toContain('bun install --frozen-lockfile')
    expect(frontendDockerfile).not.toContain('COPY packages ./packages')
  })

  test('shares one cached Bun workspace install across backend image targets', () => {
    const dockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.backend'), 'utf8')

    expect(dockerfile).toContain('ARG BUN_INSTALL_NETWORK_CONCURRENCY=2')
    expect(dockerfile).toContain('--mount=type=cache,target=/root/.bun/install/cache')
    expect(dockerfile).toContain('bun install --frozen-lockfile --registry=https://registry.npmmirror.com/ --network-concurrency=${BUN_INSTALL_NETWORK_CONCURRENCY} --no-progress')
    expect(dockerfile.match(/bun install --frozen-lockfile/g)).toHaveLength(1)
    expect(dockerfile).toContain('FROM backend-source AS runtime')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS billing')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS skills')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS resources')
  })

  test('keeps backend source copies after dependency install for Docker cache reuse', () => {
    const backendDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.backend'), 'utf8')
    const installIndex = backendDockerfile.indexOf('bun install --frozen-lockfile')

    expect(installIndex).toBeGreaterThan(-1)
    expect(backendDockerfile.indexOf('COPY packages ./packages')).toBeGreaterThan(installIndex)
    expect(backendDockerfile.indexOf('COPY src ./src')).toBeGreaterThan(installIndex)
    expect(backendDockerfile.indexOf('COPY packages/agent-workflow-server/package.json ./packages/agent-workflow-server/package.json')).toBeLessThan(installIndex)
  })

  test('uses the shared backend Dockerfile with an explicit target for every backend service', () => {
    const compose = readFileSync(join(repoRoot, 'docker/docker-compose.yml'), 'utf8')

    expect(compose.match(/dockerfile: docker\/Dockerfile\.backend/g)).toHaveLength(4)
    for (const target of ['runtime', 'billing', 'skills', 'resources']) {
      expect(compose).toContain(`target: ${target}`)
    }
  })
})

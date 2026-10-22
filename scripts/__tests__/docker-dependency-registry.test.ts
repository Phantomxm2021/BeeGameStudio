import { readFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..')

describe('Docker dependency registry', () => {
  test('every explicit backend COPY input exists in the current source tree', () => {
    const dockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.backend'), 'utf8')
    for (const line of dockerfile.split('\n').filter(line => line.startsWith('COPY ') && !line.includes('--from='))) {
      for (const source of line.split(/\s+/).slice(1, -1)) expect(existsSync(join(repoRoot, source))).toBe(true)
    }
  })
  test('keeps Bun lockfile tarballs away from legacy taobao mirror registries', () => {
    const lockfile = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

    expect(lockfile).not.toContain('registry.npm.taobao.org')
  })

  test('frontend installs the locked workspace before building shared source', () => {
    const dockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.frontend'), 'utf8')
    const installIndex = dockerfile.indexOf('bun install --ignore-scripts --frozen-lockfile')
    expect(installIndex).toBeGreaterThan(-1)
    const dependencyInputs = new Set(dockerfile.slice(0, installIndex).split('\n')
      .filter(line => line.startsWith('COPY ') && !line.includes('--from='))
      .flatMap(line => line.split(/\s+/).slice(1, -1)))
    for (const file of ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', 'tsconfig.base.json']) {
      expect(dependencyInputs.has(file)).toBe(true)
    }
    // Every root workspace must exist when Bun validates its frozen lockfile.
    for (const parent of ['apps', 'packages']) {
      for (const name of readdirSync(join(repoRoot, parent))) {
        const manifest = `${parent}/${name}/package.json`
        if (existsSync(join(repoRoot, manifest))) expect(dependencyInputs.has(manifest)).toBe(true)
      }
    }
    expect(dockerfile.indexOf('COPY apps/frontend ./apps/frontend')).toBeGreaterThan(installIndex)
    expect(dockerfile.indexOf('COPY packages ./packages')).toBeGreaterThan(installIndex)
    expect(dockerfile).toContain('WORKDIR /app/apps/frontend')
    expect(dockerfile).toContain('RUN bun run build')
    expect(dockerfile).toContain('COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html')
    expect(dockerfile).not.toContain('npm ci')
    expect(existsSync(join(repoRoot, 'apps/frontend/package-lock.json'))).toBe(false)
    const ci = readFileSync(join(repoRoot, '.github/workflows/frontend-checks.yml'), 'utf8')
    const bunVersion = ci.match(/bun-version: '([^']+)'/)?.[1]
    expect(bunVersion).toBeDefined()
    expect(dockerfile).toContain(`FROM oven/bun:${bunVersion}-alpine`)
  })

  test('both frontend Dockerfile paths use the same isolated workspace context', () => {
    for (const suffix of ['', '.dockerignore']) {
      expect(realpathSync(join(repoRoot, `apps/frontend/Dockerfile${suffix}`)))
        .toBe(join(repoRoot, `docker/Dockerfile.frontend${suffix}`))
    }
    const ignore = readFileSync(join(repoRoot, 'docker/Dockerfile.frontend.dockerignore'), 'utf8')
    expect(ignore.split('\n')).toContain('**')
    for (const pattern of ['!packages/**', '!apps/frontend/**', '**/node_modules', '**/dist', '**/.env', '**/.env.*']) {
      expect(ignore.split('\n')).toContain(pattern)
    }
    expect(ignore).not.toContain('!vendor')
    expect(ignore).not.toContain('!Projects')
  })

  test('shares one cached Bun workspace install across backend image targets', () => {
    const dockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.backend'), 'utf8')

    expect(dockerfile).toContain('ARG BUN_INSTALL_NETWORK_CONCURRENCY=2')
    expect(dockerfile).toContain('ARG BUN_INSTALL_REGISTRY=https://registry.npmmirror.com/')
    expect(dockerfile).toContain('--mount=type=cache,target=/root/.bun/install/cache')
    expect(dockerfile).toContain('bun install --ignore-scripts --frozen-lockfile --registry=${BUN_INSTALL_REGISTRY} --network-concurrency=${BUN_INSTALL_NETWORK_CONCURRENCY} --no-progress')
    expect(dockerfile.match(/bun install --ignore-scripts --frozen-lockfile/g)).toHaveLength(1)
    expect(dockerfile).toContain('FROM backend-source AS runtime')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS billing')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS skills')
    expect(dockerfile).toContain('FROM oven/bun:1.3-alpine AS resources')
  })

  test('keeps backend source copies after dependency install for Docker cache reuse', () => {
    const backendDockerfile = readFileSync(join(repoRoot, 'docker/Dockerfile.backend'), 'utf8')
    const installIndex = backendDockerfile.indexOf('bun install --ignore-scripts --frozen-lockfile')

    expect(installIndex).toBeGreaterThan(-1)
    expect(backendDockerfile.indexOf('COPY packages ./packages')).toBeGreaterThan(installIndex)
    expect(backendDockerfile).not.toContain('COPY src ./src')
    expect(backendDockerfile.indexOf('COPY packages/agent-workflow-server/package.json ./packages/agent-workflow-server/package.json')).toBeLessThan(installIndex)
  })

  test('uses the shared backend Dockerfile with an explicit target for every backend service', () => {
    const compose = readFileSync(join(repoRoot, 'docker/docker-compose.yml'), 'utf8')

    expect(compose.match(/dockerfile: docker\/Dockerfile\.backend/g)).toHaveLength(4)
    for (const target of ['runtime', 'billing', 'skills', 'resources']) {
      expect(compose).toContain(`target: ${target}`)
    }
  })

  test('lets the Docker launcher apply one custom registry to all Bun builds', () => {
    const launcher = readFileSync(join(repoRoot, 'scripts/beegame-docker.sh'), 'utf8')
    const compose = readFileSync(join(repoRoot, 'docker/docker-compose.yml'), 'utf8')

    expect(launcher).toContain('package_registry="${BEEGAME_PACKAGE_REGISTRY:-}"')
    expect(launcher).toContain("package_registry=\"$(sed -n 's/^BEEGAME_PACKAGE_REGISTRY=//p' \"$ENV_FILE\" | tail -n 1)\"")
    expect(launcher).toContain('package_registry="${package_registry:-https://registry.npmmirror.com/}"')
    expect(launcher).toContain('--registry=*)')
    expect(launcher).toContain('export BEEGAME_PACKAGE_REGISTRY="$package_registry"')
    expect(compose.match(/BUN_INSTALL_REGISTRY: \$\{BEEGAME_PACKAGE_REGISTRY:-https:\/\/registry\.npmmirror\.com\/\}/g)).toHaveLength(5)
    expect(compose).not.toContain('NPM_INSTALL_REGISTRY')
  })
})

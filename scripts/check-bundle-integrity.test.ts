import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { listBundleJavaScript } from './check-bundle-integrity'

test('checks active generation and nested chunks, not retained historical builds', async () => {
  const root = await mkdtemp('/private/tmp/bgs-bundle-check-')
  try {
    for (const path of ['build-current/chunks', 'build-old']) await mkdir(join(root, path), { recursive: true })
    await writeFile(join(root, 'cli.js'), 'import "./build-current/cli.js"\n')
    await writeFile(join(root, 'build-current/cli.js'), 'import "./chunks/actual.js"\n')
    await writeFile(join(root, 'build-current/chunks/actual.js'), 'import "../missing.js"\n')
    await writeFile(join(root, 'build-old/cli.js'), 'old unrelated code')
    expect(await listBundleJavaScript(root)).toEqual(['build-current/chunks/actual.js', 'build-current/cli.js', 'cli.js'])
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'check-bundle-integrity.ts'), root], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(1)
    expect(output).toContain('../missing.js')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('rejects empty build folders instead of reporting success', async () => {
  const root = await mkdtemp('/private/tmp/bgs-empty-bundle-')
  try { await expect(listBundleJavaScript(root)).rejects.toThrow('Missing CLI entry') }
  finally { await rm(root, { recursive: true, force: true }) }
})

test('unrelated JS files do not mask a missing CLI entry', async () => {
  const root = await mkdtemp('/private/tmp/bgs-missing-entry-')
  try {
    await writeFile(join(root, 'orphan.js'), 'console.log("not a CLI")')
    await expect(listBundleJavaScript(root)).rejects.toThrow('Missing CLI entry')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('static dependencies use the target manifest, not the source repository, and accept declared subpaths', async () => {
  const root = await mkdtemp('/private/tmp/bgs-static-dependency-')
  try {
    await writeFile(join(root, 'cli.js'), `import sharp from 'sharp'; import declared from 'fixture-package/subpath'; import bogus from 'node:not-real'; import { DatabaseSync } from 'node:sqlite';`)
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'fixture-package': '1.0.0' } }))
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'check-bundle-integrity.ts'), root], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(1)
    expect(output).toContain('"sharp"')
    expect(output).toContain('"node:not-real"')
    expect(output).not.toContain('"fixture-package/subpath"')
    expect(output).toContain('2 个错误')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('does not mistake undici for a Node builtin or hide a missing dependency as a fallback', async () => {
  const root = await mkdtemp('/private/tmp/bgs-dependency-check-')
  try {
    await writeFile(join(root, 'cli.js'), "try { await import('@napi-rs/keyring'); } catch {} __require('undici');\n")
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'check-bundle-integrity.ts'), root], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(1)
    expect(output).toContain('"undici"')
    expect(output).toContain('1 个错误, 1 个警告')
    expect(output).toContain('加密文件回退')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each([
  ['syntax', 'export const broken = ;', 'JavaScript 语法错误'],
  ['renamed-loader', `import {createRequire as make} from 'node:module'; const load = make(import.meta.url); load('missing-fixture');`, 'missing-fixture'],
  ['static-keyring', `import '@napi-rs/keyring';`, '@napi-rs/keyring'],
  ['uncaught-keyring', `import('@napi-rs/keyring');`, '@napi-rs/keyring'],
  ['unawaited-keyring', `try { import('@napi-rs/keyring'); } catch {}`, '@napi-rs/keyring'],
])('rejects %s instead of reporting a runnable build', async (_name, source, message) => {
  const root = await mkdtemp('/private/tmp/bgs-invalid-bundle-')
  try {
    await writeFile(join(root, 'cli.js'), source)
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'check-bundle-integrity.ts'), root], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(1)
    expect(output).toContain(message)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('catches loader aliases without confusing a same-named local callback', async () => {
  const root = await mkdtemp('/private/tmp/bgs-loader-shadow-')
  try {
    await writeFile(join(root, 'cli.js'), `import {createRequire} from 'node:module'; const r=createRequire(import.meta.url);
      function local(r) { r('not-a-dependency'); } try { await import('@napi-rs/keyring'); } catch {}`)
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, 'check-bundle-integrity.ts'), root], { stdout: 'pipe', stderr: 'pipe' })
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()])
    expect(code).toBe(0)
    expect(output).toContain('0 个错误, 1 个警告')
  } finally { await rm(root, { recursive: true, force: true }) }
})

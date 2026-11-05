import { expect, test } from 'bun:test'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectDependencies, copyBuildDependencies, prepareBuildCaches } from './editable-project'
import { commandCheck } from './checks'

// Reproduce package-manager bin and package links without installing packages.
test.each(['relative', 'absolute'] as const)('isolated build preserves %s dependency links and package-relative imports', async kind => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-dependency-links-')))
  try {
    const modules = join(root, 'node_modules'), pkg = join(modules, '.store/demo')
    await mkdir(join(pkg, 'bin'), { recursive: true })
    await mkdir(join(pkg, 'dist'))
    await mkdir(join(modules, '.bin'))
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'demo-build' } }))
    await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}')
    await writeFile(join(pkg, 'bin/build.mjs'), '#!/usr/bin/env node\nimport "../dist/cli.mjs";\n')
    await chmod(join(pkg, 'bin/build.mjs'), 0o755)
    await writeFile(join(pkg, 'dist/cli.mjs'), `import {lstat,realpath,mkdir,writeFile} from 'node:fs/promises';
import {relative,isAbsolute} from 'node:path';
for(const path of ['node_modules/.bin/demo-build','node_modules/demo']) {
  if(!(await lstat(path)).isSymbolicLink())throw Error('Dependency link was flattened');
  const target=relative(process.cwd(),await realpath(path));
  if(target.startsWith('..')||isAbsolute(target))throw Error('Dependency escaped the build copy');
}
for(const cache of ['.vite-temp','.tmp'])await writeFile('node_modules/'+cache+'/build-info','cache');
try {
  await writeFile('node_modules/demo/dist/cli.mjs','changed');
  throw Error('Dependency unexpectedly writable');
} catch(error) {if(!['EPERM','EACCES','EROFS'].includes(error.code))throw error;}
await mkdir('dist');await writeFile('dist/index.html','<html>Package-relative import succeeded</html>');`)
    await symlink(kind === 'relative' ? '.store/demo' : pkg, join(modules, 'demo'))
    const bin = join(modules, '.bin/demo-build')
    const binTarget = kind === 'relative' ? '../demo/bin/build.mjs' : join(modules, 'demo/bin/build.mjs')
    await symlink(binTarget, bin)
    const before = await projectDependencies(root)
    const isolated=join(root,'.isolated-copy')
    await mkdir(isolated)
    await cp(join(root,'package.json'),join(isolated,'package.json'))
    expect(await copyBuildDependencies(root,isolated)).toBe(true)
    await prepareBuildCaches(isolated)
    const result = await commandCheck(isolated,'build',undefined,true)
    expect(result.code,result.log).toBe(0)
    expect(await readFile(join(isolated,'dist/index.html'),'utf8')).toContain('Package-relative import succeeded')
    expect(await projectDependencies(root)).toBe(before)
    expect((await lstat(bin)).isSymbolicLink()).toBe(true)
    expect(await readlink(bin)).toBe(binTarget)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

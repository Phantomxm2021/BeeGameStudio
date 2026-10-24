import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildEditableProject } from './editable-project'
import { commandCheck, projectDependencies, projectFiles } from './checks'

const task = { editableProject: true as const, runtimeArtifact: 'dist', writablePaths: ['dist/**'] }
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-build-boundary-')))
  await mkdir(join(root, 'node_modules/tiny'), { recursive: true })
  await writeFile(join(root, 'node_modules/tiny/index.js'), 'PROTECTED_DEPENDENCY')
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }))
  await writeFile(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}')
  return root
}
const output = `mkdirSync('dist');writeFileSync('dist/index.html','<html>Boundary checks passed</html>');`

test('isolated Vite cache permits cache writes but preserves dependency, original-project and network boundaries', async () => {
  const root = await fixture()
  let requests = 0
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { requests++; return new Response('denied') } })
  try {
    await mkdir(join(root, 'node_modules/.vite-temp'))
    await writeFile(join(root, 'node_modules/.vite-temp/keep.txt'), 'ORIGINAL_CACHE')
    await writeFile(join(root, 'build.mjs'), `
import {writeFileSync,readFileSync,mkdirSync,renameSync,unlinkSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import assert from 'node:assert/strict';
const cache='node_modules/.vite-temp',dep='node_modules/tiny/index.js';
const original=${JSON.stringify(root)};
const deny=(name,action)=>{assert.throws(action,undefined,name);assert.equal(readFileSync(dep,'utf8'),'PROTECTED_DEPENDENCY',name)};
writeFileSync(cache+'/config.mjs','temporary config');
assert.equal(readFileSync(cache+'/config.mjs','utf8'),'temporary config');
deny('dependency write',()=>writeFileSync(dep,'bad'));
deny('dependency deletion',()=>unlinkSync(dep));
deny('unrelated cache',()=>mkdirSync('node_modules/.cache'));
deny('original source read',()=>readFileSync(original+'/package.json'));
deny('original source write',()=>writeFileSync(original+'/package.json','bad'));
deny('original dependency',()=>writeFileSync(original+'/'+dep,'bad'));
deny('original cache',()=>writeFileSync(original+'/'+cache+'/keep.txt','bad'));
deny('symlink from writable cache',()=>{symlinkSync('../tiny/index.js',cache+'/alias');writeFileSync(cache+'/alias','bad')});
deny('hardlink from writable cache',()=>{linkSync(dep,cache+'/hardlink');writeFileSync(cache+'/hardlink','bad')});
deny('dependency ancestor rename',()=>{renameSync('node_modules','moved-dependencies');mkdirSync('node_modules');writeFileSync('moved-dependencies/tiny/index.js','bad')});
deny('cache rename',()=>{renameSync(cache,'node_modules/moved-cache');symlinkSync('tiny',cache);writeFileSync(cache+'/index.js','bad')});
deny('cache replacement',()=>{rmSync(cache,{recursive:true});symlinkSync('tiny',cache);writeFileSync(cache+'/index.js','bad')});
await assert.rejects(fetch(${JSON.stringify(upstream.url.origin)},{signal:AbortSignal.timeout(2000)}));
${output}`)
    const sources = await projectFiles(root, 'dist', [])
    const dependencies = await projectDependencies(root)
    const result = await buildEditableProject(root, task, [], [])
    expect(result.status, result.observation).toBe('passed')
    expect(await readFile(join(root, 'dist/index.html'), 'utf8')).toContain('Boundary checks passed')
    expect(await projectFiles(root, 'dist', [])).toEqual(sources)
    expect(await projectDependencies(root)).toBe(dependencies)
    expect(requests).toBe(0)
  } finally { upstream.stop(true); await rm(root, { recursive: true, force: true }) }
}, 15000)

test.each(['symlink', 'file'] as const)('isolated build rejects a %s cache before executing project code', async kind => {
  const root = await fixture()
  try {
    const cache = join(root, 'node_modules/.vite-temp')
    if (kind === 'symlink') await symlink('tiny', cache)
    else await writeFile(cache, 'not a directory')
    await writeFile(join(root, 'build.mjs'), 'throw Error("PROJECT_CODE_EXECUTED")')
    const before = await projectDependencies(root)
    await expect(buildEditableProject(root, task, [], [])).rejects.toThrow('Vite build cache must be a canonical directory')
    expect(await projectDependencies(root)).toBe(before)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

test('direct command checks do not inherit the isolated-copy cache exception', async () => {
  const root = await fixture()
  try {
    await mkdir(join(root, 'node_modules/.vite-temp'))
    await writeFile(join(root, 'build.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync('node_modules/.vite-temp/config.mjs','must fail');`)
    const before = await projectDependencies(root)
    const result = await commandCheck(root, 'build')
    expect(result.code, result.log).not.toBe(0)
    expect(result.log).toMatch(/EPERM|EACCES|EROFS/)
    expect(await projectDependencies(root)).toBe(before)
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

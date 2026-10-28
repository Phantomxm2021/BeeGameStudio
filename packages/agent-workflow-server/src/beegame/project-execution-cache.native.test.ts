import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { projectExecutionAccess } from './project-execution-access'
import { nativeSessionOutputPath } from './native-runtime-process-path'
import { getSafeRuntimeProcessEnvironment } from './runtime-process-environment'
import { bgsCommand, toml } from '../bgs/client'

const localTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
localTest('dependency caches stay outside test discovery and remain writable only within the session sandbox', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-dependency-cache-')))
  const game = join(root, 'game'), pack = join(root, 'package')
  await mkdir(game); await mkdir(join(pack, 'test'), { recursive: true })
  await writeFile(join(pack, 'package.json'), JSON.stringify({name:'bgs-cache-fixture',version:'1.0.0'}))
  await writeFile(join(pack, 'test/dependency.test.js'), 'throw new Error("DEPENDENCY_CACHE_TEST_MUST_NOT_RUN")')
  await writeFile(join(game, 'package.json'), JSON.stringify({name:'synthetic-game',private:true,
    dependencies:{'bgs-cache-fixture':'file:./dependency.tgz'}}))
  await writeFile(join(game, 'game.test.js'), 'test("game smoke", () => { expect(1 + 1).toBe(2) })')
  const env = getSafeRuntimeProcessEnvironment()
  const run = async (command: string[], environment = env) => {
    const child = Bun.spawn(command, {cwd:game,env:environment,stdout:'pipe',stderr:'pipe'})
    const [code,out,err] = await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
    expect(code, out + err).toBe(0)
    return out
  }
  const output = nativeSessionOutputPath(game, 'fixture', await realpath(tmpdir()))
  try {
    await run(['tar','-czf',join(game,'dependency.tgz'),'-C',root,'package'])
    const access = await projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})
    const profile = {...access.config.permissions['bgs-project'],network:{enabled:false}}
    const sandbox = (command:string[]) => bgsCommand().concat('sandbox','-C',game,'-P','bgs-project',
      '-c','permissions.bgs-project='+toml(profile),'--',...command)
    const executionEnv = {...env,...access.environment}
    // Both package managers consume only the local archive; the OS denies networking.
    await run(sandbox([process.execPath,'install','--ignore-scripts','--no-progress']),executionEnv)
    await run(sandbox(['npm','cache','add','./dependency.tgz','--offline','--ignore-scripts']),executionEnv)
    expect(await readFile(join(game,'node_modules/bgs-cache-fixture/test/dependency.test.js'),'utf8'))
      .toContain('DEPENDENCY_CACHE_TEST_MUST_NOT_RUN')
    const vitest = fileURLToPath(new URL('../../../../node_modules/vitest/vitest.mjs',import.meta.url))
    const report = JSON.parse(await run([Bun.which('node')!,vitest,'run','--root',game,'--globals',
      '--maxWorkers','1','--no-file-parallelism','--reporter=json']))
    expect(report.numTotalTests).toBe(1)
    expect(report.numFailedTestSuites).toBe(0)
    for (const key of ['XDG_CACHE_HOME','BUN_INSTALL_CACHE_DIR','NPM_CONFIG_CACHE','npm_config_cache']) {
      expect(access.environment[key]!.startsWith(game + '/')).toBe(false)
      expect(access.environment[key]!.startsWith(output + '/')).toBe(true)
    }
    const cache = dirname(access.environment.BUN_INSTALL_CACHE_DIR!)
    expect(profile.filesystem[cache]).toBe('write')
    expect(profile.filesystem[output]).toBe('read')
    expect(profile.filesystem[':slash_tmp']).toBe('deny')
    await writeFile(join(game,'permissions.cjs'), `
      const fs = require('node:fs');
      for (const name of ['XDG_CACHE_HOME','BUN_INSTALL_CACHE_DIR','NPM_CONFIG_CACHE']) {
        fs.mkdirSync(process.env[name], {recursive:true});
        fs.writeFileSync(require('node:path').join(process.env[name], 'probe'), 'cache');
      }
      let denied = false;
      try { fs.writeFileSync(${JSON.stringify(join(root,'outside-cache'))}, 'forbidden'); }
      catch { denied = true; }
      if (!denied) throw Error('Sibling directory became writable');
    `)
    await run(sandbox([process.execPath,join(game,'permissions.cjs')]),executionEnv)
    const resumed = await projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})
    expect(resumed.environment.BUN_INSTALL_CACHE_DIR).toBe(access.environment.BUN_INSTALL_CACHE_DIR)
    expect(await readFile(join(resumed.environment.BUN_INSTALL_CACHE_DIR!, 'probe'),'utf8')).toBe('cache')
    // An existing alias must not redirect a later session preparation into game sources.
    await rm(cache,{recursive:true}); await symlink(game,cache,'dir')
    await expect(projectExecutionAccess({workspacePath:game,sessionId:'fixture',environment:env})).rejects.toThrow('link')
  } finally {
    await rm(output,{recursive:true,force:true})
    await rm(root,{recursive:true,force:true})
  }
}, 30000)

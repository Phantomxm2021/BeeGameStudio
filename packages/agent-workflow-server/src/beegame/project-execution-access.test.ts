import { expect, test } from 'bun:test'

test('missing optional clients do not block project tools or grant fallback host access', async () => {
  // Isolate module mocks from other tests; all output lives in a temporary fixture.
  const child = Bun.spawn([process.execPath, '--eval', `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join, dirname, resolve } from 'node:path';
    import { fileURLToPath } from 'node:url';
    const base = ${JSON.stringify(new URL('./', import.meta.url).href)};
    let optionalCalls = 0;
    const missing = () => { optionalCalls++; throw Error('Synthetic missing optional dependency'); };
    let playwrightCalls = 0;
    mock.module(new URL('shared-playwright.ts', base).pathname, () => ({
      sharedPlaywright: () => { playwrightCalls++; return {root:'/synthetic-playwright',moduleUrl:'file:///synthetic-playwright/index.mjs'}; },
      preparePreviewRecorder: () => { throw Error('Recorder must not run without Playwright'); },
    }));
    mock.module(new URL('shared-sharp.ts', base).pathname, () => ({ sharedSharp: missing }));
    mock.module(new URL('content-checker-runtime.ts', base).pathname, () => ({ sharedContentChecker: missing, sharedProjectReads: missing, MEDIA_PRODUCTION_ENTRY: "", RESOURCE_PRODUCTION_ENTRY: "" }));
    const { projectExecutionAccess } = await import(new URL('project-execution-access.ts', base).href);
    const { openAgentTools } = await import(new URL('workflow-v3/agent-tools.ts', base).href);
    const { produceMedia } = await import(new URL('media-production.ts', base).href);
    const { projectHostDirectory, projectWorkRoot, projectWorkDirectory } = await import(new URL('project-storage-paths.ts', base).href);
    const { nativeSessionOutputPath } = await import(new URL('native-runtime-process-path.ts', base).href);
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-optional-clients-')));
    let tools, access, other, readonly;
    try {
      access = await projectExecutionAccess({workspacePath:root,sessionId:'fixture',environment:{
        BEEGAME_SHARP_MODULE:'file:///stale-sharp.mjs',BEEGAME_PLAYWRIGHT_MODULE:'file:///stale-browser.mjs',
      }});
      assert.deepEqual(access.unavailable.sort(), ['image processing (Sharp)','project read tools','resource/media tools'].sort());
      assert.equal(optionalCalls, 3);
      assert.equal(playwrightCalls, 0);
      assert.equal(access.projectReadToolPath, undefined);
      for (const key of ['BEEGAME_SHARP_MODULE','BEEGAME_CONTENT_CHECKER_MODULE'])
        assert.equal(access.environment[key], '');
      assert.equal(access.environment.BEEGAME_FONT_MODULE, undefined);
      assert.equal(access.environment.BEEGAME_PLAYWRIGHT_MODULE, undefined);
      assert.equal(access.environment.PLAYWRIGHT_BROWSERS_PATH, undefined);
      readonly=await projectExecutionAccess({workspacePath:root,sessionId:'readonly',environment:{},readOnly:true});
      assert.equal(optionalCalls,3);
      assert.deepEqual(readonly.unavailable,[]);
      assert.equal(readonly.config.permissions['bgs-project'].filesystem[root],'read');
      assert.equal(readonly.config.permissions['bgs-project'].filesystem[':root'],'deny');
      assert.equal(readonly.projectReadToolPath,undefined);
      assert.equal(readonly.environment.BEEGAME_FONT_MODULE,undefined);
      const permissions = access.config.permissions['bgs-project'].filesystem;
      assert.equal(permissions['/synthetic-playwright'], undefined);
      assert.equal(permissions[':root'], 'deny');
      assert.equal(permissions[':slash_tmp'], 'deny');
      assert.equal(permissions[join(root, 'docs/GDD.md')], 'read');
      assert.equal(permissions[root], 'write');
      assert.equal(permissions[access.environment.BEEGAME_ASSET_CAPABILITY_FILE], 'read');
      const review = access.config.permissions['bgs-project-review'];
      assert.equal(review.filesystem[root], 'read');
      assert.equal(permissions[projectHostDirectory(root)], 'deny');
      assert.equal(review.filesystem[projectHostDirectory(root)], 'deny');
      assert.equal(permissions[projectWorkDirectory(root,'fixture')], 'read');
      assert.ok(Buffer.byteLength(join(access.environment.TMPDIR,'tsx-501','socket.pipe'))<103);
      assert.equal((await stat(access.temporary)).mode & 0o777,0o700);
      other=await projectExecutionAccess({workspacePath:root,sessionId:'fixture',environment:{}});
      assert.notEqual(access.temporary,other.temporary);
      assert.equal(permissions[other.temporary],undefined);
      await writeFile(join(other.temporary,'retained'),'other-session');
      assert.equal(access.temporary.startsWith(root + '/'), false);
      assert.equal(review.filesystem[access.temporary], 'write');
      assert.equal(review.filesystem[join(access.nativeOutput, 'cache')], 'write');
      assert.equal(review.filesystem[await realpath(process.execPath)], 'read');
      assert.equal(review.filesystem['/usr'], 'read');
      assert.equal(review.filesystem[':root'], 'deny');
      assert.equal(review.filesystem[':slash_tmp'], 'deny');
      assert.equal(review.network.enabled, false);
      assert.equal(access.config.permissions['bgs-project'].network.enabled, true);
      assert.equal(access.reviewEnvironment.TMPDIR, access.environment.TMPDIR);
      assert.equal(access.reviewEnvironment.BUN_INSTALL_CACHE_DIR, access.environment.BUN_INSTALL_CACHE_DIR);
      assert.equal(Object.keys(access.reviewEnvironment).some(key => /^(BEEGAME_|PLAYWRIGHT_)/.test(key)), false);
      for (const key of ['BEEGAME_ASSET_CAPABILITY_FILE']) {
        assert.equal(permissions[access.environment[key]], 'read');
        assert.equal(review.filesystem[access.environment[key]], undefined);
      }
      assert.equal(access.environment.BEEGAME_PREVIEW_TEST_MODULE, undefined);
      assert.equal(access.environment.BEEGAME_PREVIEW_CAPABILITY_FILE, undefined);
      assert.equal(access.environment.BEEGAME_MEASUREMENT_CAPABILITY_FILE, undefined);
      assert.notEqual(access.environment.BEEGAME_ASSET_CAPABILITY_FILE, access.environment.BEEGAME_PREVIEW_CAPABILITY_FILE);
      tools = await openAgentTools({workspacePath:root,sessionId:'fixture',getAuthToken:()=>undefined});
      assert.equal(await Bun.file(resolve(tools.directory,'preview.mjs')).exists(),false);
      assert.equal(await Bun.file(resolve(tools.directory,'assets.mjs')).exists(),true);
      process.env.BEEGAME_SHARP_MODULE = '';
      await assert.rejects(produceMedia(root,{operation:'inspect',inputs:[{input:'missing.png'}]}), /Media runtime is unavailable/);
    } finally {
      await tools?.close();
      await readonly?.close();
      await access?.close();
      if(access)await assert.rejects(stat(access.temporary),{code:'ENOENT'});
      if(other)assert.equal(await Bun.file(join(other.temporary,'retained')).text(),'other-session');
      await other?.close();
      await rm(projectWorkRoot(root),{recursive:true,force:true});
      await rm(root,{recursive:true,force:true});
    }
  `], { stdout: 'pipe', stderr: 'pipe' })
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect(code, out + err).toBe(0)
}, 30000)

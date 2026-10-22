import { expect, test } from 'bun:test'

test('missing optional clients do not block project tools or grant fallback host access', async () => {
  // Isolate module mocks from other tests; all output lives in a temporary fixture.
  const child = Bun.spawn([process.execPath, '--eval', `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    import { mkdtemp, realpath, rm } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const base = ${JSON.stringify(new URL('./', import.meta.url).href)};
    const missing = () => { throw Error('Synthetic missing optional dependency'); };
    mock.module(new URL('shared-playwright.ts', base).pathname, () => ({
      sharedPlaywright: missing,
      preparePreviewRecorder: () => { throw Error('Recorder must not run without Playwright'); },
    }));
    mock.module(new URL('shared-sharp.ts', base).pathname, () => ({ sharedSharp: missing, sharedFont: missing }));
    const { projectExecutionAccess } = await import(new URL('project-execution-access.ts', base).href);
    const { openAgentTools } = await import(new URL('workflow-v3/agent-tools.ts', base).href);
    const { produceMedia } = await import(new URL('media-production.ts', base).href);
    const { nativeSessionOutputPath } = await import(new URL('native-runtime-process-path.ts', base).href);
    const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-optional-clients-')));
    let tools;
    try {
      const access = await projectExecutionAccess({workspacePath:root,sessionId:'fixture',environment:{
        BEEGAME_SHARP_MODULE:'file:///stale-sharp.mjs',BEEGAME_PLAYWRIGHT_MODULE:'file:///stale-browser.mjs',
      }});
      assert.equal(access.unavailable.length, 3);
      for (const key of ['BEEGAME_SHARP_MODULE','BEEGAME_FONT_MODULE','BEEGAME_PLAYWRIGHT_MODULE'])
        assert.equal(access.environment[key], '');
      const permissions = access.config.permissions['bgs-project'].filesystem;
      assert.equal(permissions[':root'], 'deny');
      assert.equal(permissions[':slash_tmp'], 'deny');
      assert.equal(permissions[join(root, 'docs/GDD.md')], 'read');
      assert.equal(permissions[root], 'write');
      assert.equal(permissions[access.environment.BEEGAME_ASSET_CAPABILITY_FILE], 'read');
      assert.notEqual(access.environment.BEEGAME_ASSET_CAPABILITY_FILE, access.environment.BEEGAME_PREVIEW_CAPABILITY_FILE);
      tools = await openAgentTools({workspacePath:root,sessionId:'fixture',getAuthToken:()=>undefined,
        openPreview:()=>({baseUrl:'http://127.0.0.1:1',instruction:'Synthetic inactive preview',close:async()=>{}})});
      const cli = Bun.spawn([process.execPath,join(root,tools.directory,'preview.mjs'),'--client'], {
        cwd:root,env:{...process.env,...access.environment},stdout:'pipe',stderr:'pipe',
      });
      const [code,out,err] = await Promise.all([cli.exited,new Response(cli.stdout).text(),new Response(cli.stderr).text()]);
      assert.equal(code,0,err);
      assert.equal(JSON.parse(out).playwrightModule,null);
      process.env.BEEGAME_SHARP_MODULE = '';
      await assert.rejects(produceMedia(root,{operation:'inspect',inputs:[{input:'missing.png'}]}), /Media runtime is unavailable/);
    } finally {
      await tools?.close();
      await rm(nativeSessionOutputPath(root,'fixture',await realpath(tmpdir())),{recursive:true,force:true});
      await rm(root,{recursive:true,force:true});
    }
  `], { stdout: 'pipe', stderr: 'pipe' })
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ])
  expect(code, out + err).toBe(0)
}, 30000)

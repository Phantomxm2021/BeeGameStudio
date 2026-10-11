import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Keep mocks/bootstrap/environment in a separate process, not the main suite.
const root = resolve(import.meta.dir, '../../../..')
function isolated(code: string): void {
  const directory = mkdtempSync(join(tmpdir(), 'bgs-isolation-test-'))
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        '-e',
        `
      import { strict as assert } from 'node:assert';
      import { mock } from 'bun:test';
      const directory = ${JSON.stringify(directory)};
      const path = relative => ${JSON.stringify(root)} + '/' + relative;
      ${code}
    `,
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'test',
          BEEGAME_CONFIG_DIR: directory,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    if (result.exitCode !== 0)
      throw new Error(result.stderr.toString().slice(-3000))
    expect(result.exitCode).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('host route wins over settings modelType; standalone behavior is preserved', () =>
  isolated(`
  const { getAPIProvider } = await import(path('src/utils/model/providers.ts'));
  for (const provider of ['BEDROCK','VERTEX','FOUNDRY','OPENAI','GEMINI','GROK']) {
    process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1';
    process.env['BGS_USE_' + provider] = '1';
    assert.equal(getAPIProvider({ modelType: 'grok' }), ({BEDROCK:'bedrock',VERTEX:'vertex',FOUNDRY:'foundry',OPENAI:'openai',GEMINI:'gemini',GROK:'grok'})[provider]);
    delete process.env['BGS_USE_' + provider];
  }
  assert.equal(getAPIProvider({ modelType: 'grok' }), 'firstParty');
  process.env.BGS_PROVIDER_MANAGED_BY_HOST = '0';
  assert.equal(getAPIProvider({ modelType: 'grok' }), 'grok');
  process.env.BGS_PROVIDER_MANAGED_BY_HOST = '';
  assert.equal(getAPIProvider({ modelType: 'grok' }), 'grok');
  process.env.BGS_PROVIDER_MANAGED_BY_HOST = '1';
  assert.equal(getAPIProvider({ modelType: 'grok' }), 'firstParty');
  delete process.env.BGS_PROVIDER_MANAGED_BY_HOST;
  delete process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST;
  assert.equal(getAPIProvider({ modelType: 'grok' }), 'grok');
`))

test('pane handoff clears stale canonical and legacy routes and forwards mTLS privately', () =>
  isolated(`
  const { writeInheritedProviderEnvironment, getInheritedEnvVarAssignments } = await import(path('src/utils/swarm/spawnUtils.ts'));
  process.env.BGS_USE_OPENAI = '1';
  process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE = 'synthetic-mtls-secret';
  const snapshot = await writeInheritedProviderEnvironment();
  const result = Bun.spawnSync(['/bin/sh', '-c', '. "$1"; exec "$2" -e "$3"', 'fixture', snapshot.path, process.execPath,
    'console.log(JSON.stringify(process.env))'], { env: { PATH: process.env.PATH ?? '', BGS_USE_BEDROCK:'1', CLAUDE_CODE_USE_VERTEX:'1', GROK_API_KEY:'stale', GROK_MODEL:'stale' }, stdout:'pipe', stderr:'pipe' });
  assert.equal(result.exitCode, 0);
  const env = JSON.parse(result.stdout.toString());
  assert.equal(env.BGS_USE_OPENAI, '1');
  assert.equal(env.BGS_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(env.GROK_API_KEY, undefined);
  assert.equal(env.GROK_MODEL, undefined);
  assert.equal(env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE, 'synthetic-mtls-secret');
  assert(!JSON.stringify(getInheritedEnvVarAssignments()).includes('synthetic-mtls-secret'));
  await (await import('node:fs/promises')).rm(snapshot.directory, {recursive:true,force:true});
`))

test('empty/partial setting sources and runtime defines survive, but debugger/eval flags do not', () =>
  isolated(`
  const bootstrap = await import(path('src/bootstrap/state.ts'));
  const { buildInheritedCliArgParts, getInheritedRuntimeArgs } = await import(path('src/utils/swarm/spawnUtils.ts'));
  for (const [sources, expected] of [[[], ''], [['projectSettings'], 'project']]) {
    bootstrap.setAllowedSettingSources(sources);
    const args = buildInheritedCliArgParts();
    assert.equal(args[args.indexOf('--setting-sources') + 1], expected);
  }
  assert.deepEqual(getInheritedRuntimeArgs(['--inspect=9229','--feature','fixture','-d','MACRO.VERSION:"fixture"','--eval','bad','--feature=second']),
    ['--feature','fixture','-d','MACRO.VERSION:"fixture"','--feature=second']);
`))

test('selected inline agent is saved privately and loadable through the native CLI argument', () =>
  isolated(`
  const fs = await import('node:fs/promises');
  const { writeInheritedProviderEnvironment, writeInheritedAgentDefinition } = await import(path('src/utils/swarm/spawnUtils.ts'));
  const { readAgentsArgument, parseAgentsFromJson } = await import(path('packages/builtin-tools/src/tools/AgentTool/loadAgentsDir.ts'));
  const snapshot = await writeInheritedProviderEnvironment();
  const saved = await writeInheritedAgentDefinition(snapshot.directory, {source:'flagSettings',agentType:'reviewer',whenToUse:'review',getSystemPrompt:()=> 'synthetic-private-prompt',tools:['Read'],permissionMode:'dontAsk'});
  assert.equal((await fs.stat(saved)).mode & 0o777, 0o600);
  const parsed = parseAgentsFromJson(await readAgentsArgument('@' + saved), 'flagSettings');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].getSystemPrompt(), 'synthetic-private-prompt');
  assert.equal(parsed[0].permissionMode, 'dontAsk');
  assert.equal(await writeInheritedAgentDefinition(snapshot.directory, {source:'projectSettings'}), undefined);
  await assert.rejects(() => readAgentsArgument('@' + directory + '/missing.json'));
  await fs.rm(snapshot.directory, {recursive:true,force:true});
`))

test('real Bun dev launch retains macro defines and feature gates in the child command', () =>
  isolated(`
  const fs = await import('node:fs/promises');
  const entry = directory + '/runtime.ts';
  await fs.writeFile(entry, 'import { getTeammateCommandParts } from ' + JSON.stringify(path('src/utils/swarm/spawnUtils.ts')) + '; console.log(JSON.stringify(getTeammateCommandParts()))');
  const flags = ['-d', 'MACRO.AUDIT_FLAG:"fixture"', '--feature', 'BGS_AUDIT_FIXTURE'];
  const parent = Bun.spawnSync([process.execPath,'run',...flags,entry], {env:process.env, stdout:'pipe',stderr:'pipe'});
  assert.equal(parent.exitCode,0,parent.stderr.toString());
  const parts=JSON.parse(parent.stdout.toString());
  for (const flag of flags) assert(parts.includes(flag), JSON.stringify(parts));
  assert.equal(parts.at(-1),await fs.realpath(entry));
`))

test('registration failure closes the already-started teammate before publishing app state', () =>
  isolated(`
  const fs=await import('node:fs/promises');
  const h=await import(path('src/utils/swarm/teamHelpers.ts'));
  await h.writeTeamFileAsync('fixture',{name:'fixture',createdAt:1,leadAgentId:'lead@fixture',members:[]});
  let killed=0, published=0;
  const r=path('src/utils/swarm/backends/registry.ts'); const original=await import(r);
  mock.module(r,()=>({...original,getTeammateExecutor:async()=>({setContext(){},spawn:async()=>{await fs.unlink(h.getTeamFilePath('fixture'));return {success:true,agentId:'worker@fixture',backendType:'in-process'}},kill:async()=>{killed++;return true}})}));
  const { spawnTeammate }=await import(path('packages/builtin-tools/src/tools/shared/spawnMultiAgent.ts'));
  const context={getAppState:()=>({mainLoopModel:'fixture-model'}),setAppState:()=>published++,options:{agentDefinitions:{activeAgents:[]}}};
  await assert.rejects(()=>spawnTeammate({name:'worker',prompt:'synthetic',team_name:'fixture',model:'fixture-model'},context),/started teammate was closed/);
  assert.equal(killed,1);assert.equal(published,0);
`))

test('parallel processes retain every registered member and valid atomic JSON', () =>
  isolated(`
  const h = await import(path('src/utils/swarm/teamHelpers.ts'));
  await h.writeTeamFileAsync('fixture', {name:'fixture',createdAt:1,leadAgentId:'lead@fixture',members:[]});
  const workers = Array.from({length:4}, (_, index) => Bun.spawn([process.execPath,'-e',
    'const h=await import(' + JSON.stringify(path('src/utils/swarm/teamHelpers.ts')) + '); for(let n=0;n<8;n++) await h.mutateTeamFileAsync("fixture",team=>team.members.push({agentId:"worker-' + index + '-"+n,name:"worker-' + index + '-"+n,joinedAt:1,tmuxPaneId:"",cwd:"",subscriptions:[]}));'
  ], { env: {PATH:process.env.PATH ?? '',NODE_ENV:'test',BEEGAME_CONFIG_DIR:directory},stdout:'pipe',stderr:'pipe' }));
  assert.deepEqual(await Promise.all(workers.map(worker=>worker.exited)), [0,0,0,0]);
  const team = await h.readTeamFileAsync('fixture');
  assert.equal(team.members.length, 32);
  assert.equal(new Set(team.members.map(member=>member.agentId)).size, 32);
  h.setMemberMode('fixture','worker-0-0','dontAsk');
  assert.equal(h.readTeamFile('fixture').members.length,32);
  assert.equal(h.readTeamFile('fixture').members[0].mode ?? h.readTeamFile('fixture').members.find(m=>m.name==='worker-0-0').mode,'dontAsk');
`))

const paneFixture = `
  const { createPaneBackendExecutor } = await import(path('src/utils/swarm/backends/PaneBackendExecutor.ts'));
  const config = {name:'worker',teamName:'fixture',prompt:'synthetic',cwd:directory,parentSessionId:'fixture'};
  const context = {getAppState:()=>({toolPermissionContext:{mode:'default'}})};
`

test('help-only permission recognition includes shipped aliases without permitting other CLI actions', () =>
  isolated(`
  const { checkReadOnlyConstraints }=await import(path('packages/builtin-tools/src/tools/BashTool/readOnlyValidation.ts'));
  for (const executable of ['bee-game-studio','bee-game-studio-bun','ccb','ccb-bun']) {
    assert.equal(checkReadOnlyConstraints({command:executable+' --help'},false).behavior,'allow');
    assert.equal(checkReadOnlyConstraints({command:executable+' -h'},false).behavior,'allow');
    assert.notEqual(checkReadOnlyConstraints({command:executable+' --help; touch /fixture'},false).behavior,'allow');
    assert.notEqual(checkReadOnlyConstraints({command:executable+' auth login'},false).behavior,'allow');
  }
`))
test('shutdown during native pane creation closes the late pane without sending a command', () =>
  isolated(
    paneFixture +
      `
  let release; let kills=0, sends=0;
  const gate = new Promise(resolve=>release=resolve);
  const executor = createPaneBackendExecutor({type:'tmux',createTeammatePaneInSwarmView:async()=>{await gate;return {paneId:'%fixture',isFirstTeammate:false}},sendCommandToPane:async()=>sends++,killPane:async()=>{kills++;return true}});
  executor.setContext(context);
  const spawned = executor.spawn(config);
  const cleaning = (await import(path('src/utils/cleanupRegistry.ts'))).runCleanupFunctions();
  release();
  assert.equal((await spawned).success,false);
  await cleaning;
  assert.equal(kills,1); assert.equal(sends,0);
  assert.equal((await executor.spawn(config)).success,false);
`,
  ))

test('kill during command dispatch cannot be followed by successful spawn', () =>
  isolated(
    paneFixture +
      `
  let release, started; let kills=0;
  const sending = new Promise(resolve=>started=resolve);
  const gate = new Promise(resolve=>release=resolve);
  const executor = createPaneBackendExecutor({type:'tmux',createTeammatePaneInSwarmView:async()=>({paneId:'%fixture',isFirstTeammate:false}),sendCommandToPane:async()=>{started();await gate},killPane:async()=>{kills++;return true}});
  executor.setContext(context);
  const spawned=executor.spawn(config); await sending;
  const killed=executor.kill('worker@fixture'); release();
  assert.equal((await spawned).success,false);
  assert.equal(await killed,true); assert.equal(kills,1);
  assert.equal(await executor.isActive('worker@fixture'),false);
`,
  ))

test('separate tmux windows keep the actual external origin even under a tmux parent', () =>
  isolated(
    paneFixture +
      `
  const d = path('src/utils/swarm/backends/detection.ts');
  const original = await import(d); mock.module(d,()=>({...original,isInsideTmux:async()=>true}));
  let sending, killing;
  const executor=createPaneBackendExecutor({type:'tmux',createTeammateWindowInSwarmView:async()=>({paneId:'%fixture',windowName:'fixture',isFirstTeammate:false,cleanup:{useExternalSession:true,tmuxSocketName:'original-socket'}}),sendCommandToPane:async(id,command,external)=>sending=external,killPane:async(id,external,metadata)=>{killing=[external,metadata.tmuxSocketName];return true}});
  executor.setContext(context);
  const result=await executor.spawn({...config,useSplitPane:false});
  assert.equal(result.success,true); assert.equal(sending,true);
  assert.equal(result.insideTmux,false);
  await executor.kill(result.agentId);
  assert.deepEqual(killing,[true,'original-socket']);
`,
  ))

test('fresh tmux backend closes the persisted socket, not the new process socket', () =>
  isolated(`
  const e=path('src/utils/execFileNoThrow.ts'); const original=await import(e);let args;
  mock.module(e,()=>({...original,execFileNoThrow:async(command,a)=>{args=a;return {stdout:'',stderr:'',code:0}}}));
  const { TmuxBackend } = await import(path('src/utils/swarm/backends/TmuxBackend.ts'));
  assert(await new TmuxBackend().killPane('%1',true,{useExternalSession:true,tmuxSocketName:'persisted-socket'}));
  assert.deepEqual(args,['-L','persisted-socket','kill-pane','-t','%1']);
`))

test('fresh Windows backend uses a non-secret saved launcher fingerprint and rejects arbitrary locators', () =>
  isolated(`
  const { WindowsTerminalBackend } = await import(path('src/utils/swarm/backends/WindowsTerminalBackend.ts'));
  const fs=await import('node:fs/promises');let encoded;
  const runner=async(command,args)=>{if(command==='wt.exe'){encoded=args[args.indexOf('-EncodedCommand')+1];const decoded=Buffer.from(encoded,'base64').toString('utf16le');await fs.writeFile(decoded.match(/Set-Content -LiteralPath '([^']+)'/)[1],'12345');} return {stdout:'',stderr:'',code:0}};
  const backend=new WindowsTerminalBackend({runCommand:runner,getPlatform:()=> 'windows',pidFileDir:directory});
  const pane=await backend.createTeammatePaneInSwarmView('worker','blue');
  await backend.sendCommandToPane(pane.paneId,"Write-Output 'synthetic'");
  const metadata=backend.getPaneCleanupMetadata(pane.paneId);
  assert(!JSON.stringify(metadata).includes(encoded));
  let recoveredCommand='';const fresh=new WindowsTerminalBackend({runCommand:async(command,args)=>{recoveredCommand=args.join(' ');return {stdout:'',stderr:'',code:0}},getPlatform:()=> 'windows',pidFileDir:directory});
  assert.equal(await fresh.killPane(pane.paneId,false,metadata),true);
  assert(recoveredCommand.includes('Test-PaneLauncher'));assert(recoveredCommand.includes('taskkill.exe /PID $p.ProcessId /T /F'));
  const other=new WindowsTerminalBackend({runCommand:runner,getPlatform:()=> 'windows',pidFileDir:directory});
  assert.equal(await other.killPane(pane.paneId,false,{...metadata,windows:{...metadata.windows,pidFile:'/unrelated/file'}}),false);
`))

test('restart cleanup retains old records lacking verified pane locators', () => isolated(`
  const registry=await import(path('src/utils/swarm/backends/registry.ts'));
  await registry.ensureBackendsRegistered();let killed=0;
  class FakeBackend { type='tmux'; async killPane(){killed++;return true} }
  registry.registerTmuxBackend(FakeBackend);
  assert.equal(await registry.closeTeammatePane('tmux','%legacy',false),false);
  assert.equal(killed,0);
`))

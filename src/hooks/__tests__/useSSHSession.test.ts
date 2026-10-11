import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

test.each(['reconnect', 'disconnect', 'cleanup', 'end'])('SSH permissions become unusable on %s without clearing other owners', action => {
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    const root = ${JSON.stringify(root)};
    const action = ${JSON.stringify(action)};
    const unrelated = { toolUseID: 'other-owner' };
    let callbacks, queue = [unrelated], sent = [], loading = [], effects = [], sendAccepted = true;
    mock.module('react', () => ({ useRef: value => ({current:value}), useEffect: fn => effects.push(fn()), useCallback: fn => fn, useMemo: fn => fn() }));
    mock.module(root+'/src/utils/debug.ts', () => ({ logForDebugging() {} }));
    mock.module(root+'/src/utils/gracefulShutdown.ts', () => ({ gracefulShutdown() {} }));
    mock.module(root+'/src/Tool.ts', () => ({ findToolByName() {} }));
    mock.module(root+'/src/remote/remotePermissionBridge.ts', () => ({ createSyntheticAssistantMessage: () => ({}), createToolStub: name => ({name}) }));
    mock.module(root+'/src/remote/sdkMessageAdapter.ts', () => ({ convertSDKMessage: () => ({type:'skip'}), isSessionEndMessage: () => false }));
    const manager = { connect() {}, disconnect() {}, sendInterrupt() {}, sendMessage: async () => sendAccepted,
      respondToPermissionRequest: (id, decision) => { sent.push({id,decision}); return sendAccepted } };
    const session = { createManager: options => { callbacks=options; return manager }, proxy: {stop(){}}, getStderrTail: () => '', proc: {exitCode:0,signalCode:null} };
    const { useSSHSession } = await import(root+'/src/hooks/useSSHSession.ts');
    const hook = useSSHSession({session,tools:[],setMessages(){},setIsLoading:value=>loading.push(value),setToolUseConfirmQueue:fn=>{queue=fn(queue)}});
    const request = { tool_name:'Bash', tool_use_id:'same-tool', input:{} };
    callbacks.onPermissionRequest(request,'old-request');
    const old = queue[1];
    if (action === 'reconnect') callbacks.onReconnecting(1,3);
    if (action === 'disconnect') hook.disconnect();
    if (action === 'cleanup') effects.at(-1)();
    if (action === 'end') callbacks.onDisconnected();
    assert.deepEqual(queue,[unrelated]);
    old.onAllow({}); old.onReject('stale'); old.onAbort();
    assert.deepEqual(sent,[]);
    if (action === 'reconnect') {
      callbacks.onConnected();
      callbacks.onPermissionRequest(request,'new-request');
      old.onAllow({});
      assert.equal(queue.length,2);
      queue[1].onAllow({});
      assert.equal(sent[0].id,'new-request');
      assert.equal(sent.length,1);
      assert.deepEqual(queue,[unrelated]);
      assert.equal(loading.at(-1),true);
      sendAccepted=false;
      assert.equal(await hook.sendMessage('not-delivered'),false);
      assert.equal(loading.at(-1),false);
      callbacks.onPermissionRequest(request,'failed-permission');
      queue[1].onAllow({});
      assert.equal(loading.at(-1),false);
    }
  `], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  if (child.exitCode !== 0) throw new Error(child.stderr.toString().slice(-3000))
  expect(child.exitCode).toBe(0)
})

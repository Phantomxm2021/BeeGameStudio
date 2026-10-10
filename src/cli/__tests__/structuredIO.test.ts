import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../..')

function isolated(code: string): void {
  // Keep the SDK's singleton bootstrap and permissions out of other tests.
  const child = Bun.spawnSync(
    [
      process.execPath,
      '-e',
      `
    import { strict as assert } from 'node:assert';
    import { z } from 'zod/v4';
    const { StructuredIO } = await import(${JSON.stringify(resolve(root, 'src/cli/structuredIO.ts'))});
    async function* input() {}
    const io = new StructuredIO(input());
    io.write = async () => {};
    const request = { subtype: 'can_use_tool', tool_use_id: 'tool-1' };
    async function deadline(promise) {
      let timer;
      try {
        return await Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Permission request stalled')), 200);
        })]);
      } finally { clearTimeout(timer); }
    }
    ${code}
  `,
    ],
    { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 5000 },
  )
  if (child.exitCode !== 0)
    throw new Error(child.stderr.toString().slice(-3000))
  expect(child.exitCode).toBe(0)
}

test('permission broker can respond synchronously after the request is registered', () =>
  isolated(`
  io.setOnControlRequestSent(r => {
    assert.equal(io.getPendingPermissionRequests().length, 1);
    io.injectControlResponse({type:'control_response', response:{subtype:'success', request_id:r.request_id, response:{value:'ok'}}});
  });
  assert.deepEqual(await deadline(io.sendRequest(request, z.object({value:z.string()}))), {value:'ok'});
  assert.equal(io.getPendingPermissionRequests().length, 0);
`))

test('synchronous cancellation in the broker does not leave a pending permission', () =>
  isolated(`
  const controller = new AbortController();
  io.setOnControlRequestSent(() => controller.abort());
  await assert.rejects(deadline(io.sendRequest(request, z.object({}), controller.signal)), {name:'AbortError'});
  assert.equal(io.getPendingPermissionRequests().length, 0);
`))

test('broker failure rejects the request and removes pending state', () =>
  isolated(`
  io.setOnControlRequestSent(() => { throw new Error('broker failed'); });
  await assert.rejects(deadline(io.sendRequest(request, z.object({}))), /broker failed/);
  assert.equal(io.getPendingPermissionRequests().length, 0);
`))

test('normal asynchronous responses and input closure still settle pending requests', () =>
  isolated(`
  const pending = io.sendRequest(request, z.object({value:z.string()}));
  const outgoing = (await io.outbound.next()).value;
  io.injectControlResponse({type:'control_response', response:{subtype:'success', request_id:outgoing.request_id, response:{value:'later'}}});
  assert.deepEqual(await deadline(pending), {value:'later'});
  const closed = io.sendRequest(request, z.object({}));
  const rejection = assert.rejects(deadline(closed), /stream closed before response/i);
  await io.structuredInput.next();
  await rejection;
  assert.equal(io.getPendingPermissionRequests().length, 0);
`))

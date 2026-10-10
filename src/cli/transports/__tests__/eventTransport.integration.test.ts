import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '../../../..')

// Requires local socket permission; run explicitly with BGS_TEST_LOOPBACK=1.
test.skipIf(process.env.BGS_TEST_LOOPBACK !== '1')(
  'real loopback HTTP delivers oversized concurrent batches and SSE replay exactly once',
  () => {
    // Local transport integration only: synthetic auth, no model or live service.
    const child = Bun.spawnSync(
      [
        process.execPath,
        '-e',
        `
    import { strict as assert } from 'node:assert';
    globalThis.MACRO = {VERSION:'fixture'};
    const { HybridTransport } = await import(${JSON.stringify(resolve(root, 'src/cli/transports/HybridTransport.ts'))});
    const { SSETransport } = await import(${JSON.stringify(resolve(root, 'src/cli/transports/SSETransport.ts'))});
    const received = [], delivered = [], acknowledged = [];
    let posts = 0;
    const frame = seq => 'id: '+seq+'\\nevent: client_event\\ndata: '+JSON.stringify({
      event_id:'e'+seq, sequence_num:seq, event_type:'user', source:'fixture',
      payload:{type:'user', uuid:'u'+seq},
    })+'\\n\\n';
    const server = Bun.serve({hostname:'127.0.0.1', port:0, async fetch(request) {
      if (request.method === 'POST') {
        const { events } = await request.json();
        posts++;
        received.push(...events.map(e => e.uuid));
        return new Response('{}', {status:201, headers:{'Content-Type':'application/json'}});
      }
      return new Response(new ReadableStream({start(c) {
        c.enqueue(new TextEncoder().encode(frame(1)+frame(1)+frame(2)));
        c.close();
      }}), {headers:{'Content-Type':'text/event-stream'}});
    }});
    const hybrid = new HybridTransport(new URL('ws://127.0.0.1:'+server.port+'/ws/fixture'));
    const sse = new SSETransport(new URL('http://127.0.0.1:'+server.port+'/events/stream'), {}, 'fixture', undefined, undefined,
      () => ({Authorization:'Bearer synthetic-fixture-token'}));
    let timer;
    try {
      await Promise.race([
        Promise.all([
          hybrid.writeBatch(Array.from({length:10001}, (_,i) => ({type:'user', uuid:String(i)}))),
          hybrid.writeBatch([{type:'user', uuid:'last'}]),
        ]),
        new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('HTTP upload stalled')), 5000)}),
      ]);
      await hybrid.flush();
      assert.deepEqual(received, [...Array.from({length:10001}, (_,i) => String(i)), 'last']);
      sse.setOnData(data => {delivered.push(JSON.parse(data).uuid)});
      sse.setOnEvent(event => {
        acknowledged.push(event.sequence_num);
        if (event.sequence_num === 2) sse.close();
      });
      await sse.connect();
      assert.deepEqual(delivered, ['u1','u2']);
      assert.deepEqual(acknowledged, [1,2]);
      console.log(JSON.stringify({events:received.length, posts, sseDelivered:delivered.length, modelCalls:0}));
    } finally {
      clearTimeout(timer);
      sse.close();
      hybrid.close();
      server.stop(true);
    }
  `,
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? '',
          NODE_ENV: 'test',
          BGS_DISABLE_NONESSENTIAL_TRAFFIC: '1',
          CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'synthetic-fixture-token',
          NO_PROXY: '127.0.0.1',
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 10000,
      },
    )
    if (child.exitCode !== 0)
      throw new Error(child.stderr.toString().slice(-3000))
    expect(JSON.parse(child.stdout.toString())).toMatchObject({
      events: 10002,
      sseDelivered: 2,
      modelCalls: 0,
    })
    expect(child.exitCode).toBe(0)
  },
)

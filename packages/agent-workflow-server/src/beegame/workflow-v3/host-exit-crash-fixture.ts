// Dedicated child of host-exit-receipt.test.ts. Never opens a real project or
// real provider. The parent kills this exact process at an observed checkpoint.
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { getMacroDefines } from '../../../../../scripts/defines'
import { createLocalWorkflowStore, type WorkflowStore } from './store'
import { createHostExitReceipts } from './host-exit-receipt'
import { createAgentGoalExecutor } from './agent-goal'
import { createV3Executor } from './execution'
import { BeeGameSessionManager } from '../session-manager'
import type { Run } from './state'

const job = JSON.parse(await Bun.stdin.text()) as {
  root: string; key: string; mode: 'agent' | 'source' | 'no-start' | 'before-exit'; run: Run; body?: unknown
}
const root = await realpath(job.root)
if (dirname(root) !== await realpath(tmpdir()) || !basename(root).startsWith('bgs-v3-exit-crash-') ||
    job.run.workspacePath !== join(root, 'workspace') || job.run.projectId !== 'synthetic-exit-project')
  throw Error('Only the dedicated synthetic crash fixture is allowed')
Object.assign(globalThis, { MACRO: Object.fromEntries(Object.entries(getMacroDefines())
  .map(([key,value]) => [key.replace('MACRO.',''), JSON.parse(value)])) })
const base = createLocalWorkflowStore(join(root, 'store'))
async function checkpoint(event: string) {
  console.log(JSON.stringify({ checkpoint: event, pid: process.pid }))
  // Keep the child alive for the parent's explicit SIGKILL, not an auto retry.
  for (;;) await Bun.sleep(1000)
}
const store: WorkflowStore = { read: base.read, async commit(...args) {
  if (args[4] === 'agent.writer-quiesced' || args[4] === 'writer.quiesced')
    await checkpoint('receipt-before-database')
  await base.commit(...args)
  if (args[4] === 'agent.turn-claimed' && job.mode === 'before-exit') await checkpoint('before-exit')
  if (args[4] === 'agent.turn-claimed' && job.mode === 'no-start') throw Error('Synthetic lost reservation response')
} }
const sessions = new BeeGameSessionManager({ async start(input) {
  if(job.mode === 'source' || job.mode === 'no-start' || job.mode === 'before-exit') throw Error('No native start permitted')
  input.onNativeSessionId?.('11111111-2222-4333-8444-555555555555')
  return { stop(){}, async dispose(){}, async submit(turn) {
    await writeFile(join(job.run.workspacePath,'candidate.txt'),'Synthetic candidate; never game acceptance')
    await turn.onMessage({type:'result',subtype:'success',session_id:'11111111-2222-4333-8444-555555555555',
      usage:{input_tokens:5,output_tokens:2},result:'Synthetic only'} as any)
  } }
} }, join(root,'sessions'), async()=>({}), {}, true)
const exitReceipts = createHostExitReceipts({dataRoot:join(root,'host'),key:Buffer.from(job.key,'hex')})!
if(job.mode === 'source') await createV3Executor({store,sessions,exitReceipts}).edit(job.run,job.body)
else await createAgentGoalExecutor({store,sessions,exitReceipts}).start(job.run,{})
// Native execution is asynchronous; keep this exact synthetic worker alive.
for (;;) await Bun.sleep(1000)

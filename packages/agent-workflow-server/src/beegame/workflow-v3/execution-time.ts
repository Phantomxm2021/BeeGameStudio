import type { Run } from './state'

/** Count observed Agent turn intervals, never the age of the project or delayed settlement. */
export function projectExecutionTime(run: Run | undefined, writerActive: boolean, now = Date.now()):
  { elapsed_ms: number; running: boolean } | undefined {
  if (!run?.agentTurns) return undefined
  let elapsed = 0, running = false
  for (const turn of run.agentTurns) {
    if (turn.notStarted) continue
    const start = Date.parse(turn.startedAt)
    const end = turn.quiescedAt ?? turn.finishedAt
    const live = !end && turn.status === 'running' && run.writer?.attemptId === turn.attemptId && writerActive
    // An unresolved writer after a disconnect/restart is not proof it kept running.
    if (!end && !live) return undefined
    const finish = end ? Date.parse(end) : now
    if (!Number.isFinite(start) || !Number.isFinite(finish) || start > finish || finish > now) return undefined
    elapsed += finish - start
    running ||= live
  }
  return { elapsed_ms: elapsed, running }
}

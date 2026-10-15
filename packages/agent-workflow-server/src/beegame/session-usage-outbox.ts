import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BeeGameSessionUsageBillingBackend } from './session-manager'

type BillingInput = Parameters<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>[1]
type BillingResult = Awaited<ReturnType<NonNullable<BeeGameSessionUsageBillingBackend['recordUsage']>>>
export type PendingSessionUsage = { userId: string; input: Omit<BillingInput, 'authToken'> }

/** Durable usage snapshots; never stores credentials or schedules model work. */
export class SessionUsageOutbox {
  private readonly pending = new Map<string, PendingSessionUsage[]>()
  private readonly active = new Map<string, Promise<void>>()
  private readonly root: string
  private readonly timer: ReturnType<typeof setInterval>

  constructor(dataRoot: string, private readonly backend: BeeGameSessionUsageBillingBackend,
    private readonly settled: (entry: PendingSessionUsage, recorded: BillingResult, debited?: BillingResult) => void,
    private readonly failed: (error: unknown) => void) {
    this.root = join(dataRoot, 'session-usage-outbox')
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    for (const name of readdirSync(this.root).filter(name => name.endsWith('.json'))) {
      // Corrupt pending financial data must not be treated as an empty queue.
      const entries = JSON.parse(readFileSync(join(this.root, name), 'utf8')) as PendingSessionUsage[]
      if (!Array.isArray(entries) || !entries.length || entries.some(entry =>
        !entry?.userId || !entry.input?.sessionId || !entry.input?.idempotencyKey ||
        !entry.input.usage || this.key(entry) + '.json' !== name))
        throw new Error('Invalid pending session usage file: ' + name)
      this.pending.set(name.slice(0, -5), entries)
    }
    this.timer = setInterval(() => { void this.flushAll() }, 60_000)
    this.timer.unref()
    void this.flushAll()
  }

  submit(entry: PendingSessionUsage): Promise<void> {
    const key = this.key(entry)
    const entries = this.pending.get(key) ?? []
    if (!entries.some(item => item.input.idempotencyKey === entry.input.idempotencyKey)) {
      // Save before either remote operation. A lost response is safely replayed
      // with the same idempotency key after restart.
      this.save(key, [...entries, entry])
    }
    return this.flush(key)
  }

  async dispose(): Promise<void> {
    clearInterval(this.timer)
    await Promise.allSettled(this.active.values())
  }

  private key(entry: PendingSessionUsage): string {
    return createHash('sha256').update(JSON.stringify([entry.userId, entry.input.sessionId])).digest('hex')
  }

  private save(key: string, entries: PendingSessionUsage[]): void {
    const path = join(this.root, key + '.json')
    if (entries.length) {
      const temporary = path + '.' + randomUUID() + '.tmp'
      writeFileSync(temporary, JSON.stringify(entries), { mode: 0o600 })
      renameSync(temporary, path)
      this.pending.set(key, entries)
    } else {
      unlinkSync(path)
      this.pending.delete(key)
    }
  }

  private flush(key: string): Promise<void> {
    const running = this.active.get(key)
    if (running) return running.then(() => this.pending.has(key) ? this.flush(key) : undefined)
    const run = Promise.resolve().then(async () => {
      while (this.pending.has(key)) {
        const entry = this.pending.get(key)![0]!
        const recorded = await this.backend.recordUsage!(entry.userId, entry.input)
        const debited = await this.backend.debitRealtimeUsage?.(entry.userId, entry.input)
        if (recorded?.event?.idempotencyKey !== entry.input.idempotencyKey ||
            this.backend.debitRealtimeUsage && debited?.event?.idempotencyKey !== entry.input.idempotencyKey)
          throw new Error('Billing did not confirm the pending usage key')
        // New terminal bills may have arrived while the request was in flight.
        this.save(key, this.pending.get(key)!.filter(item => item.input.idempotencyKey !== entry.input.idempotencyKey))
        this.settled(entry, recorded, debited)
      }
    })
    this.active.set(key, run)
    void run.then(() => this.active.delete(key), () => this.active.delete(key))
    return run
  }

  private async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map(key => this.flush(key).catch(this.failed)))
  }
}

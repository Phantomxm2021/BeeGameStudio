import {
  appendAuditEvent,
  listAuditEvents,
  type AppendAuditEventInput,
} from './audit-events-store'
import {
  getCreditBalance,
  listCreditLedger,
  refundCreditReservation,
  reserveCredits,
  settleCreditReservation,
  summarizeCreditLedger,
  type CreditBalance,
  type CreditLedgerEntry,
  type CreditLedgerSummary,
  type CreditReservation,
} from './credit-store'
import {
  loadRuntimeSettingsConfig,
  mapRuntimeSettingsToEnv,
} from './runtime-settings-store'
import type { BeeGameUserContext } from './auth/user-context'
import type { SupabaseDashboardStore } from './supabase-dashboard-store'
import {
  loadWebToolsConfig,
  mapWebToolsConfigToRuntimeEnv,
} from './web-tools-store'

export type DashboardRepositoryOptions = {
  dashboardDataRoot: string
  supabaseStore?: SupabaseDashboardStore
  getUserDataRoot: (request?: Request) => string
}

type CreditReserveInput = Omit<Parameters<typeof reserveCredits>[1], 'dataDir'>
type CreditSettleInput = Omit<
  Parameters<typeof settleCreditReservation>[1],
  'dataDir'
>
type CreditRefundInput = Omit<
  Parameters<typeof refundCreditReservation>[1],
  'dataDir'
>

export class DashboardRepository {
  readonly supabaseStore?: SupabaseDashboardStore

  constructor(private readonly options: DashboardRepositoryOptions) {
    this.supabaseStore = options.supabaseStore
  }

  async getCreditBalance(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<CreditBalance> {
    return this.supabaseStore
      ? this.supabaseStore.getCreditBalance(user.id)
      : getCreditBalance(user.id, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async listCreditLedger(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<CreditLedgerEntry[]> {
    return this.supabaseStore
      ? this.supabaseStore.listCreditLedger(user.id)
      : listCreditLedger(user.id, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async summarizeCreditLedger(
    request: Request,
    user: BeeGameUserContext,
    projectId?: string,
  ): Promise<CreditLedgerSummary> {
    return this.supabaseStore
      ? this.supabaseStore.summarizeCreditLedger(user.id, projectId)
      : summarizeCreditLedger(user.id, {
          dataDir: this.options.getUserDataRoot(request),
          ...(projectId ? { projectId } : {}),
        })
  }

  async reserveCredits(
    request: Request,
    user: BeeGameUserContext,
    input: CreditReserveInput,
  ): Promise<CreditReservation> {
    return this.supabaseStore
      ? this.supabaseStore.reserveCredits(user.id, input)
      : reserveCredits(user.id, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async settleCreditReservation(
    request: Request,
    user: BeeGameUserContext,
    input: CreditSettleInput,
  ): Promise<ReturnType<typeof settleCreditReservation>> {
    return this.supabaseStore
      ? this.supabaseStore.settleCreditReservation(user.id, input)
      : settleCreditReservation(user.id, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async refundCreditReservation(
    request: Request,
    user: BeeGameUserContext,
    input: CreditRefundInput,
  ): Promise<ReturnType<typeof refundCreditReservation>> {
    return this.supabaseStore
      ? this.supabaseStore.refundCreditReservation(user.id, input)
      : refundCreditReservation(user.id, {
          ...input,
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async appendAuditEvent(
    request: Request,
    user: BeeGameUserContext,
    input: AppendAuditEventInput,
  ): Promise<void> {
    if (this.supabaseStore) {
      await this.supabaseStore.appendAuditEvent(user.id, input)
      return
    }
    appendAuditEvent(input, {
      dataDir: this.options.getUserDataRoot(request),
    })
  }

  async listAuditEvents(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<ReturnType<typeof listAuditEvents>> {
    return this.supabaseStore
      ? this.supabaseStore.listAuditEvents(user.id)
      : listAuditEvents({
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async getRuntimeEnv(
    userDataRoot?: string,
    userId?: string,
  ): Promise<Record<string, string>> {
    const dataDir = userDataRoot ?? this.options.dashboardDataRoot
    if (this.supabaseStore && userId) {
      const [webTools, runtimeSettings] = await Promise.all([
        this.supabaseStore.loadWebTools(userId),
        this.supabaseStore.loadRuntimeSettings(userId),
      ])
      return {
        ...mapWebToolsConfigToRuntimeEnv(webTools),
        ...mapRuntimeSettingsToEnv(runtimeSettings, { dataDir }),
      }
    }
    return {
      ...mapWebToolsConfigToRuntimeEnv(loadWebToolsConfig({ dataDir })),
      ...mapRuntimeSettingsToEnv(loadRuntimeSettingsConfig({ dataDir }), {
        dataDir,
      }),
    }
  }
}

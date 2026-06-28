import {
  createModelConfig,
  deleteModelConfig,
  exportModelConfigSnapshot,
  importModelConfigSnapshot,
  listModelConfigs,
  updateModelConfig,
  type ModelProviderKind,
} from '@claude-code-best/agent-workflow'
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
  saveRuntimeSettingsConfig,
  type RuntimeSettingsConfig,
} from './runtime-settings-store'
import type { BeeGameUserContext } from './auth/user-context'
import {
  saveModelConfigsToStore,
  type ModelConfigStoreOptions,
} from './model-config-store'
import type { SupabaseDashboardStore } from './supabase-dashboard-store'
import {
  loadWebToolsConfig,
  mapWebToolsConfigToRuntimeEnv,
  saveWebToolsConfig,
  toPublicWebToolsConfig,
  type WebToolsConfig,
} from './web-tools-store'

export type DashboardRepositoryOptions = {
  dashboardDataRoot: string
  supabaseStore?: SupabaseDashboardStore
  getUserDataRoot: (request?: Request) => string
  modelConfigStore?: ModelConfigStoreOptions | false
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
type CreateModelConfigInput = {
  name: string
  provider: ModelProviderKind
  baseUrl?: string
  apiKey: string
  models: {
    fast?: string
    balanced?: string
    strong?: string
  }
  isDefault?: boolean
}
type UpdateModelConfigInput = Partial<CreateModelConfigInput>

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

  async loadWebTools(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<WebToolsConfig> {
    const config = this.supabaseStore
      ? await this.supabaseStore.loadWebTools(user.id)
      : loadWebToolsConfig({
          dataDir: this.options.getUserDataRoot(request),
        })
    return toPublicWebToolsConfig(config)
  }

  async saveWebTools(
    request: Request,
    user: BeeGameUserContext,
    input: WebToolsConfig,
  ): Promise<WebToolsConfig> {
    return this.supabaseStore
      ? this.supabaseStore.saveWebTools(user.id, input)
      : saveWebToolsConfig(input, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async loadRuntimeSettings(
    request: Request,
    user: BeeGameUserContext,
  ): Promise<RuntimeSettingsConfig> {
    return this.supabaseStore
      ? this.supabaseStore.loadRuntimeSettings(user.id)
      : loadRuntimeSettingsConfig({
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async saveRuntimeSettings(
    request: Request,
    user: BeeGameUserContext,
    input: RuntimeSettingsConfig,
  ): Promise<RuntimeSettingsConfig> {
    return this.supabaseStore
      ? this.supabaseStore.saveRuntimeSettings(user.id, input)
      : saveRuntimeSettingsConfig(input, {
          dataDir: this.options.getUserDataRoot(request),
        })
  }

  async listModelConfigs(user: BeeGameUserContext) {
    await this.syncModelConfigs()
    return listModelConfigs(user.id)
  }

  async syncModelConfigs(): Promise<void> {
    if (!this.supabaseStore) return
    importModelConfigSnapshot(await this.supabaseStore.loadModelConfigSnapshot())
  }

  async createModelConfig(
    user: BeeGameUserContext,
    input: CreateModelConfigInput,
  ) {
    await this.syncModelConfigs()
    const created = createModelConfig(user.id, input)
    await this.persistModelConfig(created.id)
    return created
  }

  async updateModelConfig(id: string, input: UpdateModelConfigInput) {
    await this.syncModelConfigs()
    const updated = updateModelConfig(id, input)
    if (updated) await this.persistModelConfig(updated.id)
    return updated
  }

  async deleteModelConfig(
    user: BeeGameUserContext,
    id: string,
  ): Promise<boolean> {
    await this.syncModelConfigs()
    const deleted = deleteModelConfig(id)
    if (!deleted) return false
    if (this.supabaseStore) {
      await this.supabaseStore.deleteModelConfig(user.id, id)
    } else {
      this.persistLocalModelConfigs()
    }
    return true
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

  private async persistModelConfig(id: string): Promise<void> {
    if (!this.supabaseStore) {
      this.persistLocalModelConfigs()
      return
    }
    const record = exportModelConfigSnapshot().find(config => config.id === id)
    if (record) await this.supabaseStore.upsertModelConfig(record)
  }

  private persistLocalModelConfigs(): void {
    const modelConfigStore = this.options.modelConfigStore
    if (modelConfigStore !== false && modelConfigStore !== undefined) {
      saveModelConfigsToStore(modelConfigStore)
    }
  }
}

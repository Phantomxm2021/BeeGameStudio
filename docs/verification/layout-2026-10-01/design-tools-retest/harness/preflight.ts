import { createSupabaseDashboardStoreFromEnv } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/supabase-dashboard-store.ts'
import { loadRuntimeImageConfig } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/image-generation/runtime-config.ts'
import { resolveBeeGameBillingConfig } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/beegame-billing-core/src/billing-config.ts'

export const modelConfigId = 'llm_ac40e5d1be394ffe925e3f2532dedd34'
export async function runtime() {
  for (const key of ['BEEGAME_SUPABASE_URL','BEEGAME_SUPABASE_ANON_KEY','BEEGAME_SMOKE_EMAIL','BEEGAME_SMOKE_PASSWORD'])
    if (!process.env[key]) throw Error('Missing required test environment: ' + key)
  const response = await fetch(process.env.BEEGAME_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method:'POST', headers:{apikey:process.env.BEEGAME_SUPABASE_ANON_KEY!, 'content-type':'application/json'},
    body:JSON.stringify({email:process.env.BEEGAME_SMOKE_EMAIL,password:process.env.BEEGAME_SMOKE_PASSWORD}),
    signal:AbortSignal.timeout(20000),
  })
  if (!response.ok) throw Error('Test authentication failed: ' + response.status)
  const auth = await response.json()
  const selected = await createSupabaseDashboardStoreFromEnv()!.withAuthToken(auth.access_token)
    .loadRlsVisibleModelRuntimeEnv(modelConfigId)
  if (selected.ANTHROPIC_DEFAULT_SONNET_MODEL !== 'ark-code-latest') throw Error('Configured model mismatch')
  const billing = resolveBeeGameBillingConfig()
  let imageConfig: Awaited<ReturnType<typeof loadRuntimeImageConfig>> | undefined
  try { imageConfig = await loadRuntimeImageConfig(import.meta.dir, {remote:true,billing}) }
  catch { /* Optional capability is accurately unavailable, not replaced by a fake provider. */ }
  return {selected, userId:auth.user.id as string, billing, imageConfig}
}
if (import.meta.main) {
  const data = await runtime()
  console.log(JSON.stringify({authenticated:true, model:data.selected.ANTHROPIC_DEFAULT_SONNET_MODEL,
    imageConfigured:Boolean(data.imageConfig), imageProvider:data.imageConfig?.provider,
    imagePricingConfigured:Boolean(data.imageConfig?.billing), billingMode:data.billing.mode}))
}

import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { registerBeeGameUsageControlRoutes } from '../usage-control-routes'
import { createImageBillingClient, validImageBillingInput } from '../image-billing'
import type { BeeGameBillingRouteRepository } from '../billing-ports'

const input = { projectId: 'project', requestId: 'image', digest: 'digest', action: 'reserve' as const, amountCreditsMicro: 100, projectBudgetCreditsMicro: 500 }
test('remote billing preserves unresolved original request identity and rejects contradictory receipts', async () => {
  const receipt = {created:false,state:'reserved',blockedByRequestId:'original',reservedCreditsMicro:100,chargedCreditsMicro:0,metadata:{}}
  let actual: Record<string, unknown> = receipt
  const client=createImageBillingClient({mode:'remote',remoteApiBaseUrl:'http://local',creditControlToken:'test'},
    async()=>Response.json(actual))
  expect(await client.apply('user',input)).toEqual(receipt)
  for(const override of [{created:true},{state:'settled'},{blockedByRequestId:''}]) {
    actual={...receipt,...override}
    await expect(client.apply('user',input)).rejects.toThrow('Invalid blocked image billing receipt')
  }
})

test('image billing validates integer amounts and never exposes service errors or retries', async () => {
  expect(validImageBillingInput(input)).toBe(true)
  expect(validImageBillingInput({ ...input, amountCreditsMicro: 0.5 })).toBe(false)
  expect(validImageBillingInput({ ...input, amountCreditsMicro: -1 })).toBe(false)
  expect(validImageBillingInput({ ...input, projectBudgetCreditsMicro: 99 })).toBe(false)
  let calls = 0
  const client = createImageBillingClient({ mode: 'remote', remoteApiBaseUrl: 'http://local', creditControlToken: 'private' }, async (_url, init) => {
    calls++; expect(new Headers(init?.headers).get('x-beegame-credit-control-token')).toBe('private')
    return new Response('private upstream error', { status: 503 })
  })
  await expect(client.apply('user', input)).rejects.toThrow('Image billing unavailable (503)')
  expect(calls).toBe(1)
})

test('image billing route requires host service credential, not user authorization', async () => {
  const app = new Hono()
  let calls = 0
  registerBeeGameUsageControlRoutes(app, {
    billingConfig: { mode: 'server', creditControlToken: 'host-secret' },
    dashboardRepository: { applyImageBilling: async (userId, received) => {
      calls++; expect(userId).toBe('user'); expect(received.requestId).toBe('image')
      return { created: true, state: 'reserved', reservedCreditsMicro: 100, chargedCreditsMicro: 0, metadata: {} }
    } } as BeeGameBillingRouteRepository,
  })
  const body = JSON.stringify({ userId: 'user', ...input })
  expect((await app.request('/api/internal/images/billing', { method: 'POST', body, headers: { authorization: 'Bearer user-token' } })).status).toBe(401)
  expect(calls).toBe(0)
  expect((await app.request('/api/internal/images/billing', { method: 'POST', body, headers: { 'x-beegame-credit-control-token': 'host-secret' } })).status).toBe(200)
  expect(calls).toBe(1)
})

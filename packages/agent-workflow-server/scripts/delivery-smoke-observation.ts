/** Read-only smoke telemetry. Display failures are not authority to stop an Agent. */
export async function observeDeliverySmoke(
  api: (path: string) => Promise<any>,
  projectId: string,
  sessionId: string,
) {
  const paths = ['/api/usage-wallet', `/api/usage/summary?projectId=${projectId}`,
    `/api/beegame-sessions/${sessionId}`, `/api/projects/${projectId}/deployment-readiness`]
  const results = await Promise.allSettled(paths.map(path => api(path)))
  const values = results.map(result => result.status === 'fulfilled' ? result.value : undefined)
  const errors = results.flatMap((result, index) => result.status === 'rejected'
    ? [{ path: paths[index]!, error: result.reason instanceof Error ? result.reason.message : 'Request failed' }] : [])
  const [wallet, usage, session, gate] = values
  // Missing/null billing fields are not zero spend.
  const numbers = [wallet?.consumedCreditsMicro, wallet?.reservedCreditsMicro, usage?.creditsMicro]
  const billingAvailable = numbers.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
  return { wallet, usage, session, gate, errors, billingAvailable }
}

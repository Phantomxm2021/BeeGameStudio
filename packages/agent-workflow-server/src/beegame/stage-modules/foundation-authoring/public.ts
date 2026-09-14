import { parseAuthorConfiguration, type AuthorConfiguration as PrivateConfiguration } from './private/contract'
import type { AuthorOperations } from './private/contract'
import { createAutonomousAuthorLifecycle } from './private/autonomous-lifecycle'
import type { RuntimeConfigurationClient } from '../../../runtime-configuration/public'
import type { UsageBillingClient } from '../../../billing/public'

export type { AuthorStartInput, AuthorHandle, AuthorResumeInput, AuthorStopInput,
  AuthorResult, AuthorDocumentsResult, AuthorDocumentArtifact } from './private/contract'
export type AuthorConfiguration = Omit<PrivateConfiguration, 'model'>
export type AuthorInfrastructure = Readonly<{
  runtimeConfiguration: RuntimeConfigurationClient
  billing: UsageBillingClient
}>

/** The only production entry point. Each invocation owns its entire author lifecycle. */
export function createFoundationAuthoring(config: AuthorConfiguration, infrastructure: AuthorInfrastructure): AuthorOperations {
  if (!infrastructure || Object.keys(infrastructure).sort().join(',') !== 'billing,runtimeConfiguration' ||
    infrastructure.billing?.protocolVersion !== 1 || infrastructure.runtimeConfiguration?.protocolVersion !== 1 ||
    !infrastructure.billing.ownerId || infrastructure.billing.ownerId !== infrastructure.runtimeConfiguration.ownerId ||
    typeof infrastructure.billing.submitUsage !== 'function' || typeof infrastructure.runtimeConfiguration.resolve !== 'function')
    throw new Error('Author requires owner-bound runtime configuration and billing clients')
  if (!config || Object.keys(config).some(key => !['workspacePath', 'privateRootPath', 'language', 'executionLimits'].includes(key)))
    throw new Error('Invalid author public configuration')
  const configuration = parseAuthorConfiguration({ ...config, model: { command: ['resolved-by-runtime-configuration'], env: {} } })
  const operations = createAutonomousAuthorLifecycle(configuration, { ...infrastructure })
  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch { throw new Error('Author operation could not be accepted or safely completed') }
  }
  return {
    start: input => invoke(() => operations.start(input)),
    resume: input => invoke(() => operations.resume(input)),
    stop: input => invoke(() => operations.stop(input)),
    getResult: handle => invoke(() => operations.getResult(handle)),
  }
}

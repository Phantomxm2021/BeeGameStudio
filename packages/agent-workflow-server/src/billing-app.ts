import {
  createBeeGameBillingRouteApp,
} from './billing-app-factory'
import {
  createBeeGameBillingRuntimeDeps,
  type BeeGameBillingRuntimeOptions,
} from './billing-runtime-deps'

export type BeeGameBillingAppOptions = BeeGameBillingRuntimeOptions

export function createBeeGameBillingApp(
  options: BeeGameBillingAppOptions = {},
): ReturnType<typeof createBeeGameBillingRouteApp> {
  return createBeeGameBillingRouteApp(createBeeGameBillingRuntimeDeps(options))
}

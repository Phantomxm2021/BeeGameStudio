// Type-only adapters over the app-server schema generated from Rust.
// Keep experimental/fixture methods on BgsClient.request until their payloads
// are represented by the generated stable schema.
import type { ClientRequest } from '../../../../vendor/bgs/codex-rs/app-server-protocol/schema/typescript'
import type {
  ConfigReadResponse,
  GetAccountResponse,
  ModelListResponse,
  SkillsExtraRootsSetResponse,
  SkillsListResponse,
  ThreadGoalClearResponse,
  ThreadGoalGetResponse,
  ThreadGoalSetResponse,
  ThreadInjectItemsResponse,
} from '../../../../vendor/bgs/codex-rs/app-server-protocol/schema/typescript/v2'

/** The app-server methods represented by the stable generated payloads used by BGS. */
export type BgsStableMethod =
  | 'model/list'
  | 'account/read'
  | 'config/read'
  | 'skills/list'
  | 'skills/extraRoots/set'
  | 'thread/goal/get'
  | 'thread/goal/set'
  | 'thread/goal/clear'
  | 'thread/inject_items'

type BgsStableResponse = {
  'model/list': ModelListResponse
  'account/read': GetAccountResponse
  'config/read': ConfigReadResponse
  'skills/list': SkillsListResponse
  'skills/extraRoots/set': SkillsExtraRootsSetResponse
  'thread/goal/get': ThreadGoalGetResponse
  'thread/goal/set': ThreadGoalSetResponse
  'thread/goal/clear': ThreadGoalClearResponse
  'thread/inject_items': ThreadInjectItemsResponse
}

export type BgsStableParams<M extends BgsStableMethod> =
  Extract<ClientRequest, { method: M }>['params']
export type BgsStableResult<M extends BgsStableMethod> = BgsStableResponse[M]

export type { DynamicToolSpec } from '../../../../vendor/bgs/codex-rs/app-server-protocol/schema/typescript/v2'
